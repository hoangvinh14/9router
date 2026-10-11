import { describe, expect, it, vi } from 'vitest';
import { createAccountedOpenaiStream } from 'open-sse/utils/accountedOpenaiStream.js';
import { createAccountingResponsesSseParser } from 'open-sse/utils/accountingResponsesSseParser.js';
const encoder = new TextEncoder();
const model = 'grok-build';
const item = () => ({ id: 'rs_fixture', type: 'reasoning', summary: [{ type: 'summary_text', text: 'héllo reasoning' }], encrypted_content: 'fixture-encrypted', status: 'completed' });
const terminal = () => ({ id: 'resp_fixture', object: 'response', model, status: 'completed', service_tier: 'default', error: null, incomplete_details: null,
  output: [item()], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } });
const frames = () => [
  { type: 'response.created', response: { ...terminal(), status: 'in_progress', output: [], usage: null } },
  { type: 'response.output_item.added', output_index: 0, item: { id: 'rs_fixture', type: 'reasoning', summary: [], status: 'in_progress' } },
  { type: 'response.reasoning_summary_part.added', output_index: 0, item_id: 'rs_fixture', summary_index: 0, part: { type: 'summary_text', text: '' } },
  { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'rs_fixture', summary_index: 0, delta: 'héllo reasoning' },
  { type: 'response.reasoning_summary_text.done', output_index: 0, item_id: 'rs_fixture', summary_index: 0, text: 'héllo reasoning' },
  { type: 'response.reasoning_summary_part.done', output_index: 0, item_id: 'rs_fixture', summary_index: 0, part: item().summary[0] },
  { type: 'response.output_item.done', output_index: 0, item: item() },
  { type: 'response.completed', response: terminal() },
].map((event, sequence_number) => ({ ...event, sequence_number }));
const wire = values => values.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
const parser = callback => createAccountingResponsesSseParser(callback, { expectedModel: model, allowReasoning: true });
const exact = { exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 0, reasoning: 10, reasoningIncludedInOutput: true,
  provenance: { schema: 'openai-responses', endpoint: 'chat', inputIncludesCache: true } };
