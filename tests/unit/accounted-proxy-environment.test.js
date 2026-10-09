import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNTED_PROXY_ENV_KEYS, captureAccountingProxyEnvironment, validateAccountingProxyEnvironment } from '../../open-sse/config/accountedProxyEnvironment.js';
beforeEach(() => { for (const key of ACCOUNTED_PROXY_ENV_KEYS) vi.stubEnv(key, undefined); });
afterEach(() => vi.unstubAllEnvs());
describe('bounded exact proxy environment equality only, not routing or activation', () => {
  it('absent state is frozen and unchanged validates without environment mutation', () => {
    const evidence = captureAccountingProxyEnvironment();
    expect(Object.isFrozen(evidence)).toBe(true); expect(Object.values(evidence).every(value => value === null)).toBe(true);
    expect(validateAccountingProxyEnvironment(evidence)).toEqual(evidence);
    for (const key of ACCOUNTED_PROXY_ENV_KEYS) expect(process.env[key]).toBeUndefined();
  });
  it('present-empty differs from absence and lower/uppercase/provenance are independent', () => {
    const absent = captureAccountingProxyEnvironment(); vi.stubEnv('HTTP_PROXY', '');
    expect(() => validateAccountingProxyEnvironment(absent)).toThrow();
    const present = captureAccountingProxyEnvironment(); expect(present.HTTP_PROXY).toBe(''); expect(present.http_proxy).toBeNull();
    expect(validateAccountingProxyEnvironment(present)).toEqual(present);
  });
  it.each(ACCOUNTED_PROXY_ENV_KEYS)('%s mutation refuses stale exact evidence', key => {
    const evidence = captureAccountingProxyEnvironment(); vi.stubEnv(key, key.includes('PROXY_MANAGED') ? '1' : 'dummy-proxy-value');
    expect(() => validateAccountingProxyEnvironment(evidence)).toThrow('Accounting proxy environment unavailable');
  });
  it('captures original dummy proxy bytes without normalization/reselection', () => {
    vi.stubEnv('HTTP_PROXY', ' http://dummy.invalid:8080/ '); vi.stubEnv('NO_PROXY', 'localhost, .fixture.invalid');
    const evidence = captureAccountingProxyEnvironment();
    expect(evidence.HTTP_PROXY).toBe(' http://dummy.invalid:8080/ '); expect(validateAccountingProxyEnvironment(evidence)).toEqual(evidence);
    vi.stubEnv('HTTP_PROXY', 'http://dummy.invalid:8080/'); expect(() => validateAccountingProxyEnvironment(evidence)).toThrow();
  });
  it.each(['x'.repeat(8193), 'dummy\nproxy', 'dummy\rproxy', 'dummy\0proxy'])('unbounded/control environment refuses %#', value => {
    // Node truncates NUL env strings; newline and byte ceilings remain native
    // capture checks, and NUL is checked against explicit detached evidence.
    if (value.includes('\0')) {
      expect(() => validateAccountingProxyEnvironment({ ...captureAccountingProxyEnvironment(), HTTP_PROXY: value })).toThrow();
    } else { vi.stubEnv('HTTP_PROXY', value); expect(captureAccountingProxyEnvironment).toThrow(); }
  });
  it('unknown/missing/accessor/proxy evidence refuses without executing callbacks', () => {
    const evidence = captureAccountingProxyEnvironment(), getter = vi.fn(() => null), trap = vi.fn(() => { throw new Error('Proxy executed'); });
    expect(() => validateAccountingProxyEnvironment({ ...evidence, unknown: null })).toThrow();
    const missing = { ...evidence }; delete missing.HTTP_PROXY; expect(() => validateAccountingProxyEnvironment(missing)).toThrow();
    const accessor = { ...evidence }; Object.defineProperty(accessor, 'HTTP_PROXY', { get: getter, enumerable: true });
    expect(() => validateAccountingProxyEnvironment(accessor)).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(() => validateAccountingProxyEnvironment(new Proxy(evidence, { ownKeys: trap }))).toThrow('Accounting proxy environment unavailable'); expect(trap).not.toHaveBeenCalled();
  });
});
