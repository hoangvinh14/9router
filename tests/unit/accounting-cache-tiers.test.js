import { describe, expect, it } from 'vitest';
import { normalizeExactUsage } from 'open-sse/utils/exactUsage.js';
import { createBufferedClaudeUsageObserver } from 'open-sse/utils/accountingClaudeUsage.js';
import { supportsAnthropicLiveRequest } from 'open-sse/config/accountedAnthropicCandidate.js';
import { costFromExactUsage } from '@/lib/pricing/money.js';
import { completeReferenceRates } from '@/lib/pricing/referenceResolver.js';
import { validatePricingMutation } from '@/lib/pricing/pricingValidation.js';
import { validateCatalog } from '@/lib/pricing/catalogSync.js';
import { pricingDraft, changedPricingModels } from '@/shared/utils/pricingDraft.js';
import { attemptRecoveryDraft } from '@/shared/utils/budgetManagementDraft.js';

const raw = (five = 5, hour = 5) => ({ input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 40,
  cache_creation_input_tokens: five + hour, cache_creation: { ephemeral_5m_input_tokens: five, ephemeral_1h_input_tokens: hour }, server_tool_use: { web_search_requests: 0 } });
const normalize = value => normalizeExactUsage(value, 'claude', 'chat', { allowCache1h: true, requireCacheTiers: true });
const rates = { input: '1', output: '2', cached: '0.1', cache_creation: '1.25', cache_creation_1h: '2' };
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const stream = value => event('message_start', { message: { id: 'msg_tier', type: 'message', role: 'assistant', model: 'fixture-tier', content: [], usage: { ...value, output_tokens: 0 } } }) +
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + event('message_stop');
const request = () => ({ model: 'fixture-tier', stream: true, max_tokens: 100, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture', cache_control: { type: 'ephemeral', ttl: '1h' } }] }] });

describe('observed Messages cache tiers and explicit original reference rates', () => {
  it('retains exact inclusive subsets and both observed counts; default normalization stays denied', () => {
    const value = Object.freeze({ ...raw(), cache_creation: Object.freeze(raw().cache_creation) });
    expect(normalize(value)).toMatchObject({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 10, cacheWrite5m: 5, cacheWrite1h: 5 });
    expect(value.input_tokens).toBe(50); expect(normalizeExactUsage(value, 'claude')).toBeNull();
    expect(normalize(raw(0, 0))).toMatchObject({ cacheWrite5m: 0, cacheWrite1h: 0 });
  });
  it.each(['sum', 'missing', 'unknown', 'negative', 'fractional', 'unsafe', 'string', 'partial'])('invalid or absent observed split is unknown: %s', mode => {
    const value = raw();
    if (mode === 'sum') value.cache_creation_input_tokens++;
    if (mode === 'missing') delete value.cache_creation;
    if (mode === 'unknown') value.cache_creation.future_tier = 0;
    if (mode === 'negative') value.cache_creation.ephemeral_1h_input_tokens = -1;
    if (mode === 'fractional') value.cache_creation.ephemeral_1h_input_tokens = 5.1;
    if (mode === 'unsafe') value.cache_creation.ephemeral_1h_input_tokens = Number.MAX_SAFE_INTEGER + 1;
    if (mode === 'string') value.cache_creation.ephemeral_1h_input_tokens = '5';
    if (mode === 'partial') delete value.cache_creation.ephemeral_5m_input_tokens;
    expect(normalize(value)).toBeNull();
  });
  it('separately opts raw reader in; genuine EOF required and tier change cannot be overwritten', () => {
    const observer = createBufferedClaudeUsageObserver({ expectedModel: 'fixture-tier', allowCache1h: true, requireCacheTiers: true });
    observer.push(new TextEncoder().encode(stream(raw())));
    expect(observer.finish()).toMatchObject({ cacheWrite5m: 5, cacheWrite1h: 5 });
    const partial = createBufferedClaudeUsageObserver({ expectedModel: 'fixture-tier', allowCache1h: true, requireCacheTiers: true });
    partial.push(new TextEncoder().encode(stream(raw()).split('event: message_stop')[0])); expect(partial.finish()).toBeNull();
    const drift = createBufferedClaudeUsageObserver({ expectedModel: 'fixture-tier', allowCache1h: true, requireCacheTiers: true });
    const changed = stream(raw()).replace('"usage":{"output_tokens":20}', '"usage":{"output_tokens":20,"cache_creation":{"ephemeral_5m_input_tokens":10,"ephemeral_1h_input_tokens":0}}');
    expect(() => drift.push(new TextEncoder().encode(changed))).toThrow();
  });
  it('1h input requires distinct opt-in; tools opt-in alone and default callers remain denied', () => {
    expect(supportsAnthropicLiveRequest(request(), 'fixture-tier')).toBe(false);
    expect(supportsAnthropicLiveRequest(request(), 'fixture-tier', true)).toBe(false);
    expect(supportsAnthropicLiveRequest(request(), 'fixture-tier', true, true)).toBe(true);
    const mixed = request(); mixed.messages[0].content.push({ type: 'text', text: 'five', cache_control: { type: 'ephemeral', ttl: '5m' } });
    expect(supportsAnthropicLiveRequest(mixed, 'fixture-tier', true, true)).toBe(true);
    mixed.messages[0].content.reverse(); expect(supportsAnthropicLiveRequest(mixed, 'fixture-tier', true, true)).toBe(false);
  });
  it('1h cache control is top-level content only, not nested tool-result content', () => {
    const body = request(); body.messages[0].content[0].cache_control.ttl = '5m';
    body.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'tier-tool', name: 'fixture', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tier-tool', content: [{ type: 'text', text: 'fixture', cache_control: { type: 'ephemeral', ttl: '1h' } }] }] });
    expect(supportsAnthropicLiveRequest(body, 'fixture-tier', true, true)).toBe(false);
    delete body.messages[2].content[0].content[0].cache_control;
    expect(supportsAnthropicLiveRequest(body, 'fixture-tier', true, true)).toBe(true);
  });
  it('uses distinct explicit rate, never a multiplier or flat aggregate; round once across tiers', () => {
    expect(costFromExactUsage(normalize(raw()), rates)).toBe('110250');
    expect(costFromExactUsage(normalize(raw()), { ...rates, cache_creation_1h: '0' })).toBe('100250');
    expect(costFromExactUsage(normalize(raw(10, 0)), { input: '1', output: '2', cached: '0.1', cache_creation: '1.25' })).toBe('106500');
    const tiny = { exact: true, input: 2, output: 0, cacheRead: 0, cacheWrite: 2, cacheWrite5m: 1, cacheWrite1h: 1, reasoning: 0, reasoningIncludedInOutput: true };
    expect(costFromExactUsage(tiny, { input: '0', output: '0', cache_creation: '0.00025', cache_creation_1h: '0.00025' })).toBe('1');
    const { cache_creation_1h: _hour, ...flat } = rates;
    expect(() => costFromExactUsage(normalize(raw()), flat)).toThrow();
    expect(() => costFromExactUsage({ ...normalize(raw()), cacheWrite5m: 6 }, rates)).toThrow();
    const partial = normalize(raw()); delete partial.cacheWrite1h;
    expect(() => costFromExactUsage(partial, rates)).toThrow();
  });
  it('manual ingress/draft retains zero and lexical precision; flat catalog absence stays absent', () => {
    expect(completeReferenceRates(rates)).toEqual(rates);
    expect(validatePricingMutation({ anthropic: { 'fixture-tier': { ...rates, cache_creation_1h: '0' } } }).anthropic['fixture-tier'].cache_creation_1h).toBe('0');
    expect(() => completeReferenceRates({ ...rates, cache_creation_1h: '0.0000000001' })).toThrow();
    const baseline = pricingDraft({ anthropic: { 'fixture-tier': rates } }), draft = structuredClone(baseline);
    expect(changedPricingModels(baseline, draft)).toEqual({}); draft.anthropic['fixture-tier'].cache_creation_1h = '0';
    expect(changedPricingModels(baseline, draft).anthropic['fixture-tier'].cache_creation_1h).toBe('0');
    const catalog = validateCatalog(JSON.stringify({ anthropic: { id: 'anthropic', models: { 'fixture-tier': { id: 'fixture-tier', cost: { input: 1, output: 2, cache_write: 1.25 } } } } }));
    expect(catalog.entries['anthropic/fixture-tier'].rates).not.toHaveProperty('cache_creation_1h');
    draft.anthropic['fixture-tier'].cache_creation_1h = '';
    expect(changedPricingModels(baseline, draft).anthropic['fixture-tier']).not.toHaveProperty('cache_creation_1h');
  });
  it('operator recovery preserves both counts and rejects partial/mismatched tiers', () => {
    const { provenance: _provenance, ...usage } = normalize(raw());
    const recovery = value => attemptRecoveryDraft({ resolutionVersion: 0 }, { action: 'exact_usage', reason: 'fixture', evidence: 'owned evidence', usageJson: JSON.stringify(value) }, 'tier-recovery');
    expect(recovery(usage).usage).toEqual(usage);
    expect(() => recovery({ ...usage, cacheWrite1h: 6 })).toThrow();
    const partial = { ...usage }; delete partial.cacheWrite5m; expect(() => recovery(partial)).toThrow();
  });
});