describe('opt-in ordered raw Responses reasoning prerequisite (not Grok owner/protocol certification)', () => {
  it('empty summary and encrypted continuity delivered only at item done remain exact', () => {
    const values = frames(); values.splice(2, 4); values[2].item.summary = []; values[3].response.output[0].summary = [];
    values.forEach((value, index) => { value.sequence_number = index; });
    const observer = parser(() => {}); observer.push(encoder.encode(wire(values))); expect(observer.finish()).toEqual(exact);
  });
  it('encrypted data present at item start cannot change at item done', () => {
    const values = frames(); values[1].item.encrypted_content = 'fixture-start';
    const observer = parser(() => {}); expect(() => observer.push(encoder.encode(wire(values.slice(0, 6))))).not.toThrow();
    expect(() => observer.push(encoder.encode(wire(values.slice(6))))).toThrow('Invalid raw Responses');
  });
  it.each(['summary', 'encrypted'])('%s bytes cannot bypass event/text bounds', kind => {
    const values = frames(), observer = createAccountingResponsesSseParser(() => {}, { expectedModel: model, allowReasoning: true, maxEventBytes: 1024 });
    if (kind === 'summary') {
      expect(() => observer.push(encoder.encode(wire(values.slice(0, 3))))).not.toThrow();
      // Each event fits, but accumulated text exceeds the same conservative limit.
      for (let sequence = 3; sequence < 5; sequence++) observer.push(encoder.encode(wire([{ ...values[3], delta: 'x'.repeat(400), sequence_number: sequence }])));
      expect(() => observer.push(encoder.encode(wire([{ ...values[3], delta: 'x'.repeat(400), sequence_number: 5 }])))).toThrow('Invalid raw Responses');
    } else {
      expect(() => observer.push(encoder.encode(wire(values.slice(0, 6))))).not.toThrow(); values[6].item.encrypted_content = 'x'.repeat(2000);
      expect(() => observer.push(encoder.encode(wire([values[6]])))).toThrow('Invalid raw Responses');
    }
    expect(() => observer.finish()).toThrow();
  });
  it('shared owner holds summary done/encrypted item/completed bytes through EOF, own ACK and authorization', async () => {
    let upstream, deltaRead, enterAck, releaseAck, enterAuth, releaseAuth;
    // Upstream pull may be eager prefetch, not downstream delivery. Ground the
    // barrier in the actual consumer reading the required nonterminal delta.
    const deliveredDelta = new Promise(resolve => { deltaRead = resolve; });
    const enteredAck = new Promise(resolve => { enterAck = resolve; }), ack = new Promise(resolve => { releaseAck = resolve; });
    const enteredAuth = new Promise(resolve => { enterAuth = resolve; }), auth = new Promise(resolve => { releaseAuth = resolve; });
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { enterAck(); await ack; return payload; }),
      assertSuccessfulTerminal: vi.fn(async () => { enterAuth(); await auth; }) };
    const text = wire(frames());
    const response = new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(encoder.encode(text)); } }));
    const reader = createAccountedOpenaiStream(response, { accounting, attempt: {}, expectedModel: model,
      parserFactory: createAccountingResponsesSseParser, limits: { allowReasoning: true } }).getReader();
    let delivered = '', ended = false;
    const work = (async () => { const decoder = new TextDecoder(); try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); if (delivered.includes('response.reasoning_summary_text.delta')) deltaRead(); } delivered += decoder.decode(); ended = true; } finally { reader.releaseLock(); } })();
    try {
      await deliveredDelta; expect(delivered).toContain('response.reasoning_summary_text.delta'); expect(delivered).not.toContain('response.reasoning_summary_text.done');
      expect(accounting.completeAttempt).not.toHaveBeenCalled(); upstream.close(); await enteredAck;
      expect(ended).toBe(false); expect(delivered).not.toContain('fixture-encrypted'); expect(delivered).not.toContain('response.completed');
      releaseAck(); await enteredAuth; expect(delivered).not.toContain('response.completed');
    } finally {
      releaseAck(); releaseAuth();
      try { upstream.close(); } catch { /* already closed at observed EOF */ }
      await work;
    }
    expect(delivered).toBe(text); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: exact, outcome: 'success' }); expect(accounting.assertSuccessfulTerminal).toHaveBeenCalledTimes(1);
  });
  it('shared owner missing completed errors delivery but separate own ACK is observed with null usage', async () => {
    let acknowledged; const ack = new Promise(resolve => { acknowledged = resolve; });
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { acknowledged(); return payload; }), assertSuccessfulTerminal: vi.fn() };
    const response = new Response(encoder.encode(wire(frames().slice(0, -1))));
    const reader = createAccountedOpenaiStream(response, { accounting, attempt: {}, expectedModel: model,
      parserFactory: createAccountingResponsesSseParser, limits: { allowReasoning: true } }).getReader();
    let delivered = '';
    const work = (async () => { try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += new TextDecoder().decode(chunk.value); } } finally { reader.releaseLock(); } })();
    await expect(work).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: null, outcome: 'network_unknown' });
    expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); expect(delivered).not.toContain('fixture-encrypted'); expect(delivered).not.toContain('response.reasoning_summary_text.done');
  });
  it('explicit reasoning lifecycle preserves raw wire/UTF8 and exact usage only at genuine completed EOF', () => {
    const events = [], observer = parser(value => events.push(value)), text = wire(frames());
    for (const byte of encoder.encode(text)) observer.push(new Uint8Array([byte]));
    expect(observer.finish()).toEqual(exact);
    expect(new TextDecoder().decode(Buffer.concat(events.map(event => event.bytes)))).toBe(text);
    expect(events.filter(event => event.done)).toHaveLength(1);
    expect(events.filter(event => event.terminal)).toHaveLength(4);
  });
  it('default message-only parser remains closed to reasoning output', () => {
    const observer = createAccountingResponsesSseParser(() => {}, { expectedModel: model });
    expect(() => observer.push(encoder.encode(wire(frames())))).toThrow('Invalid raw Responses accounting stream');
  });
  it('completed item but missing response.completed has no exact authority', () => {
    const observer = parser(() => {}); observer.push(encoder.encode(wire(frames().slice(0, -1))));
    expect(observer.finish()).toBeNull(); expect(observer.evidence()).toBeNull();
  });
  it.each(['delta-after-done', 'wrong-index', 'wrong-id', 'done-mismatch', 'part-mismatch', 'encrypted-terminal-mismatch', 'hosted-item', 'summary-without-start', 'usage-total'])('%s cannot become exact money authority', kind => {
    const values = frames();
    if (kind === 'delta-after-done') values.splice(5, 0, { ...values[3] });
    if (kind === 'wrong-index') values[3].summary_index = 1;
    if (kind === 'wrong-id') values[3].item_id = 'other';
    if (kind === 'done-mismatch') values[4].text = 'different';
    if (kind === 'part-mismatch') values[5].part.text = 'different';
    if (kind === 'encrypted-terminal-mismatch') values[7].response.output[0].encrypted_content = 'different';
    if (kind === 'hosted-item') values[1].item.type = 'web_search_call';
    if (kind === 'summary-without-start') values.splice(2, 1);
    if (kind === 'usage-total') values[7].response.usage.total_tokens = 121;
    values.forEach((value, index) => { value.sequence_number = index; });
    const boundary = { 'delta-after-done': 5, 'wrong-index': 3, 'wrong-id': 3, 'done-mismatch': 4, 'part-mismatch': 5,
      'encrypted-terminal-mismatch': 7, 'hosted-item': 1, 'summary-without-start': 2, 'usage-total': 7 }[kind];
    const observed = [], observer = parser(value => observed.push(value));
    // Each invalid case must pass its complete valid prefix. Missing-support
    // catchall rejection at ITEM_START is not proof of a later equality check.
    expect(() => observer.push(encoder.encode(wire(values.slice(0, boundary))))).not.toThrow();
    expect(observed).toHaveLength(boundary);
    expect(() => { observer.push(encoder.encode(wire(values.slice(boundary)))); observer.finish(); }).toThrow('Invalid raw Responses');
    expect(() => observer.finish()).toThrow();
  });
});
