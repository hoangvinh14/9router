import { getAccountingAdapter } from '../db/driver.js';
import { unavailable } from './attempt-payload.js';
import { createNodeOuterTransaction } from './node-outer-transaction.js';
import { oauthTokenExpired } from './node-anthropic-account.js';

import { serializeConnectionOAuth } from '../db/repos/connectionsRepo.js';

const tokenEndpoints = { claude: 'https://api.anthropic.com/v1/oauth/token', codex: 'https://auth.openai.com/oauth/token' };
const operations = {
  current: { method: 'get', sql: "SELECT data FROM providerConnections WHERE id = ? AND provider = ? AND authType = 'oauth' AND isActive = 1" },
  rotate: { method: 'run', sql: "UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ? AND provider = ? AND authType = 'oauth' AND isActive = 1 AND data = ?" },
};

export async function refreshAccountedOAuth(provider, credentials, signal) {
  const { connectionId, accessToken, refreshToken } = credentials;
  if (!['claude', 'codex'].includes(provider) || !connectionId || !refreshToken || !accessToken) throw unavailable();
  return serializeConnectionOAuth(connectionId, async () => {
    signal?.throwIfAborted();
    const transact = createNodeOuterTransaction(await getAccountingAdapter(), operations);
    const read = scope => {
      const raw = scope.current([connectionId, provider])?.data;
      if (!raw) throw unavailable();
      const row = JSON.parse(raw);
      if (row.accessToken !== accessToken || row.refreshToken !== refreshToken ||
          (row.lastRefreshAt ?? null) !== (credentials.lastRefreshAt ?? null)) throw unavailable();
      return { raw, row };
    };
    transact(scope => { read(scope); });
    const [{ DefaultExecutor }, { prepareAccountedDirectPost }] = await Promise.all([
      import('../../../open-sse/executors/default.js'), import('../../../open-sse/utils/proxyFetch.js'),
    ]);
    const tokens = await new DefaultExecutor(provider).refreshFromGrant(credentials, null, async (url, options) => {
      if (url !== tokenEndpoints[provider]) throw unavailable();
      // A dispatched grant may rotate a single-use token even after the client
      // disconnects. Persist its reply, then check cancellation before inference.
      const dispatch = await prepareAccountedDirectPost(url, { ...options,
        body: options.body.toString(), signal: AbortSignal.timeout(30_000) });
      signal?.throwIfAborted();
      return dispatch();
    });
    if (typeof tokens?.accessToken !== 'string' || !tokens.accessToken || tokens.error ||
        (tokens.refreshToken !== undefined && (typeof tokens.refreshToken !== 'string' || !tokens.refreshToken))) throw unavailable();
    const timestamp = new Date().toISOString();
    const expiresAt = tokens.expiresAt ?? (Number.isFinite(tokens.expiresIn) && tokens.expiresIn > 0
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : null);
    if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) || oauthTokenExpired({ expiresAt }, Date.now())) throw unavailable();
    const patch = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? refreshToken,
      expiresAt, lastRefreshAt: timestamp, ...(tokens.idToken ? { idToken: tokens.idToken } : {}),
      ...(tokens.expiresIn ? { expiresIn: tokens.expiresIn } : {}) };
    const { value } = transact(scope => {
      const { raw, row } = read(scope);
      const data = JSON.stringify({ ...row, ...patch });
      const result = scope.rotate([data, timestamp, connectionId, provider, raw]);
      return result.changes === 1 && scope.current([connectionId, provider])?.data === data;
    });
    if (value !== true) throw unavailable();
    signal?.throwIfAborted();
    return { ...credentials, ...patch };
  });
}
