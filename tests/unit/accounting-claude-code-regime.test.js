import { describe, expect, it, vi } from 'vitest';
import * as policy from 'open-sse/config/accountingClaudeCodeRegime.js';
const search = (type = 'web_search_20260209') => ({ type, name: 'web_search' });
const fetch = (type = 'web_fetch_20260209') => ({ type, name: 'web_fetch' });
const code = (type = 'code_execution_20260120') => ({ type, name: 'code_execution' });
const regime = tools => policy.captureClaudeCodeRegime(tools);

describe('isolated original code charge regime, not provider admission/time/resource proof', () => {
  it('later search/fetch selects documented token-only code regime independently of actual call counts', () => {
    for (const tools of [[search()], [fetch()], [search('web_search_20260318'), code('code_execution_20260521')], [fetch('web_fetch_20260309'), code()], [search(), fetch()]]) {
      expect(regime(tools)).toMatchObject({ codeCharge: 'token-only', codeVersion: tools.find(tool => tool.name === 'code_execution')?.type || 'code_execution_20260120' });
      expect(Object.isFrozen(regime(tools))).toBe(true);
    }
  });
  it('direct later definitions still select included code regime; caller choice cannot invent a charge', () => {
    expect(regime([{ ...search(), allowed_callers: ['direct'] }]).codeCharge).toBe('token-only');
    expect(regime([{ ...fetch('web_fetch_20260318'), allowed_callers: ['direct'], response_inclusion: 'excluded' }]).codeCharge).toBe('token-only');
    expect(regime([{ name: 'lookup', input_schema: { type: 'object' } }])).toEqual({ codeCharge: 'absent', codeVersion: null });
  });
  it('standalone/legacy versions remain duration-unobservable rather than count-priced or fabricated free', () => {
    for (const tools of [[code()], [code('code_execution_20250825')], [search('web_search_20250305'), code()], [fetch('web_fetch_20250910'), code()]])
      expect(regime(tools)).toEqual({ codeCharge: 'duration-unobservable', codeVersion: tools.at(-1).type });
    expect(regime([search('web_search_20250305')])).toEqual({ codeCharge: 'absent', codeVersion: null });
  });
  it('invalid versions/callers/duplicates/conflicting old runtime never establish included regime', () => {
    for (const tools of [[search('web_search_future')], [{ ...fetch(), allowed_callers: ['foreign'] }], [search(), search()], [fetch(), code('code_execution_20250825')], [{ ...code(), price: 0 }], [search(), code('code_execution_future')], [{ ...search(), allowed_callers: [] }]])
      expect(() => regime(tools)).toThrow('Invalid Claude code regime authority');
  });
  it('bounded definitions preserve strict version options/cache and caller grammar without changing direct provider predicates', async () => {
    const { supportsClaudeServerSearchTool } = await import('open-sse/config/accountingClaudeServerSearch.js');
    const { supportsClaudeServerFetchTool } = await import('open-sse/config/accountingClaudeServerFetch.js');
    const mixed = { ...search(), allowed_callers: ['direct', 'code_execution_20260120'], cache_control: { type: 'ephemeral', ttl: '1h' } };
    expect(regime([mixed]).codeCharge).toBe('token-only'); expect(supportsClaudeServerSearchTool(mixed)).toBe(false);
    expect(regime([{ ...fetch(), allowed_callers: ['code_execution_20260120'] }]).codeCharge).toBe('token-only'); expect(supportsClaudeServerFetchTool(fetch())).toBe(false);
    for (const tools of [[{ ...search(), max_uses: -1 }], [{ ...search(), allowed_callers: ['direct', 'direct'] }], [{ ...fetch(), use_cache: true }], [{ ...fetch(), citations: { enabled: 'true' } }], [{ ...code(), cache_control: { type: 'foreign' } }], [{ ...search(), cache_control: { type: 'ephemeral', ttl: 'unknown' } }], [{ name: 'web_search', input_schema: {} }], [{ name: 'foreign', input_schema: {}, arbitrary: true }]])
      expect(() => regime(tools)).toThrow();
    expect(() => regime(Array.from({ length: 10001 }, (_, i) => ({ name: `tool${i}`, input_schema: {} })))).toThrow();
    expect(() => regime([{ name: 'client', description: 'x'.repeat(262145), input_schema: {} }])).toThrow();
  });
  it('documented 20260521 declared caller aliases runtime20260120 without accepting raw caller alias or duplicate versions', () => {
    expect(regime([{ ...search(), allowed_callers: ['code_execution_20260521'] }, code('code_execution_20260521')]).codeCharge).toBe('token-only');
    expect(() => regime([{ ...fetch(), allowed_callers: ['code_execution_20260120', 'code_execution_20260521'] }])).toThrow();
  });
  it('original snapshots refuse getters/proxies/undefined before reads; result cannot be changed by later mutation', () => {
    const getter = vi.fn(), trap = vi.fn();
    expect(() => regime([Object.defineProperty(search(), 'allowed_callers', { enumerable: true, get: getter })])).toThrow();
    expect(() => regime(new Proxy([search()], { ownKeys: trap }))).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    expect(() => regime([{ ...search(), allowed_callers: undefined }])).toThrow();
    const tools = [search()], value = regime(tools); tools[0].type = 'foreign'; expect(value.codeCharge).toBe('token-only');
  });
});
