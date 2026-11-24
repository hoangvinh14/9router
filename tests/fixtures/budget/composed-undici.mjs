import assert from 'node:assert/strict';
import { fetch as send } from 'undici';
export * from 'undici';

// Keep the production Claude hostname through its CLI-header check. Rewrite
// only the final network destination inside the isolated loopback namespace.
export function fetch(url, options) {
  const fixture = globalThis.routeFixture;
  const grant = fixture?.profile?.provider === 'codex' ? 'https://auth.openai.com/oauth/token' : 'https://api.anthropic.com/v1/oauth/token';
  if (url === grant) url = new URL('/oauth/token', fixture.endpoint).href;
  else if (fixture?.profile?.provider === 'claude') {
    assert.equal(url, 'https://api.anthropic.com/v1/messages?beta=true');
    url = fixture.endpoint;
  }
  assert.equal(new URL(url).hostname, '127.0.0.1');
  return send(url, options);
}
