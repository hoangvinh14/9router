import { describe, expect, it } from 'vitest';
import { validateQueuedBaseWire } from '@/lib/apiKeyBudget/queuedBaseWire.js';
import { captureAccountingProxyEnvironment } from '../../open-sse/config/accountedProxyEnvironment.js';
import { captureAccountingBaseTransport } from '../../open-sse/config/accountedBaseTransport.js';
import { PROVIDERS } from '../../open-sse/config/providers.js';

const authority = (connection = {}, settings = {}, provider = 'openai') => ({ provider, connection: { data: JSON.stringify({ apiKey: 'dummy-provider', ...connection }) }, settings: JSON.stringify(settings) });
const wire = extra => ({ url: PROVIDERS.openai.baseUrl, stream: false, headers: { Authorization: 'Bearer dummy-provider', 'Content-Type': 'application/json' }, credentials: { apiKey: 'dummy-provider' }, providerOverrides: null, proxyEnvironment: captureAccountingProxyEnvironment(), runtimeTransport: null, baseTransport: captureAccountingBaseTransport(PROVIDERS.openai), urlIndex: 0, ...extra });
describe('internal narrow Base original credential/header equality (not proxy or dispatch)', () => {
  it('valid material is detached frozen; no reprepare from fresh DB values', () => {
    const input = wire(), result = validateQueuedBaseWire(authority(), input);
    expect(result).toEqual(input); expect(result).not.toBe(input); expect(Object.isFrozen(result.headers)).toBe(true);
    input.headers.Authorization = 'changed'; expect(result.headers.Authorization).toBe('Bearer dummy-provider');
  });
  it('explicit no-runtime evidence is mandatory, absent or invented endpoint refuses', () => {
    const missing = wire(); delete missing.runtimeTransport;
    expect(() => validateQueuedBaseWire(authority(), missing)).toThrow('Queued prepared wire unavailable');
    expect(() => validateQueuedBaseWire(authority(), wire({ runtimeTransport: undefined }))).toThrow();
    expect(() => validateQueuedBaseWire(authority(), wire({ runtimeTransport: { format: 'openai', baseUrl: 'http://dummy-unbound.invalid/chat' } }))).toThrow('Accounting runtime transport unavailable');
  });
  it('complete headers require protocol fields, declared extras only and original stream flag', () => {
    expect(() => validateQueuedBaseWire(authority(), wire({ headers: { Authorization: 'Bearer dummy-provider' } }))).toThrow();
    expect(() => validateQueuedBaseWire(authority(), wire({ headers: { ...wire().headers, 'x-unbound': 'dummy' } }))).toThrow();
    const live = wire({ stream: true, headers: { ...wire().headers, Accept: 'text/event-stream' } });
    expect(validateQueuedBaseWire(authority(), live)).toEqual(live);
    expect(() => validateQueuedBaseWire(authority(), { ...live, stream: false })).toThrow();
    const missing = wire(); delete missing.stream;
    expect(() => validateQueuedBaseWire(authority(), missing)).toThrow();
  });
  it('API-key rotation between header creation and enqueue refuses stale wire', () => {
    expect(() => validateQueuedBaseWire(authority({ apiKey: 'dummy-rotated' }), wire())).toThrow('Queued prepared wire unavailable');
  });
  it('accessToken has precedence but stale API-key field is not ignored', () => {
    const current = authority({ accessToken: 'dummy-token' });
    const valid = wire({ credentials: { apiKey: 'dummy-provider', accessToken: 'dummy-token' }, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dummy-token' } });
    expect(validateQueuedBaseWire(current, valid)).toEqual(valid);
    expect(() => validateQueuedBaseWire(current, { ...valid, credentials: { apiKey: 'wrong', accessToken: 'dummy-token' } })).toThrow();
    expect(() => validateQueuedBaseWire(current, wire())).toThrow();
  });
  it('ACKed refreshed token matches only explicitly prepared refreshed wire', () => {
    const current = authority({ accessToken: 'dummy-refreshed' });
    expect(() => validateQueuedBaseWire(current, wire({ credentials: { apiKey: 'dummy-provider', accessToken: 'dummy-old' }, headers: { Authorization: 'Bearer dummy-old' } }))).toThrow();
    const refreshed = wire({ credentials: { apiKey: 'dummy-provider', accessToken: 'dummy-refreshed' }, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dummy-refreshed' } });
    expect(validateQueuedBaseWire(current, refreshed)).toEqual(refreshed);
  });
  it('prepared headers independently must match persisted token even if credential fields match', () => {
    expect(() => validateQueuedBaseWire(authority(), wire({ headers: { Authorization: 'Bearer stale' } }))).toThrow();
  });
  it('provider overrides require persisted equality and original header values', () => {
    const providerOverrides = { headers: { 'x-fixture': 'dummy' }, connectTimeoutMs: 1000 };
    const current = authority({}, { providerOverrides: { openai: providerOverrides } });
    const valid = wire({ providerOverrides, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dummy-provider', 'x-fixture': 'dummy' } });
    expect(validateQueuedBaseWire(current, valid)).toEqual(valid);
    expect(() => validateQueuedBaseWire(current, wire())).toThrow();
    expect(() => validateQueuedBaseWire(current, { ...valid, headers: { Authorization: 'Bearer dummy-provider', 'x-fixture': 'stale' } })).toThrow();
  });
  it('case normalization works without duplicate-shadow authorization names', () => {
    expect(validateQueuedBaseWire(authority(), wire({ headers: { 'content-type': 'application/json', authorization: 'Bearer dummy-provider' } })).headers.authorization).toBe('Bearer dummy-provider');
    expect(() => validateQueuedBaseWire(authority(), wire({ headers: { authorization: 'Bearer dummy-provider', Authorization: 'Bearer dummy-provider' } }))).toThrow();
  });
  it.each(['anthropic', 'gemini', 'openai-compatible-fixture'])('unsupported %s never inherits OpenAI equality authority', provider => {
    expect(() => validateQueuedBaseWire(authority({}, {}, provider), wire())).toThrow();
  });
  it('arbitrary URL cannot borrow canonical transport evidence; no broad proxy/dispatch authority', () => {
    const input = wire({ url: 'http://dummy.invalid/custom' });
    expect(() => validateQueuedBaseWire(authority(), input)).toThrow('Accounting Base transport unavailable');
    expect(() => validateQueuedBaseWire(authority(), wire({ credentials: { apiKey: 'dummy-provider', runtimeTransport: {} } }))).toThrow();
  });
});
