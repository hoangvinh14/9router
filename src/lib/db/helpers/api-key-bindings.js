import { text, unavailable } from "../../accounting/attempt-payload.js";

function collision() {
  return Object.assign(new Error("API key identity binding conflict; import unchanged"), { status: 409, code: "api_key_identity_conflict" });
}
export function validateKeyBindings(db, coverage, keys, { allowUnboundExisting = false } = {}) {
  if (!Array.isArray(keys)) throw new Error("Invalid API keys payload");
  const ids = new Set(), secrets = new Set(), retired = coverage.retiredBindings();
  for (const key of keys) {
    text(key?.id, "API key ID", 200); text(key.key, "API key secret", 8192);
    if (ids.has(key.id) || secrets.has(key.key)) throw collision();
    ids.add(key.id); secrets.add(key.key);
    const fingerprint = coverage.fingerprint(key.key);
    const prior = db.get("SELECT * FROM apiKeyBindings WHERE apiKeyId=?", [key.id]);
    const secret = db.get("SELECT * FROM apiKeyBindings WHERE fingerprint=?", [fingerprint]);
    if (!prior && !allowUnboundExisting && db.get("SELECT id FROM apiKeys WHERE id=?", [key.id])) throw unavailable("Retained key binding missing");
    if (prior && (prior.fingerprint !== fingerprint || prior.retiredAt) || secret && secret.apiKeyId !== key.id ||
        retired.some(b => b.apiKeyId === key.id || b.fingerprint === fingerprint)) throw collision();
  }
}
export function retainKeyBindings(db, coverage, keys, options) {
  validateKeyBindings(db, coverage, keys, options);
  for (const key of keys) db.run("INSERT OR IGNORE INTO apiKeyBindings(apiKeyId,fingerprint,createdAt) VALUES(?,?,?)", [key.id, coverage.fingerprint(key.key), key.createdAt || new Date().toISOString()]);
}
export function retireKeyBindings(db, coverage, keys) {
  const bindings = keys.map(key => {
    const b = db.get("SELECT * FROM apiKeyBindings WHERE apiKeyId=?", [key.id]);
    if (!b || b.fingerprint !== coverage.fingerprint(key.key)) throw unavailable("API key binding missing");
    return b;
  });
  coverage.retainRetiredBindings(bindings);
  for (const b of bindings) db.run("UPDATE apiKeyBindings SET retiredAt=COALESCE(retiredAt,?) WHERE apiKeyId=?", [new Date().toISOString(), b.apiKeyId]);
}
export function initializeKeyBindings(db, coverage) {
  const initialized = db.get("SELECT value FROM _meta WHERE key='accountingBindingsInitialized'");
  if (initialized && initialized.value !== "1") throw unavailable("Invalid binding initialization marker");
  if (!initialized && (db.get("SELECT apiKeyId FROM apiKeyBindings LIMIT 1") ||
      db.get("SELECT attemptId FROM apiKeyAccounting LIMIT 1") || db.get("SELECT id FROM apiKeyAccountingAudit LIMIT 1"))) throw unavailable("Binding initialization marker missing");
  if (initialized) {
    for (const key of db.all("SELECT * FROM apiKeys")) {
      const binding = db.get("SELECT * FROM apiKeyBindings WHERE apiKeyId=?", [key.id]);
      if (!binding || binding.fingerprint !== coverage.fingerprint(key.key)) throw unavailable("Retained key binding missing or mismatched");
    }
  }
  for (const b of coverage.retiredBindings()) {
    const existing = db.get("SELECT * FROM apiKeyBindings WHERE apiKeyId=? OR fingerprint=?", [b.apiKeyId, b.fingerprint]);
    if (existing && (existing.apiKeyId !== b.apiKeyId || existing.fingerprint !== b.fingerprint)) throw unavailable("Restored binding conflict");
    db.run("INSERT OR IGNORE INTO apiKeyBindings(apiKeyId,fingerprint,createdAt,retiredAt) VALUES(?,?,?,?)", [b.apiKeyId, b.fingerprint, b.retiredAt, b.retiredAt]);
    db.run("UPDATE apiKeyBindings SET retiredAt=COALESCE(retiredAt,?) WHERE apiKeyId=?", [b.retiredAt, b.apiKeyId]);
    db.run("UPDATE apiKeys SET isActive=0 WHERE id=?", [b.apiKeyId]);
  }
  const keys = db.all("SELECT * FROM apiKeys").filter(k => !coverage.retiredBindings().some(b => b.apiKeyId === k.id));
  retainKeyBindings(db, coverage, keys, { allowUnboundExisting: !initialized });
  db.run("INSERT OR IGNORE INTO _meta(key,value) VALUES('accountingBindingsInitialized','1')");
}
