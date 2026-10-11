import { describe, it, expect } from 'vitest';
import WindsurfExecutor, { decodeCompletionChunk, grpcWebFrame } from 'open-sse/executors/windsurf.js';
import { PROVIDERS } from 'open-sse/config/providers.js';
import registry from 'open-sse/providers/registry/windsurf.js';

// Characterize legacy evidence loss, NOT an accounting acceptance suite.
// Independent BigInt encoder; no live requests, credentials or route exceptions.
function varint(value) {
  const out = []; let n = BigInt(value);
  do { out.push(Number(n & 127n) | (n > 127n ? 128 : 0)); n >>= 7n; } while (n);
  return Uint8Array.from(out);
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function bytes(field, payload) { return concat(varint(BigInt(field) * 8n + 2n), varint(payload.length), payload); }
function counter(field, value) { return concat(varint(BigInt(field) * 8n), varint(value)); }
function done(usage) { return bytes(3, bytes(1, usage)); }
const valid = () => done(concat(counter(1, 100), counter(2, 20)));
async function converted(payload) {
  const upstream = new Response(payload, { headers: { 'content-type': 'application/grpc-web+proto' } });
  return new WindsurfExecutor().transformToSSE(upstream, 'fixture-model').text();
}

describe('Windsurf legacy accounting evidence characterization (not support)', () => {
  it('keeps the intentionally hidden registry separate from executor fallback; does not activate it', () => {
    expect(PROVIDERS.windsurf).toBeUndefined();
    expect(registry.transport.baseUrl).toBe('https://server.codeium.com/exa.language_server_pb.LanguageServerService/GetChatMessage');
    expect(new WindsurfExecutor().buildUrl()).toBe(registry.transport.baseUrl);
  });
  it('collapses absent raw UsageStats into zero after a valid explicit-counter control', () => {
    expect(decodeCompletionChunk(valid())).toEqual({ kind: 'done', promptTokens: 100, completionTokens: 20 });
    expect(decodeCompletionChunk(bytes(3, new Uint8Array()))).toEqual({ kind: 'done', promptTokens: 0, completionTokens: 0 });
  });
  it('defaults a missing completion counter to zero rather than preserving absence', () => {
    expect(decodeCompletionChunk(valid()).completionTokens).toBe(20);
    expect(decodeCompletionChunk(done(counter(1, 100)))).toEqual({ kind: 'done', promptTokens: 100, completionTokens: 0 });
  });
  it('wraps a raw uint64 counter through the legacy 32-bit decoder', () => {
    expect(decodeCompletionChunk(valid()).promptTokens).toBe(100);
    expect(decodeCompletionChunk(done(concat(counter(1, 4294967303n), counter(2, 20)))).promptTokens).toBe(7);
  });
  it('synthesizes stop and DONE at empty EOF without raw done or successful trailer', async () => {
    const text = await converted(new Uint8Array());
    expect(text).toContain('"finish_reason":"stop"'); expect(text).toContain('data: [DONE]'); expect(text).not.toContain('"usage"');
  });
  it('accepts a valid done frame then ignores a truncated trailer tail at EOF', async () => {
    const text = await converted(concat(grpcWebFrame(valid()), Uint8Array.of(128, 0, 0, 0, 5, 65)));
    expect(text).toContain('"prompt_tokens":100'); expect(text).toContain('"completion_tokens":20');
    expect(text).toContain('data: [DONE]'); expect(text).not.toContain('"error"');
  });
  it('overwrites an earlier valid raw done with a second conflicting done instead of refusing', async () => {
    const text = await converted(concat(grpcWebFrame(valid()), grpcWebFrame(done(concat(counter(1, 9), counter(2, 8))))));
    expect(text).toContain('"prompt_tokens":9'); expect(text).toContain('"completion_tokens":8'); expect(text).not.toContain('"error"');
  });
});
