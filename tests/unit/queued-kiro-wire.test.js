import { beforeAll, describe, expect, it } from 'vitest';
import { PROVIDERS } from 'open-sse/config/providers.js';
import { captureAccountingKiroConfig } from 'open-sse/config/accountedKiroDispatch.js';
import { captureAccountingProxyEnvironment } from 'open-sse/config/accountedProxyEnvironment.js';
let validateWire;
beforeAll(async () => { ({ validateQueuedKiroWire: validateWire } = await import('@/lib/apiKeyBudget/queuedKiroWire.js')); });
const model = 'claude-sonnet-4.5', invocationId = '22222222-2222-4222-8222-222222222222';
const profileArn = 'arn:aws:codewhisperer:us-east-1:123456789012:profile/fixture';
// Real connToRow stores id/provider/authType in columns, not data JSON.
const connection = () => ({ apiKey: null,
  accessToken: 'dummy-api-key', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } });
const authority = () => ({ provider: 'kiro', model, connection: { id: 'fixture-connection', authType: 'apikey', data: JSON.stringify(connection()) }, settings: '{}' });
const original = () => ({ conversationState: { chatTriggerType: 'MANUAL', conversationId: '12345678-1234-4123-8123-123456789abc',
  currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: model, origin: 'AI_EDITOR' } }, history: [] },
  inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 } });
const wire = () => ({ protocol: 'native-kiro', url: 'https://q.us-east-1.amazonaws.com/generateAssistantResponse',
  headers: { ...PROVIDERS.kiro.headers, 'Amz-Sdk-Request': 'attempt=1; max=3', 'Amz-Sdk-Invocation-Id': invocationId,
    Authorization: 'Bearer dummy-api-key', TokenType: 'API_KEY', 'x-amz-sso-bearer': 'dummy-api-key',
    'x-amzn-kiro-agent-mode': 'spec', 'x-amzn-codewhisperer-machine-id': 'kiro-desktop' },
  credentials: { apiKey: null, accessToken: 'dummy-api-key', connectionId: 'fixture-connection', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } },
  providerOverrides: null, proxyOptions: null, proxyEnvironment: captureAccountingProxyEnvironment(),
  kiroTransport: { model, mode: 'native-kiro-eventstream', kiroConfig: captureAccountingKiroConfig(PROVIDERS.kiro), invocationId, serializedBody: JSON.stringify(original()) } });
