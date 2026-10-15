import { describe, expect, it, vi } from 'vitest';
import { createBufferedClaudeUsageObserver, readBufferedClaudeAccounting } from 'open-sse/utils/accountingClaudeUsage.js';
const original = () => ({ model: 'fixture-dynamic-stream', stream: true, max_tokens: 100, tools: [{ type: 'web_search_20260318', name: 'web_search' }], messages: [{ role: 'user', content: 'Search' }] });
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const start = (extra = {}) => event('message_start', { message: { id: 'msg_dynamic', type: 'message', role: 'assistant', model: 'fixture-dynamic-stream', content: [], usage: { input_tokens: 50, output_tokens: 2, ...extra } } });
const parent = (input = {}) => ({ type: 'server_tool_use', id: 'srvtoolu_parent', name: 'code_execution', input });
const child = () => ({ type: 'server_tool_use', id: 'srvtoolu_child', name: 'web_search', input: {}, caller: { type: 'code_execution_20260120', tool_id: 'srvtoolu_parent' } });
const searchResult = () => ({ type: 'web_search_tool_result', tool_use_id: 'srvtoolu_child', caller: child().caller, content: [{ type: 'web_search_result', url: 'https://example.com/source', title: 'source', encrypted_content: 'private opaque corpus' }] });
const codeResult = () => ({ type: 'code_execution_tool_result', tool_use_id: 'srvtoolu_parent', content: { type: 'code_execution_result', stdout: 'private result', stderr: '', return_code: 0, content: [] } });
const block = (index, value, deltas = []) => event('content_block_start', { index, content_block: value }) + deltas.map(delta => event('content_block_delta', { index, delta })).join('') + event('content_block_stop', { index });
const codeCall = () => block(0, parent(), [{ type: 'input_json_delta', partial_json: '{"code":"private code🙂"}' }]);
const childCall = () => block(1, child(), [{ type: 'input_json_delta', partial_json: '{"query":"private query"}' }]);
const end = (reason = 'end_turn', count = 3) => event('message_delta', { delta: { stop_reason: reason }, usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 2, code_execution_requests: count } } }) + event('message_stop');
const wire = () => start() + codeCall() + childCall() + block(2, searchResult()) + block(3, codeResult()) + end();
const observer = options => createBufferedClaudeUsageObserver({ expectedModel: 'fixture-dynamic-stream', allowWebSearchUsage: true, allowCodeExecutionUsage: true, serverDynamicOriginal: original(), ...options });
const read = (raw, options) => { const value = observer(options); value.push(new TextEncoder().encode(raw)); return value.finish(); };

