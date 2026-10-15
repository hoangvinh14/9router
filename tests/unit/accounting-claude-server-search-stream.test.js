import { describe, expect, it } from 'vitest';
import { createBufferedClaudeUsageObserver, readBufferedClaudeAccounting } from 'open-sse/utils/accountingClaudeUsage.js';
import { createClaudeServerSearchAuthority, CLAUDE_ACCOUNTING_SERVER_SEARCH_AUTHORITY_BYTES } from 'open-sse/config/accountingClaudeServerSearch.js';

const original = () => ({ model: 'fixture-server-stream', stream: true, max_tokens: 2000,
  tools: [{ type: 'web_search_20250305', name: 'web_search' }], messages: [{ role: 'user', content: 'fixture search' }] });
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const start = () => event('message_start', { message: { id: 'msg_server_stream', type: 'message', role: 'assistant', model: 'fixture-server-stream', content: [], usage: { input_tokens: 50, output_tokens: 3 } } });
const call = () => ({ type: 'server_tool_use', id: 'srvtoolu_stream', name: 'web_search', input: {} });
const source = () => ({ type: 'web_search_result', url: 'https://example.invalid/search', title: 'Fixture source', encrypted_content: 'opaque-stream-source', page_age: null });
const result = () => ({ type: 'web_search_tool_result', tool_use_id: 'srvtoolu_stream', content: [source()] });
const citation = () => ({ type: 'web_search_result_location', url: source().url, title: source().title, encrypted_index: 'opaque-stream-index', cited_text: 'fixture quote' });
const block = (index, value, deltas = []) => event('content_block_start', { index, content_block: value }) + deltas.map(delta => event('content_block_delta', { index, delta })).join('') + event('content_block_stop', { index });
const callBlock = () => block(0, call(), [{ type: 'input_json_delta', partial_json: '{"query":"fixture query"}' }]);
const end = (reason = 'end_turn', uses = 2) => event('message_delta', { delta: { stop_reason: reason }, usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: uses } } }) + event('message_stop');
const wire = () => start() + callBlock() + block(1, result()) + block(2, { type: 'text', text: '' }, [{ type: 'text_delta', text: 'fixture answer' }, { type: 'citations_delta', citation: citation() }]) + end();
const observer = options => createBufferedClaudeUsageObserver({ expectedModel: 'fixture-server-stream', allowWebSearchUsage: true, serverSearchOriginal: original(), ...options });
const read = (value, options) => { const o = observer(options); o.push(new TextEncoder().encode(value)); return o.finish(); };

