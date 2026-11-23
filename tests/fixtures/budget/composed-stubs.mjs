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
export const refreshProviderCredentials = blocked, shouldRefreshCredentials = blocked, resolveOpenAICompatibleApiType = blocked, buildKimiHeaders = blocked;
export const buildClineHeaders = blocked, extractClaudeSessionIdFromUserId = blocked;
export const getCapabilitiesForModel = blocked, proxyAwareFetch = blocked;
export async function prepareAccountedDirectPost(url, options, proxyOptions) {
  const fixture = globalThis.routeFixture;
  fixture.preparations++;
  assert.equal(url, fixture.profile?.provider === "codex" ? codex.transport.baseUrl : anthropic.transport.baseUrl);
  assert.equal(options.method, 'POST');
  assert.equal(Object.values(proxyOptions ?? {}).some(Boolean), false);
  if (process.env.BUDGET_COMPOSED_TLS === '1') {
    assert.equal(new URL(fixture.endpoint).hostname, '127.0.0.1');
    const { prepareAccountedDirectPost: prepare } = await import('../../../open-sse/utils/proxyFetch.js');
    const send = await prepare(fixture.endpoint, options, proxyOptions);
    return () => send().then(response => fixture.trackRead(response));
  }
  const headers = Object.fromEntries(new Headers(options.headers));
  const body = JSON.parse(options.body);
  return () => fixture.invoke({ headers, body });
}
