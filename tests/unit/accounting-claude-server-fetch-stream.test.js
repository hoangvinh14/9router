import { describe, expect, it, vi } from 'vitest';
import { createBufferedClaudeUsageObserver, readBufferedClaudeAccounting } from 'open-sse/utils/accountingClaudeUsage.js';

const original = () => ({ model: 'fixture-fetch-stream', stream: true, max_tokens: 100,
  tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', citations: { enabled: true } }], messages: [{ role: 'user', content: 'Read https://example.com/article' }] });
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const start = extra => event('message_start', { message: { id: 'msg_fetch', type: 'message', role: 'assistant', model: 'fixture-fetch-stream', content: [], usage: { input_tokens: 50, output_tokens: 2, ...extra } } });
const call = () => ({ type: 'server_tool_use', id: 'srvtoolu_fetch', name: 'web_fetch', input: {} });
const result = () => ({ type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_fetch', content: { type: 'web_fetch_result', url: 'https://example.com/article', retrieved_at: '2026-10-03T00:00:00Z', content: {
  type: 'document', title: 'Fetched title', source: { type: 'text', media_type: 'text/plain', data: 'Original fetched corpus🙂' }, citations: { enabled: true } } } });
const citation = index => ({ type: 'char_location', document_index: index, document_title: 'Fetched title', start_char_index: 0, end_char_index: 7, cited_text: 'Original' });
const block = (index, value, deltas = []) => event('content_block_start', { index, content_block: value }) + deltas.map(delta => event('content_block_delta', { index, delta })).join('') + event('content_block_stop', { index });
const callBlock = () => block(0, call(), [{ type: 'input_json_delta', partial_json: '{"url":"https://example.com/article"}' }]);
const end = (reason = 'end_turn', count = 3) => event('message_delta', { delta: { stop_reason: reason }, usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_fetch_requests: count } } }) + event('message_stop');
const wire = () => start() + callBlock() + block(1, result()) + block(2, { type: 'text', text: '' }, [{ type: 'text_delta', text: 'answer🙂' }, { type: 'citations_delta', citation: citation(0) }]) + end();
const observer = options => createBufferedClaudeUsageObserver({ expectedModel: 'fixture-fetch-stream', allowWebFetchUsage: true, serverFetchOriginal: original(), ...options });
const read = (value, options) => { const owner = observer(options); owner.push(new TextEncoder().encode(value)); return owner.finish(); };

