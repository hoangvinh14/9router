import { beforeAll, describe, expect, it } from 'vitest';
import adapter from '../../open-sse/handlers/embeddingProviders/gemini.js';
import { PROVIDER_MEDIA } from '../../open-sse/providers/index.js';
let validateGeminiEmbeddingAuthority;
beforeAll(async () => ({ validateGeminiEmbeddingAuthority } = await import('@/lib/apiKeyBudget/geminiEmbeddingAuthority.js')));
function input() {
  const model = 'gemini-embedding-001', original = { model, input: 'fixture original' }, credentials = { apiKey: 'fixture-private-key' };
  const actual = adapter.buildBody(model, original);
  return { authority: { provider: 'gemini', model, connectionId: 'connection-a',
    connection: { id: 'connection-a', provider: 'gemini', authType: 'apikey', isActive: 1, data: JSON.stringify({ apiKey: credentials.apiKey, providerSpecificData: {} }) },
    settings: JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: 'http://fixture-proxy.invalid:3210', outboundNoProxy: '' }), proxyPool: null },
    image: { model, original, actual, mediaConfig: PROVIDER_MEDIA.gemini.embeddingConfig, credentials,
      headers: adapter.buildHeaders(credentials), url: adapter.buildUrl(model, credentials, { input: original.input }), serialized: JSON.stringify(actual),
      proxyOptions: { persistedGlobalProxy: { url: 'http://fixture-proxy.invalid:3210', noProxy: '' } } } };
}
function positive() { const p = input(); expect(validateGeminiEmbeddingAuthority(p.authority, p.image)).toEqual(p.image); }
describe('persisted Gemini embedding image equality, not source provenance/freshness/dispatch grant', () => {
  it('whole selected API-key model and saved route equals private original wire', () => { positive(); });
  it.each(['key', 'model', 'connection-id', 'connection-provider', 'inactive', 'oauth', 'custom-psd', 'saved-url', 'saved-disabled', 'override', 'json-invalid'])('rejects %s after accepted positive', fault => {
    positive(); const p = input(), connection = JSON.parse(p.authority.connection.data), settings = JSON.parse(p.authority.settings);
    if (fault === 'key') connection.apiKey = 'changed';
    else if (fault === 'model') p.authority.model = 'changed';
    else if (fault === 'connection-id') p.authority.connectionId = 'changed';
    else if (fault === 'connection-provider') p.authority.connection.provider = 'openai';
    else if (fault === 'inactive') p.authority.connection.isActive = 0;
    else if (fault === 'oauth') connection.accessToken = 'fixture-oauth';
    else if (fault === 'custom-psd') connection.providerSpecificData.customUrl = 'https://fixture.invalid';
    else if (fault === 'saved-url') settings.outboundProxyUrl = 'http://changed.invalid:3210';
    else if (fault === 'saved-disabled') settings.outboundProxyEnabled = false;
    else if (fault === 'override') settings.providerOverrides = { gemini: { headers: { extra: 'changed' } } };
    p.authority.connection.data = fault === 'json-invalid' ? '{' : JSON.stringify(connection); p.authority.settings = JSON.stringify(settings);
    expect(() => validateGeminiEmbeddingAuthority(p.authority, p.image)).toThrow('Gemini embedding authority unavailable');
  });
  it.each(['authority-getter', 'image-getter', 'proxy', 'oversize'])('descriptor/bounds %s zero programmable reads', fault => {
    positive(); const p = input(); let reads = 0; const trap = () => { reads++; throw new Error('fixture-private-key'); };
    if (fault === 'authority-getter') Object.defineProperty(p.authority.connection, 'data', { enumerable: true, get: trap });
    else if (fault === 'image-getter') Object.defineProperty(p.image, 'credentials', { enumerable: true, get: trap });
    else if (fault === 'proxy') p.authority = new Proxy(p.authority, { get: trap, ownKeys: trap });
    else p.authority.extra = 'x'.repeat(262145);
    expect(() => validateGeminiEmbeddingAuthority(p.authority, p.image)).toThrow('Gemini embedding authority unavailable'); expect(reads).toBe(0);
  });
});
