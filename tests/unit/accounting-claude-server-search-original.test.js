import { describe, expect, it, vi } from 'vitest';
import { supportsAnthropicLiveRequest } from 'open-sse/config/accountedAnthropicCandidate.js';
import { createClaudeServerSearchAuthority } from 'open-sse/config/accountingClaudeServerSearch.js';

const tool = () => ({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 });
const request = () => ({ model: 'fixture-search-original', stream: true, max_tokens: 2000,
  tools: [tool()], messages: [{ role: 'user', content: 'search fixture' }] });
const supported = body => supportsAnthropicLiveRequest(body, body.model, true, true, true, true, true, true, true, true);
const call = () => ({ type: 'server_tool_use', id: 'srvtoolu_fixture', name: 'web_search', input: { query: 'fixture query' } });
const result = () => ({ type: 'web_search_tool_result', tool_use_id: 'srvtoolu_fixture', content: [{ type: 'web_search_result',
  url: 'https://example.invalid/source', title: 'Fixture title', encrypted_content: 'opaque-original-encrypted-content', page_age: null }] });
const citation = () => ({ type: 'web_search_result_location', url: 'https://example.invalid/source', title: 'Fixture title',
  encrypted_index: 'opaque-original-encrypted-index', cited_text: 'fixture quotation' });
const history = () => { const body = request(); body.messages.push({ role: 'assistant', content: [call(), result(),
  { type: 'text', text: 'fixture answer', citations: [citation()] }] }, { role: 'user', content: 'continue' }); return body; };

