export { POLICY_FORMAT_KEY, POLICY_FORMAT_VERSION, validateExplicitPolicy } from './explicitPolicy.js';

// Retired unsafe sidecar-first entrypoint. No DB interaction, including reads.
// Explicit stopped-writer operation owns initialization and bound recovery.
export function initializeExplicitPoliciesSync() {
  throw new Error('Policy initialization requires explicit offline api-key-policy-init.mjs operation');
}
