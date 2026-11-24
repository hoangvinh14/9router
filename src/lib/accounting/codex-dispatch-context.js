import { randomUUID } from 'node:crypto';
import { prepareAccountedDirectPost } from '../../../open-sse/utils/proxyFetch.js';
import { unavailable } from './attempt-payload.js';
import { openaiToOpenAIResponsesRequest } from '../../../open-sse/translator/request/openai-responses.js';
import { budgetInstant } from './budget-windows.js';
import { estimateInputTokens } from '../../../open-sse/utils/usageTracking.js';
import { codexAccountId, directAccountData } from './node-anthropic-account.js';

const endpoint = 'https://chatgpt.com/backend-api/codex/responses';
const fields = new Set(['model', 'input', 'instructions', 'tools', 'tool_choice', 'stream', 'store',
  'reasoning', 'include', 'prompt_cache_key', 'text', 'parallel_tool_calls']);
const itemTypes = new Set(['message', 'reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output']);

const chatFields = new Set(['model', 'messages', 'stream', 'reasoning_effort', 'tools', 'prompt_cache_key', 'stream_options']);
const plainText = content => typeof content === 'string' || (Array.isArray(content) && content.length > 0 &&
  content.every(block => block?.type === 'text' && typeof block.text === 'string' &&
    Object.keys(block).every(key => key === 'type' || key === 'text')));
const functionName = name => typeof name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(name);

function chatInput(model, body) {
  if (Object.keys(body).some(key => !chatFields.has(key)) ||
      (body.stream !== undefined && typeof body.stream !== 'boolean') ||
      (body.stream_options !== undefined && (body.stream !== true || !body.stream_options ||
        Object.keys(body.stream_options).length !== 1 || typeof body.stream_options.include_usage !== 'boolean')) ||
      !Array.isArray(body.messages) || !body.messages.length) throw unavailable();
  let instructions = false;
  for (const [index, message] of body.messages.entries()) {
    if (!message || !['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role) ||
        Object.keys(message).some(key => !['role', 'content',
          ...(message.role === 'assistant' ? ['tool_calls', 'reasoning_content', 'reasoning_encrypted_content'] : []),
          ...(message.role === 'tool' ? ['tool_call_id'] : [])].includes(key))) throw unavailable();
    if (message.role === 'system' || message.role === 'developer') {
      if (instructions || index !== 0) throw unavailable();
      instructions = true;
    }
    if (message.role === 'tool' && (typeof message.tool_call_id !== 'string' ||
        !message.tool_call_id || message.tool_call_id.length > 64 || typeof message.content !== 'string')) throw unavailable();
    const calls = message.tool_calls;
    if (calls !== undefined && (!Array.isArray(calls) || !calls.length || calls.some(call =>
      call?.type !== 'function' || typeof call.id !== 'string' || !call.id || call.id.length > 64 ||
      !functionName(call.function?.name) || typeof call.function.arguments !== 'string'))) throw unavailable();
    if (!plainText(message.content) && !(calls?.length && message.content == null)) throw unavailable();
    for (const field of ['reasoning_content', 'reasoning_encrypted_content']) {
      if (message[field] !== undefined && typeof message[field] !== 'string') throw unavailable();
    }
  }
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool =>
    tool?.type !== 'function' || !functionName(tool.function?.name)))) throw unavailable();
  return openaiToOpenAIResponsesRequest(model, body, true);
}

export function createCodexDispatchContext({ identity, routeProof, credentials, profile, clock }) {
  const { connectionId, accessToken, providerSpecificData } = credentials;
  const accountId = codexAccountId(providerSpecificData);
  const { model } = profile;
  if (profile.provider !== 'codex' || profile.auth !== 'oauth' || profile.producerAdmitted !== true ||
      profile.connectionId !== connectionId || profile.accountId !== accountId || credentials.authType !== 'oauth' || credentials.apiKey ||
      !accessToken || !accountId || !routeProof || !directAccountData(providerSpecificData)) throw unavailable();
  let validated = false;
  let prepared = false;

  function validate(body) {
    if (!body || Object.keys(body).some(key => !fields.has(key)) || body.stream !== true ||
        (body.store !== undefined && body.store !== false) ||
        (body.include !== undefined && !(Array.isArray(body.include) && body.include.length === 1 &&
          body.include[0] === 'reasoning.encrypted_content')) ||
        !(typeof body.input === 'string' && body.input.trim() || Array.isArray(body.input) && body.input.length &&
          body.input.every(item => item && itemTypes.has(item.type ?? (item.role && 'message')) &&
            (!Array.isArray(item.content) || item.content.every(block =>
              block && ['input_text', 'output_text', 'refusal'].includes(block.type))))) ||
        (body.tools !== undefined && (!Array.isArray(body.tools) ||
          body.tools.some(tool => !tool || !['function', 'custom'].includes(tool.type))))) throw unavailable();
  }

  return Object.freeze({
    provider: 'codex',
    stream: true,
    validateInput(body, chatCompletions = false) {
      if (validated || ![model, `codex/${model}`].includes(body?.model)) throw unavailable();
      const input = chatCompletions ? chatInput(model, body) : body;
      validate(input);
      validated = true;
      return input;
    },
    async prepare({ url, options, proxyOptions, provider, model: selectedModel, stream }) {
      if (prepared || !validated || provider !== 'codex' || selectedModel !== model || url !== endpoint || stream !== true) throw unavailable();
      prepared = true;
      const body = JSON.parse(options.body);
      validate(body);
      const headers = new Headers(options.headers);
      if (body.model !== model || body.store !== false || headers.get('authorization') !== `Bearer ${accessToken}` ||
          headers.get('chatgpt-account-id') !== accountId || headers.get('content-type') !== 'application/json' ||
          headers.has('x-openai-internal-codex-responses-lite')) throw unavailable();

      const { proof, price } = await identity.bindCodexAccount(routeProof, connectionId, accessToken, accountId, profile.priceBasis);
      const initiate = await prepareAccountedDirectPost(url, options, proxyOptions);
      const attempt = identity.prepare({ attemptId: randomUUID(), provider, model, startedAt: budgetInstant(clock), price }, routeProof, proof);
      return Object.freeze({
        dispatch: () => identity.dispatch(attempt.ack, budgetInstant(clock), initiate),
        priceCacheWrites: 'included-in-input',
        inputEstimate: estimateInputTokens(body),
        settleResponses: attempt.settle,
      });
    },
  });
}
