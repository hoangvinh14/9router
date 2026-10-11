import { beforeAll, describe, it, expect } from 'vitest';
import { PROVIDERS } from '../../open-sse/config/providers.js';
let capture, validate;
beforeAll(async () => ({ captureUnhealthyChatDispatch: capture, validateUnhealthyChatDispatch: validate } =
  await import('../../open-sse/config/accountedUnhealthyChatDispatch.js')));
const input = () => {
  const body = { model: 'fixture-model', stream: false, messages: [{ role: 'user', content: 'fixture original' }] };
  return { provider: 'openai', model: body.model, body, config: structuredClone(PROVIDERS.openai),
    credentials: { apiKey: 'fixture-key', accessToken: null }, proxyOptions: null, providerOverrides: null,
    url: PROVIDERS.openai.baseUrl, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-key' },
    serialized: JSON.stringify(body) };
};
describe('unwired unhealthy Chat complete original/prepared dispatch, no persisted proof or ACK grant', () => {
  it('accepts detached complete canonical evidence and checks the exact POST', () => {
    const source = input(), retained = capture(source);
    expect(Object.isFrozen(retained)).toBe(true); expect(Object.isFrozen(retained.body.messages[0])).toBe(true);
    expect(() => validate(retained, source.url, { method: 'POST', headers: source.headers, body: source.serialized, redirect: 'error' }, source.proxyOptions)).not.toThrow();
    source.body.messages[0].content = 'changed'; expect(retained.body.messages[0].content).toBe('fixture original');
  });
  it.each(['body', 'url', 'token', 'headers', 'config', 'oauth', 'proxy', 'override', 'getter', 'oversized'])('capture refuses unsupported or inconsistent full %s evidence before exposure', kind => {
    expect(() => capture(input())).not.toThrow(); const source = input(); let reads = 0;
    if (kind === 'body') source.serialized = JSON.stringify({ ...source.body, temperature: 0 });
    if (kind === 'url') source.url = 'https://fixture.invalid/chat';
    if (kind === 'token') source.headers.Authorization = 'Bearer other';
    if (kind === 'headers') source.headers['X-Fixture'] = 'unsupported';
    if (kind === 'config') source.config.baseUrl = 'https://fixture.invalid/chat';
    if (kind === 'oauth') source.credentials.accessToken = 'fixture-oauth';
    if (kind === 'proxy') source.proxyOptions = { unknown: true };
    if (kind === 'override') source.providerOverrides = { headers: { 'X-Fixture': 'unsupported' } };
    if (kind === 'getter') Object.defineProperty(source.credentials, 'apiKey', { enumerable: true, get() { reads++; return 'fixture-key'; } });
    if (kind === 'oversized') source.credentials.fixture = 'x'.repeat(262145);
    expect(() => capture(source)).toThrow(); expect(reads).toBe(0);
  });
  it.each(['unknown-credential', 'custom-url', 'relay', 'connection-proxy', 'pool', 'unknown-specific', 'getter-specific'])('rejects complete credential envelope %s before exposure', mode => {
    const positive = input();
    positive.credentials = { ...positive.credentials, authType: 'apikey', connectionId: 'fixture-connection', connectionName: 'fixture-name',
      rawHeaders: { 'user-agent': 'fixture-client' }, providerSpecificData: {
        connectionProxyEnabled: false, connectionProxyUrl: '', connectionNoProxy: '', connectionProxyPoolId: null, vercelRelayUrl: '', proxyPoolId: '__none__' } };
    expect(() => capture(positive)).not.toThrow();
    const source = structuredClone(positive); let reads = 0;
    if (mode === 'unknown-credential') source.credentials.fixtureUnknown = 'unprocessed';
    if (mode === 'custom-url') source.credentials.providerSpecificData.baseUrl = 'https://fixture.invalid';
    if (mode === 'relay') source.credentials.providerSpecificData.vercelRelayUrl = 'https://fixture.invalid';
    if (mode === 'connection-proxy') source.credentials.providerSpecificData.connectionProxyEnabled = true;
    if (mode === 'pool') source.credentials.providerSpecificData.connectionProxyPoolId = 'unproved-pool';
    if (mode === 'unknown-specific') source.credentials.providerSpecificData.fixtureUnknown = 'unprocessed';
    if (mode === 'getter-specific') Object.defineProperty(source.credentials.providerSpecificData, 'baseUrl', { enumerable: true, get() { reads++; return 'https://fixture.invalid'; } });
    expect(() => capture(source)).toThrow(); expect(reads).toBe(0);
  });
  it.each(['body', 'token', 'redirect', 'method', 'proxy', 'getter'])('dispatch refuses current %s drift against retained evidence', kind => {
    const source = input(), retained = capture(source);
    const init = { method: 'POST', headers: source.headers, body: source.serialized, redirect: 'error' }; let reads = 0;
    expect(() => validate(retained, source.url, init, null)).not.toThrow();
    if (kind === 'body') init.body = JSON.stringify({ ...source.body, model: 'other' });
    if (kind === 'token') init.headers.Authorization = 'Bearer other';
    if (kind === 'redirect') init.redirect = 'follow';
    if (kind === 'method') init.method = 'GET';
    if (kind === 'getter') Object.defineProperty(init, 'body', { enumerable: true, get() { reads++; return source.serialized; } });
    expect(() => validate(retained, source.url, init, kind === 'proxy' ? { unknown: true } : null)).toThrow();
    expect(reads).toBe(0);
  });
});
