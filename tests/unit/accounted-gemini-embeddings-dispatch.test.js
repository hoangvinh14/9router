import { beforeAll, describe, expect, it } from 'vitest';
import adapter from '../../open-sse/handlers/embeddingProviders/gemini.js';
import { PROVIDER_MEDIA } from '../../open-sse/providers/index.js';
let captureGeminiEmbeddingDispatch, validateGeminiEmbeddingOptions;
beforeAll(async () => ({ captureGeminiEmbeddingDispatch, validateGeminiEmbeddingOptions } = await import('../../open-sse/config/accountedGeminiEmbeddingDispatch.js')));
const model = 'gemini-embedding-001';
const privateKey = 'fixture-private-key';
function value(batch = false) {
  const original = { model, input: batch ? ['fixture-one', 'fixture-two'] : 'fixture-one', dimensions: 3 };
  const credentials = { apiKey: privateKey };
  const actual = adapter.buildBody(model, original);
  return { model, original, actual, mediaConfig: structuredClone(PROVIDER_MEDIA.gemini.embeddingConfig), credentials,
    headers: adapter.buildHeaders(credentials), url: adapter.buildUrl(model, credentials, { input: original.input }),
    serialized: JSON.stringify(actual), proxyOptions: null };
}
const post = evidence => ({ method: 'POST', redirect: 'error', headers: evidence.headers, body: evidence.serialized });
const fixedRefusal = invoke => {
  let error; try { invoke(); } catch (caught) { error = caught; }
  expect(error?.message).toBe('Gemini embedding dispatch unavailable');
  expect(error.message.includes(privateKey)).toBe(false);
};
describe('Gemini embedding complete private transport equality, not POST admission', () => {
  it.each([false, true])('original/config/key-query URL/current POST bind single/batch %s', batch => {
    const input = value(batch), evidence = captureGeminiEmbeddingDispatch(input);
    expect(evidence).toEqual(input); expect(Object.isFrozen(evidence)).toBe(true);
    expect(validateGeminiEmbeddingOptions(evidence, input.url, { ...post(input), signal: new AbortController().signal }, input.proxyOptions)).toEqual(evidence);
  });
  it.each(['query-key', 'query-extra', 'query-double', 'wrong-operation', 'custom-origin', 'credentials-key', 'oauth', 'unknown-credential', 'media-config', 'header-key', 'serialization', 'proxy-relay'])('fixed secret-safe refusal of %s after positive', fault => {
    expect(captureGeminiEmbeddingDispatch(value()).model).toBe(model);
    const input = value();
    if (fault === 'query-key') input.url = input.url.replace(privateKey, 'fixture-changed');
    else if (fault === 'query-extra') input.url += '&alt=json';
    else if (fault === 'query-double') input.url += `&key=${privateKey}`;
    else if (fault === 'wrong-operation') input.url = input.url.replace(':embedContent', ':batchEmbedContents');
    else if (fault === 'custom-origin') input.url = input.url.replace('generativelanguage.googleapis.com', 'fixture.invalid');
    else if (fault === 'credentials-key') input.credentials.apiKey = 'fixture-changed';
    else if (fault === 'oauth') input.credentials.accessToken = 'fixture-oauth';
    else if (fault === 'unknown-credential') input.credentials.baseUrl = 'https://fixture.invalid';
    else if (fault === 'media-config') input.mediaConfig.authHeader = 'bearer';
    else if (fault === 'header-key') input.headers['x-goog-api-key'] = privateKey;
    else if (fault === 'serialization') input.serialized = '{}';
    else input.proxyOptions = { vercelRelayUrl: 'https://fixture.invalid' };
    fixedRefusal(() => captureGeminiEmbeddingDispatch(input));
  });
  it.each(['body', 'headers', 'url', 'proxy'])('current POST %s cannot replace retained image', fault => {
    const input = value(), evidence = captureGeminiEmbeddingDispatch(input);
    const options = post(input); let url = input.url, proxy = input.proxyOptions;
    if (fault === 'body') options.body = '{}';
    else if (fault === 'headers') options.headers = { ...input.headers, extra: 'changed' };
    else if (fault === 'url') url += '&extra=1';
    else proxy = { persistedGlobalProxy: { url: 'http://fixture.invalid:1234', noProxy: '' } };
    fixedRefusal(() => validateGeminiEmbeddingOptions(evidence, url, options, proxy));
  });
  it.each(['credential-getter', 'url-getter', 'proxy', 'post-getter'])('descriptor guard %s has zero programmable reads', fault => {
    expect(captureGeminiEmbeddingDispatch(value()).model).toBe(model);
    let reads = 0; const trap = () => { reads++; throw new Error(privateKey); };
    let input = value();
    if (fault === 'credential-getter') Object.defineProperty(input.credentials, 'apiKey', { enumerable: true, get: trap });
    else if (fault === 'url-getter') Object.defineProperty(input, 'url', { enumerable: true, get: trap });
    else if (fault === 'proxy') input = new Proxy(input, { get: trap, ownKeys: trap });
    if (fault === 'post-getter') {
      const evidence = captureGeminiEmbeddingDispatch(input), options = post(input);
      Object.defineProperty(options, 'body', { enumerable: true, get: trap });
      fixedRefusal(() => validateGeminiEmbeddingOptions(evidence, input.url, options, input.proxyOptions));
    } else fixedRefusal(() => captureGeminiEmbeddingDispatch(input));
    expect(reads).toBe(0);
  });
});