describe('direct server-search SSE owner prerequisite, no actual dispatch', () => {
  it('one-byte whole-wire capture preserves opaque results/index/query and raw counters own debit', () => {
    const o = observer({ captureMessage: true });
    for (const byte of new TextEncoder().encode(wire())) o.push(Uint8Array.of(byte));
    expect(o.message()).toBeNull();
    expect(o.finish()).toMatchObject({ input: 100, output: 20, toolUses: { webSearchRequests: 2 } });
    expect(o.message().content).toEqual([{ ...call(), input: { query: 'fixture query' } }, result(),
      { type: 'text', text: 'fixture answer', citations: [citation()] }]);
    // One result/call pair, observed two uses: never derive debit from blocks.
    expect(o.message().usage.server_tool_use.web_search_requests).toBe(2);
  });
  it('live callback passes identical bytes and bounded tool JSON; usage exposed only after EOF', () => {
    const frames = [], o = observer({ onEvent: value => frames.push(value) });
    o.push(new TextEncoder().encode(wire()));
    expect(frames.at(-1).done).toBe(true);
    expect(new TextDecoder().decode(Buffer.concat(frames.map(value => Buffer.from(value.bytes))))).toBe(wire());
    expect(o.finish().toolUses).toEqual({ webSearchRequests: 2 });
    expect(() => read(wire(), { maxToolInputBytes: 5 })).toThrow();
  });
  it('empty result or documented result error does not fabricate price/count; raw observed zero is required', () => {
    for (const content of [[], { type: 'web_search_tool_result_error', error_code: 'unavailable' }]) {
      const value = start() + callBlock() + block(1, { ...result(), content }) + end('end_turn', 0);
      expect(read(value).toolUses).toEqual({ webSearchRequests: 0 });
    }
  });
  it.each(['foreign-result', 'duplicate-result', 'future-citation', 'erased-encrypted', 'bad-index', 'query-array', 'prepopulated-query', 'caller', 'result-delta'])('rejects invalid source/protocol authority: %s', mode => {
    let value = wire();
    if (mode === 'foreign-result') value = value.replace('"tool_use_id":"srvtoolu_stream"', '"tool_use_id":"srvtoolu_foreign"');
    if (mode === 'duplicate-result') value = start() + callBlock() + block(1, result()) + block(2, result()) + end();
    if (mode === 'future-citation') value = start() + block(0, { type: 'text', text: '', citations: [citation()] }) + end();
    if (mode === 'erased-encrypted') value = value.replace('"encrypted_content":"opaque-stream-source",', '');
    if (mode === 'bad-index') value = value.replace('"encrypted_index":"opaque-stream-index"', '"encrypted_index":""');
    if (mode === 'query-array') value = start() + block(0, call(), [{ type: 'input_json_delta', partial_json: '[]' }]) + end('pause_turn');
    if (mode === 'prepopulated-query') value = start() + block(0, { ...call(), input: { query: 'hidden' } }) + end('pause_turn');
    if (mode === 'caller') value = value.replace('"name":"web_search"', '"name":"web_search","caller":{"type":"code_execution_20260120","tool_id":"srvtoolu_other"}');
    if (mode === 'result-delta') value = start() + callBlock() + block(1, result(), [{ type: 'text_delta', text: 'hidden' }]) + end();
    expect(() => read(value)).toThrow();
  });
  it('pending server call ends only in pause_turn or mixed client-tool stop; no internal continuation POST', () => {
    expect(read(start() + callBlock() + end('pause_turn', 0)).toolUses).toEqual({ webSearchRequests: 0 });
    expect(() => read(start() + callBlock() + end('end_turn', 0))).toThrow();
    expect(() => read(start() + callBlock() + end('tool_use', 0))).toThrow();
    const mixed = original(); mixed.tools.push({ name: 'fixture_client', input_schema: { type: 'object' } });
    const client = block(1, { type: 'tool_use', id: 'toolu_fixture', name: 'fixture_client', input: {} }, [{ type: 'input_json_delta', partial_json: '{}' }]);
    expect(read(start() + callBlock() + client + end('tool_use', 0), { serverSearchOriginal: mixed, allowClientTools: true, onEvent: () => {} }).toolUses).toEqual({ webSearchRequests: 0 });
    expect(() => read(start() + callBlock() + client + end('pause_turn', 0), { serverSearchOriginal: mixed, allowClientTools: true, onEvent: () => {} })).toThrow();
  });
  it('deferred result binds an original pending call without duplicate current call; replay state is immutable', () => {
    const body = original(); body.messages.push({ role: 'assistant', content: [{ ...call(), input: { query: 'fixture query' } }] });
    const o = observer({ serverSearchOriginal: body }); body.messages[1].content[0].id = 'mutated';
    o.push(new TextEncoder().encode(start() + block(0, result()) + end()));
    expect(o.finish().toolUses).toEqual({ webSearchRequests: 2 });
    expect(() => read(wire(), { serverSearchOriginal: { ...original(), messages: [{ role: 'assistant', content: [{ ...call(), input: { query: 'fixture query' } }] }] } })).toThrow();
  });
  it('requires original/model/usage opt-ins; defaults, dynamic caller and source erasure stay closed', () => {
    expect(() => observer({ allowWebSearchUsage: false })).toThrow();
    const dynamic = original(); dynamic.tools[0].type = 'web_search_20260209'; expect(() => observer({ serverSearchOriginal: dynamic })).toThrow();
    expect(() => observer({ serverSearchOriginal: { ...original(), model: 'foreign' } })).toThrow();
    const defaults = createBufferedClaudeUsageObserver({ expectedModel: 'fixture-server-stream', allowAbsentServerToolUsage: true });
    expect(() => defaults.push(new TextEncoder().encode(wire()))).toThrow();
    const noOriginal = createBufferedClaudeUsageObserver({ expectedModel: 'fixture-server-stream', allowWebSearchUsage: true });
    expect(() => noOriginal.push(new TextEncoder().encode(wire()))).toThrow();
  });
  it('source/ID association retention is bounded without retaining or decoding the encrypted corpus', () => {
    const authority = createClaudeServerSearchAuthority(original().tools);
    expect(authority.acceptCall({ ...call(), input: { query: 'fixture query' } })).toBe(true);
    const tooLarge = { ...result(), content: [{ ...source(), title: 'x'.repeat(CLAUDE_ACCOUNTING_SERVER_SEARCH_AUTHORITY_BYTES) }] };
    expect(authority.acceptResult(tooLarge)).toBe(false);
    expect(authority.pendingCount()).toBe(1);
    expect(authority.acceptResult(result())).toBe(true); expect(authority.pendingCount()).toBe(0);
    expect(authority.supportsCitation(citation())).toBe(true);
    const paired = original(); paired.messages.push({ role: 'assistant', content: [{ ...call(), input: { query: 'fixture query' } }, result()] });
    expect(() => read(start() + block(0, result()) + end(), { serverSearchOriginal: paired })).toThrow();
  });
  it('buffered failed HTTP requires separate status opt-in; malformed tail/missing stop cannot expose captured message', async () => {
    const response = value => new Response(value, { status: 503, headers: { 'content-type': 'text/event-stream' } });
    const options = { expectedModel: 'fixture-server-stream', allowWebSearchUsage: true, serverSearchOriginal: original(), captureMessage: true };
    await expect(readBufferedClaudeAccounting(response(wire()), null, options)).rejects.toThrow();
    const failed = await readBufferedClaudeAccounting(response(wire()), null, { ...options, allowFailedHttp: true });
    expect(failed.message.content[1]).toEqual(result()); expect(failed.usage.toolUses).toEqual({ webSearchRequests: 2 });
    const partial = observer({ captureMessage: true }); partial.push(new TextEncoder().encode(wire().replace(event('message_stop'), '')));
    expect(partial.finish()).toBeNull(); expect(partial.message()).toBeNull();
    const poisoned = observer({ captureMessage: true }); poisoned.push(new TextEncoder().encode(wire()));
    expect(() => poisoned.push(new TextEncoder().encode(event('ping')))).toThrow(); expect(poisoned.finish()).toBeNull(); expect(poisoned.message()).toBeNull();
  });
});
