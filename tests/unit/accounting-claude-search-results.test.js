import { describe, it, expect } from 'vitest';
import { prepareClaudeRequest, anchorClaudeCache } from 'open-sse/translator/formats/claude.js';
import { anthropicRequestHasCache1h, supportsAnthropicLiveRequest } from 'open-sse/config/accountedAnthropicCandidate.js';
import { supportsClaudeOauthOriginal, prepareAccountingClaudeOauthBody } from 'open-sse/config/accountedClaudeOauth.js';
import { createAccountingClaudeSseParser } from 'open-sse/utils/accountingClaudeSseParser.js';
import { createBufferedClaudeUsageObserver } from 'open-sse/utils/accountingClaudeUsage.js';
const enc = new TextEncoder();
const result = () => ({ type: 'search_result', source: 'kb://original/item', title: 'original RAG title', content: [{ type: 'text', text: 'first🙂 chunk' }, { type: 'text', text: 'second chunk' }], citations: { enabled: true } });
const request = () => ({ model: 'fixture-model', stream: true, max_tokens: 100, messages: [{ role: 'user', content: [result(), { type: 'text', text: 'cite these results' }] }] });
const citation = () => ({ type: 'search_result_location', source: 'kb://original/item', title: 'original RAG title', cited_text: 'first🙂 chunk', search_result_index: 0, start_block_index: 0, end_block_index: 1 });
const authority = () => [{ source: 'kb://original/item', title: 'original RAG title', enabled: true, content: ['first🙂 chunk', 'second chunk'] }];
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const wire = (value = citation()) => event('message_start', { message: { id: 'msg_rag', type: 'message', role: 'assistant', model: 'fixture-model', content: [], usage: { input_tokens: 50, output_tokens: 2, server_tool_use: { web_search_requests: 0 } } } }) +
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '', citations: [] } }) +
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'answer🙂' } }) +
  event('content_block_delta', { index: 0, delta: { type: 'citations_delta', citation: value } }) + event('content_block_stop', { index: 0 }) +
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + event('message_stop');
describe('queued client-supplied RAG results, not paid server search or retrieval approval', () => {
  it.each(['top-level', 'search-only-turn', 'tool-result', 'assistant-replay'])('preserves original %s source/text through queued transform only', mode => {
    const original = request();
    if (mode === 'search-only-turn') original.messages[0].content.pop();
    if (mode === 'tool-result') {
      original.messages = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'use', name: 'lookup', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'use', is_error: true, content: [result()] }] }];
      original.tools = [{ name: 'lookup', input_schema: { type: 'object' } }];
    }
    if (mode === 'assistant-replay') original.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'previous answer', citations: [citation()] }] }, { role: 'user', content: 'continue' });
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true, true)).toBe(false);
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true, true, 'true')).toBe(false);
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true, true, true)).toBe(true);
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
    const before = structuredClone(original), prepared = prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy');
    if (mode === 'tool-result') expect(prepared.messages[1].content[0]).toMatchObject({ is_error: true, content: original.messages[1].content[0].content });
    else { const { cache_control: _cache, ...sent } = prepared.messages[0].content[0]; expect(sent).toEqual(original.messages[0].content[0]); }
    if (mode === 'assistant-replay') expect(prepared.messages[1].content[0].citations).toEqual([citation()]);
    expect(original).toEqual(before);
  });
  it.each(['mixed-enable', 'assistant-role', 'empty-content', 'empty-text', 'image-child', 'extra-source', 'child-cache', 'child-citation', 'mixed-tool-result', 'future-reference', 'wrong-title'])('original %s cannot acquire support by erasure/coercion', mode => {
    const original = request(), block = original.messages[0].content[0];
    if (mode === 'mixed-enable') original.messages[0].content.push({ ...result(), citations: { enabled: false } });
    if (mode === 'assistant-role') original.messages[0].role = 'assistant';
    if (mode === 'empty-content') block.content = [];
    if (mode === 'empty-text') block.content[0].text = '';
    if (mode === 'image-child') block.content.push({ type: 'image', source: { type: 'url', url: 'https://media.example.invalid/source.png' } });
    if (mode === 'extra-source') block.hidden = true;
    if (mode === 'child-cache') block.content[0].cache_control = { type: 'ephemeral' };
    if (mode === 'child-citation') block.content[0].citations = [citation()];
    if (mode === 'mixed-tool-result') {
      original.messages = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'use', name: 'lookup', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'use', content: [result(), { type: 'text', text: 'hidden mixed text' }] }] }];
    }
    if (mode === 'future-reference') original.messages.unshift({ role: 'assistant', content: [{ type: 'text', text: 'history', citations: [citation()] }] });
    if (mode === 'wrong-title') original.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'history', citations: [{ ...citation(), title: 'foreign title' }] }] }, { role: 'user', content: 'continue' });
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false);
  });
  it('one-byte raw citations retain exact wire and cumulative tokens; capture does not estimate cited text', () => {
    const raw = wire(), events = [], sources = authority();
    const observer = createAccountingClaudeSseParser(value => events.push(value), { expectedModel: 'fixture-model', citationSearchResults: sources });
    sources[0].content[0] = 'mutated';
    for (const byte of enc.encode(raw)) observer.push(new Uint8Array([byte]));
    expect(observer.finish()).toMatchObject({ exact: true, input: 50, output: 20 });
    expect(new TextDecoder().decode(Buffer.concat(events.map(value => value.bytes)))).toBe(raw);
    const buffered = createBufferedClaudeUsageObserver({ expectedModel: 'fixture-model', captureMessage: true, citationSearchResults: authority() });
    buffered.push(enc.encode(raw)); expect(buffered.finish()).toMatchObject({ exact: true, output: 20 });
    expect(buffered.message().content[0]).toEqual({ type: 'text', text: 'answer🙂', citations: [citation()] });
  });
  it.each(['foreign-index', 'negative-start', 'range-overflow', 'wrong-source', 'wrong-title', 'wrong-text', 'paid-web-search', 'extra-field'])('raw %s invalidates token-only authority', mode => {
    const value = citation();
    if (mode === 'foreign-index') value.search_result_index = 1;
    if (mode === 'negative-start') value.start_block_index = -1;
    if (mode === 'range-overflow') value.end_block_index = 3;
    if (mode === 'wrong-source') value.source = 'kb://foreign/item';
    if (mode === 'wrong-title') value.title = 'foreign';
    if (mode === 'wrong-text') value.cited_text = 'fabricated quote';
    if (mode === 'paid-web-search') value.type = 'web_search_result_location';
    if (mode === 'extra-field') value.hidden = true;
    const observer = createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', citationSearchResults: authority() });
    expect(() => observer.push(enc.encode(wire(value)))).toThrow(); expect(observer.finish()).toBeNull();
  });
  it('source authority rejects programmable/invalid inventory without invocation or coercion', () => {
    let invoked = 0; const sources = authority();
    Object.defineProperty(sources[0], 'source', { enumerable: true, get() { invoked++; return 'kb://original/item'; } });
    expect(() => createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', citationSearchResults: sources })).toThrow(); expect(invoked).toBe(0);
    for (const value of [[], true, [{ ...authority()[0], hidden: true }], [{ ...authority()[0], content: [] }], [{ ...authority()[0], enabled: 'true' }], [{ ...authority()[0], content: [null] }]]) {
      expect(() => createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', citationSearchResults: value })).toThrow();
    }
    const original = request(); Object.defineProperty(original.messages[0].content[0], 'source', { enumerable: true, get() { invoked++; return 'kb://original/item'; } });
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false); expect(invoked).toBe(0);
  });
  it('document and search inventories are separate; full multi-block quote binds original content', () => {
    const value = { ...citation(), end_block_index: 2, cited_text: 'first🙂 chunksecond chunk' };
    const observer = createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', citationSearchResults: authority(), citationDocuments: [{ kind: 'pdf', enabled: true }] });
    observer.push(enc.encode(wire(value))); expect(observer.finish()).toMatchObject({ exact: true, output: 20 });
    const original = request(); original.messages[0].content.unshift({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'separate doc' }, citations: { enabled: true } });
    original.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'answer', citations: [value] }] }, { role: 'user', content: 'continue' });
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
  });
  it('only boolean Claude accounting flag retains search-only turns; legacy and foreign behavior unchanged', () => {
    const original = request(); original.messages[0].content.pop();
    for (const flag of [undefined, false, 'true']) {
      const prepared = prepareClaudeRequest(structuredClone(original), 'claude', null, null, null, null, false, flag);
      expect(prepared.messages.some(message => message.content?.some?.(block => block.type === 'search_result'))).toBe(false);
    }
    const foreign = prepareClaudeRequest(structuredClone(original), 'minimax', null, null, null, null, false, true);
    expect(foreign.messages.some(message => message.content?.some?.(block => block.type === 'search_result'))).toBe(false);
    const prepared = prepareClaudeRequest(structuredClone(original), 'claude', null, null, null, null, false, true);
    expect(prepared.messages[0].content).toEqual(original.messages[0].content);
    const anchored = anchorClaudeCache(prepared, true);
    expect(anchored.messages[0].content[0]).toEqual({ ...result(), cache_control: { type: 'ephemeral' } });
  });
  it('top-level RAG source cache and original 1h detection remain distinct from child cache/citation blocks', () => {
    const original = request(); original.messages[0].content[0].cache_control = { type: 'ephemeral', ttl: '1h' };
    expect(anthropicRequestHasCache1h(original)).toBe(true);
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true, true, true)).toBe(true);
    expect(supportsAnthropicLiveRequest(original, original.model, true, false, true, true, true, true, true)).toBe(false);
    const prepared = prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy');
    expect(prepared.messages[0].content[0]).toMatchObject(result());
    original.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'history', citations: [citation()], cache_control: { type: 'ephemeral' } }] }, { role: 'user', content: 'continue' });
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false);
  });
  it('paid server counters cannot settle client-only RAG authority and unknown originals never throw', () => {
    const observer = createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', citationSearchResults: authority() });
    expect(() => observer.push(enc.encode(wire().replace('"web_search_requests":0', '"web_search_requests":1')))).toThrow();
    expect(observer.finish()).toBeNull();
    for (const body of [null, {}, { model: 'fixture-model', messages: [null] }, { model: 'fixture-model', messages: [{ content: [null] }] }, { model: 'fixture-model', messages: [{ content: [{ type: 'search_result', content: null }] }] }]) {
      expect(supportsAnthropicLiveRequest(body, 'fixture-model', true, true, true, true, true, true, true)).toBe(false);
    }
  });
  it('default raw observer remains closed to client search citations', () => {
    expect(() => createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model' }).push(enc.encode(wire()))).toThrow();
  });
});