describe('raw direct-fetch cumulative usage/result/citation owner prerequisite, no provider dispatch', () => {
  it('one-byte buffered capture preserves fetched corpus/URL/citation and exposes observed uses only after clean EOF', () => {
    const owner = observer({ captureMessage: true });
    for (const byte of new TextEncoder().encode(wire())) owner.push(Uint8Array.of(byte));
    expect(owner.message()).toBeNull();
    expect(owner.finish()).toMatchObject({ input: 100, output: 20, nonBillableToolUses: { webFetchRequests: 3 } });
    expect(owner.message().content).toEqual([{ ...call(), input: { url: 'https://example.com/article' } }, result(), { type: 'text', text: 'answer🙂', citations: [citation(0)] }]);
    expect(owner.message().usage.server_tool_use.web_fetch_requests).toBe(3);
  });
  it('live observer forwards identical frames, terminal uses cumulative replacement not sum or block count', () => {
    const frames = [], owner = observer({ onEvent: frame => frames.push(frame) });
    const raw = wire().replace(end(), event('message_delta', { delta: {}, usage: { input_tokens: 70, output_tokens: 10, server_tool_use: { web_fetch_requests: 1 } } }) + end());
    owner.push(new TextEncoder().encode(raw)); expect(owner.finish().nonBillableToolUses).toEqual({ webFetchRequests: 3 });
    expect(new TextDecoder().decode(Buffer.concat(frames.map(frame => Buffer.from(frame.bytes))))).toBe(raw);
    expect(frames.at(-1).done).toBe(true);
    expect(() => read(wire(), { maxToolInputBytes: 4 })).toThrow();
  });
  it('result whole-only pairing and dynamically preceding citations reject foreign/duplicate/future/resultdelta/file authority', () => {
    for (const raw of [wire().replace('"tool_use_id":"srvtoolu_fetch"', '"tool_use_id":"srvtoolu_other"'),
      start() + callBlock() + block(1, result()) + block(2, result()) + end(),
      start() + block(0, { type: 'text', text: '', citations: [citation(0)] }) + end(),
      start() + callBlock() + block(1, result(), [{ type: 'text_delta', text: 'hidden' }]) + end(),
      wire().replace('"document_index":0', '"document_index":1'),
      wire().replace('"source":{"type":"text","media_type":"text/plain","data":"Original fetched corpus🙂"}', '"source":{"type":"file","file_id":"file_other"}')]) expect(() => read(raw)).toThrow();
  });
  it('counter/category/input rollback or terminal absence fails; omission at start never fabricates zero', () => {
    const blocks = callBlock() + block(1, result());
    expect(read(start() + blocks + end('end_turn', 0)).nonBillableToolUses).toEqual({ webFetchRequests: 0 });
    for (const raw of [start({ server_tool_use: { web_fetch_requests: 4 } }) + blocks + end(),
      start({ server_tool_use: { web_fetch_requests: 1, web_search_requests: 0 } }) + blocks + end(),
      wire().replace('"input_tokens":100', '"input_tokens":49'),
      wire().replace(',"server_tool_use":{"web_fetch_requests":3}', ''),
      wire().replace('"web_fetch_requests":3', '"code_execution_requests":3')]) expect(() => read(raw)).toThrow();
  });
  it('original inline and preceding fetched history preserve ordered citation indices, deferred result uses retained ID once', () => {
    const body = original(); body.messages[0].content = [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'inline' }, citations: { enabled: true } }];
    expect(read(wire().replace('"document_index":0', '"document_index":1'), { serverFetchOriginal: body }).nonBillableToolUses.webFetchRequests).toBe(3);
    const paused = original(); paused.messages.push({ role: 'assistant', content: [{ ...call(), input: { url: 'https://example.com/article' } }] });
    const owner = observer({ serverFetchOriginal: paused }); paused.messages[1].content[0].id = 'mutated';
    owner.push(new TextEncoder().encode(start() + block(0, result()) + end())); expect(owner.finish().nonBillableToolUses.webFetchRequests).toBe(3);
    expect(() => read(wire(), { serverFetchOriginal: { ...original(), messages: [{ role: 'assistant', content: [{ ...call(), input: { url: 'https://example.com/article' } }, result()] }] } })).toThrow();
  });
  it('pending call requires pause or mixed declared-client stop, tool errors add no citation document', () => {
    expect(read(start() + callBlock() + end('pause_turn', 0)).nonBillableToolUses).toEqual({ webFetchRequests: 0 });
    expect(() => read(start() + callBlock() + end('end_turn', 0))).toThrow();
    expect(() => read(start() + callBlock() + end('tool_use', 0))).toThrow();
    const mixed = original(); mixed.tools.push({ name: 'lookup', input_schema: { type: 'object' } });
    const client = block(1, { type: 'tool_use', id: 'client', name: 'lookup', input: {} }, [{ type: 'input_json_delta', partial_json: '{}' }]);
    expect(read(start() + callBlock() + client + end('tool_use', 0), { serverFetchOriginal: mixed, allowClientTools: true, onEvent: () => {} }).nonBillableToolUses.webFetchRequests).toBe(0);
    const error = { ...result(), content: { type: 'web_fetch_tool_result_error', error_code: 'unavailable' } };
    expect(read(start() + callBlock() + block(1, error) + end('end_turn', 0)).nonBillableToolUses.webFetchRequests).toBe(0);
    expect(() => read(start() + callBlock() + block(1, error) + block(2, { type: 'text', text: '', citations: [citation(0)] }) + end())).toThrow();
  });
  it('requires explicit plain original/model/tool and independent usage flag; defaults do not admit fetch blocks', () => {
    expect(() => observer({ allowWebFetchUsage: false })).toThrow();
    expect(() => observer({ serverFetchOriginal: { ...original(), model: 'foreign' } })).toThrow();
    const getter = vi.fn(() => original().tools);
    expect(() => observer({ serverFetchOriginal: Object.defineProperty(original(), 'tools', { enumerable: true, get: getter }) })).toThrow(); expect(getter).not.toHaveBeenCalled();
    for (const options of [{ expectedModel: 'fixture-fetch-stream', allowAbsentServerToolUsage: true }, { expectedModel: 'fixture-fetch-stream', allowWebFetchUsage: true }]) {
      const owner = createBufferedClaudeUsageObserver(options); expect(() => owner.push(new TextEncoder().encode(wire()))).toThrow();
    }
  });
  it('combined search/fetch shares ID state but retains independent raw counters and source citation types', () => {
    const body = original(); body.tools.push({ type: 'web_search_20250305', name: 'web_search' });
    const searchCall = { type: 'server_tool_use', id: 'srvtoolu_search', name: 'web_search', input: {} };
    const searchResult = { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_search', content: [] };
    const raw = start() + callBlock() + block(1, result()) + block(2, searchCall, [{ type: 'input_json_delta', partial_json: '{"query":"search"}' }]) + block(3, searchResult) +
      end().replace('"web_fetch_requests":3', '"web_fetch_requests":3,"web_search_requests":2');
    const options = { allowWebSearchUsage: true, serverSearchOriginal: body, serverFetchOriginal: body };
    expect(read(raw, options)).toMatchObject({ toolUses: { webSearchRequests: 2 }, nonBillableToolUses: { webFetchRequests: 3 } });
    expect(() => read(raw.replace('"id":"srvtoolu_search"', '"id":"srvtoolu_fetch"'), options)).toThrow();
    expect(() => read(raw, { ...options, serverSearchOriginal: { ...body, max_tokens: 101 } })).toThrow();
  });
  it('fetched PDF kind/cache/citation enablement and late/partial JSON remain strict', () => {
    const pdf = result(); pdf.content.content.source = { type: 'base64', media_type: 'application/pdf', data: 'aW5saW5l' };
    const page = { type: 'page_location', document_index: 0, document_title: 'Fetched title', start_page_number: 1, end_page_number: 2, cited_text: 'PDF quotation' };
    const raw = start() + callBlock() + block(1, pdf) + block(2, { type: 'text', text: '', citations: [page] }) + end();
    expect(read(raw).nonBillableToolUses.webFetchRequests).toBe(3);
    expect(() => read(raw.replace(JSON.stringify(page), JSON.stringify(citation(0))))).toThrow();
    const disabled = original(); disabled.tools[0].citations.enabled = false; expect(() => read(wire(), { serverFetchOriginal: disabled })).toThrow();
    expect(() => read(start() + block(0, { ...call(), input: { url: 'https://example.com/article' } }) + end('pause_turn'))).toThrow();
    expect(() => read(start() + block(0, call(), [{ type: 'input_json_delta', partial_json: '{' }]) + end('pause_turn'))).toThrow();
    const cached = result(); cached.content.content.cache_control = { type: 'ephemeral' };
    expect(() => read(start() + callBlock() + block(1, cached) + end())).toThrow();
  });
  it('failed HTTP opt-in still requires raw stop/EOF; poison never exposes captured message', async () => {
    const options = { expectedModel: 'fixture-fetch-stream', allowWebFetchUsage: true, serverFetchOriginal: original(), captureMessage: true };
    const response = raw => new Response(raw, { status: 503, headers: { 'content-type': 'text/event-stream' } });
    await expect(readBufferedClaudeAccounting(response(wire()), null, options)).rejects.toThrow();
    const failed = await readBufferedClaudeAccounting(response(wire()), null, { ...options, allowFailedHttp: true });
    expect(failed.message.content[1]).toEqual(result()); expect(failed.usage.nonBillableToolUses.webFetchRequests).toBe(3);
    const partial = observer({ captureMessage: true }); partial.push(new TextEncoder().encode(wire().replace(event('message_stop'), ''))); expect(partial.finish()).toBeNull(); expect(partial.message()).toBeNull();
    const poison = observer({ captureMessage: true }); poison.push(new TextEncoder().encode(wire())); expect(() => poison.push(new TextEncoder().encode(event('ping')))).toThrow(); expect(poison.finish()).toBeNull(); expect(poison.message()).toBeNull();
  });
});
