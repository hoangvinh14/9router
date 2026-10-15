import { describe, expect, it, vi } from 'vitest';
import { createClaudeServerFetchAuthority } from 'open-sse/config/accountingClaudeServerFetch.js';
import { supportsAnthropicLiveRequest } from 'open-sse/config/accountedAnthropicCandidate.js';

const request = () => ({ model: 'fixture-fetch-original', stream: true, max_tokens: 100,
  tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', citations: { enabled: true }, max_uses: 3, max_content_tokens: 1000 }],
  messages: [{ role: 'user', content: 'Read https://example.com/article' }] });
const call = () => ({ type: 'server_tool_use', id: 'srvtoolu_fetch', name: 'web_fetch', input: { url: 'https://example.com/article' } });
const result = () => ({ type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_fetch', content: { type: 'web_fetch_result',
  url: 'https://example.com/article', retrieved_at: '2026-10-03T00:00:00Z', content: { type: 'document', title: 'Fetched title',
    source: { type: 'text', media_type: 'text/plain', data: 'Fetched original corpus' }, citations: { enabled: true } } } });
const citation = () => ({ type: 'char_location', document_index: 0, document_title: 'Fetched title', start_char_index: 0, end_char_index: 7, cited_text: 'Fetched' });
const history = () => { const body = request(); body.messages.push({ role: 'assistant', content: [call(), result(), { type: 'text', text: 'answer', citations: [citation()] }] }, { role: 'user', content: 'continue' }); return body; };
const supported = body => supportsAnthropicLiveRequest(body, body.model, true, true, true, true, true, true, true, true, true);

