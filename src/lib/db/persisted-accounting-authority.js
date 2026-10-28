import { createHash } from "node:crypto";
import { verifyAccountingSchemaRows } from "./migrations/002-accounting-foundation.js";
import { verifyAccountingPolicySchemaRows } from "./helpers/accounting-policy.js";
import { assertReadSql, synchronousResult } from "./durableFile.js";
import { unavailable } from "../accounting/attempt-payload.js";

const TABLE_KEYS = Object.freeze({
  apiKeys: "id", apiKeyBindings: "apiKeyId", apiKeyBudgetPolicies: "apiKeyId",
  providerConnections: "id", providerNodes: "id", proxyPools: "id", settings: "id", combos: "id",
});

// A digest is only a veto against stale configuration. Permission always comes
// from a fresh read-only persisted image, schema, ownership and coverage proof.
function authorityDigest(reader) {
  const schema = reader.all("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name");
  verifyAccountingSchemaRows(schema);
  verifyAccountingPolicySchemaRows(schema);
  const digest = createHash("sha256");
  const add = value => digest.update(JSON.stringify(value)).update("\n");
  add(schema);
  for (const [table, key] of Object.entries(TABLE_KEYS)) add(reader.all(`SELECT * FROM ${table} ORDER BY ${key}`));
  add(reader.all("SELECT * FROM kv WHERE scope IN ('modelAliases','customModels','disabledModels','pricing','referencePricing') ORDER BY scope,key"));
  add(reader.all("SELECT * FROM _meta WHERE key IN ('schemaVersion','backupSchemaVersion','referencePricingRevision','accountingCoverageId','accountingBindingKeyId','accountingBindingsInitialized','accountingPoliciesInitialized','ledgerStartedAt') ORDER BY key"));
  return digest.digest("hex");
}

export function readOnlyAuthorityReader(get, all) {
  return Object.freeze({
    get(sql, params = []) { assertReadSql(sql); return get(sql, params); },
    all(sql, params = []) { assertReadSql(sql); return all(sql, params); },
  });
}

export function createPersistedAccountingAuthority({ owner, current, openReadOnly, health, quiescent }) {
  let acknowledged = null, prepared = null, releasing = null, failed = null;
  const capture = () => { try { return authorityDigest(current); } catch { return null; } };
  return Object.freeze({
    prepare(confirmCommitted = false) {
      prepared = capture(); releasing = prepared; failed = null;
      if (confirmCommitted && prepared) {
        const source = openReadOnly();
        try { acknowledged = authorityDigest(source.reader) === prepared ? prepared : null; }
        finally { source.close(); }
      }
    },
    beforeRelease() { releasing = capture(); },
    acknowledge() { acknowledged = releasing; prepared = null; releasing = null; failed = null; },
    fail(recordingPublication) {
      failed = recordingPublication && prepared && prepared === releasing && prepared === acknowledged ? prepared : null;
      prepared = null; releasing = null;
    },
    invalidate() { failed = null; prepared = null; releasing = null; },
    read(work) {
      owner.assertOwned();
      const state = health();
      if (!state.owned || state.closed || !quiescent()) throw unavailable("Persisted authority not quiescent");
      const expected = state.healthy ? capture() : failed;
      if (!expected || !state.healthy && expected !== acknowledged) throw unavailable("Recording-only authority unavailable");
      const source = openReadOnly();
      try {
        if (authorityDigest(source.reader) !== expected) throw unavailable("Persisted authority is stale");
        return synchronousResult(work(source.reader));
      } finally { source.close(); }
    },
  });
}
