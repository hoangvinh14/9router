import { unavailable, snapshotPayload } from './attempt-payload.js';
import { createNodeOuterTransaction } from './node-outer-transaction.js';
import { ANTHROPIC_ACCOUNT_READS, isSingleWorkspaceBinding, readAnthropicAccount } from './node-anthropic-account.js';
import { ANTHROPIC_REFERENCE_MODEL } from './anthropic-reference-price.js';
import { ROUTING_READS } from './node-routing-snapshot.js';

const definitions = Object.freeze({
  ...ANTHROPIC_ACCOUNT_READS,
  routingSettings: ROUTING_READS.routingSettings,
  activeClient: Object.freeze({ method: 'get', sql: `SELECT 1 AS present FROM apiKeys
    WHERE id = ? AND isActive = 1 AND typeof(key) = 'text' AND length(key) > 0 AND instr(key, char(0)) = 0` }),
});
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?![\s\S])/.test(value);

// Server-owned input only. Checks local consistency, not provider attestation.
// No registration, policy write, dispatch capability, or credential output.
export function verifyInternalAnthropicBinding(adapter, input) {
  const value = snapshotPayload(input);
  if (!value || Object.keys(value).sort().join(',') !== 'clientKeyId,workspaceBinding' ||
      !validId(value.clientKeyId) || !isSingleWorkspaceBinding(value.workspaceBinding) ||
      !validId(value.workspaceBinding.connectionId)) throw unavailable();
  const { clientKeyId, workspaceBinding } = value;
  const { value: matches } = createNodeOuterTransaction(adapter, definitions)(scope =>
    scope.activeClient([clientKeyId])?.present === 1 &&
    readAnthropicAccount(scope, workspaceBinding.connectionId, ANTHROPIC_REFERENCE_MODEL) === workspaceBinding.keyDigest);
  if (!matches) throw unavailable();
  return true;
}
