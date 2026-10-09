import { describe, it, expect, vi } from 'vitest';
import { createAccountingClaudeSseParser } from 'open-sse/utils/accountingClaudeSseParser.js';
import { createAccountedOpenaiStream } from 'open-sse/utils/accountedOpenaiStream.js';
const enc = new TextEncoder();
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const usage = { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
  cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } };
const start = () => event('message_start', { message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'fixture-model', content: [], usage } });
const text = () => event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'đúng🙂' } }) + event('content_block_stop', { index: 0 });
const delta = () => event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } });
const stop = () => event('message_stop');
const wire = () => start() + text() + delta() + stop();
const parser = callback => createAccountingClaudeSseParser(callback, { expectedModel: 'fixture-model' });
describe('live text-only Claude raw observer/shared terminal candidate, not app approval', () => {
  const batches = [false, true].flatMap(crlf => {
    const raw = wire().replaceAll('\n', crlf ? '\r\n' : '\n'), bytes = enc.encode(raw), rows = [];
    for (let first = 0; first <= bytes.length; first += 128) rows.push({ crlf, first, last: Math.min(first + 127, bytes.length), raw, bytes });
    return rows;
  });
  it.each(batches)('all split positions $first..$last preserve raw wire CRLF=$crlf', ({ first, last, raw, bytes }) => {
    for (let split = first; split <= last; split++) {
      const events = [], observer = parser(value => events.push(value)); observer.push(bytes.slice(0, split)); observer.push(bytes.slice(split));
      expect(observer.finish()).toMatchObject({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 10, provenance: { schema: 'claude' } });
      expect(new TextDecoder().decode(Buffer.concat(events.map(value => value.bytes)))).toBe(raw); expect(events.filter(value => value.done)).toHaveLength(1);
    }
  });
  it('one-byte fragmentation preserves UTF8 and same raw bytes', () => {
    const events = [], observer = parser(value => events.push(value));
    for (const byte of enc.encode(wire())) observer.push(new Uint8Array([byte]));
    expect(observer.finish()).toMatchObject({ exact: true, input: 100, output: 20 });
    expect(new TextDecoder().decode(Buffer.concat(events.map(value => value.bytes)))).toBe(wire());
  });
  it('live mode does not impose buffered total/event cap', () => {
    const observer = createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', maxTotalBytes: 1, maxEvents: 1 });
    observer.push(enc.encode(wire())); expect(observer.finish()).toMatchObject({ exact: true, output: 20 });
  });
  it.each(['thinking', 'tool_use', 'server_tool_use', 'unknown-text-field', 'wrong-model', 'late-ping', 'duplicate-stop', 'missing-stop', 'error'])('%s cannot create exact terminal authority', mode => {
    let raw = wire();
    if (['thinking', 'tool_use', 'server_tool_use'].includes(mode)) raw = start() + event('content_block_start', { index: 0, content_block: { type: mode, text: '' } }) + delta() + stop();
    if (mode === 'unknown-text-field') raw = raw.replace('"type":"text","text":""', '"type":"text","text":"","paid_option":true');
    if (mode === 'wrong-model') raw = raw.replace('fixture-model', 'other-model');
    if (mode === 'late-ping') raw += event('ping');
    if (mode === 'duplicate-stop') raw += stop();
    if (mode === 'missing-stop') raw = start() + text() + delta();
    if (mode === 'error') raw = start() + event('error', { error: { type: 'fixture' } });
    const observer = parser(() => {});
    if (mode === 'missing-stop') { observer.push(enc.encode(raw)); expect(observer.finish()).toBeNull(); }
    else expect(() => { observer.push(enc.encode(raw)); observer.finish(); }).toThrow();
    expect(observer.evidence()).toBeNull();
  });
  it('fatalUTF8/event/chunk bounds still fail closed', () => {
    expect(() => parser(() => {}).push(new Uint8Array([255]))).toThrow();
    for (const limits of [{ maxEventBytes: 16 }, { maxChunkBytes: 16 }]) expect(() => createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', ...limits }).push(enc.encode(wire()))).toThrow();
  });
  it('sole owner holds message_delta/message_stop until EOF, ACK and authorization', async () => {
    let upstream, enterAck, releaseAck, enterAuth, releaseAuth;
    const startedAck = new Promise(resolve => { enterAck = resolve; }), ack = new Promise(resolve => { releaseAck = resolve; });
    const startedAuth = new Promise(resolve => { enterAuth = resolve; }), auth = new Promise(resolve => { releaseAuth = resolve; });
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { enterAck(); await ack; return payload; }), assertSuccessfulTerminal: vi.fn(async () => { enterAuth(); await auth; }) };
    const response = new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(enc.encode(wire())); } }));
    const reader = createAccountedOpenaiStream(response, { accounting, attempt: {}, parserFactory: createAccountingClaudeSseParser, expectedModel: 'fixture-model' }).getReader();
    let text = '';
    const work = (async () => { while (true) { const value = await reader.read(); if (value.done) break; text += new TextDecoder().decode(value.value); } })();
    try {
      await new Promise(resolve => setImmediate(resolve)); expect(text).toContain('event: content_block_delta'); expect(text).not.toContain('event: message_delta'); expect(accounting.completeAttempt).not.toHaveBeenCalled();
      upstream.close(); await startedAck; expect(text).not.toContain('event: message_stop'); releaseAck(); await startedAuth; expect(text).not.toContain('event: message_stop');
    } finally { releaseAck(); releaseAuth(); }
    await work; expect(text).toBe(wire()); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.completeAttempt.mock.calls[0][1]).toMatchObject({ outcome: 'success', usage: { exact: true, input: 100, output: 20 } });
  });
  it.each(['missing-stop', 'trailing-invalid', 'persistence-reject', 'authorization-reject'])('shared owner %s never emits successful native terminal or second completion', async mode => {
    const raw = mode === 'missing-stop' ? start() + text() + delta() : wire() + (mode === 'trailing-invalid' ? event('error', { error: {} }) : '');
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { if (mode === 'persistence-reject') throw new Error('fixture persist'); return payload; }), assertSuccessfulTerminal: vi.fn(async () => { if (mode === 'authorization-reject') throw new Error('fixture auth'); }) };
    const reader = createAccountedOpenaiStream(new Response(raw), { accounting, attempt: {}, parserFactory: createAccountingClaudeSseParser, expectedModel: 'fixture-model' }).getReader();
    let captured = '';
    await expect((async () => { while (true) { const value = await reader.read(); if (value.done) break; captured += new TextDecoder().decode(value.value); } })()).rejects.toThrow('Gateway accounting stream unavailable');
    await new Promise(resolve => setImmediate(resolve)); expect(captured).not.toContain('event: message_delta'); expect(captured).not.toContain('event: message_stop'); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(accounting.completeAttempt.mock.calls[0][1].usage === null).toBe(['missing-stop', 'trailing-invalid'].includes(mode));
  });
});
