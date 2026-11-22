// Executable production coverage, NOT catalog or fixture capabilities. No cell
// is admitted yet; never auto-enroll a model from pricing/provider discovery.
// Entries require exact producer/profile/transport and shipping route evidence.
const PROFILES = Object.freeze([]);

export function installedBudgetReadiness() {
  return Object.freeze({ ready: PROFILES.length > 0, reason: PROFILES.length ? null : 'no_admitted_profile' });
}

// Exact enrolled client identity; no request option or global readiness grants access.
export function findInstalledBudgetProfileForKey(keyId) {
  return PROFILES.find(profile => profile.keyId === keyId)?.dispatch ?? null;
}

export function findInstalledBudgetProfile(provider, model) {
  return PROFILES.find(profile => profile.provider === provider && profile.model === model) ?? null;
}
