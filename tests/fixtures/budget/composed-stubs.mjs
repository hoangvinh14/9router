import assert from 'node:assert/strict';
import codex from '../../../open-sse/providers/registry/codex.js';
import anthropic from '../../../open-sse/providers/registry/anthropic.js';

const blocked = () => assert.fail('Unexpected dependency in internal composition fixture');
export function getAdapter() {
  const db = globalThis.routeFixture?.db;
  assert.ok(db, 'No disposable adapter is active');
  return db;
}
export const getAccountingAdapter = getAdapter;
export const getAntigravityQuotaCache = blocked, getAntigravityModelQuota = blocked;
export const clearAntigravityStrikes = () => {};
export const handleAntigravityQuotaError = blocked;
export const OAUTH_ENDPOINTS = {}, NOUS_ATTRIBUTION = {};
export const refreshProviderCredentials = blocked;
export const shouldRefreshCredentials = blocked, resolveOpenAICompatibleApiType = blocked, buildKimiHeaders = blocked;
export const buildClineHeaders = blocked, extractClaudeSessionIdFromUserId = () => null;
export const getCapabilitiesForModel = blocked;
export const proxyAwareFetch = blocked;
export async function prepareAccountedDirectPost(url, options, proxyOptions) {
  const fixture = globalThis.routeFixture;
  const tokenUrl = fixture.profile?.provider === 'claude' ? 'https://api.anthropic.com/v1/oauth/token' : 'https://auth.openai.com/oauth/token';
  if (url === tokenUrl) {
    assert.equal(options.method, 'POST');
    assert.equal(proxyOptions, undefined);
    if (process.env.BUDGET_COMPOSED_TLS === '1') {
      const { prepareAccountedDirectPost: prepare } = await import('../../../open-sse/utils/proxyFetch.js');
      return prepare(url, options);
    }
    const body = fixture.profile.provider === 'claude' ? JSON.parse(options.body) : Object.fromEntries(new URLSearchParams(options.body));
    return () => fixture.grant(body);
  }
  fixture.preparations++;
  assert.equal(url, fixture.profile?.provider === "openai" ? "https://api.openai.com" + (fixture.profile.endpoint || "/v1/chat/completions") : fixture.profile?.provider === "codex" ? codex.transport.baseUrl : anthropic.transport.baseUrl + (fixture.profile?.provider === "claude" ? "?beta=true" : ""));
  assert.equal(options.method, 'POST');
  assert.equal(Object.values(proxyOptions ?? {}).some(Boolean), false);
  if (process.env.BUDGET_COMPOSED_TLS === '1') {
    assert.equal(new URL(fixture.endpoint).hostname, '127.0.0.1');
    const { prepareAccountedDirectPost: prepare } = await import('../../../open-sse/utils/proxyFetch.js');
    const send = await prepare(fixture.profile?.provider === 'claude' ? url : fixture.endpoint, options, proxyOptions);
    return () => send().then(response => fixture.trackRead(response));
  }
  const headers = Object.fromEntries(new Headers(options.headers));
  const body = JSON.parse(options.body);
  return () => fixture.invoke({ headers, body });
}
