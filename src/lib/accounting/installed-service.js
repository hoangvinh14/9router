import { getAccountingAdapter } from '../db/driver.js';
import { createNodeAttemptLedger } from './node-attempt-ledger.js';
import { createNodeKeyPolicy } from './node-key-policy.js';

// Same application adapter only. No schema creation/migration or cached health
// promise: each access rechecks actual driver provenance and process fault.
// Missing accounting schema refuses. Management cannot activate finite policy
// from fixture capability; shipping coverage readiness remains mandatory.
export async function getInstalledAccountingServices() {
  const adapter = await getAccountingAdapter();
  return Object.freeze({ ledger: createNodeAttemptLedger(adapter, { requireAccount: true }), policy: createNodeKeyPolicy(adapter) });
}

// Bind original server-validated presented key; callback resolves fresh policy at
// actual dispatch, not a stale HTTP context or client-provided identity/limits.
export function bindAccountingIdentity({ policy, ledger }, presentedSecret) {
  const original = policy.resolve(presentedSecret);
  if (!original) return null;
  return Object.freeze({ keyId: original.keyId, bindingGeneration: original.bindingGeneration,
    matchesSecret: secret => secret === presentedSecret,
    captureRoute: () => ledger.captureRoute(original.keyId),
    bindAnthropicAccount: (routeProof, connectionId, apiKey, inferenceGeo) => ledger.bindAnthropicAccount(routeProof, connectionId, apiKey, inferenceGeo),
    bindCodexAccount: (routeProof, connectionId, accessToken, accountId, priceBasis) =>
      ledger.bindCodexAccount(routeProof, connectionId, accessToken, accountId, priceBasis),
    prepare(command, routeProof, accountProof) {
      return ledger.prepare({ ...command, keyId: original.keyId, bindingGeneration: original.bindingGeneration }, routeProof, accountProof);
    },
    dispatch(ack, now, initiate) {
      return ledger.dispatch(ack, { presentedSecret, now }, initiate);
    },
  });
}