describe('queued narrow Kiro Q API-key original wire equality (not owner/fallback/generation proof)', () => {
  it('detaches/freezes original full wire including caller work and persisted API-key access-token storage', () => {
    const input = wire(), result = validateWire(authority(), input);
    expect(result).toEqual(input); expect(result).not.toBe(input); expect(Object.isFrozen(result.credentials.providerSpecificData)).toBe(true);
    input.headers.Authorization = 'changed'; input.credentials.accessToken = 'changed';
    expect(result.headers.Authorization).toBe('Bearer dummy-api-key'); expect(result.credentials.accessToken).toBe('dummy-api-key');
  });
  it('explicit apiKey and SSO accessToken must select the same persisted token', () => {
    const current = authority(), input = wire(), data = connection(); data.apiKey = 'dummy-api-key';
    current.connection.data = JSON.stringify(data); input.credentials.apiKey = 'dummy-api-key';
    expect(validateWire(current, input)).toEqual(input);
  });
  it('preserves caller profile only when whole persisted profile and actual header match', () => {
    const current = authority(), input = wire(), data = connection(), body = original();
    body.profileArn = profileArn; data.providerSpecificData.profileArn = profileArn;
    current.connection.data = JSON.stringify(data); input.credentials.providerSpecificData.profileArn = profileArn;
    input.kiroTransport.serializedBody = JSON.stringify(body); input.headers['x-amzn-codewhisperer-profile-arn'] = profileArn;
    expect(validateWire(current, input)).toEqual(input);
    data.providerSpecificData.profileArn = profileArn.replace('/fixture', '/changed'); current.connection.data = JSON.stringify(data);
    expect(() => validateWire(current, input)).toThrow('Queued Kiro wire unavailable');
  });
  it.each(['saved-token', 'header-key', 'SSO', 'different-selected-key', 'missing-access', 'oauth', 'auth-method', 'missing-region', 'region',
    'connection', 'provider-data', 'provider', 'model', 'tools', 'invocation', 'missing-env', 'overrides', 'duplicate-header', 'unknown-envelope'])('%s refuses unchanged original binding rather than rebuilding', kind => {
    const current = authority(), input = wire(); expect(validateWire(current, input)).toEqual(input);
    const data = connection();
    if (kind === 'saved-token') data.accessToken = 'dummy-rotated';
    if (kind === 'header-key') input.headers.Authorization = 'Bearer dummy-stale';
    if (kind === 'SSO') input.headers['x-amz-sso-bearer'] = 'dummy-stale';
    if (kind === 'different-selected-key') { data.apiKey = 'dummy-other-key'; input.credentials.apiKey = data.apiKey; input.headers.Authorization = `Bearer ${data.apiKey}`; }
    if (kind === 'missing-access') { data.apiKey = 'dummy-api-key'; data.accessToken = null; input.credentials.apiKey = data.apiKey; input.credentials.accessToken = null; delete input.headers['x-amz-sso-bearer']; }
    if (kind === 'oauth') current.connection.authType = 'oauth';
    if (kind === 'auth-method') { data.providerSpecificData.authMethod = 'external_idp'; input.credentials.providerSpecificData.authMethod = 'external_idp'; }
    if (kind === 'missing-region') { delete data.providerSpecificData.region; delete input.credentials.providerSpecificData.region; }
    if (kind === 'region') { data.providerSpecificData.region = 'eu-west-1'; input.credentials.providerSpecificData.region = 'eu-west-1'; }
    if (kind === 'connection') input.credentials.connectionId = 'different';
    if (kind === 'provider-data') data.providerSpecificData.device = 'changed';
    if (kind === 'provider') current.provider = 'openai';
    if (kind === 'model') current.model = 'unknown';
    if (kind === 'tools') { const body = original(); body.tools = []; input.kiroTransport.serializedBody = JSON.stringify(body); }
    if (kind === 'invocation') input.headers['Amz-Sdk-Invocation-Id'] = '33333333-3333-4333-8333-333333333333';
    if (kind === 'missing-env') delete input.proxyEnvironment;
    if (kind === 'overrides') current.settings = JSON.stringify({ providerOverrides: { kiro: { headers: { 'x-amzn-kiro-agent-mode': 'other' } } } });
    if (kind === 'duplicate-header') input.headers.authorization = input.headers.Authorization;
    if (kind === 'unknown-envelope') input.extra = true;
    current.connection.data = JSON.stringify(data);
    expect(() => validateWire(current, input)).toThrow();
  });
  it.each(['body', 'connection', 'settings'])('malformed %s JSON refuses after accepted original without rebuilding', kind => {
    const current = authority(), input = wire(); expect(validateWire(current, input)).toEqual(input);
    if (kind === 'body') input.kiroTransport.serializedBody = '{';
    if (kind === 'connection') current.connection.data = '{';
    if (kind === 'settings') current.settings = '{';
    expect(() => validateWire(current, input)).toThrow(kind === 'body' ? 'Accounting Kiro transport unavailable' : 'Queued Kiro wire unavailable');
  });
  it('saved route is independently bound even with matching environment', () => {
    const current = authority(), input = wire(); current.settings = JSON.stringify({ outboundProxyEnabled: true, outboundProxyUrl: 'http://dummy-proxy.invalid:3210', outboundNoProxy: 'fixture.invalid' });
    input.proxyOptions = { persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: 'fixture.invalid' } };
    expect(validateWire(current, input)).toEqual(input); input.proxyOptions.persistedGlobalProxy.noProxy = '*';
    expect(() => validateWire(current, input)).toThrow('Queued saved proxy wire unavailable');
  });
  it('plain guard precedes programmable header reads', () => {
    const input = wire(); let hits = 0;
    Object.defineProperty(input.headers, 'Authorization', { enumerable: true, get() { hits++; throw new Error('do not run'); } });
    expect(() => validateWire(authority(), input)).toThrow(); expect(hits).toBe(0);
  });
});
