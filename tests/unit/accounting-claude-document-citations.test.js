import { describe, it, expect } from 'vitest';
import { supportsAnthropicLiveRequest } from 'open-sse/config/accountedAnthropicCandidate.js';
import { supportsClaudeOauthOriginal, prepareAccountingClaudeOauthBody } from 'open-sse/config/accountedClaudeOauth.js';
import { createAccountingClaudeSseParser } from 'open-sse/utils/accountingClaudeSseParser.js';
import { createBufferedClaudeUsageObserver } from 'open-sse/utils/accountingClaudeUsage.js';
import { prepareClaudeRequest, anchorClaudeCache } from 'open-sse/translator/formats/claude.js';
const enc = new TextEncoder();
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const doc = (pdf = false) => ({ type: 'document', source: pdf ? { type: 'base64', media_type: 'application/pdf', data: 'aW5saW5l' } : { type: 'text', media_type: 'text/plain', data: 'original🙂 document' }, title: 'original title', context: 'original context', citations: { enabled: true } });
const request = (pdf = false) => ({ model: 'fixture-model', stream: true, max_tokens: 100, messages: [{ role: 'user', content: [doc(pdf), { type: 'text', text: 'cite the document' }] }] });
const citation = (pdf = false) => ({ type: pdf ? 'page_location' : 'char_location', cited_text: 'cited🙂 document', document_index: 0, document_title: 'original title', file_id: null, ...(pdf ? { start_page_number: 1, end_page_number: 2 } : { start_char_index: 0, end_char_index: 8 }) });
const start = () => event('message_start', { message: { id: 'msg_citation', type: 'message', role: 'assistant', model: 'fixture-model', content: [], usage: { input_tokens: 50, output_tokens: 2, server_tool_use: { web_search_requests: 0 } } } });
const prefix = () => start() + event('content_block_start', { index: 0, content_block: { type: 'text', text: '', citations: [] } });
const end = () => event('content_block_stop', { index: 0 }) + event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + event('message_stop');
const cite = value => event('content_block_delta', { index: 0, delta: { type: 'citations_delta', citation: value } });
const documents = pdf => [{ kind: pdf ? 'pdf' : 'text', enabled: true }];
describe('bounded inline document citations, original authority and raw counters only', () => {
  it.each([false, true])('preserves citation config through queued API-key/OAuth source pdf=%s, default remains closed', pdf => {
    const original = request(pdf);
    expect(supportsAnthropicLiveRequest(original, original.model)).toBe(false);
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true)).toBe(false);
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true)).toBe(true);
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
    const prepared = prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy');
    const { cache_control: _cache, ...actual } = prepared.messages[0].content[0];
    expect(actual).toEqual(original.messages[0].content[0]); expect(original).toEqual(request(pdf));
  });
  it.each(['enabled-string', 'extra-config', 'image-config', 'mixed-documents', 'assistant-citations', 'unknown-source'])('original %s remains refused without stripping work', mode => {
    const original = request(), block = original.messages[0].content[0];
    if (mode === 'enabled-string') block.citations.enabled = 'true';
    if (mode === 'extra-config') block.citations.hidden = true;
    if (mode === 'image-config') { block.type = 'image'; block.source = { type: 'base64', media_type: 'image/png', data: 'aW5saW5l' }; }
    if (mode === 'mixed-documents') { const second = doc(); second.citations.enabled = false; original.messages[0].content.push(second); }
    if (mode === 'assistant-citations') original.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'history', citations: [{ ...citation(), document_index: 9 }] }] });
    if (mode === 'unknown-source') block.source = { type: 'url', url: 'http://127.0.0.1/private' };
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true)).toBe(false);
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false);
  });
  it.each([false, true])('one-byte citation wire is preserved with cumulative usage pdf=%s, capture aggregates not estimates', pdf => {
    const raw = prefix() + event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'answer🙂' } }) + cite(citation(pdf)) + cite({ ...citation(pdf), file_id: undefined }) + end();
    const events = [], observer = createAccountingClaudeSseParser(value => events.push(value), { expectedModel: 'fixture-model', citationDocuments: documents(pdf) });
    for (const byte of enc.encode(raw)) observer.push(new Uint8Array([byte]));
    expect(observer.finish()).toMatchObject({ exact: true, input: 50, output: 20 });
    expect(new TextDecoder().decode(Buffer.concat(events.map(value => value.bytes)))).toBe(raw);
    const buffered = createBufferedClaudeUsageObserver({ expectedModel: 'fixture-model', captureMessage: true, citationDocuments: documents(pdf) });
    buffered.push(enc.encode(raw)); expect(buffered.finish()).toMatchObject({ exact: true, output: 20 });
    expect(buffered.message().content[0]).toEqual({ type: 'text', text: 'answer🙂', citations: [citation(pdf), { ...citation(pdf), file_id: undefined }] });
  });
  it('original document inventory spans turns and is immutable after parser creation', () => {
    const docs = [{ kind: 'pdf', enabled: true }, ...documents(false)];
    const observer = createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', citationDocuments: docs });
    docs[1].enabled = false;
    observer.push(enc.encode(prefix() + cite({ ...citation(), document_index: 1 }) + end()));
    expect(observer.finish()).toMatchObject({ exact: true, output: 20 });
    const original = request(); original.messages.unshift({ role: 'user', content: [{ ...doc(), citations: undefined }] });
    // Missing enablement is not erased to manufacture all-or-none support.
    delete original.messages[0].content[0].citations;
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true)).toBe(false);
  });
  it('programmable citation authority is refused without invoking getters, and invalid limits fail closed', () => {
    let invoked = 0; const docs = documents(false);
    Object.defineProperty(docs[0], 'enabled', { enumerable: true, get() { invoked++; return true; } });
    expect(() => createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', citationDocuments: docs })).toThrow(); expect(invoked).toBe(0);
    for (const authority of [true, [], [{ kind: 'url', enabled: true }], [{ kind: 'text', enabled: 'true' }], [{ kind: 'text', enabled: true, hidden: true }], [{ kind: 'content', enabled: true }], [{ kind: 'content', enabled: true, blockCount: 0 }], [{ kind: 'content', enabled: true, blockCount: 1.5 }], [{ kind: 'content', enabled: true, blockCount: 2, hidden: true }]]) {
      expect(() => createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', citationDocuments: authority })).toThrow();
    }
    const original = request(); Object.defineProperty(original.messages[0].content[0].citations, 'enabled', { enumerable: true, get() { invoked++; return true; } });
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false); expect(invoked).toBe(0);
  });
  it.each(['event-bound', 'late-citation', 'delta-extra', 'bad-cited-text', 'page-zero', 'initial-foreign'])('citation %s cannot bypass existing bounds or raw block authority', mode => {
    const observer = createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', citationDocuments: documents(mode === 'page-zero'), ...(mode === 'event-bound' ? { maxEventBytes: 600 } : {}) });
    let raw = prefix() + cite(citation()) + end();
    if (mode === 'event-bound') raw = prefix() + cite({ ...citation(), cited_text: 'x'.repeat(601) }) + end();
    if (mode === 'late-citation') raw += cite(citation());
    if (mode === 'delta-extra') raw = prefix() + cite(citation()).replace('"type":"citations_delta"', '"type":"citations_delta","hidden":true') + end();
    if (mode === 'bad-cited-text') raw = prefix() + cite({ ...citation(), cited_text: 1 }) + end();
    if (mode === 'page-zero') raw = prefix() + cite({ ...citation(true), start_page_number: 0 }) + end();
    if (mode === 'initial-foreign') raw = start() + event('content_block_start', { index: 0, content_block: { type: 'text', text: 'answer', citations: [{ ...citation(), document_index: 1 }] } }) + end();
    expect(() => observer.push(enc.encode(raw))).toThrow(); expect(observer.finish()).toBeNull();
  });
  it.each(['text', 'mixed-image', 'url-image'])('custom-content %s document survives original/actual transform and block citation raw capture', mode => {
    const original = request();
    const chunks = [{ type: 'text', text: 'first🙂 chunk' }, mode === 'text' ? { type: 'text', text: 'second chunk' } : { type: 'image', source: mode === 'url-image' ? { type: 'url', url: 'https://media.example.invalid/custom%20source.png?version=1' } : { type: 'base64', media_type: 'image/png', data: 'aW5saW5l' } }];
    original.messages[0].content[0].source = { type: 'content', content: chunks };
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true)).toBe(false);
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true)).toBe(mode !== 'url-image');
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true, true)).toBe(true);
    const prepared = prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy');
    expect(prepared.messages[0].content[0].source).toEqual(original.messages[0].content[0].source);
    const value = { type: 'content_block_location', document_index: 0, document_title: 'original title', cited_text: 'first🙂 chunk', start_block_index: 0, end_block_index: 1, file_id: null };
    const raw = prefix() + cite(value) + end(), events = [];
    const limits = { expectedModel: 'fixture-model', citationDocuments: [{ kind: 'content', enabled: true, blockCount: 2 }] };
    const observer = createAccountingClaudeSseParser(event => events.push(event), limits);
    for (const byte of enc.encode(raw)) observer.push(new Uint8Array([byte]));
    expect(observer.finish()).toMatchObject({ exact: true, input: 50, output: 20 });
    expect(new TextDecoder().decode(Buffer.concat(events.map(event => event.bytes)))).toBe(raw);
    const buffered = createBufferedClaudeUsageObserver({ ...limits, captureMessage: true }); buffered.push(enc.encode(raw));
    expect(buffered.finish()).toMatchObject({ exact: true, output: 20 }); expect(buffered.message().content[0].citations).toEqual([value]);
  });
  it.each(['empty-content', 'extra-source', 'nested-document', 'url-image', 'cache-child', 'cited-child', 'non-text', 'programmable-child'])('custom content original %s cannot be erased or coerced', mode => {
    const original = request(), source = { type: 'content', content: [{ type: 'text', text: 'original chunk' }] }; let invoked = 0;
    original.messages[0].content[0].source = source;
    if (mode === 'empty-content') source.content = [];
    if (mode === 'extra-source') source.hidden = true;
    if (mode === 'nested-document') source.content.push(doc());
    if (mode === 'url-image') source.content.push({ type: 'image', source: { type: 'url', url: 'http://127.0.0.1/private' } });
    if (mode === 'cache-child') source.content[0].cache_control = { type: 'ephemeral', ttl: '1h' };
    if (mode === 'cited-child') source.content[0].citations = [citation()];
    if (mode === 'non-text') source.content[0].text = 1;
    if (mode === 'programmable-child') Object.defineProperty(source.content[0], 'text', { enumerable: true, get() { invoked++; return 'chunk'; } });
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false); expect(invoked).toBe(0);
  });
  it.each(['out-of-range', 'negative-start', 'fractional-end', 'wrong-kind'])('custom block citation %s rejects after a valid prefix', mode => {
    const observer = createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', citationDocuments: [{ kind: 'content', enabled: true, blockCount: 2 }] });
    observer.push(enc.encode(prefix()));
    const value = { type: 'content_block_location', document_index: 0, document_title: null, cited_text: 'chunk', start_block_index: 0, end_block_index: 1 };
    if (mode === 'out-of-range') value.end_block_index = 3;
    if (mode === 'negative-start') value.start_block_index = -1;
    if (mode === 'fractional-end') value.end_block_index = 1.5;
    if (mode === 'wrong-kind') Object.assign(value, citation());
    expect(() => observer.push(enc.encode(cite(value)))).toThrow(); expect(observer.finish()).toBeNull();
  });
  it.each(['char', 'page', 'block'])('assistant %s citation history survives original replay without fabricated tokens', mode => {
    const original = request(mode === 'page');
    if (mode === 'block') original.messages[0].content[0].source = { type: 'content', content: [{ type: 'text', text: 'chunk' }] };
    const value = mode === 'block' ? { type: 'content_block_location', document_index: 0, document_title: 'original title', cited_text: 'chunk', start_block_index: 0, end_block_index: 1 } : citation(mode === 'page');
    original.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'previous answer', citations: [value] }] }, { role: 'user', content: 'continue' });
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true)).toBe(false);
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true)).toBe(true);
    const prepared = prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy');
    expect(prepared.messages[1].content[0].citations).toEqual([value]); expect(original.messages[1].content[0].citations).toEqual([value]);
  });
  it.each(['future-document', 'wrong-kind', 'user-role', 'extra-field', 'cached-citation', 'paid-search'])('original citation replay %s stays denied without content erasure', mode => {
    const original = request(), value = citation();
    const block = { type: 'text', text: 'history', citations: [value] };
    if (mode === 'wrong-kind') Object.assign(value, citation(true));
    if (mode === 'extra-field') value.hidden = true;
    if (mode === 'cached-citation') block.cache_control = { type: 'ephemeral' };
    if (mode === 'paid-search') value.type = 'web_search_result_location';
    if (mode === 'user-role') original.messages[0].content.push(block);
    else original.messages.push({ role: 'assistant', content: [block] }, { role: 'user', content: 'continue' });
    if (mode === 'future-document') { original.messages[0].content.shift(); original.messages[2].content = [doc()]; }
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false);
  });
  it('only explicit boolean Claude accounting flags change citation cache targeting, default helper unchanged', () => {
    const original = request(); original.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'history', citations: [citation()] }] }, { role: 'user', content: 'continue' });
    for (const flag of [undefined, false, 'true']) {
      const legacy = prepareClaudeRequest(structuredClone(original), 'claude', null, null, null, null, false, flag);
      expect(legacy.messages[1].content[0].cache_control).toBeTruthy();
      const anchored = anchorClaudeCache(structuredClone(original), flag); expect(anchored.messages[1].content[0].cache_control).toBeTruthy();
    }
    const accounting = prepareClaudeRequest(structuredClone(original), 'claude', null, null, null, null, false, true);
    expect(accounting.messages[1].content[0]).toEqual(original.messages[1].content[0]);
    const anchored = anchorClaudeCache(accounting, true); expect(anchored.messages[1].content[0]).toEqual(original.messages[1].content[0]);
    expect(anchored.messages[2].content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    const foreign = prepareClaudeRequest(structuredClone(original), 'minimax', null, null, null, null, false, true);
    expect(foreign.messages[1].content[0].cache_control).toBeTruthy();
  });
  it('default observer remains closed to citation frames', () => {
    expect(() => createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model' }).push(enc.encode(prefix() + cite(citation()) + end()))).toThrow();
  });
  it.each(['negative-index', 'foreign-index', 'fractional-index', 'wrong-document-type', 'reversed-range', 'unknown-field', 'web-search', 'non-null-file', 'disabled-document', 'paid-counter', 'wrong-block'])('valid prefix followed by %s cannot settle token-only', mode => {
    const value = citation(), docs = documents(false);
    if (mode === 'negative-index') value.document_index = -1;
    if (mode === 'foreign-index') value.document_index = 1;
    if (mode === 'fractional-index') value.document_index = 0.5;
    if (mode === 'wrong-document-type') Object.assign(value, citation(true));
    if (mode === 'reversed-range') value.end_char_index = 0;
    if (mode === 'unknown-field') value.hidden = true;
    if (mode === 'web-search') value.type = 'web_search_result_location';
    if (mode === 'non-null-file') value.file_id = 'file_foreign';
    if (mode === 'disabled-document') docs[0].enabled = false;
    const observer = createAccountingClaudeSseParser(() => {}, { expectedModel: 'fixture-model', citationDocuments: docs, allowThinking: true });
    observer.push(enc.encode(mode === 'wrong-block' ? start() + event('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }) : prefix()));
    expect(() => observer.push(enc.encode(mode === 'paid-counter' ? cite(value) + end().replace('"output_tokens":20', '"output_tokens":20,"server_tool_use":{"web_search_requests":1}') : cite(value)))).toThrow();
    expect(observer.finish()).toBeNull();
  });
});
