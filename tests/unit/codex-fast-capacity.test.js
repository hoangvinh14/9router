import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

function streamFromText(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe("Codex fast tier and capacity handling", () => {
  it.each(["HTTP 503", "SSE overload"])("keeps compact and standard sessions separate during %s retry", async (failure) => {
    const executor = new CodexExecutor();
    const received = [];
    const compactArrived = Promise.withResolvers();
    const releaseCompact = Promise.withResolvers();
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      received.push([req.url, req.headers.session_id, body.prompt_cache_key, body._compact]);
      if (received.length === 1) {
        compactArrived.resolve();
        await releaseCompact.promise;
        if (failure === "SSE overload") {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end('event: error\ndata: {"type":"error","code":"server_is_overloaded"}\n\n');
          return;
        }
        res.writeHead(503);
      }
      res.end("data: [DONE]\n\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${server.address().port}/responses`;
    executor.config = { ...executor.config, baseUrl, baseUrls: [baseUrl], retry: { 503: { attempts: 1, delayMs: 0 } } };
    const request = (session, compact) => ({
      model: "gpt-6-sol", stream: true, credentials: { connectionId: session },
      body: { input: "hello", prompt_cache_key: session, _compact: compact },
    });
    try {
      vi.stubEnv("NO_PROXY", "127.0.0.1");
      const compact = request("compact-session", true);
      const first = executor.execute(compact);
      await Promise.race([compactArrived.promise, first]);
      try {
        await executor.execute(request("standard-session", false));
      } finally {
        releaseCompact.resolve();
        const result = await first;
        expect(await result.response.text()).toBe("data: [DONE]\n\n");
      }
      // The ordinary auth-refresh path calls execute again with the same body.
      await executor.execute(compact);
      expect(received).toEqual([
        ["/responses/compact", "compact-session", "compact-session", undefined],
        ["/responses", "standard-session", "standard-session", undefined],
        ["/responses/compact", "compact-session", "compact-session", undefined],
        ["/responses/compact", "compact-session", "compact-session", undefined],
      ]);
    } finally {
      vi.unstubAllEnvs();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });

  it("maps Codex fast tier to priority and max reasoning to xhigh", () => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest("gpt-reserve", {
      model: "gpt-reserve",
      input: "hi",
      reasoning_effort: "max",
      service_tier: "fast",
    }, true, {});

    expect(body.service_tier).toBe("priority");
    expect(body.reasoning.effort).toBe("xhigh");
  });

  it("uses ChatGPT workspace header fallback", () => {
    const executor = new CodexExecutor();
    const headers = executor.buildHeaders({
      accessToken: "token",
      connectionId: "conn_1",
      providerSpecificData: { chatgptAccountId: "acct_1" },
    });

    expect(headers["ChatGPT-Account-ID"]).toBe("acct_1");
  });

  it("classifies 200-SSE model capacity as account fallback", async () => {
    const executor = new CodexExecutor();
    const response = new Response(streamFromText([
      "event: error",
      'data: {"error":{"message":"Selected model is at capacity. Please try a different model."}}',
      "",
    ].join("\n")), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.accountFallback).toBe(true);
    expect(peek.message).toBe("Selected model is at capacity. Please try a different model.");
  });

  it("reassembles normal SSE after peeking", async () => {
    const executor = new CodexExecutor();
    const text = [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"OK"}',
      "",
    ].join("\n");
    const response = new Response(streamFromText(text), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.matched).toBeNull();
    await expect(new Response(peek.replacementBody).text()).resolves.toBe(text);
  });
});

describe("Codex reasoning normalization", () => {
  it.each([
    ["gpt-5.6-sol", "max", "max"],
    ["gpt-5.6-sol", "ultra", "ultra"],
    ["gpt-5.6-terra", "max", "max"],
    ["gpt-5.6-terra", "ultra", "ultra"],
    ["gpt-5.6-luna", "max", "max"],
    ["gpt-5.6-luna", "ultra", "max"],
  ])("normalizes %s effort %s to %s", (model, effort, expected) => {
    const body = new CodexExecutor().transformRequest(model, {
      model,
      input: "hi",
      reasoning: { effort },
    }, true, {});

    expect(body.reasoning.effort).toBe(expected);
  });

  it("resolves review models before applying the reasoning matrix", () => {
    const body = new CodexExecutor().transformRequest("gpt-5.6-terra-review", {
      model: "gpt-5.6-terra-review",
      input: "hi",
      reasoning_effort: "ultra",
    }, true, {});

    expect(body.model).toBe("gpt-5.6-terra");
    expect(body.reasoning.effort).toBe("ultra");
  });
});
