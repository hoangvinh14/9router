import { beforeAll, describe, expect, it } from 'vitest';
import { PROVIDERS } from 'open-sse/config/providers.js';
import { captureAccountingCommandCodeConfig } from 'open-sse/config/accountedCommandCodeDispatch.js';
import { captureAccountingProxyEnvironment } from 'open-sse/config/accountedProxyEnvironment.js';
let validateWire;
beforeAll(async () => { ({ validateQueuedCommandCodeWire: validateWire } = await import('@/lib/apiKeyBudget/queuedCommandCodeWire.js')); });
const model = 'deepseek/deepseek-v4-pro', sessionId = '22222222-2222-4222-8222-222222222222';
const connection = () => ({ id: 'fixture-connection', provider: 'commandcode', apiKey: 'dummy-api-key', providerSpecificData: {} });
const authority = () => ({ provider: 'commandcode', model, connection: { id: 'fixture-connection', data: JSON.stringify(connection()) }, settings: '{}' });
const original = () => ({ threadId: '11111111-1111-4111-8111-111111111111', memory: '',
  config: { workingDir: '/fixture/workspace', date: '2026-10-10', environment: 'linux', structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
  params: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } });
const wire = () => ({ protocol: 'native-commandcode', url: 'https://api.commandcode.ai/alpha/generate',
  headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: 'Bearer dummy-api-key', ...PROVIDERS.commandcode.headers, 'x-session-id': sessionId },
  credentials: { apiKey: 'dummy-api-key', accessToken: null, connectionId: 'fixture-connection', providerSpecificData: {} },
  providerOverrides: null, proxyOptions: null, proxyEnvironment: captureAccountingProxyEnvironment(),
  commandCodeTransport: { model, mode: 'native-commandcode-ndjson', commandCodeConfig: captureAccountingCommandCodeConfig(PROVIDERS.commandcode), sessionId, serializedBody: JSON.stringify(original()) } });
describe('queued CommandCode original wire persisted equality (not coordinator or native dispatch certification)', () => {
  it('detaches and freezes full original body/config/credential/header evidence without rebuilding', () => {
    const input = wire(), result = validateWire(authority(), input);
    expect(result).toEqual(input); expect(result).not.toBe(input); expect(Object.isFrozen(result.credentials.providerSpecificData)).toBe(true);
    input.headers.Authorization = 'changed'; input.credentials.apiKey = 'changed'; expect(result.headers.Authorization).toBe('Bearer dummy-api-key');
  });
  it.each(['saved-key', 'header-key', 'access-fallback', 'connection', 'provider-data', 'provider', 'model', 'metadata', 'session', 'missing-env', 'overrides', 'duplicate-header', 'unknown-envelope'])('%s refuses unchanged original binding rather than rebuilding', kind => {
    const current = authority(), input = wire(); expect(validateWire(current, input)).toEqual(input);
    if (kind === 'saved-key') { const data = connection(); data.apiKey = 'dummy-rotated'; current.connection.data = JSON.stringify(data); }
    if (kind === 'header-key') input.headers.Authorization = 'Bearer dummy-stale';
    if (kind === 'access-fallback') { const data = connection(); delete data.apiKey; data.accessToken = 'dummy-access'; current.connection.data = JSON.stringify(data); input.credentials.apiKey = null; input.credentials.accessToken = 'dummy-access'; input.headers.Authorization = 'Bearer dummy-access'; }
    if (kind === 'connection') input.credentials.connectionId = 'different';
    if (kind === 'provider-data') { const data = connection(); data.providerSpecificData = { device: 'changed' }; current.connection.data = JSON.stringify(data); }
    if (kind === 'provider') current.provider = 'openai';
    if (kind === 'model') current.model = 'unknown';
    if (kind === 'metadata') { const body = JSON.parse(input.commandCodeTransport.serializedBody); body.metadata = {}; input.commandCodeTransport.serializedBody = JSON.stringify(body); }
    if (kind === 'session') input.headers['x-session-id'] = '33333333-3333-4333-8333-333333333333';
    if (kind === 'missing-env') delete input.proxyEnvironment;
    if (kind === 'overrides') current.settings = JSON.stringify({ providerOverrides: { commandcode: { headers: { 'x-cli-environment': 'other' } } } });
    if (kind === 'duplicate-header') input.headers.authorization = input.headers.Authorization;
    if (kind === 'unknown-envelope') input.extra = true;
    expect(() => validateWire(current, input)).toThrow();
  });
  it('saved global route is independently bound; equal environment is not route permission', () => {
    const current = authority(), input = wire(); current.settings = JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: 'http://dummy-proxy.invalid:3210', outboundNoProxy: 'fixture.invalid' });
    input.proxyOptions = { persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: 'fixture.invalid' } };
    expect(validateWire(current, input)).toEqual(input); input.proxyOptions.persistedGlobalProxy.noProxy = '*';
    expect(() => validateWire(current, input)).toThrow('Queued saved proxy wire unavailable');
  });
  it('plain guard precedes programmable wire reads or header coercion', () => {
    const input = wire(); let hits = 0;
    Object.defineProperty(input.headers, 'Authorization', { enumerable: true, get() { hits++; throw new Error('do not run'); } });
    expect(() => validateWire(authority(), input)).toThrow(); expect(hits).toBe(0);
  });
});
