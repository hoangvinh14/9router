import { conflict, unavailable } from './attempt-payload.js';
import { createNodeOuterTransaction } from './node-outer-transaction.js';
import {
  ANTHROPIC_WORKSPACE_SCOPE, credentialDigest, isSingleWorkspaceBinding, PROVIDER_ACCOUNT_READS, readAnthropicWorkspace,
} from './node-anthropic-account.js';

const operations = {
  ...PROVIDER_ACCOUNT_READS,
  saveWorkspace: { method: 'run', sql: 'INSERT INTO kv(scope, key, value) VALUES (?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value' },
};

function savedDigest(scope, connectionId) {
  const row = scope.providerAccount([connectionId]);
  if (row?.provider !== 'anthropic' || row.authType !== 'apikey') throw unavailable();
  return credentialDigest(JSON.parse(row.data).apiKey);
}

export function inspectAnthropicWorkspace(adapter, connectionId) {
  return createNodeOuterTransaction(adapter, operations)(scope => {
    const evidence = readAnthropicWorkspace(scope, connectionId, savedDigest(scope, connectionId));
    return { workspaceId: evidence?.workspaceId ?? null };
  }).value;
}

export function saveAnthropicWorkspace(adapter, connectionId, workspaceId, expectedDigest) {
  const { value } = createNodeOuterTransaction(adapter, operations)(scope => {
    const keyDigest = savedDigest(scope, connectionId);
    if (expectedDigest !== undefined && keyDigest !== expectedDigest) return null;
    const evidence = { connectionId, workspaceId, keyDigest, scope: 'single-workspace' };
    if (!isSingleWorkspaceBinding(evidence)) throw unavailable();
    const current = readAnthropicWorkspace(scope, connectionId, keyDigest);
    // An offline import may be rerun and must not replace newer attestation.
    if (expectedDigest !== undefined && current && current.workspaceId !== workspaceId) return null;
    if (current?.workspaceId !== workspaceId &&
        scope.saveWorkspace([ANTHROPIC_WORKSPACE_SCOPE, connectionId, JSON.stringify(evidence)]).changes !== 1) throw unavailable();
    return { workspaceId };
  });
  if (value === null) throw conflict();
  return value;
}
