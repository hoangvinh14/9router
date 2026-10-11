import { describe, expect, it, vi } from 'vitest';
import { createBufferedClaudeUsageObserver, readBufferedClaudeAccounting } from 'open-sse/utils/accountingClaudeUsage.js';
import { ACCOUNTING_JSON_DEADLINE_MS } from 'open-sse/config/accountingBodyLimits.js';
const enc = new TextEncoder();
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const rawUsage = { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
  cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } };
const start = (usage = rawUsage) => event('message_start', { message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'fixture-model', content: [], usage } });
const delta = (output = 20, extra = {}) => event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: output, ...extra } });
const stop = event('message_stop');
const text = event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'đúng🙂' } }) + event('content_block_stop', { index: 0 });
function inspect(wire, options) { const o = createBufferedClaudeUsageObserver(options); o.push(enc.encode(wire)); return o.finish(); }
function denied(wire) {
  let value, error;
  try { value = inspect(wire); } catch (caught) { error = caught; }
  if (error) expect(error).toBeInstanceOf(Error); else expect(value).toBeNull();
}
describe('unconnected bounded raw Claude usage candidate (not provider or POST-owner approval)', () => {
  it('optional buffered native message capture uses exact raw cache split and cumulative final usage', async () => {
    const wire = start() + text + delta() + stop;
    const result = await readBufferedClaudeAccounting(new Response(wire, { headers: { 'content-type': 'text/event-stream' } }), null,
      { expectedModel: 'fixture-model', captureMessage: true });
    expect(result.message).toEqual({ id: 'msg_fixture', type: 'message', role: 'assistant', model: 'fixture-model',
      content: [{ type: 'text', text: 'đúng🙂' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { ...rawUsage, output_tokens: 20 } });
    expect(result.usage).toMatchObject({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 10,
      provenance: { schema: 'claude', endpoint: 'chat', inputIncludesCache: true } });
  });
  it('optional native message preserves thinking signature and parsed client-tool input in block order', async () => {
    const wire = start() + event('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'reason' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'opaque-signature' } }) + event('content_block_stop', { index: 0 }) +
      event('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'tool_1', name: 'fixture', input: {} } }) +
      event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"value":' } }) +
      event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '1}' } }) + event('content_block_stop', { index: 1 }) +
      event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }) + stop;
    const result = await readBufferedClaudeAccounting(new Response(wire, { headers: { 'content-type': 'text/event-stream' } }), null, { captureMessage: true });
    expect(result.message.content).toEqual([{ type: 'thinking', thinking: 'reason', signature: 'opaque-signature' },
      { type: 'tool_use', id: 'tool_1', name: 'fixture', input: { value: 1 } }]);
    expect(result.message.stop_reason).toBe('tool_use'); expect(result.usage.output).toBe(20);
  });
  it('optional native message remains unavailable when genuine stop is missing', async () => {
    const result = await readBufferedClaudeAccounting(new Response(start() + text + delta(), { headers: { 'content-type': 'text/event-stream' } }), null, { captureMessage: true });
    expect(result.usage).toBeNull(); expect(result.message).toBeNull();
  });
  it('optional native message rejects malformed client-tool JSON rather than fabricating empty input', async () => {
    const wire = start() + event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'fixture', input: {} } }) +
      event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{' } }) + event('content_block_stop', { index: 0 }) + delta() + stop;
    await expect(readBufferedClaudeAccounting(new Response(wire, { headers: { 'content-type': 'text/event-stream' } }), null,
      { captureMessage: true })).rejects.toThrow('Invalid raw Claude accounting stream');
  });
  it('captured redacted thinking and stop sequence preserve native fields only after finish', () => {
    const wire = start() + event('content_block_start', { index: 0, content_block: { type: 'redacted_thinking', data: 'opaque' } }) +
      event('content_block_stop', { index: 0 }) + event('message_delta', { delta: { stop_reason: 'stop_sequence', stop_sequence: 'fixture-stop' }, usage: { output_tokens: 20 } }) + stop;
    const observer = createBufferedClaudeUsageObserver({ captureMessage: true }); observer.push(enc.encode(wire));
    expect(observer.message()).toBeNull(); expect(observer.finish()).toMatchObject({ output: 20 });
    expect(observer.message()).toMatchObject({ content: [{ type: 'redacted_thinking', data: 'opaque' }], stop_reason: 'stop_sequence', stop_sequence: 'fixture-stop' });
    const copy = observer.message(); copy.content[0].data = 'mutated';
    expect(observer.message().content[0].data).toBe('opaque');
  });
  it('native capture refuses unapproved block fields without affecting default usage-only protocol', async () => {
    const wire = start() + event('content_block_start', { index: 0, content_block: { type: 'text', text: '', service_tier: 'priority' } }) +
      event('content_block_stop', { index: 0 }) + delta() + stop;
    await expect(readBufferedClaudeAccounting(new Response(wire, { headers: { 'content-type': 'text/event-stream' } }), null, { captureMessage: true }))
      .rejects.toThrow('Invalid raw Claude accounting stream');
  });
  it('explicit expected model binds raw start identity without fuzzy aliases', () => {
    expect(inspect(start() + delta() + stop, { expectedModel: 'fixture-model' })).toMatchObject({ output: 20 });
    expect(() => inspect(start() + delta() + stop, { expectedModel: 'different-model' })).toThrow();
  });
  it.each([
    ['start serving tier metadata', { service_tier: 'priority' }],
    ['server-side model fallback metadata', { input_transformations: [{ type: 'fallback' }] }],
    ['premature stop reason', { stop_reason: 'end_turn' }],
  ])('start rejects unapproved identity/pricing state: %s', (_name, extra) => {
    denied(event('message_start', { message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'fixture-model', content: [], usage: rawUsage, ...extra } }) + delta() + stop);
  });
  it('reader composes exact model binding and standard nullable start fields without rejecting valid counts', async () => {
    const wire = event('message_start', { message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'fixture-model', content: [], usage: rawUsage, stop_reason: null, stop_sequence: null } }) + delta() + stop;
    const response = () => new Response(wire, { headers: { 'content-type': 'text/event-stream' } });
    expect(await readBufferedClaudeAccounting(response(), null, { expectedModel: 'fixture-model' })).toMatchObject({ text: wire, usage: { output: 20 } });
    await expect(readBufferedClaudeAccounting(response(), null, { expectedModel: 'other-model' })).rejects.toThrow('Invalid raw Claude accounting stream');
    for (const expectedModel of ['', 123, {}]) expect(() => createBufferedClaudeUsageObserver({ expectedModel })).toThrow();
  });
  it('requires clean finish after genuine stop and replaces cumulative output instead of summing', () => {
    const o = createBufferedClaudeUsageObserver(); o.push(enc.encode(start() + text + delta(5) + delta(20) + stop));
    expect(o.finish()).toMatchObject({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 10, reasoningIncludedInOutput: true });
    expect(() => o.finish()).toThrow(); expect(() => o.push(enc.encode(stop))).toThrow();
  });
  it('every byte split including UTF8 and CRLF preserves only exact terminal counts', () => {
    const bytes = enc.encode((start() + text + delta() + stop).replaceAll('\n', '\r\n'));
    for (let i = 0; i <= bytes.length; i++) {
      const o = createBufferedClaudeUsageObserver(); o.push(bytes.slice(0, i)); o.push(bytes.slice(i));
      expect(o.finish()).toMatchObject({ input: 100, output: 20 });
    }
  });
  it('one-byte input and EOF unterminated stop never invent a missing stop', () => {
    const o = createBufferedClaudeUsageObserver(); for (const byte of enc.encode(start() + delta() + stop.trimEnd())) o.push(new Uint8Array([byte]));
    expect(o.finish()).toMatchObject({ output: 20 });
    expect(inspect(start() + delta())).toBeNull();
  });
  it('explicit all-zero usage remains exact', () => {
    expect(inspect(start({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
      server_tool_use: { web_search_requests: 0 } }) + delta(0) + stop)).toMatchObject({ input: 0, output: 0 });
  });
  it.each([
    ['missing start', delta() + stop], ['duplicate start', start() + start() + delta() + stop],
    ['missing output delta', start() + stop], ['missing stop', start() + delta()],
    ['decreasing cumulative output', start() + delta(20) + delta(19) + stop],
    ['changed input', start() + delta(20, { input_tokens: 51 }) + stop],
    ['paid tool then zero', start({ ...rawUsage, server_tool_use: { web_search_requests: 1 } }) + delta(20, { server_tool_use: { web_search_requests: 0 } }) + stop],
    ['1h then zero', start({ ...rawUsage, cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 5 } }) + delta() + stop],
    ['absent tool evidence', start({ input_tokens: 1, output_tokens: 0 }) + delta() + stop],
    ['empty tools', start({ ...rawUsage, server_tool_use: {} }) + delta() + stop],
    ['late substantive event', start() + delta() + stop + event('ping')],
    ['duplicate stop', start() + delta() + stop + stop],
    ['error after valid counts', start() + delta() + event('error', { error: { type: 'overloaded_error' } }) + stop],
    ['unknown fallback event', start() + event('fallback') + delta() + stop],
    ['server-tool block', start() + event('content_block_start', { index: 0, content_block: { type: 'server_tool_use' } }) + delta() + stop],
    ['open content block at stop', start() + event('content_block_start', { index: 0, content_block: { type: 'text' } }) + delta() + stop],
    ['event/type mismatch', start() + 'event: message_delta\ndata: {"type":"message_stop"}\n\n' + stop],
    ['unnamed event', start() + 'data: {"type":"message_stop"}\n\n'],
    ['malformed usage', start() + delta('20') + stop],
  ])('denies %s without exact terminal authority', (_name, wire) => { denied(wire); });
  it('CRLF event byte bound counts every byte, including the LF after CR', () => {
    const wire = start().replaceAll('\n', '\r\n');
    expect(() => inspect(wire, { maxEventBytes: enc.encode(wire).byteLength - 1 })).toThrow();
  });
  it.each([
    ['text block with input JSON delta', event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) + event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }) + event('content_block_stop', { index: 0 }) + delta()],
    ['unknown content delta', event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) + event('content_block_delta', { index: 0, delta: { type: 'future_delta' } }) + event('content_block_stop', { index: 0 }) + delta()],
    ['wrong text value', event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) + event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 123 } }) + event('content_block_stop', { index: 0 }) + delta()],
    ['changed serving model', event('message_delta', { delta: { stop_reason: 'end_turn', model: 'different-model' }, usage: { output_tokens: 20 } })],
    ['unapproved top-level delta field', event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 }, future_billing: 1 })],
  ])('unsupported observation never grants exact token-only authority: %s', (_name, middle) => { denied(start() + middle + stop); });
  it('stop cannot add unapproved usage authority', () => {
    denied(start() + delta() + event('message_stop', { usage: { output_tokens: 999 } }));
  });
  it.each([
    ['thinking', 'thinking_delta', 'thinking', 'reasoning'],
    ['thinking', 'signature_delta', 'signature', 'opaque-signature'],
    ['tool_use', 'input_json_delta', 'partial_json', '{"argument":1}'],
  ])('valid %s/%s block stays usable without estimating reasoning or tool counts', (type, deltaType, field, value) => {
    const block = event('content_block_start', { index: 0, content_block: { type } }) +
      event('content_block_delta', { index: 0, delta: { type: deltaType, [field]: value } }) + event('content_block_stop', { index: 0 });
    expect(inspect(start() + block + delta() + stop)).toMatchObject({ input: 100, output: 20, reasoning: 0, reasoningIncludedInOutput: true });
  });
  it('CRLF exact byte boundary passes and repeated carriage-return separators remain valid', () => {
    const wire = start().replaceAll('\n', '\r\n');
    expect(inspect(wire + delta() + stop, { maxEventBytes: enc.encode(wire).byteLength })).toMatchObject({ output: 20 });
    expect(inspect((start() + delta() + stop).replaceAll('\n', '\r'))).toMatchObject({ output: 20 });
  });
  it('invalidity stays sticky even if caller catches push failure', () => {
    const o = createBufferedClaudeUsageObserver(); expect(() => o.push(enc.encode(start() + event('error')))).toThrow();
    expect(() => o.push(enc.encode(delta() + stop))).toThrow(); expect(o.finish()).toBeNull();
  });
  it('sole reader waits for clean EOF after stop then returns exact original raw text', async () => {
    let controller; const body = new ReadableStream({ start(c) { controller = c; } });
    let settled = false;
    const result = readBufferedClaudeAccounting(new Response(body, { headers: { 'content-type': 'text/event-stream' } })).then(value => { settled = true; return value; });
    const wire = start() + text + delta() + stop;
    controller.enqueue(enc.encode(wire)); await new Promise(resolve => setImmediate(resolve)); expect(settled).toBe(false);
    controller.close(); expect(await result).toMatchObject({ text: wire, usage: { exact: true, input: 100, output: 20 } });
    expect(body.locked).toBe(false);
  });
  it('existing absolute reader deadline bounds an open transport after stop without comments resetting it', async () => {
    vi.useFakeTimers(); let controller; const cancel = vi.fn(() => Promise.reject(new Error('foreign cleanup failure')));
    const body = new ReadableStream({ start(c) { controller = c; }, cancel });
    let settled = false;
    const result = readBufferedClaudeAccounting(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
      .then(value => ({ value }), error => ({ error })).then(value => { settled = true; return value; });
    try {
      controller.enqueue(enc.encode(start() + delta() + stop)); await vi.advanceTimersByTimeAsync(ACCOUNTING_JSON_DEADLINE_MS - 1);
      controller.enqueue(enc.encode(': comment\n\n')); await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1); const outcome = await result;
      expect(outcome.error.message).toBe('Accounting response deadline exceeded'); expect(outcome.value).toBeUndefined();
      expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
    } finally { await result; vi.useRealTimers(); }
  });
  it.each([false, 0, 'exact-reason'])('caller abort after stop preserves exact reason %s with no exact result', async reason => {
    let controller; const cancel = vi.fn(); const caller = new AbortController();
    const body = new ReadableStream({ start(c) { controller = c; }, cancel });
    const result = readBufferedClaudeAccounting(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), caller.signal)
      .then(value => ({ value }), error => ({ error }));
    controller.enqueue(enc.encode(start() + delta() + stop)); await new Promise(resolve => setImmediate(resolve)); caller.abort(reason);
    const outcome = await result; expect(outcome.error).toBe(reason); expect(outcome.value).toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledWith(reason); expect(body.locked).toBe(false);
  });
  it('read failure after exact counts and stop is not clean EOF authority', async () => {
    let controller; const body = new ReadableStream({ start(c) { controller = c; } });
    const error = new Error('read failed'); const result = readBufferedClaudeAccounting(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
      .then(value => ({ value }), caught => ({ error: caught }));
    controller.enqueue(enc.encode(start() + delta() + stop)); await new Promise(resolve => setImmediate(resolve)); controller.error(error);
    expect((await result).error).toBe(error); expect(body.locked).toBe(false);
  });
  it('wrong media/status refuses before sole reader acquisition', async () => {
    for (const response of [new Response('not SSE'), new Response('failed', { status: 500, headers: { 'content-type': 'text/event-stream' } })]) {
      await expect(readBufferedClaudeAccounting(response)).rejects.toThrow('Unsupported raw Claude accounting response');
      expect(response.bodyUsed).toBe(false);
    }
  });
  it('failed HTTP opt-in reads exact raw counts only after genuine stop and clean EOF', async () => {
    let controller, ended = false;
    const body = new ReadableStream({ start(value) { controller = value; } });
    const wire = start() + delta() + stop;
    const work = readBufferedClaudeAccounting(new Response(body, { status: 429, headers: { 'content-type': 'text/event-stream' } }), null,
      { expectedModel: 'fixture-model', allowFailedHttp: true }).then(value => { ended = true; return value; });
    controller.enqueue(enc.encode(wire)); await new Promise(resolve => setImmediate(resolve)); expect(ended).toBe(false);
    controller.close(); expect(await work).toMatchObject({ text: wire, usage: { exact: true, input: 100, output: 20 } });
    expect(body.locked).toBe(false);
  });
  it('failed HTTP opt-in preserves false abort after stop rather than exact usage', async () => {
    let controller; const caller = new AbortController(), cancel = vi.fn();
    const body = new ReadableStream({ start(value) { controller = value; }, cancel });
    const work = readBufferedClaudeAccounting(new Response(body, { status: 500, headers: { 'content-type': 'text/event-stream' } }), caller.signal,
      { allowFailedHttp: true }).then(value => ({ value }), error => ({ error }));
    controller.enqueue(enc.encode(start() + delta() + stop)); await new Promise(resolve => setImmediate(resolve)); caller.abort(false);
    expect((await work).error).toBe(false); expect(cancel).toHaveBeenCalledWith(false); expect(body.locked).toBe(false);
  });
  it('failed HTTP opt-in never accepts non-SSE or truthy non-boolean permission', async () => {
    for (const [type, allowFailedHttp] of [['application/json', true], ['text/event-stream', 'true'], ['text/event-stream', 1]]) {
      const response = new Response(start() + delta() + stop, { status: 429, headers: { 'content-type': type } });
      await expect(readBufferedClaudeAccounting(response, null, { allowFailedHttp })).rejects.toThrow('Unsupported raw Claude accounting response');
      expect(response.bodyUsed).toBe(false);
    }
  });
  it('clean EOF missing stop yields unresolved usage, never invented terminal', async () => {
    const wire = start() + delta();
    expect(await readBufferedClaudeAccounting(new Response(wire, { headers: { 'content-type': 'text/event-stream' } }))).toEqual({ text: wire, usage: null });
  });
  it('bounded total bytes includes comments, event count includes pings, and fatal UTF8 fails closed', () => {
    expect(() => inspect(': comment padding\n\n', { maxTotalBytes: 4 })).toThrow();
    expect(() => inspect(start() + event('ping') + delta() + stop, { maxEvents: 2 })).toThrow();
    expect(() => inspect(':' + 'a'.repeat(100), { maxEventBytes: 20 })).toThrow();
    const o = createBufferedClaudeUsageObserver(); expect(() => o.push(new Uint8Array([0xff]))).toThrow(); expect(o.finish()).toBeNull();
  });
});