describe('original direct server-search authority prerequisite, no dispatch admission', () => {
  it('accepts documented basic direct original definition only under separate explicit boolean opt-in', () => {
    expect(supported(request())).toBe(true);
    expect(supportsAnthropicLiveRequest(request(), request().model, true, true, true, true, true, true, true)).toBe(false);
    expect(supportsAnthropicLiveRequest(request(), request().model, true, true, true, true, true, true, true, false)).toBe(false);
    expect(supportsAnthropicLiveRequest(request(), request().model, true, true, true, true, true, true, true, 'true')).toBe(false);
    expect(supportsAnthropicLiveRequest(request(), request().model, true, true, true, true, false, true, true, true)).toBe(false);
  });
  it('accepts later direct-only versions with explicit caller, not implicit dynamic code execution', () => {
    for (const type of ['web_search_20260209', 'web_search_20260318']) {
      const body = request(); body.tools[0].type = type;
      expect(supported(body)).toBe(false);
      body.tools[0].allowed_callers = ['direct']; expect(supported(body)).toBe(true);
      body.tools[0].allowed_callers = ['code_execution_20260120']; expect(supported(body)).toBe(false);
    }
    const body = request(); body.tools[0] = { ...tool(), type: 'web_search_20260318', allowed_callers: ['direct'], response_inclusion: 'excluded' };
    expect(supported(body)).toBe(true);
    body.tools[0].response_inclusion = 'unknown'; expect(supported(body)).toBe(false);
  });
  it('preserves domain/location/cache options, with strict known shape and independent mixed TTL authority', () => {
    const body = request(); Object.assign(body.tools[0], { allowed_domains: ['example.com/blog', 'example.org/*/articles'],
      user_location: { type: 'approximate', country: 'US', timezone: 'America/New_York' }, cache_control: { type: 'ephemeral', ttl: '1h' } });
    const before = JSON.stringify(body); expect(supported(body)).toBe(true); expect(JSON.stringify(body)).toBe(before);
    body.tools[0].blocked_domains = ['example.net']; expect(supported(body)).toBe(false);
    delete body.tools[0].blocked_domains;
    for (const domain of ['https://example.com', '*.example.com', 'example.com\\hidden', 'example.com\n', '']) {
      body.tools[0].allowed_domains = [domain]; expect(supported(body)).toBe(false);
    }
  });
  it('preserves opaque result/index and citations referencing preceding server source, no corpus decoding', () => {
    const body = history(), before = JSON.stringify(body); expect(supported(body)).toBe(true); expect(JSON.stringify(body)).toBe(before);
    for (const field of ['url', 'title']) { const bad = history(); bad.messages[1].content[2].citations[0][field] = 'foreign'; expect(supported(bad)).toBe(false); }
    const empty = history(); empty.messages[1].content[0].input.query = ''; expect(supported(empty)).toBe(false);
    const erased = history(); delete erased.messages[1].content[1].content[0].encrypted_content; expect(supported(erased)).toBe(false);
    const noIndex = history(); noIndex.messages[1].content[2].citations[0].encrypted_index = ''; expect(supported(noIndex)).toBe(false);
    const future = history(); future.messages[1].content.reverse(); expect(supported(future)).toBe(false);
  });
  it('handles empty successful results and documented tool errors, not guessed free usage', () => {
    const body = request(); body.messages.push({ role: 'assistant', content: [call(), { ...result(), content: [] }] });
    expect(supported(body)).toBe(true);
    for (const code of ['too_many_requests', 'invalid_tool_input', 'max_uses_exceeded', 'query_too_long', 'request_too_large', 'unavailable']) {
      body.messages[1].content[1].content = { type: 'web_search_tool_result_error', error_code: code }; expect(supported(body)).toBe(true);
    }
    body.messages[1].content[1].content.error_code = 'unknown'; expect(supported(body)).toBe(false);
  });
  it('pairs distinct server IDs across paused/deferred history, not position/client IDs', () => {
    const paused = request(); paused.messages.push({ role: 'assistant', content: [call()] }); expect(supported(paused)).toBe(true);
    const deferred = request(); deferred.tools.push({ name: 'fixture_client', input_schema: { type: 'object' } });
    deferred.messages.push({ role: 'assistant', content: [call(), { type: 'tool_use', id: 'toolu_client', name: 'fixture_client', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_client', content: 'fixture client result' }] },
      { role: 'assistant', content: [result()] }); expect(supported(deferred)).toBe(true);
    const duplicate = history(); duplicate.messages[1].content.splice(1, 0, call()); expect(supported(duplicate)).toBe(false);
    const twice = history(); twice.messages[1].content.splice(2, 0, result()); expect(supported(twice)).toBe(false);
    const foreign = history(); foreign.messages[1].content[1].tool_use_id = 'toolu_client'; expect(supported(foreign)).toBe(false);
    const user = history(); user.messages[1].role = 'user'; expect(supported(user)).toBe(false);
    const missing = history(); missing.tools = []; expect(supported(missing)).toBe(false);
  });
  it('authority stays isolated/bounded/plain and preserves source snapshot after caller mutation', () => {
    const first = createClaudeServerSearchAuthority([tool()]), second = createClaudeServerSearchAuthority([tool()]);
    const source = result();
    expect(first.acceptCall(call())).toBe(true); expect(first.acceptResult(source)).toBe(true);
    source.content[0].title = 'mutated'; source.content[0].encrypted_content = '';
    expect(first.supportsCitation(citation())).toBe(true);
    expect(second.supportsCitation(citation())).toBe(false);
    expect(second.acceptResult(result())).toBe(false);
    expect(first.acceptResult(result())).toBe(false);
    const getter = vi.fn(() => 'web_search');
    const bad = Object.defineProperty(call(), 'name', { enumerable: true, get: getter });
    expect(second.acceptCall(bad)).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(createClaudeServerSearchAuthority([null])).toBeNull();
    expect(createClaudeServerSearchAuthority([tool(), tool()])).toBeNull();
    const oversized = history(); oversized.messages[1].content[1].content[0].encrypted_content = 'x'.repeat(262144);
    expect(supported(oversized)).toBe(false);
  });
  it('rejects source/definition/cache/caller field erasure loopholes without normalizing history', () => {
    for (const extra of [{ caller: { type: 'code_execution_20260120', tool_id: 'srvtoolu_other' } }, { cache_control: { type: 'ephemeral' } }]) {
      const body = history(); Object.assign(body.messages[1].content[0], extra); expect(supported(body)).toBe(false);
    }
    const clientCollision = history(); clientCollision.tools.push({ name: 'web_search', input_schema: {} }); expect(supported(clientCollision)).toBe(false);
    const malformed = request(); malformed.tools = null; expect(supported(malformed)).toBe(false);
    const noLocation = request(); noLocation.tools[0].user_location = { type: 'approximate' }; expect(supported(noLocation)).toBe(false);
    const wrongZone = request(); wrongZone.tools[0].user_location = { type: 'approximate', timezone: 'invalid/timezone' }; expect(supported(wrongZone)).toBe(false);
    const wrongRole = history(); wrongRole.messages[2].content = [result()]; expect(supported(wrongRole)).toBe(false);
  });
  it('rejects undeclared type/version/caller/extra/malformed/query roles without executing getters', () => {
    for (const extra of [{ type: 'web_search_future' }, { name: 'other' }, { max_uses: -1 }, { max_uses: 1.5 },
      { input_schema: {} }, { allowed_callers: [] }, { allowed_callers: ['direct', 'direct'] }, { response_inclusion: 'full' }]) {
      const body = request(); Object.assign(body.tools[0], extra); expect(supported(body)).toBe(false);
    }
    const getter = vi.fn(() => 'web_search'); const body = request(); Object.defineProperty(body.tools[0], 'name', { enumerable: true, get: getter });
    expect(supported(body)).toBe(false); expect(getter).not.toHaveBeenCalled();
    const cached = history(); cached.messages[1].content[2].cache_control = { type: 'ephemeral' }; expect(supported(cached)).toBe(false);
  });
});