describe('explicit original direct fetch and dynamic document citation inventory prerequisite', () => {
  it('basic fetch definition requires separate boolean flag and retains source/options unchanged', () => {
    const body = request(), before = JSON.stringify(body); expect(supported(body)).toBe(true); expect(JSON.stringify(body)).toBe(before);
    expect(supportsAnthropicLiveRequest(body, body.model, true, true, true, true, true, true, true, true)).toBe(false);
    expect(supportsAnthropicLiveRequest(body, body.model, true, true, true, true, true, true, true, true, 'true')).toBe(false);
  });
  it('later versions require direct-only caller and version-specific cache/inclusion fields', () => {
    for (const type of ['web_fetch_20260209', 'web_fetch_20260309', 'web_fetch_20260318']) {
      const body = request(); body.tools[0].type = type; expect(supported(body)).toBe(false);
      body.tools[0].allowed_callers = ['direct']; expect(supported(body)).toBe(true);
      body.tools[0].use_cache = false; expect(supported(body)).toBe(type !== 'web_fetch_20260209');
      delete body.tools[0].use_cache; body.tools[0].response_inclusion = 'excluded'; expect(supported(body)).toBe(type === 'web_fetch_20260318');
    }
  });
  it('fetch result registers preceding document only after matching call, permits text/PDF citations not future/foreign kind', () => {
    expect(supported(history())).toBe(true);
    const future = history(); future.messages[1].content = [{ type: 'text', text: 'answer', citations: [citation()] }, call(), result()]; expect(supported(future)).toBe(false);
    const wrong = history(); wrong.messages[1].content[1].tool_use_id = 'srvtoolu_foreign'; expect(supported(wrong)).toBe(false);
    const pdf = history(); pdf.messages[1].content[1].content.content.source = { type: 'base64', media_type: 'application/pdf', data: 'aW5saW5l' };
    pdf.messages[1].content[2].citations = [{ type: 'page_location', document_index: 0, document_title: 'Fetched title', start_page_number: 1, end_page_number: 2, cited_text: 'PDF quotation' }];
    expect(supported(pdf)).toBe(true); pdf.messages[1].content[2].citations = [citation()]; expect(supported(pdf)).toBe(false);
    const disabled = history(); disabled.tools[0].citations.enabled = false; expect(supported(disabled)).toBe(false);
    const file = history(); file.messages[1].content[1].content.content.source = { type: 'file', file_id: 'file_other' }; expect(supported(file)).toBe(false);
  });
  it('original and fetched document indices share preceding order, not a replacement inventory', () => {
    const body = history(); body.messages[0].content = [{ type: 'text', text: 'Read https://example.com/article' },
      { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Original inline' }, citations: { enabled: true } }];
    body.messages[1].content[2].citations[0].document_index = 1; expect(supported(body)).toBe(true);
    body.messages[1].content[2].citations[0].document_index = 2; expect(supported(body)).toBe(false);
  });
  it('pending/deferred calls pair once across history, share IDs with search/client tools and errors add no document', () => {
    const paused = request(); paused.messages.push({ role: 'assistant', content: [call()] }); expect(supported(paused)).toBe(true);
    const body = history(); body.tools.push({ name: 'lookup', input_schema: { type: 'object' } });
    body.messages = [body.messages[0], { role: 'assistant', content: [call(), { type: 'tool_use', id: 'client', name: 'lookup', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'client', content: 'value' }] }, { role: 'assistant', content: [result()] }];
    expect(supported(body)).toBe(true);
    const duplicate = history(); duplicate.messages[1].content.splice(2, 0, result()); expect(supported(duplicate)).toBe(false);
    const error = history(); error.messages[1].content[1].content = { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' };
    error.messages[1].content.pop(); expect(supported(error)).toBe(true);
    error.messages[1].content.push({ type: 'text', text: 'invalid', citations: [citation()] }); expect(supported(error)).toBe(false);
  });
  it('fetch owner stays bounded/isolated/plain and never consumes failed pairing or stores fetched corpus', () => {
    const documents = [], issued = new Set(), first = createClaudeServerFetchAuthority(request().tools, issued, documents), second = createClaudeServerFetchAuthority(request().tools);
    expect(first.acceptCall(call())).toBe(true); expect(first.pendingCount()).toBe(1); expect(second.acceptResult(result())).toBe(false);
    const invalid = result(); invalid.content.content.source.data = ''; expect(first.acceptResult(invalid)).toBe(false); expect(first.pendingCount()).toBe(1);
    const source = result(); expect(first.acceptResult(source)).toBe(true); source.content.content.source.data = 'mutated';
    expect(documents).toEqual([{ kind: 'text', enabled: true }]); expect(JSON.stringify(documents)).not.toContain('corpus');
    expect(first.pendingCount()).toBe(0); expect(first.acceptResult(result())).toBe(false); expect(first.acceptCall(call())).toBe(false);
    const getter = vi.fn(() => 'web_fetch'), trapped = vi.fn(() => ['type']);
    expect(second.acceptCall(Object.defineProperty(call(), 'name', { enumerable: true, get: getter }))).toBe(false);
    expect(second.acceptResult(new Proxy(result(), { ownKeys: trapped }))).toBe(false);
    expect(getter).not.toHaveBeenCalled(); expect(trapped).not.toHaveBeenCalled();
    const oversized = history(); oversized.messages[1].content[1].content.content.source.data = 'x'.repeat(262144); expect(supported(oversized)).toBe(false);
    expect(createClaudeServerFetchAuthority([null])).toBeNull(); expect(createClaudeServerFetchAuthority([...request().tools, ...request().tools])).toBeNull();
  });
  it('search/fetch/client owners share issued IDs, and strict fetch options/errors do not erase original content', () => {
    const body = history(); body.tools.push({ type: 'web_search_20250305', name: 'web_search' });
    body.messages[1].content.splice(2, 0, { type: 'server_tool_use', id: 'srvtoolu_fetch', name: 'web_search', input: { query: 'search' } });
    expect(supported(body)).toBe(false);
    for (const field of ['allowed_domains', 'blocked_domains']) {
      const options = request(); options.tools[0][field] = ['example.com']; expect(supported(options)).toBe(true);
      options.tools[0][field] = ['https://example.com']; expect(supported(options)).toBe(false);
    }
    const both = request(); both.tools[0].allowed_domains = ['example.com']; both.tools[0].blocked_domains = ['example.org']; expect(supported(both)).toBe(false);
    const timestamp = history(); timestamp.messages[1].content[1].content.retrieved_at = 'yesterday'; expect(supported(timestamp)).toBe(false);
    const malformed = history(); malformed.messages[1].content[0].input.query = 'not fetch'; expect(supported(malformed)).toBe(false);
    const error = history(); error.messages[1].content = [call(), { ...result(), content: { type: 'web_fetch_tool_result_error', error_code: 'unknown' } }]; expect(supported(error)).toBe(false);
    const cached = history(); cached.messages[1].content[1].content.content.cache_control = { type: 'ephemeral' }; expect(supported(cached)).toBe(false);
  });
  it('refuses malformed/unknown/dynamic/unsafe URL/query fields and programmable definitions before reads', () => {
    for (const extra of [{ type: 'web_fetch_future' }, { allowed_callers: ['code_execution_20260120'] }, { max_content_tokens: 0 },
      { max_uses: -1 }, { use_cache: false }, { response_inclusion: 'full' }, { input_schema: {} }, { citations: { enabled: 'true' } }]) {
      const body = request(); Object.assign(body.tools[0], extra); expect(supported(body)).toBe(false);
    }
    for (const url of ['http://127.0.0.1/private', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com/article#fragment']) {
      const body = history(); body.messages[1].content[0].input.url = url; expect(supported(body)).toBe(false);
    }
    const getter = vi.fn(() => 'web_fetch'); const body = request(); Object.defineProperty(body.tools[0], 'name', { enumerable: true, get: getter });
    expect(supported(body)).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
});