describe('isolated raw dynamic graph/full result/observed code terminal, not provider/resource admission', () => {
  it('one-byte capture preserves code/query/caller/results and exact independent counters after clean EOF', () => {
    const value = observer({ captureMessage: true }); for (const byte of new TextEncoder().encode(wire())) value.push(Uint8Array.of(byte)); expect(value.message()).toBeNull();
    expect(value.finish()).toMatchObject({ input: 100, output: 20, codeToolUses: { codeExecutionRequests: 3 }, toolUses: { webSearchRequests: 2 } });
    expect(value.message().content).toEqual([parent({ code: 'private code🙂' }), { ...child(), input: { query: 'private query' } }, searchResult(), codeResult()]);
  });
  it('live frames remain identical and cumulative code count replaces, never inferred from parent blocks', () => {
    const frames = [], value = observer({ onEvent: frame => frames.push(frame) });
    const raw = wire().replace(end(), event('message_delta', { delta: {}, usage: { input_tokens: 70, output_tokens: 10, server_tool_use: { web_search_requests: 1, code_execution_requests: 1 } } }) + end());
    value.push(new TextEncoder().encode(raw)); expect(value.finish().codeToolUses.codeExecutionRequests).toBe(3);
    expect(new TextDecoder().decode(Buffer.concat(frames.map(frame => Buffer.from(frame.bytes))))).toBe(raw);
    for (const bad of [raw.replace('"code_execution_requests":3', '"code_execution_requests":0'), wire().replace(',"code_execution_requests":3', ''), wire().replace('"input_tokens":100', '"input_tokens":49')]) expect(() => read(bad)).toThrow();
  });
  it('full pairing/caller/schema/whole-result validation rejects foreign parent/resultdelta/file/half-pair even suppressed', () => {
    for (const bad of [wire().replaceAll('"tool_id":"srvtoolu_parent"', '"tool_id":"srvtoolu_foreign"'), wire().replace('"return_code":0', '"return_code":0.5'),
      start() + codeCall() + childCall() + block(2, codeResult()) + end(), start() + codeCall() + block(1, codeResult(), [{ type: 'text_delta', text: 'hidden' }]) + end(),
      wire().replace('"content":[]', '"content":[{"type":"code_execution_output","file_id":"file_foreign"}]')]) expect(() => read(bad)).toThrow();
    const body = original(); body.tools[0].response_inclusion = 'excluded';
    expect(read(start() + codeCall() + block(1, codeResult()) + end(), { serverDynamicOriginal: body }).codeToolUses.codeExecutionRequests).toBe(3);
    expect(() => read(start() + codeCall() + childCall() + block(2, codeResult()) + end(), { serverDynamicOriginal: body })).toThrow();
  });
  it('pending code pause and original deferred result keep shared IDs, no auto terminal or fabricated code count', () => {
    expect(read(start() + codeCall() + end('pause_turn', 0)).codeToolUses.codeExecutionRequests).toBe(0);
    expect(() => read(start() + codeCall() + end('end_turn', 0))).toThrow();
    const body = original(); body.messages.push({ role: 'assistant', content: [parent({ code: 'prior code' })] });
    const value = observer({ serverDynamicOriginal: body }); body.messages[1].content[0].id = 'mutated';
    value.push(new TextEncoder().encode(start() + block(0, codeResult()) + end())); expect(value.finish().codeToolUses.codeExecutionRequests).toBe(3);
  });
  it('requires explicit bounded original/model/flags; defaults and mixed divergent authorities cannot acquire dynamic wire', () => {
    for (const options of [{ allowCodeExecutionUsage: 'true' }, { allowCodeExecutionUsage: false }, { serverDynamicOriginal: { ...original(), model: 'foreign' } }, { serverSearchOriginal: { ...original(), max_tokens: 99 } }]) expect(() => observer(options)).toThrow();
    const getter = vi.fn(); expect(() => observer({ serverDynamicOriginal: Object.defineProperty(original(), 'tools', { enumerable: true, get: getter }) })).toThrow(); expect(getter).not.toHaveBeenCalled();
    const plain = createBufferedClaudeUsageObserver({ expectedModel: 'fixture-dynamic-stream', allowAbsentServerToolUsage: true }); expect(() => plain.push(new TextEncoder().encode(wire()))).toThrow();
  });
  it('combined dynamic fetch/search/code preserves fetched document citation index, no result-delta or future citation', () => {
    const body = original(); body.tools.push({ type: 'web_fetch_20260318', name: 'web_fetch', citations: { enabled: true } });
    const fetchedCall = { ...child(), id: 'srvtoolu_fetch', name: 'web_fetch' };
    const fetched = { type: 'web_fetch_tool_result', tool_use_id: fetchedCall.id, caller: child().caller, content: { type: 'web_fetch_result', url: 'https://example.com/source', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'private document' }, citations: { enabled: true } } } };
    const citation = { type: 'char_location', document_index: 0, document_title: null, cited_text: 'private', start_char_index: 0, end_char_index: 7 };
    const terminal = end().replace('"web_search_requests":2', '"web_search_requests":2,"web_fetch_requests":1');
    const raw = start() + codeCall() + block(1, fetchedCall, [{ type: 'input_json_delta', partial_json: '{"url":"https://example.com/source"}' }]) + block(2, fetched) + block(3, codeResult()) +
      block(4, { type: 'text', text: '' }, [{ type: 'citations_delta', citation }]) + terminal;
    const options = { serverDynamicOriginal: body, allowWebFetchUsage: true };
    expect(read(raw, options)).toMatchObject({ codeToolUses: { codeExecutionRequests: 3 }, nonBillableToolUses: { webFetchRequests: 1 }, toolUses: { webSearchRequests: 2 } });
    expect(() => read(raw.replace('"document_index":0', '"document_index":1'), options)).toThrow();
    expect(() => read(start() + codeCall() + block(1, fetchedCall, [{ type: 'input_json_delta', partial_json: '{"url":"https://example.com/source"}' }]) + block(2, fetched, [{ type: 'text_delta', text: 'hidden' }]) + terminal, options)).toThrow();
  });
  it('raw code category cannot disappear and original names/JSON/result types are never broadened by opt-in', () => {
    const countedStart = start({ server_tool_use: { web_search_requests: 0, code_execution_requests: 0 } });
    expect(() => read(wire().replace(start(), countedStart).replace(',"code_execution_requests":3', ''))).toThrow();
    const originalWire = wire();
    const mutations = [originalWire.replace(JSON.stringify('{"code":"private code🙂"}'), JSON.stringify('{"code":""}')),
      originalWire.replace('"name":"code_execution"', '"name":"foreign"'), originalWire.replace('"code_execution_result"', '"foreign_result"')];
    for (const raw of mutations) { expect(raw).not.toBe(originalWire); expect(() => read(raw)).toThrow(); }
    expect(() => read(wire(), { maxToolInputBytes: 4 })).toThrow();
  });
  it('failed HTTP opt-in still owes stop+cleanEOF and exact counts; no terminal frame alone flushes usage', async () => {
    const make = (raw, status = 429) => new Response(raw, { status, headers: { 'content-type': 'text/event-stream' } });
    const options = { expectedModel: 'fixture-dynamic-stream', allowWebSearchUsage: true, allowCodeExecutionUsage: true, serverDynamicOriginal: original(), allowFailedHttp: true, captureMessage: true };
    expect((await readBufferedClaudeAccounting(make(wire()), null, options)).usage.codeToolUses.codeExecutionRequests).toBe(3);
    await expect(readBufferedClaudeAccounting(make(wire()), null, { ...options, allowFailedHttp: false })).rejects.toThrow();
    const incomplete = observer(); incomplete.push(new TextEncoder().encode(wire().replace(/event: message_stop[\s\S]*$/, ''))); expect(incomplete.finish()).toBeNull();
    const failed = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(wire())); controller.error(new Error('fixture EOF lost')); } }), { headers: { 'content-type': 'text/event-stream' } });
    await expect(readBufferedClaudeAccounting(failed, null, options)).rejects.toThrow();
  });
});
