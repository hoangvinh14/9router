import { describe, expect, it, vi } from 'vitest';
import { prepareClaudeRequest, anchorClaudeCache } from 'open-sse/translator/formats/claude.js';
import { prepareAccountingClaudeOauthBody, claudeOauthServerSearchOwner, claudeOauthServerFetchOwner, claudeOauthDynamicOwner, supportsClaudeOauthOriginal } from 'open-sse/config/accountedClaudeOauth.js';

const call = () => ({ type: 'server_tool_use', id: 'srvtoolu_original', name: 'web_search', input: { query: 'original query' } });
const result = () => ({ type: 'web_search_tool_result', tool_use_id: 'srvtoolu_original', content: [] });
const body = () => ({ model: 'fixture-oauth-search-transform', max_tokens: 100, stream: true,
  tools: [{ type: 'web_search_20250305', name: 'web_search' }], messages: [
    { role: 'user', content: 'prior' }, { role: 'assistant', content: [call(), result()] }, { role: 'user', content: 'continue' },
  ] });
const session = '12345678-1234-4234-8234-123456789012';

describe('OAuth server-search explicit transform flags/default and original-derived raw owner', () => {
  it('ninth prepare flag keeps server-only turn only for Claude; default/foreign behavior remains unchanged', () => {
    const make = (provider, flag) => prepareClaudeRequest(body(), provider, null, null, null, null, false, false, flag);
    expect(make('claude', true).messages[1]).toEqual(body().messages[1]);
    for (const flag of [false, undefined, 'true']) {
      expect(make('claude', flag).messages.some(message => message.content?.some?.(block => block.type === 'server_tool_use'))).toBe(false);
    }
    expect(make('anthropic', true).messages).toEqual(make('anthropic', false).messages);
  });
  it('third anchor flag skips server blocks but retains source/text caching; default behavior remains unchanged', () => {
    const input = body(); input.messages[1].content.unshift({ type: 'text', text: 'cacheable source text' });
    const protectedBody = anchorClaudeCache(structuredClone(input), true, true);
    expect(protectedBody.messages[1].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(protectedBody.messages[1].content.slice(1)).toEqual(input.messages[1].content.slice(1));
    expect(anchorClaudeCache(structuredClone(input), true).messages[1].content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(anchorClaudeCache(structuredClone(input), true, 'true').messages[1].content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    const actual = prepareAccountingClaudeOauthBody(body(), 'sk-ant-oat-dummy', session);
    expect(actual.messages[1]).toEqual(body().messages[1]);
    expect(actual.tools.find(tool => tool.name === 'web_search')).toEqual(body().tools[0]);
    expect(actual.system.at(-1).cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
  it('raw owner renames only original declared clients, preserves server IDs/results, excludes injected decoys', () => {
    const original = body(); original.tools.push({ name: 'lookup', input_schema: { type: 'object' } });
    original.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'client_original', name: 'lookup', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'client_original', content: 'result' }] });
    const retained = structuredClone(original), owner = claudeOauthServerSearchOwner(original);
    expect(owner.tools.map(tool => tool.name)).toEqual(['web_search', 'lookup_ide']);
    expect(owner.messages[1]).toEqual(original.messages[1]);
    expect(owner.messages[3].content[0]).toEqual({ ...original.messages[3].content[0], name: 'lookup_ide' });
    expect(owner.messages[4]).toEqual(original.messages[4]);
    expect(original).toEqual(retained); expect(Object.isFrozen(owner)).toBe(true);
    original.messages[1].content[0].input.query = 'mutated'; expect(owner.messages[1].content[0].input.query).toBe('original query');
    expect(owner.tools.some(tool => tool.name === 'Task')).toBe(false);
  });
  it('fetch-only result history uses separate tenth prepare/fourth anchor flags; defaults/foreign unchanged', () => {
    const original = body(); original.tools = [{ type: 'web_fetch_20250910', name: 'web_fetch' }];
    original.messages[1].content = [{ type: 'server_tool_use', id: 'srvtoolu_fetch', name: 'web_fetch', input: { url: 'https://example.com/article' } },
      { type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_fetch', content: { type: 'web_fetch_result', url: 'https://example.com/article', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'original fetched corpus' } } } }];
    expect(prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy', session).messages[1]).toEqual(original.messages[1]);
    const owner = claudeOauthServerFetchOwner(original); expect(owner.messages[1]).toEqual(original.messages[1]); expect(owner.tools).toEqual(original.tools);
    const resultOnly = { ...original, messages: [{ role: 'assistant', content: [original.messages[1].content[1]] }, { role: 'user', content: 'continue' }] };
    const prepare = (provider, flag) => prepareClaudeRequest(structuredClone(resultOnly), provider, null, null, null, null, false, false, false, flag);
    expect(prepare('claude', true).messages[0]).toEqual(resultOnly.messages[0]);
    expect(prepare('claude', false).messages.some(message => message.content?.some?.(block => block.type === 'web_fetch_tool_result'))).toBe(false);
    expect(prepare('anthropic', true)).toEqual(prepare('anthropic', false));
    const anchored = anchorClaudeCache(structuredClone(resultOnly), false, false, true);
    expect(anchored.messages[0]).toEqual(resultOnly.messages[0]);
    expect(anchorClaudeCache(structuredClone(resultOnly)).messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });
  it('dynamic-only transform retains code result history/definition with eleventh prepare/fifth cache flags; default and foreign unchanged', () => {
    const original = body(); original.tools = [{ type: 'web_search_20260318', name: 'web_search' }, { type: 'code_execution_20260521', name: 'code_execution' }];
    original.messages[1].content = [{ type: 'server_tool_use', id: 'srvtoolu_code', name: 'code_execution', input: { code: 'private code' } },
      { type: 'code_execution_tool_result', tool_use_id: 'srvtoolu_code', content: { type: 'code_execution_result', stdout: 'private', stderr: '', return_code: 0, content: [] } }];
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false); expect(supportsClaudeOauthOriginal(original, original.model, true)).toBe(true);
    expect(prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy', session, true).messages[1]).toEqual(original.messages[1]);
    expect(claudeOauthDynamicOwner(original).tools).toEqual(original.tools);
    const resultOnly = { ...original, messages: [{ role: 'assistant', content: [original.messages[1].content[1]] }, { role: 'user', content: 'continue' }] };
    const prepare = (provider, flag) => prepareClaudeRequest(structuredClone(resultOnly), provider, null, null, null, null, false, false, false, false, flag);
    expect(prepare('claude', true).messages[0]).toEqual(resultOnly.messages[0]);
    expect(prepare('anthropic', true)).toEqual(prepare('anthropic', false));
    expect(anchorClaudeCache(structuredClone(resultOnly), false, false, false, true).messages[0]).toEqual(resultOnly.messages[0]);
    expect(anchorClaudeCache(structuredClone(resultOnly)).messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(prepare('claude', 'true')).toEqual(prepare('claude', false));
  });
  it('owner refuses programmable/malformed/dynamic sources before transform; no-server original has no paid owner', () => {
    const getter = vi.fn(() => body().tools), trapped = vi.fn(() => ['tools']);
    expect(() => claudeOauthServerSearchOwner(Object.defineProperty(body(), 'tools', { enumerable: true, get: getter }))).toThrow();
    expect(() => claudeOauthServerSearchOwner(new Proxy(body(), { ownKeys: trapped }))).toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(trapped).not.toHaveBeenCalled();
    const dynamic = body(); dynamic.tools[0].type = 'web_search_20260209';
    expect(supportsClaudeOauthOriginal(dynamic, dynamic.model)).toBe(false); expect(() => claudeOauthServerSearchOwner(dynamic)).toThrow();
    const flat = body(); delete flat.tools; flat.messages = [{ role: 'user', content: 'no server tool' }];
    expect(claudeOauthServerSearchOwner(flat)).toBeNull();
  });
});
