// Transitional legacy readers retain raw storage but never raw response bucket
// keys. Exact retained bindings recover tombstone IDs; unmapped keys use a
// domain-separated HMAC, not mask/name matching or unsalted secret hashes.
export function usageAttribution(db, { apiKeyId = null, apiKey = null } = {}) {
  if (apiKeyId) return `key:${apiKeyId}`;
  if (!apiKey) return "local-no-key";
  const fingerprint = db.coverage.fingerprint(apiKey);
  const binding = db.get("SELECT apiKeyId FROM apiKeyBindings WHERE fingerprint=?", [fingerprint]);
  return binding ? `key:${binding.apiKeyId}` : db.coverage.legacyAttributionId(apiKey);
}
export function usageBucketKey(id, model, provider) { return JSON.stringify([id, model || "", provider || "unknown"]); }
export function redactUsageBuckets(db, buckets) {
  const result = Object.create(null);
  for (const [legacyKey, value] of Object.entries(buckets || {})) {
    const { apiKey, ...safe } = value;
    // Old readers already mask values; the raw credential remained in the key.
    // Prefer explicit metadata, otherwise old delimiter's credential component.
    const legacyIdentity = legacyKey.split("|")[0];
    const secret = apiKey || (!safe.apiKeyId && legacyIdentity !== "local-no-key" ? legacyIdentity : null);
    const id = usageAttribution(db, { apiKeyId: safe.apiKeyId, apiKey: secret });
    const key = usageBucketKey(id, safe.rawModel, safe.provider);
    safe.apiKeyKey = id;
    safe.apiKeyId ||= id.startsWith("key:") ? id.slice(4) : null;
    if (!result[key]) result[key] = safe;
    else {
      for (const field of ["requests", "promptTokens", "completionTokens", "cachedTokens", "cost"]) result[key][field] = (result[key][field] || 0) + (safe[field] || 0);
      if (new Date(safe.lastUsed) > new Date(result[key].lastUsed)) result[key].lastUsed = safe.lastUsed;
    }
  }
  return result;
}
