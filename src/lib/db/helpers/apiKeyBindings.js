function collision() {
  const error = new Error("API key identity binding conflict; import unchanged");
  error.status = 409; error.code = "api_key_identity_conflict"; return error;
}
export function validateKeyBindings(db, coverage, keys) {
  if (!Array.isArray(keys)) throw new Error("Invalid API keys payload");
  const ids = new Set(), secrets = new Set();
  const retired = coverage.retiredBindings();
  for (const key of keys) {
    if (typeof key?.id !== "string" || !key.id || key.id.length > 200 || typeof key.key !== "string" || !key.key) throw new Error("Invalid API key identity");
    if (ids.has(key.id) || secrets.has(key.key)) throw collision();
    ids.add(key.id); secrets.add(key.key);
    const fingerprint = coverage.fingerprint(key.key);
    const priorId = db.get("SELECT * FROM apiKeyBindings WHERE apiKeyId=?", [key.id]);
    const priorSecret = db.get("SELECT * FROM apiKeyBindings WHERE fingerprint=?", [fingerprint]);
    if (priorId && (priorId.fingerprint !== fingerprint || priorId.retiredAt) || priorSecret && priorSecret.apiKeyId !== key.id ||
        retired.some(b => b.apiKeyId === key.id || b.fingerprint === fingerprint)) throw collision();
  }
}
export function retainKeyBindings(db, coverage, keys) {
  validateKeyBindings(db, coverage, keys);
  for (const key of keys) db.run("INSERT OR IGNORE INTO apiKeyBindings(apiKeyId,fingerprint,createdAt) VALUES(?,?,?)", [key.id, coverage.fingerprint(key.key), key.createdAt || new Date().toISOString()]);
}
export function retireKeyBindings(db, coverage, keys) {
  // Retire externally first. A crash before DB ack remains safely retired, not
  // silently revived by an older DB restore. A failed later import may require
  // operator reconciliation, but must never erase charged identity history.
  for (const key of keys) {
    const binding = db.get("SELECT * FROM apiKeyBindings WHERE apiKeyId=?", [key.id]);
    if (!binding) throw new Error("API key binding missing");
    coverage.retainRetiredBinding(key.id, binding.fingerprint);
  }
  for (const key of keys) db.run("UPDATE apiKeyBindings SET retiredAt=COALESCE(retiredAt,?) WHERE apiKeyId=?", [new Date().toISOString(), key.id]);
}
