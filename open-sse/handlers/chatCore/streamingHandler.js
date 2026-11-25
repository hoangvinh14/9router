import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { createAccountedAnthropicStream } from "../../utils/accounted-anthropic-stream.js";
import { createAccountedResponsesStream } from "../../utils/accounted-responses-stream.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import { EMPTY_PEEK_DEADLINE_MS, HTTP_STATUS, STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes, incompleteChatFinishReason } from "../../utils/responsesStreamHelpers.js";
import { buildStreamErrorBytes } from "../../utils/streamHelpers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { saveRequestDetail, trackPendingRequest } from "@/lib/usageDb.js";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../../utils/sseConstants.js";
import { upstreamResponseHeaders } from "../../utils/upstreamHeaders.js";

// Codex returns Responses API SSE → which client format to translate INTO, by request sourceFormat.
// Gemini-family all map to ANTIGRAVITY decoder; unknown sources fall back to OPENAI.
const CODEX_SOURCE_TO_TARGET = {
  [FORMATS.OPENAI_RESPONSES]: FORMATS.OPENAI_RESPONSES,
  [FORMATS.CLAUDE]: FORMATS.CLAUDE,
  [FORMATS.ANTIGRAVITY]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI_CLI]: FORMATS.ANTIGRAVITY,
};

/**
 * Determine which SSE transform stream to use based on provider/format.
 */
function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey, credentials }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  // Responses-API providers (e.g. codex) emit Responses SSE → translate into client format
  const isResponsesProvider = PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials);
  }

  // The passthrough path has no format translation, so the fingerprint's tool
  // rename map (read -> read_client) has to be handed over explicitly —
  // otherwise the client receives a call to a tool it never declared (#4986).
  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey, toolNameMap);
}

