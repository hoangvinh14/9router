import { describe, it, expect, vi } from 'vitest';
import { createAccountingClaudeSseParser } from 'open-sse/utils/accountingClaudeSseParser.js';
import { createAccountedOpenaiStream } from 'open-sse/utils/accountedOpenaiStream.js';
import { supportsAnthropicLiveRequest } from 'open-sse/config/accountedAnthropicCandidate.js';
const enc = new TextEncoder();
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const usage = { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
  cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } };
const start = () => event('message_start', { message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'fixture-model', content: [], usage } });
const toolStart = (block = {}) => event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tool_fixture', name: 'fixture_lookup', input: {}, ...block } });
const fragment = partial_json => event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json } });
const blockStop = () => event('content_block_stop', { index: 0 });
const terminal = () => event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }) + event('message_stop');
const prefix = () => start() + toolStart();
const toolWire = () => prefix() + fragment('{"query":') + fragment('"đúng🙂"}') + blockStop() + terminal();
const makeParser = (onEvent = () => {}, options = {}) => createAccountingClaudeSseParser(onEvent, { expectedModel: 'fixture-model', allowClientTools: true, ...options });
const request = () => ({ model: 'fixture-model', stream: true, max_tokens: 100,
  messages: [{ role: 'user', content: 'fixture' }], tools: [{ name: 'fixture_lookup', input_schema: { type: 'object', properties: { query: { type: 'string' } } } }], tool_choice: { type: 'auto' } });
describe('explicit live client-tool Messages candidate, not beta/OAuth/server-tool approval', () => {
  it('preserves genuine tool frames and exact usage under one-byte UTF8 fragmentation', () => {
    const events = [], observer = makeParser(value => events.push(value));
    for (const byte of enc.encode(toolWire())) observer.push(new Uint8Array([byte]));
    expect(observer.finish()).toMatchObject({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 10 });
    expect(new TextDecoder().decode(Buffer.concat(events.map(value => value.bytes)))).toBe(toolWire());
    expect(events.filter(value => value.terminal)).toHaveLength(2); expect(events.filter(value => value.done)).toHaveLength(1);
  });
  it('default parser remains text-only and opt-in must be an actual boolean', () => {
    expect(() => { const observer = createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model' }); observer.push(enc.encode(toolWire())); }).toThrow();
    expect(() => makeParser(() => {}, { allowClientTools: 'true' })).toThrow();
  });
  it.each(['malformed-json', 'array-json', 'extra-field', 'empty-id', 'server-tool', 'wrong-delta', 'input-bound'])('valid prefix then %s cannot settle', mode => {
    const observer = makeParser(() => {}, mode === 'input-bound' ? { maxToolInputBytes: 16 } : {});
    // Prove protocol start was reached, not a blanket rejection before the fault.
    observer.push(enc.encode(start()));
    if (['extra-field', 'empty-id', 'server-tool'].includes(mode)) {
      const block = mode === 'extra-field' ? { paid_option: true } : mode === 'empty-id' ? { id: '' } : { type: 'server_tool_use' };
      expect(() => observer.push(enc.encode(toolStart(block)))).toThrow();
    } else {
      observer.push(enc.encode(toolStart()));
      if (mode === 'wrong-delta') expect(() => observer.push(enc.encode(event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'fixture' } })))).toThrow();
      else if (mode === 'input-bound') expect(() => observer.push(enc.encode(fragment('{"query":"01234567890123456789"}')))).toThrow();
      else {
        observer.push(enc.encode(fragment(mode === 'malformed-json' ? '{' : '[]')));
        expect(() => observer.push(enc.encode(blockStop()))).toThrow();
      }
    }
    expect(observer.evidence()).toBeNull(); expect(observer.finish()).toBeNull();
  });
  it('cumulative UTF8 tool JSON bytes stay bounded across fragments, not only each event', () => {
    const observer = makeParser(() => {}, { maxToolInputBytes: 16 });
    observer.push(enc.encode(prefix())); observer.push(enc.encode(fragment('{"q":"🙂')));
    expect(() => observer.push(enc.encode(fragment('🙂🙂"}')))).toThrow(); expect(observer.finish()).toBeNull();
  });
  it('prepopulated tool-start input cannot be silently replaced by streamed JSON', () => {
    const observer = makeParser(); observer.push(enc.encode(start()));
    expect(() => observer.push(enc.encode(toolStart({ input: { q: 'fixture' } })))).toThrow(); expect(observer.finish()).toBeNull();
  });
  it('missing message_stop leaves valid closed tool JSON unresolved', () => {
    const observer = makeParser(); observer.push(enc.encode(toolWire().split('event: message_stop')[0])); expect(observer.finish()).toBeNull();
  });
  it('original live tool declarations accepted; server tools and unknown original metadata stay denied', () => {
    expect(supportsAnthropicLiveRequest(request(), 'fixture-model')).toBe(false);
    expect(supportsAnthropicLiveRequest(request(), 'fixture-model', 'true')).toBe(false);
    expect(supportsAnthropicLiveRequest(request(), 'fixture-model', true)).toBe(true);
    const server = request(); server.tools[0].type = 'web_search_20250305'; expect(supportsAnthropicLiveRequest(server, 'fixture-model', true)).toBe(false);
    const unknown = request(); unknown.metadata = { user_id: 'fixture' }; expect(supportsAnthropicLiveRequest(unknown, 'fixture-model', true)).toBe(false);
  });
  it('sole owner releases raw tool frames but holds terminal through EOF, own ACK and authorization', async () => {
    let upstream, enterAck, releaseAck, enterAuth, releaseAuth;
    const enteredAck = new Promise(resolve => { enterAck = resolve; }), ack = new Promise(resolve => { releaseAck = resolve; });
    const enteredAuth = new Promise(resolve => { enterAuth = resolve; }), auth = new Promise(resolve => { releaseAuth = resolve; });
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { enterAck(); await ack; return payload; }), assertSuccessfulTerminal: vi.fn(async () => { enterAuth(); await auth; }) };
    const response = new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(enc.encode(toolWire())); } }));
    const reader = createAccountedOpenaiStream(response, { accounting, attempt: {}, limits: { allowClientTools: true }, parserFactory: createAccountingClaudeSseParser, expectedModel: 'fixture-model' }).getReader();
    let delivered = '', enterTool;
    const toolDelivered = new Promise(resolve => { enterTool = resolve; });
    const consume = (async () => { for (;;) { const value = await reader.read(); if (value.done) break; delivered += new TextDecoder().decode(value.value); if (delivered.includes('event: content_block_stop')) enterTool(); } })();
    // If the pre-implementation parser rejects, race that rejection instead of
    // hanging on a fixture barrier the implementation could never reach.
    const observed = Promise.race([toolDelivered, consume]);
    try {
      await observed; expect(delivered).toContain('"type":"input_json_delta"'); expect(delivered).not.toContain('event: message_delta'); expect(accounting.completeAttempt).not.toHaveBeenCalled();
      upstream.close(); await enteredAck; expect(delivered).not.toContain('event: message_stop'); releaseAck(); await enteredAuth; expect(delivered).not.toContain('event: message_stop');
      releaseAuth(); await consume; expect(delivered).toBe(toolWire());
    } finally { releaseAck(); releaseAuth(); await reader.cancel().catch(() => {}); await consume.catch(() => {}); }
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(accounting.completeAttempt.mock.calls[0][1]).toMatchObject({ outcome: 'success', usage: { exact: true, input: 100, output: 20 } });
  });
});
