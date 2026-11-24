import { unavailable, snapshotPayload } from './attempt-payload.js';
import { createNodeOuterTransaction } from './node-outer-transaction.js';
import { PROVIDER_ACCOUNT_READS, isSingleWorkspaceBinding, readAnthropicAccount, readClaudeAccount, readCodexAccount } from './node-anthropic-account.js';
import { ANTHROPIC_REFERENCE_MODEL } from './anthropic-reference-price.js';
import { BUDGET_REFERENCE_SCOPE } from '../pricing/constants.js';
import { codexModelFromReference, validateCodexStandardReference } from './exact-money.js';
import { ROUTING_READS } from './node-routing-snapshot.js';

const priceRead = Object.freeze({ method: 'get', sql: 'SELECT value FROM kv WHERE scope = ? AND key = ?' });

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
    readAnthropicAccount(scope, workspaceBinding.connectionId) === workspaceBinding.keyDigest);
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

  const { value: referencePrices } = createNodeOuterTransaction(adapter, {
    ...definitions,
    referenceRows: { method: 'all', sql: "SELECT key, value FROM kv WHERE scope = ? AND key GLOB 'openai:codex/*:standard:v1' ORDER BY key" },
  })(scope => {
    if (scope.activeClient([value.clientKeyId])?.present !== 1 ||
        readCodexAccount(scope, binding.connectionId)?.accountId !== binding.accountId) return [];
    return scope.referenceRows([BUDGET_REFERENCE_SCOPE]).flatMap(row => {
      if (!codexModelFromReference(row.key)) return [];
      try {
        const price = validateCodexStandardReference(JSON.parse(row.value));
        return price.revision === row.key ? [price] : [];
      } catch { return []; }
    });
  });
  if (!referencePrices.length) throw unavailable();
  return Object.freeze({ enabled: true, producerAdmitted: true, provider: 'codex', auth: 'oauth',
    connectionId: binding.connectionId, accountId: binding.accountId, referencePrices });
}

export async function resolveInternalOperatorBinding(adapter, input) {
  const value = snapshotPayload(input);
  if (value?.claudeBinding) {
    const binding = value.claudeBinding;
    if (Object.keys(value).sort().join(',') !== 'claudeBinding,clientKeyId' ||
        Object.keys(binding).sort().join(',') !== 'connectionId,serviceTier' ||
        !validId(value.clientKeyId) || !validId(binding.connectionId) || binding.serviceTier !== 'standard') throw unavailable();
    const { claudeModelFromReference, readClaudeStandardReference } = await import('../pricing/claude-standard-reference.js');
    const { value: referencePrices } = createNodeOuterTransaction(adapter, { ...definitions, referencePrice: priceRead,
      referenceKeys: { method: 'all', sql: "SELECT key FROM kv WHERE scope = ? AND key GLOB 'anthropic:claude/*:standard:v1' ORDER BY key LIMIT 128" },
    })(scope => {
      if (scope.activeClient([value.clientKeyId])?.present !== 1) return null;
      return scope.referenceKeys([BUDGET_REFERENCE_SCOPE]).flatMap(({ key }) => {
        const model = claudeModelFromReference(key);
        if (!model || !readClaudeAccount(scope, binding.connectionId, model)) return [];
        const price = readClaudeStandardReference(scope, model);
        return price ? [price] : [];
      });
    });
    if (!referencePrices?.length) throw unavailable();
    return Object.freeze({ enabled: true, producerAdmitted: true, provider: 'claude', auth: 'oauth',
      connectionId: binding.connectionId, serviceTier: binding.serviceTier, referencePrices });
  }

  return resolveInternalBudgetBinding(adapter, value);
}
