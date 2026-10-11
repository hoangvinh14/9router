import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import adapter from '../../open-sse/handlers/embeddingProviders/gemini.js';
import { PROVIDER_MEDIA } from '../../open-sse/providers/index.js';
import { captureAccountingProxyEnvironment } from '../../open-sse/config/accountedProxyEnvironment.js';
let validateQueuedGeminiEmbeddingWire;
beforeAll(async () => ({ validateQueuedGeminiEmbeddingWire } = await import('@/lib/apiKeyBudget/queuedGeminiEmbeddingWire.js')));
afterEach(() => vi.unstubAllEnvs());
function input(batch = false) {
  const model = 'gemini-embedding-001', original = { model, input: batch ? ['first fixture', 'second fixture'] : 'fixture original', dimensions: 3 };
  const credentials = { apiKey: 'fixture-private-key', providerSpecificData: {} };
  const actual = adapter.buildBody(model, original);
  const proxyOptions = { persistedGlobalProxy: { url: 'http://fixture-proxy.invalid:3210', noProxy: '' } };
  const image = { model, original, actual, mediaConfig: PROVIDER_MEDIA.gemini.embeddingConfig, credentials,
    headers: adapter.buildHeaders(credentials), url: adapter.buildUrl(model, credentials, { input: original.input }),
    serialized: JSON.stringify(actual), proxyOptions };
  return { authority: { provider: 'gemini', model, connectionId: 'connection-a',
    connection: { id: 'connection-a', provider: 'gemini', authType: 'apikey', isActive: 1,
      data: JSON.stringify({ apiKey: credentials.apiKey, providerSpecificData: {} }) },
    settings: JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: proxyOptions.persistedGlobalProxy.url, outboundNoProxy: '' }), proxyPool: null },
    wire: { protocol: 'native-gemini-embeddings', geminiEmbeddingTransport: image, proxyEnvironment: captureAccountingProxyEnvironment() } };
}
function positive() {
  const p = input(); const retained = validateQueuedGeminiEmbeddingWire(p.authority, p.wire);
  expect(retained).toEqual(p.wire); expect(Object.isFrozen(retained)).toBe(true);
  expect(Object.isFrozen(retained.geminiEmbeddingTransport.original)).toBe(true);
  return p;
}
describe('queued Gemini embedding complete prepared-wire equality, not origin/selection/ACK/POST grant', () => {
  it.each([false, true])('single/batch %s keeps complete original/actual/query-key/config/proxy image detached', batch => {
    const p = input(batch), retained = validateQueuedGeminiEmbeddingWire(p.authority, p.wire);
    expect(retained).toEqual(p.wire); p.wire.geminiEmbeddingTransport.original.input = 'changed';
    expect(retained.geminiEmbeddingTransport.original.input).toEqual(batch ? ['first fixture', 'second fixture'] : 'fixture original');
    expect(Object.isFrozen(retained.geminiEmbeddingTransport.credentials)).toBe(true);
  });
  it.each(['protocol', 'extra-envelope', 'missing-environment', 'key', 'model', 'connection-id', 'oauth', 'inactive',
    'headers', 'url', 'actual', 'original-extra', 'config', 'saved-disabled', 'saved-url', 'override', 'psd', 'malformed-json'])('refuses %s after accepted positive with fixed private-safe error', fault => {
    positive(); const p = input(), image = p.wire.geminiEmbeddingTransport;
    const connection = JSON.parse(p.authority.connection.data), settings = JSON.parse(p.authority.settings);
    if (fault === 'protocol') p.wire.protocol = 'native-gemini';
    if (fault === 'extra-envelope') p.wire.extra = 'fixture-private-key';
    if (fault === 'missing-environment') delete p.wire.proxyEnvironment;
    if (fault === 'key') connection.apiKey = 'changed';
    if (fault === 'model') p.authority.model = 'changed';
    if (fault === 'connection-id') p.authority.connectionId = 'changed';
    if (fault === 'oauth') connection.accessToken = 'fixture-private-oauth';
    if (fault === 'inactive') p.authority.connection.isActive = 0;
    if (fault === 'headers') image.headers.extra = 'fixture-private-key';
    if (fault === 'url') image.url += '&extra=fixture-private-key';
    if (fault === 'actual') { image.actual.content.parts[0].text = 'changed'; image.serialized = JSON.stringify(image.actual); }
    if (fault === 'original-extra') image.original.metadata = { erased: true };
    if (fault === 'config') image.mediaConfig = { ...image.mediaConfig, authHeader: 'changed' };
    if (fault === 'saved-disabled') settings.outboundProxyEnabled = false;
    if (fault === 'saved-url') settings.outboundProxyUrl = 'http://changed.invalid:3210';
    if (fault === 'override') settings.providerOverrides = { gemini: { headers: { extra: 'fixture-private-key' } } };
    if (fault === 'psd') connection.providerSpecificData.customUrl = 'https://fixture-private.invalid';
    p.authority.connection.data = fault === 'malformed-json' ? '{' : JSON.stringify(connection);
    p.authority.settings = JSON.stringify(settings);
    expect(() => validateQueuedGeminiEmbeddingWire(p.authority, p.wire)).toThrow('Queued Gemini embedding wire unavailable');
  });
  it('environment reread refuses drift without manufacturing a replacement route', () => {
    positive(); const p = input(); vi.stubEnv('HTTPS_PROXY', 'http://changed.invalid:3210');
    expect(() => validateQueuedGeminiEmbeddingWire(p.authority, p.wire)).toThrow('Queued Gemini embedding wire unavailable');
  });
  it.each(['authority-getter', 'wire-getter', 'proxy', 'oversize', 'decoded-forbidden', 'decoded-depth'])('aggregate guarded %s never executes programmable reads', fault => {
    positive(); const p = input(); let reads = 0; const trap = () => { reads++; throw new Error('fixture-private-key'); };
    if (fault === 'authority-getter') Object.defineProperty(p.authority.connection, 'data', { enumerable: true, get: trap });
    if (fault === 'wire-getter') Object.defineProperty(p.wire, 'geminiEmbeddingTransport', { enumerable: true, get: trap });
    if (fault === 'proxy') p.authority = new Proxy(p.authority, { get: trap, ownKeys: trap, getPrototypeOf: trap });
    if (fault === 'oversize') p.wire.extra = 'x'.repeat(262145);
    if (fault === 'decoded-forbidden') p.authority.settings = '{"outboundProxyEnabled":true,"outboundProxyUrl":"http://fixture-proxy.invalid:3210","nested":{"constructor":"fixture-private-key"}}';
    if (fault === 'decoded-depth') { let value = {}; for (let i = 0; i < 18; i++) value = { nested: value }; p.authority.settings = JSON.stringify(value); }
    expect(() => validateQueuedGeminiEmbeddingWire(p.authority, p.wire)).toThrow('Queued Gemini embedding wire unavailable'); expect(reads).toBe(0);
  });
});
