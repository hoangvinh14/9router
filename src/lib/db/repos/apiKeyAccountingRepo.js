import { isAccountedOpenaiChatProvider } from '../../../../open-sse/config/accountedChatProviders.js';
import { randomUUID } from "node:crypto";
import { MAX_NANO_USD, ACCOUNTING_STATE as STATE } from "../../../../open-sse/config/apiKeyBudgetConstants.js";
import { getAdapter } from "../driver.js";
import { costFromExactUsage } from "../../pricing/money.js";
import { ACCOUNTING_CACHE_TIER_FIELDS } from '../../../../open-sse/config/accountingCacheTiers.js';
import { explicitPolicyFormat, validateExplicitPolicy } from "../explicitPolicy.js";
import { validateAccountingUsageEvidence } from '../../../../open-sse/utils/accountingUsageEvidence.js';
import { synchronousResult } from "../durableFile.js";
import { snapshotAccountingGroup } from '../accountingGroupPayload.js';
import { resolveQueuedAccountingCommandSync } from '../../apiKeyBudget/service.js';

function conflict(message) {
  const error = new Error(message); error.status = 409; error.code = "api_key_accounting_conflict"; return error;
}
export function validateNanoUsd(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,15})$/.test(value)) throw new Error("Invalid nanoUSD decimal string");
  const amount = BigInt(value);
  if (amount > MAX_NANO_USD) throw new Error("nanoUSD range exceeded");
  return Number(amount);
}
function text(value, field) {
  if (typeof value !== "string" || !value || value.length > 512) throw new Error(`Invalid ${field}`);
  return value;
}
function timestamp(value) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error("Invalid UTC timestamp");
  return value;
}
function canonical(value, depth = 0) {
  if (depth > 12) throw new Error("Accounting payload depth exceeded");
  if (value === null || ["string", "boolean"].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== "object" || Object.keys(value).length > 100) throw new Error("Invalid accounting payload");
  if (Array.isArray(value)) return `[${value.map(v => canonical(v, depth + 1)).join(",")}]`;
  if (Object.keys(value).some(k => ["__proto__", "constructor", "prototype"].includes(k))) throw new Error("Invalid accounting payload field");
  const json = `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k], depth + 1)}`).join(",")}}`;
  if (json.length > 16384) throw new Error("Accounting payload size exceeded");
  return json;
}
function readLedgerJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch {
    const error = new Error("Stored accounting payload corrupt; reconciliation required");
    error.status = 503; error.code = "api_key_accounting_unavailable"; throw error;
  }
}
function rowToAttempt(row) {
  if (!row) return null;
  const { usageJson, priceSnapshotJson, terminalJson, ...rest } = row;
  return { ...rest, costNanoUsd: row.costNanoUsd === null ? null : String(row.costNanoUsd),
    usage: readLedgerJson(usageJson), priceSnapshot: readLedgerJson(priceSnapshotJson) };
}
export function getAttemptSync(db, attemptId) {
  return rowToAttempt(db.get("SELECT * FROM apiKeyAccounting WHERE attemptId=?", [attemptId]));
}
function insertAttemptMutation(db, input) {
  for (const field of ["attemptId", "requestId", "apiKeyId", "ownerInstanceId", "provider", "model", "endpoint"]) text(input[field], field);
  timestamp(input.startedAt);
  const snapshot = input.priceSnapshot === undefined || input.priceSnapshot === null ? null : canonical(input.priceSnapshot);
    const previous = db.get("SELECT * FROM apiKeyAccounting WHERE attemptId=?", [input.attemptId]);
    if (previous) {
      for (const field of ["requestId", "apiKeyId", "ownerInstanceId", "provider", "model", "endpoint", "startedAt"]) {
        if (previous[field] !== input[field]) throw conflict("Attempt identity conflict");
      }
      if (previous.priceSnapshotJson !== snapshot || previous.connectionId !== (input.connectionId ?? null)) throw conflict("Attempt snapshot conflict");
      return rowToAttempt(previous);
    }
    db.run(`INSERT INTO apiKeyAccounting(attemptId,requestId,apiKeyId,ownerInstanceId,startedAt,provider,model,endpoint,connectionId,state,priceSnapshotJson)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [input.attemptId, input.requestId, input.apiKeyId, input.ownerInstanceId, input.startedAt,
      input.provider, input.model, input.endpoint, input.connectionId ?? null, STATE.PENDING, snapshot]);
    return getAttemptSync(db, input.attemptId);
}
export function insertAttemptSync(db, input) {
  return db.durableTransaction(() => insertAttemptMutation(db, input));
}
function finalizeAttemptMutation(db, attemptId, terminal) {
  if (![STATE.SETTLED, STATE.UNRESOLVED, STATE.NOT_DISPATCHED].includes(terminal.state)) throw new Error("Invalid automatic accounting state");
  timestamp(terminal.finishedAt); text(terminal.outcome, "outcome");
  const cost = terminal.state === STATE.SETTLED ? validateNanoUsd(terminal.costNanoUsd) : null;
  if (terminal.state === STATE.SETTLED && (cost === null || !terminal.usage)) throw new Error("Settlement requires cost and exact usage");
  if (terminal.state !== STATE.SETTLED && terminal.costNanoUsd != null) throw new Error("Unresolved/not-dispatched cost must be null");
  if (terminal.usageEvidence !== undefined) {
    if (terminal.state !== STATE.UNRESOLVED || terminal.usage !== undefined) throw new Error('Invalid accounting usage evidence state');
    terminal = { ...terminal, usageEvidence: validateAccountingUsageEvidence(terminal.usageEvidence) };
  }
  const payload = canonical(terminal);
    const row = db.get("SELECT * FROM apiKeyAccounting WHERE attemptId=?", [attemptId]);
    if (!row) throw new Error("Unknown attempt");
    if (terminal.usageEvidence && (!isAccountedOpenaiChatProvider(row.provider) || row.endpoint !== 'chat')) throw new Error('Invalid accounting usage evidence attempt');
    if (row.terminalJson === payload) return rowToAttempt(row);
    if (row.manuallyResolved || ![STATE.PENDING, STATE.UNRESOLVED].includes(row.state) || row.state === STATE.UNRESOLVED && terminal.state !== STATE.SETTLED) {
      // Commit an observation signal without changing an already settled amount.
      db.run(`INSERT INTO apiKeyAccountingAudit(id,attemptId,apiKeyId,operationId,actor,reason,action,beforeJson,afterJson,createdAt)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, [randomUUID(), attemptId, row.apiKeyId, randomUUID(), "accounting_callback", "Conflicting terminal observation",
        "observation_conflict", canonical(rowToAttempt(row)), payload, new Date().toISOString()]);
      return { observationConflict: true };
    }
    const result = db.run(`UPDATE apiKeyAccounting SET state=?,outcome=?,finishedAt=?,usageJson=?,costNanoUsd=?,terminalJson=?,resolutionVersion=resolutionVersion+1
      WHERE attemptId=? AND resolutionVersion=?`, [terminal.state, terminal.outcome, terminal.finishedAt, terminal.usage ? canonical(terminal.usage) : null,
      cost, payload, attemptId, row.resolutionVersion]);
    if (Number(result.changes) !== 1) throw conflict("Attempt resolution version conflict");
    return getAttemptSync(db, attemptId);
}
export function finalizeAttemptSync(db, attemptId, terminal) {
  const finalized = db.durableTransaction(() => finalizeAttemptMutation(db, attemptId, terminal));
  if (finalized.observationConflict) throw conflict("Attempt terminal observation conflict");
  return finalized;
}

// Internal storage primitive, NOT admission authority. Caller must already own
// fresh validated identity/config/policy/price authority at the mutation boundary.
// No arbitrary callbacks/SQL. Results escape only after the group's durable ACK.
export function applyAccountingGroupSync(db, commands) {
  const prepared = snapshotAccountingGroup(commands);
  return db.durableTransaction(() => prepared.map(command => {
    let value;
    try {
      value = db.transaction(() => {
        let fields = Object.keys(command).sort().join(',');
        if (command.type === 'service' && fields === 'operationId,retained,type') {
          // Only module-private service capabilities resolve; arbitrary IDs or
          // callbacks in queue payload cannot bypass fresh monetary authority.
          command = snapshotAccountingGroup([resolveQueuedAccountingCommandSync(db, command.operationId)])[0];
          fields = Object.keys(command).sort().join(',');
        }
        if (command.type === 'insert' && fields === 'input,type') return insertAttemptMutation(db, command.input);
        if (command.type === 'finalize' && fields === 'attemptId,terminal,type') return finalizeAttemptMutation(db, command.attemptId, command.terminal);
        throw new Error('Invalid accounting group command');
      });
    } catch (error) {
      // An uncertain savepoint release/rollback poisons native storage; never
      // downgrade it to a member-local refusal or ACK the rest of the group.
      if (!db.health().healthy) throw error;
      return { ok: false, error };
    }
    // Observation conflict audit committed in the member savepoint. Report its
    // refusal AFTER release so the existing append-only audit is not rolled back.
    if (value.observationConflict) return { ok: false, error: conflict('Attempt terminal observation conflict') };
    return { ok: true, value };
  }));
}

export function resolveAttemptSync(db, attemptId, recovery) {
  for (const field of ["operationId", "actor", "reason", "evidence"]) text(recovery[field], field);
  const actions = ["waive", "cost_correction", "exact_usage"];
  const fields = ["operationId", "actor", "reason", "evidence", "expectedVersion", "action"];
  if (recovery.action === "cost_correction") fields.push("costNanoUsd");
  if (recovery.action === "exact_usage") fields.push("usage");
  if (Object.keys(recovery).some(field => !fields.includes(field)) || !Number.isSafeInteger(recovery.expectedVersion) || recovery.expectedVersion < 0 || !actions.includes(recovery.action)) throw new Error("Invalid accounting recovery");
  if (recovery.action === "exact_usage") {
    const usageFields = ["exact", "input", "output", "cacheRead", "cacheWrite", "reasoning", "reasoningIncludedInOutput", ...ACCOUNTING_CACHE_TIER_FIELDS];
    if (!recovery.usage || Object.keys(recovery.usage).some(field => !usageFields.includes(field))) throw new Error("Invalid exact recovery usage");
  }
  const payload = canonical(recovery);
  return db.durableTransaction(() => {
    const previous = db.get("SELECT * FROM apiKeyAccountingAudit WHERE operationId=?", [recovery.operationId]);
    if (previous) {
      if (previous.attemptId !== attemptId || previous.afterJson !== payload) throw conflict("Recovery operation conflict");
      return getAttemptSync(db, attemptId);
    }
    const row = db.get("SELECT * FROM apiKeyAccounting WHERE attemptId=?", [attemptId]);
    if (!row || row.resolutionVersion !== recovery.expectedVersion || row.state !== STATE.UNRESOLVED) throw conflict("Recovery resolution version/state conflict");
    let cost = 0;
    if (recovery.action === "exact_usage") {
      const snapshot = readLedgerJson(row.priceSnapshotJson);
      if (!snapshot?.rates) throw new Error("Original price snapshot required for exact recovery");
      cost = validateNanoUsd(costFromExactUsage(recovery.usage, snapshot.rates, { requireCacheTiers: snapshot.usageSemantics?.cacheWriteTiers === 'observed_5m_1h' }));
    } else if (recovery.action === "cost_correction") cost = validateNanoUsd(recovery.costNanoUsd);
    if (cost === null) throw new Error("Recovery cost required");
    const state = recovery.action === "waive" ? STATE.WAIVED : STATE.SETTLED;
    const usageJson = recovery.action === "exact_usage" ? canonical(recovery.usage) : row.usageJson;
    const updated = db.run("UPDATE apiKeyAccounting SET state=?,costNanoUsd=?,usageJson=?,manuallyResolved=1,resolutionVersion=resolutionVersion+1 WHERE attemptId=? AND resolutionVersion=?", [state, cost, usageJson, attemptId, recovery.expectedVersion]);
    if (Number(updated.changes) !== 1) throw conflict("Recovery resolution version conflict");
    db.run(`INSERT INTO apiKeyAccountingAudit(id,attemptId,apiKeyId,operationId,actor,reason,action,beforeJson,afterJson,createdAt)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, [randomUUID(), attemptId, row.apiKeyId, recovery.operationId, recovery.actor, recovery.reason, recovery.action,
      canonical(rowToAttempt(row)), payload, new Date().toISOString()]);
    return getAttemptSync(db, attemptId);
  });
}
export function getPolicySync(db, apiKeyId) {
  const row = db.get("SELECT * FROM apiKeyBudgetPolicies WHERE apiKeyId=?", [apiKeyId]);
  if (explicitPolicyFormat(db)) validateExplicitPolicy(row);
  if (!row) return { apiKeyId, weeklyLimitNanoUsd: null, monthlyLimitNanoUsd: null, version: 0, updatedAt: null };
  return { ...row, weeklyLimitNanoUsd: row.weeklyLimitNanoUsd === null ? null : String(row.weeklyLimitNanoUsd), monthlyLimitNanoUsd: row.monthlyLimitNanoUsd === null ? null : String(row.monthlyLimitNanoUsd) };
}
export function putPolicySync(db, apiKeyId, limits, expectedVersion, beforeWrite = null) {
  text(apiKeyId, "apiKeyId");
  const weekly = validateNanoUsd(limits.weeklyLimitNanoUsd), monthly = validateNanoUsd(limits.monthlyLimitNanoUsd);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("Invalid policy version");
  if (beforeWrite !== null && (typeof beforeWrite !== "function" || beforeWrite.constructor?.name === "AsyncFunction")) throw new Error("Policy guard must be synchronous");
  return db.durableTransaction(() => {
    if (beforeWrite) synchronousResult(beforeWrite());
    const before = getPolicySync(db, apiKeyId);
    if (before.version !== expectedVersion) throw conflict("Policy version conflict");
    db.run(`INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,?,?,?,?)
      ON CONFLICT(apiKeyId) DO UPDATE SET weeklyLimitNanoUsd=excluded.weeklyLimitNanoUsd,monthlyLimitNanoUsd=excluded.monthlyLimitNanoUsd,version=excluded.version,updatedAt=excluded.updatedAt`,
    [apiKeyId, weekly, monthly, expectedVersion + 1, new Date().toISOString()]);
    return getPolicySync(db, apiKeyId);
  });
}
export function sumSpendSync(db, apiKeyId, start, end) {
  // SQLite SUM can overflow; JS Number would silently lose exactness. Each row
  // is range-checked on ingress and accumulated exactly here as a decimal string.
  const rows = db.all(`SELECT costNanoUsd FROM apiKeyAccounting WHERE apiKeyId=? AND startedAt>=? AND startedAt<? AND state IN (?,?)`, [apiKeyId, start, end, STATE.SETTLED, STATE.WAIVED]);
  return rows.reduce((total, row) => total + BigInt(row.costNanoUsd), 0n).toString();
}
export function countStatesSync(db, apiKeyId) {
  const result = { pending: 0, unresolved: 0 };
  for (const row of db.all("SELECT state,COUNT(*) AS count FROM apiKeyAccounting WHERE apiKeyId=? AND state IN (?,?) GROUP BY state", [apiKeyId, STATE.PENDING, STATE.UNRESOLVED])) result[row.state] = row.count;
  return result;
}
export async function getApiKeyBudgetPolicy(apiKeyId) { return getPolicySync(await getAdapter(), apiKeyId); }
export async function getApiKeyAccountingAttempt(attemptId) { return getAttemptSync(await getAdapter(), attemptId); }
