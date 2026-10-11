import { beforeAll, describe, expect, it } from 'vitest';
import { captureAccountingEmbeddingsConfig } from '../../open-sse/config/accountedEmbeddingsDispatch.js';
import { ACCOUNTED_EMBEDDINGS_URL } from '../../open-sse/config/accountedEmbeddingsCandidate.js';
let capture, validate;
beforeAll(async () => ({ captureUnhealthyEmbeddingsDispatch: capture, validateUnhealthyEmbeddingsOptions: validate } =
  await import('../../open-sse/config/accountedUnhealthyEmbeddingsDispatch.js')));
function input() {
  const body = { model: 'fixture-embedding', input: ['fixture original'] }, actual = { ...body, encoding_format: 'float' };
  return { model: body.model, body, actual, mediaConfig: captureAccountingEmbeddingsConfig(),
    credentials: { apiKey: 'fixture-upstream', accessToken: null }, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-upstream' },
    url: ACCOUNTED_EMBEDDINGS_URL, serialized: JSON.stringify(actual), proxyOptions: null };
}
describe('unwired unhealthy embeddings full original and strict prepared equality, no persisted proof/ACK grant', () => {
  it('accepts text-array original plus sole float default and native signal', () => {
    const source = input(), evidence = capture(source);
    expect(Object.isFrozen(evidence.body.input)).toBe(true);
    expect(() => validate(evidence, source.url, { method: 'POST', headers: source.headers, body: source.serialized, redirect: 'error', signal: new AbortController().signal }, null)).not.toThrow();
    source.body.input[0] = 'changed'; expect(evidence.body.input[0]).toBe('fixture original');
  });
  it.each(['extra-original', 'token-input', 'base64', 'changed-actual', 'token', 'headers', 'url', 'config', 'proxy', 'getter', 'cycle', 'oversized'])('refuses full %s material after canonical positive without erasure', mode => {
    expect(() => capture(input())).not.toThrow(); const source = input(); let reads = 0;
    if (mode === 'extra-original') source.body.user = 'unsupported';
    if (mode === 'token-input') source.body.input = [1, 2];
    if (mode === 'base64') source.body.encoding_format = 'base64';
    if (mode === 'changed-actual') source.actual.input = ['changed'];
    if (mode === 'token') source.headers.Authorization = 'Bearer other';
    if (mode === 'headers') source.headers['X-Fixture'] = 'unsupported';
    if (mode === 'url') source.url = 'https://fixture.invalid/embeddings';
    if (mode === 'config') source.mediaConfig = { ...source.mediaConfig, baseUrl: 'https://fixture.invalid/embeddings' };
    if (mode === 'proxy') source.proxyOptions = { unsupported: true };
    if (mode === 'getter') Object.defineProperty(source.credentials, 'apiKey', { enumerable: true, get() { reads++; return 'fixture-upstream'; } });
    if (mode === 'cycle') source.body.self = source.body;
    if (mode === 'oversized') source.credentials.fixture = 'x'.repeat(262145);
    expect(() => capture(source)).toThrow(); expect(reads).toBe(0);
  });
  it.each(['body', 'token', 'proxy', 'getter'])('rejects current POST %s drift against retained complete evidence', mode => {
    const source = input(), evidence = capture(source), options = { method: 'POST', headers: source.headers, body: source.serialized, redirect: 'error' }; let reads = 0;
    expect(() => validate(evidence, source.url, options, null)).not.toThrow();
    if (mode === 'body') options.body = '{}';
    if (mode === 'token') options.headers.Authorization = 'Bearer other';
    if (mode === 'getter') Object.defineProperty(options, 'body', { enumerable: true, get() { reads++; return source.serialized; } });
    expect(() => validate(evidence, source.url, options, mode === 'proxy' ? { unsupported: true } : null)).toThrow(); expect(reads).toBe(0);
  });
});
