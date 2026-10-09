import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '../../open-sse/config/providers.js';
import { captureAccountingBaseTransport } from '../../open-sse/config/accountedBaseTransport.js';
import { snapshotAccountingPreparedData, snapshotAccountingBaseDispatch, validateAccountingBaseDispatch } from '../../open-sse/config/accountedBaseDispatch.js';
const evidence = () => ({ provider: 'openai', baseTransport: captureAccountingBaseTransport(PROVIDERS.openai), urlIndex: 0, runtimeTransport: null });

describe('bounded internal Base dispatch equality evidence (not authority or host sandbox)', () => {
  it('whole prepared wire headers/options/overrides detached and frozen before exposure', () => {
    const input = { headers: { Authorization: 'Bearer dummy-provider' }, proxyOptions: { persistedGlobalProxy: { url: 'http://dummy.invalid' } },
      providerOverrides: { headers: { 'x-dummy': 'fixture' } } };
    const result = snapshotAccountingPreparedData(input);
    expect(result).toEqual(input);
    for (const value of [result, result.headers, result.proxyOptions.persistedGlobalProxy, result.providerOverrides.headers]) expect(Object.isFrozen(value)).toBe(true);
    input.headers.Authorization = 'changed'; input.proxyOptions.persistedGlobalProxy.url = 'changed'; input.providerOverrides.headers['x-dummy'] = 'changed';
    expect(result.headers.Authorization).toBe('Bearer dummy-provider'); expect(result.proxyOptions.persistedGlobalProxy.url).toBe('http://dummy.invalid');
    expect(() => snapshotAccountingPreparedData({ headers: { 'x-large': 'x'.repeat(300000) } })).toThrow('Accounting Base transport unavailable');
  });
  it('canonical snapshot is detached and frozen; validates original registry URL', () => {
    const input = evidence(), result = snapshotAccountingBaseDispatch(input);
    expect(result).toEqual(input); expect(result.baseTransport).not.toBe(input.baseTransport); expect(Object.isFrozen(result.baseTransport)).toBe(true);
    input.baseTransport.baseUrl = 'changed'; expect(validateAccountingBaseDispatch(result, PROVIDERS.openai.baseUrl)).toEqual(result);
  });
  it.each(['root', 'nested', 'revoked'])('%s Proxy refused before traps', kind => {
    let calls = 0; const traps = { ownKeys() { calls++; throw new Error('trap'); }, getPrototypeOf() { calls++; throw new Error('trap'); } };
    let input = evidence();
    if (kind === 'root') input = new Proxy(input, traps);
    else if (kind === 'nested') input.baseTransport = new Proxy({}, traps);
    else { const revoked = Proxy.revocable({}, traps); revoked.revoke(); input.baseTransport = revoked.proxy; }
    expect(() => snapshotAccountingBaseDispatch(input)).toThrow('Accounting Base transport unavailable'); expect(calls).toBe(0);
  });
  it('accessor, callback, custom prototype, cycle and symbol are not evidence', () => {
    let calls = 0; const getter = evidence(); Object.defineProperty(getter.baseTransport, 'headers', { enumerable: true, get() { calls++; return {}; } });
    expect(() => snapshotAccountingBaseDispatch(getter)).toThrow(); expect(calls).toBe(0);
    const callback = evidence(); callback.baseTransport.headers = () => { calls++; };
    const prototype = evidence(); prototype.baseTransport = Object.create({});
    const cycle = evidence(); cycle.baseTransport.headers = cycle;
    const symbol = evidence(); symbol[Symbol('hidden')] = null;
    for (const input of [callback, prototype, cycle, symbol]) expect(() => snapshotAccountingBaseDispatch(input)).toThrow('Accounting Base transport unavailable');
    expect(calls).toBe(0);
  });
  it('byte, depth and node ceilings refuse oversized evidence', () => {
    const large = evidence(); large.baseTransport.headers = { large: 'x'.repeat(300000) };
    const deep = evidence(); let cursor = deep.baseTransport; for (let i = 0; i < 20; i++) cursor = cursor.nested = {};
    const many = evidence(); many.baseTransport.headers = Array.from({ length: 10001 }, () => null);
    for (const input of [large, deep, many]) expect(() => snapshotAccountingBaseDispatch(input)).toThrow('Accounting Base transport unavailable');
  });
  it('exact envelope keys/provider required; sparse arrays/nonfinite/undefined refused', () => {
    const missing = evidence(); delete missing.runtimeTransport;
    const extra = { ...evidence(), callback: null };
    const foreign = { ...evidence(), provider: 'anthropic' };
    const sparse = evidence(); sparse.baseTransport.baseUrls = new Array(2);
    for (const input of [missing, extra, foreign, sparse, { ...evidence(), urlIndex: Infinity }, { ...evidence(), runtimeTransport: undefined }]) expect(() => snapshotAccountingBaseDispatch(input)).toThrow('Accounting Base transport unavailable');
  });
});
