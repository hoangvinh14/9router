import { getAccountingAdapter } from '../db/driver.js';
import { codexStandardReferenceKey } from '../pricing/constants.js';
import {
  codexAccountId, credentialDigest, readAnthropicWorkspace, selectedAccountProxy,
} from './node-anthropic-account.js';
import { supportsBudgetProvider } from './profile-registry.js';

export async function createRouterDispatchContext({ endpoint, identity, routeProof, provider, model, credentials, body }) {
  if (!supportsBudgetProvider(endpoint, provider)) return null;
  const { connectionId, authType, apiKey, accessToken, refreshToken, providerSpecificData } = credentials;
  const isOAuth = provider === 'codex' || provider === 'claude';
  if (!connectionId || (isOAuth
    ? authType !== 'oauth' || !accessToken || apiKey
    : authType !== 'apikey' || !apiKey || accessToken || refreshToken)) return null;

  let proxy;
  try { proxy = selectedAccountProxy(providerSpecificData); }
  catch { return null; }

  const args = { endpoint, identity, routeProof, credentials, model, body };
  const profile = {
    provider, connectionId, producerAdmitted: true, enabled: true,
    auth: isOAuth ? 'oauth' : 'api-key', serviceTier: 'standard',
  };
  const probe = { probe: true };

  if (provider === 'codex') {
    const accountId = codexAccountId(providerSpecificData);
    const basis = codexStandardReferenceKey(model);
    if (!accountId || !basis) return null;
    if (!await identity.bindCodexAccount(routeProof, connectionId, accessToken, accountId, basis, proxy, probe)) return null;
    const { createCodexDispatchContext } = await import('./codex-dispatch-context.js');
    return createCodexDispatchContext({ ...args, profile: { ...profile, accountId } });
  }
  if (provider === 'openai') {
    if (!await identity.bindOpenAIAccount(routeProof, connectionId, apiKey, proxy, probe)) return null;
    const { createOpenAIDispatchContext } = await import('./openai-dispatch-context.js');
    return createOpenAIDispatchContext({ ...args, profile });
  }
  if (provider === 'claude') {
    if (!await identity.bindClaudeAccount(routeProof, connectionId, accessToken, proxy, probe)) return null;
  } else {
    const db = await getAccountingAdapter();
    const workspaceBinding = readAnthropicWorkspace({
      anthropicWorkspace: params => db.get('SELECT value FROM kv WHERE scope = ? AND key = ?', params),
    }, connectionId, credentialDigest(apiKey));
    if (!workspaceBinding) return null;
    if (!await identity.bindAnthropicAccount(routeProof, connectionId, apiKey, 'global', true,
      proxy, { ...probe, workspaceBinding })) return null;
    Object.assign(profile, { serviceTier: 'standard_only', inferenceGeo: 'global', workspaceBinding });
  }
  const { createAnthropicDispatchContext } = await import('./anthropic-dispatch-context.js');
  const stream = !endpoint.endsWith('/messages') || body.stream === true;
  return createAnthropicDispatchContext({ ...args, profile, stream, requireStoredWorkspace: provider === 'anthropic' });
}
