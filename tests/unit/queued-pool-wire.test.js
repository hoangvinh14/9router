import { describe, expect, it } from 'vitest';
import { validateQueuedSelectedPoolWire } from '@/lib/apiKeyBudget/queuedPoolWire.js';

const authority = (pool = {}, row = {}, connection = {}) => ({
  connection: { data: JSON.stringify({ providerSpecificData: { proxyPoolId: 'p' }, ...connection }) },
  proxyPool: { id: 'p', isActive: 1, data: JSON.stringify({ proxyUrl: 'http://dummy.invalid:8080', noProxy: '', strictProxy: true, type: 'http', ...pool }), ...row }
});
const options = change => ({ proxyPoolId: 'p', connectionProxyEnabled: true, connectionProxyUrl: 'http://dummy.invalid:8080',
  connectionNoProxy: '', strictProxy: true, proxyPoolUnavailable: false, vercelRelayUrl: '', ...change });
describe('selected saved HTTP(S) pool and original resolved equality, not global/dispatch authority', () => {
  it('unchanged selected original route is detached/frozen', () => {
    const input = options(), result = validateQueuedSelectedPoolWire(authority(), input);
    expect(result).toEqual(input); expect(result).not.toBe(input); expect(Object.isFrozen(result)).toBe(true);
  });
  it('canonical root slash only can normalize without changing proxy origin', () => {
    expect(validateQueuedSelectedPoolWire(authority(), options({ connectionProxyUrl: 'http://dummy.invalid:8080/' }))).toBeTruthy();
  });
  it.each([
    { connectionProxyUrl: 'http://dummy-new.invalid:8080' }, { connectionNoProxy: 'different.invalid' },
    { strictProxy: false }, { proxyPoolId: 'another' }, { connectionProxyEnabled: false },
    { proxyPoolUnavailable: true }, { vercelRelayUrl: 'http://dummy-relay.invalid' }
  ])('changed selected resolved material refuses %#', change => {
    expect(() => validateQueuedSelectedPoolWire(authority(), options(change))).toThrow();
  });
  it.each([{ type: 'socks5' }, { type: 'vercel' }, { proxyUrl: '' }, { proxyUrl: 'http://dummy.invalid/path' }])('unsupported saved pool refuses %#', change => {
    expect(() => validateQueuedSelectedPoolWire(authority(change), options())).toThrow();
  });
  it('inactive/missing/changed pool cannot silently grant old proxy or direct fallback', () => {
    expect(() => validateQueuedSelectedPoolWire(authority({}, { isActive: 0 }), options())).toThrow();
    expect(() => validateQueuedSelectedPoolWire({ ...authority(), proxyPool: null }, options())).toThrow();
    expect(() => validateQueuedSelectedPoolWire(authority({ proxyUrl: 'http://changed.invalid' }), options())).toThrow();
  });
  it('connection must pin same selected pool, not no-pool or stale selection', () => {
    expect(() => validateQueuedSelectedPoolWire(authority({}, {}, { providerSpecificData: { proxyPoolId: '__none__' } }), options())).toThrow();
    expect(() => validateQueuedSelectedPoolWire(authority({}, {}, { providerSpecificData: { proxyPoolId: 'another' } }), options())).toThrow();
  });
  it('optional independently saved pool proof also matches original resolved material', () => {
    const saved = { id: 'p', url: 'http://dummy.invalid:8080/', noProxy: '', strictProxy: true, type: 'http', isActive: true };
    expect(validateQueuedSelectedPoolWire(authority(), options({ persistedPoolProxy: saved }))).toBeTruthy();
    expect(() => validateQueuedSelectedPoolWire(authority(), options({ persistedPoolProxy: { ...saved, url: 'http://changed.invalid/' } }))).toThrow();
  });
});
