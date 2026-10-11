import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ config: null, create: vi.fn() }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, get kiro() { return fixture.config; } } };
});
vi.mock('undici', () => ({
  ProxyAgent: class { constructor(options) { fixture.create(options); } },
  Agent: class { constructor(options) { fixture.create(options); } },
}));
let nativeFetch, fetchProxy, evidence, validatePost;
const url = 'https://q.us-east-1.amazonaws.com/generateAssistantResponse';
const options = () => ({ method: 'POST', redirect: 'error', body: evidence.serializedBody,
  headers: {
    'Content-Type': 'application/json', Accept: 'application/vnd.amazon.eventstream',
    'User-Agent': 'AWS-SDK-JS/3.0.0 kiro-ide/1.0.0', 'X-Amz-User-Agent': 'aws-sdk-js/3.0.0 kiro-ide/1.0.0',
    'Amz-Sdk-Request': 'attempt=1; max=3', 'Amz-Sdk-Invocation-Id': evidence.invocationId,
    Authorization: 'Bearer dummy-api-key', TokenType: 'API_KEY', 'x-amz-sso-bearer': 'dummy-api-key',
    'x-amzn-kiro-agent-mode': 'spec', 'x-amzn-codewhisperer-machine-id': 'kiro-desktop',
  } });
const saved = () => ({ persistedGlobalProxy: { url: 'http://dummy-proxy.invalid:3210', noProxy: '' } });
beforeEach(async () => {
  vi.resetModules(); fixture.create.mockReset();
  const original = await vi.importActual('../../open-sse/config/providers.js');
  fixture.config = structuredClone(original.PROVIDERS.kiro);
  nativeFetch = vi.fn(async () => new Response('fixture')); vi.stubGlobal('fetch', nativeFetch);
  ({ proxyAwareFetch: fetchProxy } = await import('../../open-sse/utils/proxyFetch.js'));
  const { captureAccountingKiroConfig, validateAccountingKiroPost } = await import('../../open-sse/config/accountedKiroDispatch.js');
  validatePost = validateAccountingKiroPost;
  const body = { conversationState: {
    chatTriggerType: 'MANUAL', conversationId: '12345678-1234-4123-8123-123456789abc',
    currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: 'claude-sonnet-4.5', origin: 'AI_EDITOR' } }, history: [],
  }, inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 } };
  evidence = { model: 'claude-sonnet-4.5', mode: 'native-kiro-eventstream', kiroConfig: captureAccountingKiroConfig(fixture.config),
    invocationId: '22222222-2222-4222-8222-222222222222', serializedBody: JSON.stringify(body) };
  // Every fault starts from accepted dispatch evidence; setup failure is not
  // negative-control proof. No native fetch or dispatcher is invoked here.
  expect(validatePost(evidence, url, options()).serializedBody).toBe(evidence.serializedBody);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('Narrow Kiro Q API-key native strict dispatch (mock, not credential/fallback/native owner approval)', () => {
  it('unchanged original reaches one strict POST with no transformed body', async () => {
    expect((await fetchProxy(url, options(), saved(), { singlePost: true, kiroTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1); expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(nativeFetch.mock.calls[0][1].body).toBe(evidence.serializedBody);
  });
  it('preserves caller profile ARN and requires matching profile header', async () => {
    const body = JSON.parse(evidence.serializedBody);
    body.profileArn = 'arn:aws:codewhisperer:us-east-1:123456789012:profile/fixture';
    evidence.serializedBody = JSON.stringify(body);
    const input = options(); input.headers['x-amzn-codewhisperer-profile-arn'] = body.profileArn;
    expect((await fetchProxy(url, input, saved(), { singlePost: true, kiroTransport: evidence })).ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });
  it.each(['url', 'region', 'body', 'mode', 'tools', 'thinking', 'model', 'history', 'invocation', 'token', 'SSO', 'authMethod',
    'header', 'target', 'agent', 'machine', 'sdk', 'userAgent', 'missingAccept', 'registry', 'profileMismatch', 'profileMissing'])('%s refuses before dispatcher/POST', async kind => {
    const input = options(); let target = url;
    if (kind === 'url') target = 'https://fixture.invalid/generateAssistantResponse';
    if (kind === 'region') target = 'https://q.eu-west-1.amazonaws.com/generateAssistantResponse';
    if (kind === 'body') input.body = 'changed';
    if (kind === 'mode') evidence.mode = 'legacy-kiro';
    if (['tools', 'thinking', 'model', 'history', 'profileMissing'].includes(kind)) {
      const body = JSON.parse(evidence.serializedBody);
      if (kind === 'tools') body.conversationState.currentMessage.userInputMessage.userInputMessageContext = { tools: [] };
      if (kind === 'thinking') body.additionalModelRequestFields = { thinking: { type: 'enabled' } };
      if (kind === 'model') evidence.model = body.conversationState.currentMessage.userInputMessage.modelId = 'unknown-model';
      if (kind === 'history') body.conversationState.history.push({ assistantResponseMessage: { content: 'prior' } });
      if (kind === 'profileMissing') body.profileArn = 'arn:aws:codewhisperer:us-east-1:123456789012:profile/fixture';
      input.body = evidence.serializedBody = JSON.stringify(body);
    }
    if (kind === 'invocation') input.headers['Amz-Sdk-Invocation-Id'] = '33333333-3333-4333-8333-333333333333';
    if (kind === 'token') input.headers.Authorization = 'Bearer ';
    if (kind === 'SSO') input.headers['x-amz-sso-bearer'] = 'changed-token';
    if (kind === 'authMethod') input.headers.TokenType = 'EXTERNAL_IDP';
    if (kind === 'header') input.headers['x-billing-tier'] = 'auto';
    if (kind === 'target') input.headers['X-Amz-Target'] = 'GenerateAssistantResponse';
    if (kind === 'agent') input.headers['x-amzn-kiro-agent-mode'] = 'other';
    if (kind === 'machine') input.headers['x-amzn-codewhisperer-machine-id'] = 'other';
    if (kind === 'sdk') input.headers['Amz-Sdk-Request'] = 'attempt=2; max=3';
    if (kind === 'userAgent') input.headers['User-Agent'] = 'changed';
    if (kind === 'missingAccept') delete input.headers.Accept;
    if (kind === 'registry') fixture.config.baseUrls[2] = 'https://fixture.invalid/generateAssistantResponse';
    if (kind === 'profileMismatch') input.headers['x-amzn-codewhisperer-profile-arn'] = 'arn:aws:codewhisperer:us-east-1:123456789012:profile/other';
    await expect(fetchProxy(target, input, saved(), { singlePost: true, kiroTransport: evidence })).rejects.toThrow('Accounting Kiro transport unavailable');
    expect(nativeFetch).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it.each(['route', 'body'])('%s drift after dispatcher yield refuses POST', async kind => {
    const input = options(); fixture.create.mockImplementation(() => {
      if (kind === 'route') fixture.config.baseUrls[2] = 'https://fixture.invalid/generateAssistantResponse';
      else input.body = 'changed';
    });
    await expect(fetchProxy(url, input, saved(), { singlePost: true, kiroTransport: evidence })).rejects.toThrow('Accounting Kiro transport unavailable');
    expect(fixture.create).toHaveBeenCalledTimes(1); expect(nativeFetch).not.toHaveBeenCalled();
  });
});
