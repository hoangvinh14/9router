import { describe, expect, it, vi } from 'vitest';
import { normalizeExactUsage } from 'open-sse/utils/exactUsage.js';
import { costFromExactUsage } from '@/lib/pricing/money.js';

const raw = (count = 2) => ({ input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 40,
  cache_creation_input_tokens: 10, server_tool_use: { web_search_requests: count } });
const normalized = value => normalizeExactUsage(value, 'claude', 'chat', { allowWebSearchUsage: true });

describe('explicit raw search usage prerequisite, not stream/provider admission', () => {
  it('retains raw observed count with typed monetary provenance and inclusive tokens', () => {
    const original = Object.freeze({ ...raw(), server_tool_use: Object.freeze(raw().server_tool_use) });
    expect(normalized(original)).toMatchObject({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 10,
      toolUses: { webSearchRequests: 2 }, provenance: { schema: 'claude', endpoint: 'chat', inputIncludesCache: true,
        serverToolUses: 'observed_claude_server_tool_use' } });
    expect(original.input_tokens).toBe(50); expect(original.server_tool_use.web_search_requests).toBe(2);
    expect(costFromExactUsage(normalized(original), { input: '1', output: '2', web_search_per_1000: '10' })).toBe('20140000');
  });
  it('observed zero stays explicit and still requires rate authority', () => {
    const value = normalized(raw(0));
    expect(value.toolUses).toEqual({ webSearchRequests: 0 });
    expect(() => costFromExactUsage(value, { input: '1', output: '2' })).toThrow();
    expect(costFromExactUsage(value, { input: '1', output: '2', web_search_per_1000: '0' })).toBe('140000');
  });
  it('default/false remain token-only; string/nonboolean/foreign endpoint opts do not open anything', () => {
    expect(normalizeExactUsage(raw(), 'claude')).toBeNull();
    expect(normalizeExactUsage(raw(), 'claude', 'chat', { allowWebSearchUsage: false })).toBeNull();
    for (const value of ['true', 1, null]) expect(normalizeExactUsage(raw(0), 'claude', 'chat', { allowWebSearchUsage: value })).toBeNull();
    expect(normalizeExactUsage({ prompt_tokens: 1, completion_tokens: 0 }, 'openai', 'chat', { allowWebSearchUsage: true })).toBeNull();
    expect(normalizeExactUsage(raw(0), 'claude', 'embeddings', { allowWebSearchUsage: true })).toBeNull();
    expect(normalizeExactUsage(raw(0), 'claude')).not.toHaveProperty('toolUses');
  });
  it('missing/partial/malformed/unknown/paid-fetch usage never becomes zero search use', () => {
    for (const tools of [undefined, null, {}, [], { web_fetch_requests: 0 }, { web_search_requests: -1 },
      { web_search_requests: 0.5 }, { web_search_requests: '2' }, { web_search_requests: Number.MAX_SAFE_INTEGER + 1 },
      { web_search_requests: 2, future_requests: 0 }, { web_search_requests: 2, web_fetch_requests: 1 }]) {
      expect(normalized({ ...raw(), server_tool_use: tools })).toBeNull();
    }
    const missing = raw(); delete missing.server_tool_use;
    expect(normalized(missing)).toBeNull();
    // Legacy explicit observed zero of known other counters stays nonbillable,
    // never a new free-fetch admission or fabricated counter in monetary data.
    expect(normalized({ ...raw(), server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } }).toolUses).toEqual({ webSearchRequests: 2 });
  });
  it('never executes programmable raw input, counter or marker', () => {
    const getter = vi.fn(() => 2), trap = vi.fn(() => ['web_search_requests']);
    const tools = Object.defineProperty({}, 'web_search_requests', { enumerable: true, get: getter });
    expect(normalized({ ...raw(), server_tool_use: tools })).toBeNull();
    expect(normalized({ ...raw(), server_tool_use: new Proxy(raw().server_tool_use, { ownKeys: trap }) })).toBeNull();
    expect(normalized(Object.defineProperty({ ...raw() }, 'estimated', { enumerable: true, get: getter }))).toBeNull();
    expect(normalized({ ...raw(), toJSON: () => raw() })).toBeNull();
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
  it('retains observed cache tiers and combines token/tool cost once without granting 1h by tool opt-in', () => {
    const value = { ...raw(), cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 5 } };
    expect(normalized(value)).toBeNull();
    const usage = normalizeExactUsage(value, 'claude', 'chat', { allowWebSearchUsage: true, allowCache1h: true, requireCacheTiers: true });
    expect(usage).toMatchObject({ cacheWrite5m: 5, cacheWrite1h: 5, toolUses: { webSearchRequests: 2 } });
    expect(costFromExactUsage(usage, { input: '1', output: '2', cached: '0.1', cache_creation: '1.25', cache_creation_1h: '2', web_search_per_1000: '10' })).toBe('20110250');
    expect(() => costFromExactUsage(usage, { input: '1', output: '2', web_search_per_1000: '10' })).toThrow();
  });
  it('unsupported raw categories/own undefined/programmable cache splits cannot be hidden by normalization', () => {
    for (const extra of [{ future_tool_fee: 0 }, { estimated: false }, { buffered: false }, { toolUses: { webSearchRequests: 2 } }]) {
      expect(normalized({ ...raw(), ...extra })).toBeNull();
    }
    const inherited = Object.assign(Object.create({ server_tool_use: raw().server_tool_use }), raw());
    expect(normalized(inherited)).toBeNull();
    const getter = vi.fn(() => 0);
    const cache = Object.defineProperty({ ephemeral_5m_input_tokens: 10 }, 'ephemeral_1h_input_tokens', { enumerable: true, get: getter });
    expect(normalizeExactUsage({ ...raw(), cache_creation: cache }, 'claude', 'chat', { allowWebSearchUsage: true, allowCache1h: true })).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });
  it('bad token metadata or estimated/buffered markers remain unknown despite explicit search count', () => {
    for (const value of [{ ...raw(), input_tokens: undefined }, { ...raw(), output_tokens: -1 },
      { ...raw(), estimated: true }, { ...raw(), buffered: true }, { ...raw(), cache_creation_input_tokens: -1 }]) {
      expect(normalized(value)).toBeNull();
    }
  });
});
