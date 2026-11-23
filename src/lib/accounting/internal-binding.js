import { unavailable, snapshotPayload } from './attempt-payload.js';
import { createNodeOuterTransaction } from './node-outer-transaction.js';
import { PROVIDER_ACCOUNT_READS, isSingleWorkspaceBinding, readAnthropicAccount, readCodexAccount } from './node-anthropic-account.js';
import { ANTHROPIC_REFERENCE_MODEL } from './anthropic-reference-price.js';
import { BUDGET_REFERENCE_SCOPE, CODEX_BUDGET_PRICE, CODEX_STANDARD_REFERENCE } from '../pricing/constants.js';
import { validateCodexStandardReference } from './exact-money.js';
import { ROUTING_READS } from './node-routing-snapshot.js';

const definitions = Object.freeze({
  ...PROVIDER_ACCOUNT_READS,
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

export function resolveInternalBudgetBinding(adapter, input) {
  const value = snapshotPayload(input);
  if (value?.workspaceBinding) {
    verifyInternalAnthropicBinding(adapter, value);
    return Object.freeze({ enabled: true, producerAdmitted: true, provider: 'anthropic', auth: 'api-key',
      model: ANTHROPIC_REFERENCE_MODEL, serviceTier: 'standard_only', inferenceGeo: 'global',
      workspaceBinding: Object.freeze(value.workspaceBinding) });
  }

  const binding = value?.codexBinding;
  if (!binding || Object.keys(value).sort().join(',') !== 'clientKeyId,codexBinding' ||
      Object.keys(binding).sort().join(',') !== 'accountId,connectionId,serviceTier' ||
      !validId(value.clientKeyId) || !validId(binding.connectionId) || !validId(binding.accountId) ||
      binding.serviceTier !== 'standard') throw unavailable();

  const model = CODEX_BUDGET_PRICE.model;
  const { value: matches } = createNodeOuterTransaction(adapter, {
    ...definitions,
    price: { method: 'get', sql: 'SELECT value FROM kv WHERE scope = ? AND key = ?' },
  })(scope => {
    if (scope.activeClient([value.clientKeyId])?.present !== 1 ||
        readCodexAccount(scope, binding.connectionId, model)?.accountId !== binding.accountId) return false;
    const row = scope.price([BUDGET_REFERENCE_SCOPE, CODEX_STANDARD_REFERENCE]);
    try { return Boolean(row && validateCodexStandardReference(JSON.parse(row.value))); }
    catch { return false; }
  });
  if (!matches) throw unavailable();
  return Object.freeze({ enabled: true, producerAdmitted: true, provider: 'codex', auth: 'oauth', model,
    connectionId: binding.connectionId, accountId: binding.accountId, priceBasis: CODEX_STANDARD_REFERENCE });
}
