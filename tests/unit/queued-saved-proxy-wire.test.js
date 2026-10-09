import { describe, expect, it } from 'vitest';
import { validateQueuedSavedProxyWire } from '@/lib/apiKeyBudget/queuedSavedProxyWire.js';
const authority = (settings = {}, specific = {}, proxyPool = null) => ({ settings: JSON.stringify(settings), connection: { data: JSON.stringify({ providerSpecificData: specific }) }, proxyPool });
const globalSettings = { outboundProxyEnabled: true, outboundProxyUrl: 'http://dummy-global.invalid', outboundNoProxy: 'localhost' };
const globalOptions = { persistedGlobalProxy: { url: 'http://dummy-global.invalid/', noProxy: 'localhost' } };
const legacy = { connectionProxyEnabled: true, connectionProxyUrl: 'http://dummy-legacy.invalid', connectionNoProxy: 'localhost' };
const legacyOptions = { ...legacy, strictProxy: false, proxyPoolId: null };
describe('original saved global/legacy policy equality, not environment/dispatch authority', () => {
  it('valid global policy is detached frozen and requires explicit prepared saved envelope', () => {
    const result = validateQueuedSavedProxyWire(authority(globalSettings), globalOptions);
    expect(result).toEqual(globalOptions); expect(result).not.toBe(globalOptions); expect(Object.isFrozen(result.persistedGlobalProxy)).toBe(true);
    expect(() => validateQueuedSavedProxyWire(authority(globalSettings), null)).toThrow();
  });
  it.each(['url', 'noProxy'])('changed saved global %s refuses old envelope', field => {
    const changed = { ...globalSettings, [field === 'url' ? 'outboundProxyUrl' : 'outboundNoProxy']: field === 'url' ? 'http://changed.invalid' : 'different.invalid' };
    expect(() => validateQueuedSavedProxyWire(authority(changed), globalOptions)).toThrow();
  });
  it('disabled saved global policy never permits leftover caller saved proof', () => {
    expect(() => validateQueuedSavedProxyWire(authority({ outboundProxyEnabled: false }), globalOptions)).toThrow();
  });
  it('legacy original route matches saved connection exactly, canonical origin only', () => {
    expect(validateQueuedSavedProxyWire(authority({}, legacy), legacyOptions)).toEqual(legacyOptions);
    expect(validateQueuedSavedProxyWire(authority({}, legacy), { ...legacyOptions, connectionProxyUrl: legacy.connectionProxyUrl + '/' })).toBeTruthy();
  });
  it.each(['connectionProxyUrl', 'connectionNoProxy', 'connectionProxyEnabled'])('legacy changed %s refuses stale original resolved route', field => {
    const change = field === 'connectionProxyUrl' ? 'http://changed.invalid' : field === 'connectionNoProxy' ? 'changed.invalid' : false;
    expect(() => validateQueuedSavedProxyWire(authority({}, { ...legacy, [field]: change }), legacyOptions)).toThrow();
  });
  it('saved global and legacy precedence both retain their separate original equality', () => {
    const both = { ...legacyOptions, ...globalOptions };
    expect(validateQueuedSavedProxyWire(authority(globalSettings, legacy), both)).toEqual(both);
    expect(() => validateQueuedSavedProxyWire(authority(globalSettings, { ...legacy, connectionProxyUrl: 'http://changed.invalid' }), both)).toThrow();
  });
  it.each([{ outboundProxyUrl: 'socks5://dummy.invalid' }, { outboundProxyUrl: 'http://dummy.invalid/path' }, { outboundProxyEnabled: 'true' }])('unsupported saved global material refuses %#', change => {
    expect(() => validateQueuedSavedProxyWire(authority({ ...globalSettings, ...change }), globalOptions)).toThrow();
  });
  it('missing selected pool is not permission to fall back to matching legacy/global/direct', () => {
    expect(() => validateQueuedSavedProxyWire(authority(globalSettings, { ...legacy, proxyPoolId: 'p' }), { ...legacyOptions, ...globalOptions })).toThrow();
  });
  it('relay, invented pool and strict/unavailable legacy envelope refuse', () => {
    for (const change of [{ vercelRelayUrl: 'http://dummy-relay.invalid' }, { proxyPoolId: 'p' }, { strictProxy: true }, { proxyPoolUnavailable: true }]) {
      expect(() => validateQueuedSavedProxyWire(authority({}, legacy), { ...legacyOptions, ...change })).toThrow();
    }
  });
  it('selected pool does not erase original saved global policy equality', () => {
    expect(validateQueuedSavedProxyWire(authority(globalSettings, { proxyPoolId: 'p' }, { id: 'p' }), globalOptions)).toBeTruthy();
    expect(() => validateQueuedSavedProxyWire(authority(globalSettings, { proxyPoolId: 'p' }, { id: 'p' }), null)).toThrow();
  });
  it('no saved policy is an equality result only, never environment/direct authorization', () => {
    expect(validateQueuedSavedProxyWire(authority(), null)).toBeNull();
    expect(() => validateQueuedSavedProxyWire(authority(), legacyOptions)).toThrow();
  });
});