async function createChatCompletionsRenderer(model, includeUsage, messages = false) {
  const { openaiResponsesToOpenAIResponse } = await import("../../translator/response/openai-responses.js");
  const toMessages = messages && (await import('../../translator/response/openai-to-claude.js')).openaiToClaudeResponse;
  const messagesState = { toolCalls: new Map() };
  const state = { model };
  const frame = value => `data: ${JSON.stringify(value)}\n\n`;
  return (event, terminal) => {
    const incomplete = event.type === "response.incomplete";
    const finishReason = incomplete && incompleteChatFinishReason(event.response);
    if (event.type === "response.failed" || event.type === "error" || (incomplete && !finishReason)) {
      if (messages) return 'event: error\ndata: ' + JSON.stringify({ type: 'error', error: {
        type: 'api_error', message: event.response?.error?.message || event.error?.message || 'Codex response failed',
      } }) + '\n\n';
      return frame({ error: event.response?.error || event.error ||
        { message: incomplete ? "Codex response incomplete" : "Codex response failed", type: "upstream_error" } }) + "data: [DONE]\n\n";
    }
    const chunk = openaiResponsesToOpenAIResponse(incomplete
      ? { ...event, type: "response.completed" } : event, state);
    if (!chunk) return terminal && !messages ? "data: [DONE]\n\n" : "";
    const { usage, ...completion } = chunk;
    if (incomplete) completion.choices[0].finish_reason = finishReason;
    if (messages) {
      const events = toMessages({ ...completion, usage }, messagesState) || [];
      return events.map(item => `event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`).join('');
    }
    if (includeUsage) completion.usage = null;
    const trailer = includeUsage && usage ? frame({ ...completion, choices: [], usage }) : "";
    return frame(completion) + trailer + (terminal ? "data: [DONE]\n\n" : "");
  };
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, streamDetailId, pxpipe, reqTag, log, credentials, accountingAttempt, accountedJson = false, allowAccountFallback = false }) {
  if (accountingAttempt) {
    const mediaType = providerResponse.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    const nativeChat = provider === "openai" && sourceFormat === FORMATS.OPENAI && targetFormat === FORMATS.OPENAI;
    const convertedClaude = accountingAttempt.convertedEndpoint && accountingAttempt.convertedEndpoint === clientRawRequest?.endpoint;
    const nativeClaude = ["anthropic", "claude"].includes(provider) && (sourceFormat === FORMATS.CLAUDE || convertedClaude) && targetFormat === FORMATS.CLAUDE;
    const chatCompletions = provider === "codex" && sourceFormat === FORMATS.OPENAI &&
      clientRawRequest?.endpoint === "/v1/chat/completions";
    const messages = provider === 'codex' && sourceFormat === FORMATS.CLAUDE && clientRawRequest?.endpoint === '/v1/messages';
    const nativeResponses = ["openai", "codex"].includes(provider) && (sourceFormat === FORMATS.OPENAI_RESPONSES || chatCompletions || messages) &&
      targetFormat === FORMATS.OPENAI_RESPONSES && typeof accountingAttempt.settleResponses === "function";
    if ((!nativeClaude && !nativeResponses && !nativeChat) || mediaType !== "text/event-stream" || !providerResponse.body) {
      await providerResponse.body?.cancel().catch(() => {});
      streamController.handleError(new Error("Invalid accounted SSE response"));
      return { success: false, response: Response.json({ error: { message: "Accounting response unavailable" } }, { status: 502 }) };
    }
    const onTerminal = () => trackPendingRequest(model, provider, connectionId, false);
    const renderChat = (chatCompletions || messages) && !accountedJson
      ? await createChatCompletionsRenderer(model, body?.stream_options?.include_usage === true, messages)
      : null;
    const renderer = convertedClaude ? (await import('../../utils/claude-budget-output.js')).createClaudeBudgetOutput({
      endpoint: accountingAttempt.convertedEndpoint, model, includeUsage: body.stream_options?.include_usage === true,
      rememberTools: accountingAttempt.rememberTools,
    }) : null;
    let decision = nativeResponses && allowAccountFallback && accountingAttempt.overloadSuccessor
      ? Promise.withResolvers() : null;
    const firstFrame = decision && ((event, evidence, receipt) => {
      const overload = event?.type === 'response.failed' && event.response.error?.code === 'server_is_overloaded';
      decision?.resolve(overload ? accountingAttempt.overloadSuccessor(evidence, receipt) : null);
    });
    const transform = nativeChat
      ? (await import("../../utils/accounted-openai-chat-stream.js")).createAccountedOpenAIChatStream(
        accountingAttempt, onTerminal, body.stream_options?.include_usage === true)
      : nativeResponses
      ? createAccountedResponsesStream(usage => accountingAttempt.settleResponses(usage), onTerminal,
          accountingAttempt.priceCacheWrites, renderChat, accountingAttempt.inputEstimate, accountingAttempt.mapResponsesUsage, firstFrame)
      : createAccountedAnthropicStream(accountingAttempt, onTerminal, renderer);
    const onAbortTerminal = convertedClaude ? () => new TextEncoder().encode(renderer.render({ type: 'error' }))
      : nativeChat ? () => buildStreamErrorBytes(502, "OpenAI stream ended before completion", FORMATS.OPENAI)
      : messages && !accountedJson ? () => buildStreamErrorBytes(502, "Codex stream ended before completion", FORMATS.CLAUDE)
      : chatCompletions
      ? (accountedJson ? null : () => buildStreamErrorBytes(502, "Codex stream ended before completion", FORMATS.OPENAI))
      : nativeResponses ? buildAbortedResponsesTerminalBytes
      : () => buildStreamErrorBytes(HTTP_STATUS.BAD_GATEWAY, "Anthropic stream ended before completion", FORMATS.CLAUDE);
    const abortTerminal = decision ? () => {
      decision?.resolve(null);
      return onAbortTerminal?.();
    } : onAbortTerminal;
    const responseBody = pipeWithDisconnect(providerResponse, transform, streamController, abortTerminal,
      PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS);
    if (decision) {
      // A slow first frame must not indefinitely delay HTTP headers. Once the
      // original response is released, no later event may mint a successor.
      const deadline = setTimeout(() => decision.resolve(null), EMPTY_PEEK_DEADLINE_MS);
      let accountFallbackProof;
      try { accountFallbackProof = await decision.promise; }
      finally { clearTimeout(deadline); decision = null; }
      if (accountFallbackProof) {
        // The native reader has already validated the terminal and committed the debit.
        await responseBody.pipeTo(new WritableStream());
        return { success: false, accountFallbackProof, response: Response.json({ error: 'Upstream overloaded' }, { status: 503 }) };
      }
    }
    if (convertedClaude && accountedJson) {
      try {
        await responseBody.pipeTo(new WritableStream({ write() {} }));
        return { success: true, response: Response.json(renderer.result()) };
      } catch {
        return { success: false, response: Response.json({ error: { message: 'Incomplete Claude response' } }, { status: 502 }) };
      }
    }
    return { success: true, response: new Response(responseBody, {
      headers: { ...SSE_HEADERS, ...upstreamResponseHeaders(providerResponse.headers) },
    }) };
  }

  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  }

  // When upstream returns HTML/text instead of SSE (e.g. Cloudflare 5xx error
  // page), piping it through the SSE transform stream causes Next.js
  // "failed to pipe response" and crashes the chat router. Read the body,
  // pull a short human-readable message from the <title>, sanitize it, and
  // return a clean JSON error instead. The message is stripped of HTML tags
  // and clamped so untrusted upstream text never reaches the client verbatim
  // (the UI may render error.message as HTML).
  const upstreamContentType = (providerResponse.headers.get('content-type') || '').toLowerCase();
  if (upstreamContentType && !upstreamContentType.includes('text/event-stream') && !upstreamContentType.includes('application/json')) {
    const bodyText = await providerResponse.text().catch(() => '');
    const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
    const sanitizedTitle = (titleMatch?.[1] || '').replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    const shortMsg = sanitizedTitle
      || (bodyText.length < 200 ? bodyText.replace(/<[^>]*>/g, '').trim().slice(0, 160) : `Upstream returned non-SSE response (${upstreamContentType})`);
    const status = providerResponse.status || 502;
    if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${status} · ${provider}/${model} · non-SSE (${upstreamContentType})\n    ${shortMsg}`);
    else console.warn(`[STREAM] ${provider} | ${model} | blocked pipe: ${shortMsg} [${status}]`);
    streamController?.handleError?.(new Error(`upstream non-SSE: ${status}`));
    return {
      success: false,
      response: new Response(JSON.stringify({ error: { message: `[${status}]: ${shortMsg}` } }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }),
    };
  }

  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey, credentials });

  // Terminal bytes when the stream aborts after HTTP 200 was already sent, so the
  // client sees a real error instead of a silently truncated stream.
  // Responses passthrough keeps its own response.failed shape; every other client
  // format gets the OpenAI error frame + [DONE], or `event: error` for Claude.
  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough
    ? buildAbortedResponsesTerminalBytes
    : (message) => buildStreamErrorBytes(HTTP_STATUS.GATEWAY_TIMEOUT, message, sourceFormat);
  const stallTimeoutMs = PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS;
  const transformedBody = pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal, stallTimeoutMs);

  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: "[Streaming - raw response not captured]",
    response: { content: "[Streaming in progress...]", thinking: null, type: "streaming" },
    pxpipe,
    status: "success"
  }, { id: streamDetailId })).catch(err => {
    console.error("[RequestDetail] Failed to save streaming request:", err.message);
  });

  return {
    success: true,
    response: new Response(transformedBody, { headers: { ...SSE_HEADERS, ...upstreamResponseHeaders(providerResponse.headers) } })
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest, pxpipe, reqTag, log }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete = (contentObj, usage, ttftAt) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming" },
      pxpipe,
      status: "success"
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to update streaming content:", err.message);
    });

    // Persist stream usage to DB (no console line; the "📊 done" line below is authoritative)
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE", silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency }));
  };

  return { onStreamComplete, streamDetailId };
}
