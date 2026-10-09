import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '../../open-sse/config/providers.js';
import { captureAccountingProxyEnvironment } from '../../open-sse/config/accountedProxyEnvironment.js';
import { captureAccountingBaseTransport } from '../../open-sse/config/accountedBaseTransport.js';
import { validateQueuedBaseWire } from '@/lib/apiKeyBudget/queuedBaseWire.js';

const original = () => structuredClone(PROVIDERS.deepseek.transports.find(entry => entry.format === 'openai'));
const authority = () => ({ provider: 'deepseek', connection: { data: JSON.stringify({ apiKey: 'dummy-provider' }) }, settings: '{}' });
const wire = () => ({ url: original().baseUrl, stream: false, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dummy-provider' },
  credentials: { apiKey: 'dummy-provider', accessToken: null }, providerOverrides: null,
  proxyOptions: null, proxyEnvironment: captureAccountingProxyEnvironment(), runtimeTransport: original(), baseTransport: captureAccountingBaseTransport(PROVIDERS.deepseek), urlIndex: 0 });

describe('queued original registry runtime evidence (bounded wire helper, no network or new provider eligibility)', () => {
  it('real DeepSeek registry OpenAI entry matches exact URL and survives detached bounded snapshot', () => {
    const input = wire(), result = validateQueuedBaseWire(authority(), input);
    expect(result).toEqual(input); expect(result.runtimeTransport).not.toBe(input.runtimeTransport);
    expect(Object.isFrozen(result.runtimeTransport.auth)).toBe(true);
    input.runtimeTransport.baseUrl = 'http://dummy-changed.invalid'; input.runtimeTransport.auth.header = 'x-changed';
    expect(result.runtimeTransport).toEqual(original());
  });
  it.each(['baseUrl', 'format', 'urlSuffix', 'headers', 'auth'])('changed original %s cannot borrow canonical registry authority', field => {
    const input = wire();
    input.runtimeTransport[field] = field === 'headers' ? { 'x-invented': 'dummy' }
      : field === 'auth' ? { combined: true, header: 'x-invented', scheme: 'raw' } : 'dummy-changed';
    expect(() => validateQueuedBaseWire(authority(), input)).toThrow('Accounting runtime transport unavailable');
  });
  it('exact runtime descriptor does not permit different prepared URL', () => {
    const input = wire(); input.url += '?dummy=changed';
    expect(() => validateQueuedBaseWire(authority(), input)).toThrow('Accounting runtime transport unavailable');
  });
  it('missing original evidence cannot become an implicit canonical transport', () => {
    const input = wire(); delete input.runtimeTransport;
    expect(() => validateQueuedBaseWire(authority(), input)).toThrow('Queued prepared wire unavailable');
  });
  it('explicit absent runtime remains equality-only, not permission for arbitrary custom URL', () => {
    const input = wire(); input.runtimeTransport = null;
    expect(validateQueuedBaseWire(authority(), input).runtimeTransport).toBeNull();
    input.url = 'http://dummy-unbound.invalid/chat';
    expect(() => validateQueuedBaseWire(authority(), input)).toThrow('Accounting Base transport unavailable');
    // Canonical transport/URL equality still is not complete dispatch eligibility.
  });
  it('runtime accessor or Proxy is refused before side effects', () => {
    let calls = 0;
    const input = wire();
    Object.defineProperty(input.runtimeTransport, 'baseUrl', { enumerable: true, get() { calls++; throw new Error('getter ran'); } });
    expect(() => validateQueuedBaseWire(authority(), input)).toThrow('Accounting group payload unavailable');
    const proxy = wire(); proxy.runtimeTransport = new Proxy({}, { ownKeys() { calls++; throw new Error('proxy ran'); } });
    expect(() => validateQueuedBaseWire(authority(), proxy)).toThrow('Accounting group payload unavailable'); expect(calls).toBe(0);
  });
  it('large runtime evidence counts toward wire ceiling and cannot bypass it', () => {
    const input = wire(); input.runtimeTransport.headers = { 'x-large': 'x'.repeat(300000) };
    expect(() => validateQueuedBaseWire(authority(), input)).toThrow('Accounting group payload unavailable');
  });
});
