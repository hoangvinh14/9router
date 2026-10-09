import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '../../open-sse/config/providers.js';
import { captureAccountingBaseTransport } from '../../open-sse/config/accountedBaseTransport.js';
import { captureAccountingProxyEnvironment } from '../../open-sse/config/accountedProxyEnvironment.js';
import { validateQueuedBaseWire } from '@/lib/apiKeyBudget/queuedBaseWire.js';

const authority = () => ({ provider: 'openai', connection: { data: JSON.stringify({ apiKey: 'dummy-provider' }) }, settings: '{}' });
const wire = () => ({ url: PROVIDERS.openai.baseUrl, stream: false, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dummy-provider' },
  credentials: { apiKey: 'dummy-provider' }, providerOverrides: null, proxyEnvironment: captureAccountingProxyEnvironment(),
  runtimeTransport: null, baseTransport: captureAccountingBaseTransport(PROVIDERS.openai), urlIndex: 0 });
describe('queued canonical original Base transport equality (helper, not complete executor/node eligibility)', () => {
  it('canonical URL/config snapshots are detached, frozen and contain no config callbacks', () => {
    const input = wire(), result = validateQueuedBaseWire(authority(), input);
    expect(result.baseTransport).toEqual(input.baseTransport); expect(result.baseTransport).not.toBe(input.baseTransport);
    expect(Object.isFrozen(result.baseTransport)).toBe(true);
    input.baseTransport.baseUrl = 'http://dummy-changed.invalid';
    expect(result.baseTransport.baseUrl).toBe(PROVIDERS.openai.baseUrl);
  });
  it.each(['baseUrl', 'baseUrls', 'urlSuffix', 'headers', 'noAuth', 'format', 'forceStream', 'transports'])('%s drift cannot borrow registry equality', field => {
    const input = wire(); input.baseTransport[field] = field === 'headers' ? { 'x-invented': 'dummy' } : 'changed';
    expect(() => validateQueuedBaseWire(authority(), input)).toThrow('Accounting Base transport unavailable');
  });
  it.each([-1, 1, 0.5, null, '0'])('invalid/outside original URL index %s refuses', urlIndex => {
    const input = wire(); input.urlIndex = urlIndex;
    expect(() => validateQueuedBaseWire(authority(), input)).toThrow('Accounting Base transport unavailable');
  });
  it('missing config evidence and arbitrary URL both refuse rather than rebuild', () => {
    const input = wire(); delete input.baseTransport;
    expect(() => validateQueuedBaseWire(authority(), input)).toThrow('Accounting Base transport unavailable');
    const different = wire(); different.url = 'http://dummy-unbound.invalid/chat';
    expect(() => validateQueuedBaseWire(authority(), different)).toThrow('Accounting Base transport unavailable');
  });
  it('config evidence cannot execute accessor/Proxy or evade retained byte limits', () => {
    let calls = 0; const input = wire();
    Object.defineProperty(input.baseTransport, 'headers', { enumerable: true, get() { calls++; throw new Error('getter ran'); } });
    expect(() => validateQueuedBaseWire(authority(), input)).toThrow('Accounting group payload unavailable');
    const proxy = wire(); proxy.baseTransport = new Proxy({}, { ownKeys() { calls++; throw new Error('proxy ran'); } });
    expect(() => validateQueuedBaseWire(authority(), proxy)).toThrow('Accounting group payload unavailable'); expect(calls).toBe(0);
    const large = wire(); large.baseTransport.headers = { 'x-large': 'x'.repeat(300000) };
    expect(() => validateQueuedBaseWire(authority(), large)).toThrow('Accounting group payload unavailable');
  });
});
