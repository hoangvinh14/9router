import { describe, it, expect, vi } from 'vitest';
import { createAccountingResponsesSseParser } from 'open-sse/utils/accountingResponsesSseParser.js';
import { createAccountedOpenaiStream } from 'open-sse/utils/accountedOpenaiStream.js';
const encoder = new TextEncoder();
const output = { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'héllo', annotations: [] }] };
const terminal = () => ({ id: 'resp_fixture', object: 'response', model: 'fixture-responses', status: 'completed', service_tier: 'default', error: null, incomplete_details: null,
  output: [structuredClone(output)], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } });
const frames = () => [
  { type: 'response.created', response: { ...terminal(), status: 'in_progress', output: [], usage: null } },
  { type: 'response.in_progress', response: { ...terminal(), status: 'in_progress', output: [], usage: null } },
  { type: 'response.output_item.added', output_index: 0, item: { ...output, status: 'in_progress', content: [] } },
  { type: 'response.content_part.added', output_index: 0, item_id: output.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
  { type: 'response.output_text.delta', output_index: 0, item_id: output.id, content_index: 0, delta: 'héllo' },
  { type: 'response.output_text.done', output_index: 0, item_id: output.id, content_index: 0, text: 'héllo' },
  { type: 'response.content_part.done', output_index: 0, item_id: output.id, content_index: 0, part: output.content[0] },
  { type: 'response.output_item.done', output_index: 0, item: structuredClone(output) },
  { type: 'response.completed', response: terminal() },
].map((frame, sequence_number) => ({ ...frame, sequence_number }));
const wire = (values = frames(), crlf = false) => values.map(frame => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('').replaceAll('\n', crlf ? '\r\n' : '\n');
const parser = callback => createAccountingResponsesSseParser(callback, { expectedModel: 'fixture-responses' });
const exact = { exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 0, reasoning: 10, reasoningIncludedInOutput: true,
  provenance: { schema: 'openai-responses', endpoint: 'chat', inputIncludesCache: true } };
describe('raw Responses SSE candidate protocol and shared terminal owner (no app stream approval)', () => {
  const splitCases = [false, true].flatMap(crlf => {
    const text = wire(frames(), crlf), bytes = encoder.encode(text), cases = [];
    for (let first = 0; first <= bytes.length; first += 128) cases.push({ crlf, first, last: Math.min(first + 127, bytes.length), bytes, text });
    return cases;
  });
  it.each(splitCases)('all byte split positions $first..$last preserve wire/UTF8/exact terminal CRLF=$crlf', ({ first, last, bytes, text }) => {
    for (let split = first; split <= last; split++) {
      const events = [], observer = parser(value => events.push(value)); observer.push(bytes.slice(0, split)); observer.push(bytes.slice(split));
      expect(observer.finish()).toEqual(exact); expect(events.filter(event => event.done)).toHaveLength(1);
      expect(new TextDecoder().decode(Buffer.concat(events.map(event => event.bytes)))).toBe(text);
    }
  });
  it('missing genuine completed returns no exact authority even with all output lifecycle done', () => {
    const observer = parser(() => {}); observer.push(encoder.encode(wire(frames().slice(0, -1)))); expect(observer.finish()).toBeNull(); expect(observer.evidence()).toBeNull();
  });
  it.each(['wrong-model', 'wrong-id', 'tier', 'usage-total', 'missing-detail', 'sequence-gap', 'type-mismatch', 'done-text-mismatch', 'content-mismatch', 'output-mismatch', 'hosted-item', 'failed-terminal', 'duplicate-completed', 'late-delta', 'missing-start', 'unknown-event'])('%s cannot upgrade stream to exact success', mode => {
    const values = frames();
    if (mode === 'wrong-model') values[8].response.model = 'other';
    if (mode === 'wrong-id') values[8].response.id = 'resp_other';
    if (mode === 'tier') values[8].response.service_tier = 'priority';
    if (mode === 'usage-total') values[8].response.usage.total_tokens = 121;
    if (mode === 'missing-detail') delete values[8].response.usage.output_tokens_details;
    if (mode === 'sequence-gap') values[4].sequence_number++;
    if (mode === 'done-text-mismatch') values[5].text = 'other';
    if (mode === 'content-mismatch') values[6].part = { ...values[6].part, text: 'other' };
    if (mode === 'output-mismatch') values[8].response.output = [];
    if (mode === 'hosted-item') values[2].item.type = 'web_search_call';
    if (mode === 'failed-terminal') values[8].response.status = 'failed';
    if (mode === 'duplicate-completed') values.push({ ...values[8], sequence_number: 9 });
    if (mode === 'late-delta') values.push({ ...values[4], sequence_number: 9 });
    if (mode === 'missing-start') values.shift();
    if (mode === 'unknown-event') values[4].type = 'response.audio.delta';
    let text = wire(values); if (mode === 'type-mismatch') text = text.replace('event: response.output_text.delta', 'event: response.completed');
    const observer = parser(() => {}); expect(() => { observer.push(encoder.encode(text)); observer.finish(); }).toThrow(); expect(() => observer.finish()).toThrow();
  });
  it.each([false, true])('one-byte fragmentation preserves decoder and delimiter state CRLF=%s', crlf => {
    const events = [], observer = parser(value => events.push(value)), text = wire(frames(), crlf);
    for (const byte of encoder.encode(text)) observer.push(new Uint8Array([byte]));
    expect(observer.finish()).toEqual(exact);
    expect(new TextDecoder().decode(Buffer.concat(events.map(event => event.bytes)))).toBe(text);
  });
  it('comments after completed do not replace the terminal but substantive events do', () => {
    const observer = parser(() => {}); observer.push(encoder.encode(wire() + ': fixture heartbeat\n\n')); expect(observer.finish()).toEqual(exact);
  });
  it('fatal UTF8 and event/chunk limits reject instead of partial success', () => {
    const observer = parser(() => {}); expect(() => observer.push(new Uint8Array([255]))).toThrow();
    const small = createAccountingResponsesSseParser(() => {}, { expectedModel: 'fixture-responses', maxEventBytes: 16 }); expect(() => small.push(encoder.encode(wire()))).toThrow();
    const chunk = createAccountingResponsesSseParser(() => {}, { expectedModel: 'fixture-responses', maxChunkBytes: 8 }); expect(() => chunk.push(encoder.encode(wire()))).toThrow();
  });
  it('shared owner holds native terminal through cleanEOF and durable ACK plus trusted authorization', async () => {
    let upstream, enterAck, releaseAck, enterAuth, releaseAuth;
    const startedAck = new Promise(resolve => { enterAck = resolve; }), ack = new Promise(resolve => { releaseAck = resolve; });
    const startedAuth = new Promise(resolve => { enterAuth = resolve; }), auth = new Promise(resolve => { releaseAuth = resolve; });
    const accounting = { completeAttempt: vi.fn(async (_attempt, terminal) => { enterAck(); await ack; return terminal; }), assertSuccessfulTerminal: vi.fn(async () => { enterAuth(); await auth; }) };
    const response = new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(encoder.encode(wire())); } }));
    const stream = createAccountedOpenaiStream(response, { accounting, attempt: {}, parserFactory: createAccountingResponsesSseParser, expectedModel: 'fixture-responses' });
    const reader = stream.getReader(); let text = '', completed = false;
    const work = (async () => { while (true) { const part = await reader.read(); if (part.done) break; text += new TextDecoder().decode(part.value); } completed = true; })();
    try {
      await new Promise(resolve => setImmediate(resolve)); expect(text).toContain('response.output_text.delta'); expect(text).not.toContain('response.output_text.done'); expect(accounting.completeAttempt).not.toHaveBeenCalled();
      upstream.close(); await startedAck; expect(completed).toBe(false); expect(text).not.toContain('response.completed'); releaseAck(); await startedAuth; expect(text).not.toContain('response.completed');
    } finally { releaseAck(); releaseAuth(); }
    await work; expect(text).toBe(wire()); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: exact, outcome: 'success' });
  });
  it.each(['missing-completed', 'late-invalid', 'read-error', 'persistence-reject', 'authorization-reject'])('shared owner %s never exposes held terminal or completes twice', async mode => {
    const framesText = mode === 'missing-completed' ? wire(frames().slice(0, -1)) : wire();
    let upstream, enterRead;
    const readStarted = new Promise(resolve => { enterRead = resolve; });
    const response = new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(encoder.encode(framesText)); }, pull() { enterRead(); } }));
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { if (mode === 'persistence-reject') throw new Error('fixture persistence failure'); return payload; }),
      assertSuccessfulTerminal: vi.fn(async () => { if (mode === 'authorization-reject') throw new Error('fixture authorization failure'); }) };
    const reader = createAccountedOpenaiStream(response, { accounting, attempt: {}, parserFactory: createAccountingResponsesSseParser, expectedModel: 'fixture-responses' }).getReader();
    let text = '';
    const work = (async () => { while (true) { const value = await reader.read(); if (value.done) break; text += new TextDecoder().decode(value.value); } })();
    const rejected = expect(work).rejects.toThrow('Gateway accounting stream unavailable');
    await readStarted;
    if (mode === 'read-error') upstream.error(new Error('fixture read failure'));
    else { if (mode === 'late-invalid') upstream.enqueue(encoder.encode('event: response.audio.delta\ndata: {}\n\n')); upstream.close(); }
    await rejected; await new Promise(resolve => setImmediate(resolve));
    expect(text).not.toContain('response.output_text.done'); expect(text).not.toContain('response.completed'); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(accounting.completeAttempt.mock.calls[0][1].usage).toEqual(['persistence-reject', 'authorization-reject'].includes(mode) ? exact : null);
    if (!['authorization-reject'].includes(mode)) expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
  });
  it('abort with primitive reason while ACK held cannot replace observed exact winner', async () => {
    let enterAck, releaseAck;
    const started = new Promise(resolve => { enterAck = resolve; }), ack = new Promise(resolve => { releaseAck = resolve; });
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { enterAck(); await ack; return payload; }), assertSuccessfulTerminal: vi.fn() };
    const signal = new AbortController();
    const response = new Response(encoder.encode(wire()));
    const reader = createAccountedOpenaiStream(response, { accounting, attempt: {}, signal: signal.signal, parserFactory: createAccountingResponsesSseParser, expectedModel: 'fixture-responses' }).getReader();
    let text = '';
    const work = (async () => { while (true) { const value = await reader.read(); if (value.done) break; text += new TextDecoder().decode(value.value); } })();
    const rejected = expect(work).rejects.toThrow('Gateway accounting stream unavailable');
    try { await started; signal.abort(false); await rejected; expect(signal.signal.reason).toBe(false); }
    finally { releaseAck(); }
    await new Promise(resolve => setImmediate(resolve));
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: exact, outcome: 'success' });
    expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); expect(text).not.toContain('response.completed');
  });
});
