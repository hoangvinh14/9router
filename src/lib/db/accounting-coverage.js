import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { atomicDurableWrite } from "./durableFile.js";
import { canonical, conflict, text, timestamp, unavailable } from "../accounting/attempt-payload.js";

export const COVERAGE_FILE = ".accounting-coverage.json";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_RECEIPTS = 512;
const digest = value => createHash("sha256").update(value).digest("hex");
const hex = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
function validate(s) {
  if (!s || s.version !== 1 || typeof s.id !== "string" || !s.id || !hex(s.bindingKey) || !integer(s.generation) ||
      !Array.isArray(s.gaps) || !Array.isArray(s.retiredBindings) || !Array.isArray(s.receipts) || s.receipts.length > MAX_RECEIPTS ||
      Object.keys(s).some(k => !["version", "id", "bindingKey", "generation", "gaps", "retiredBindings", "receipts", "maintenance"].includes(k))) throw unavailable("Invalid accounting coverage");
  const ids = new Set(), fingerprints = new Set(), gapIds = new Set(), operations = new Set();
  for (const b of s.retiredBindings) {
    text(b.apiKeyId, "retired key ID", 200); timestamp(b.retiredAt);
    if (!hex(b.fingerprint) || ids.has(b.apiKeyId) || fingerprints.has(b.fingerprint)) throw unavailable("Invalid retired bindings");
    ids.add(b.apiKeyId); fingerprints.add(b.fingerprint);
  }
  for (const g of s.gaps) {
    text(g.id, "gap ID"); text(g.reason, "gap reason", 2000); timestamp(g.startedAt);
    if (g.apiKeyId !== null) text(g.apiKeyId, "gap scope", 200);
    if (!integer(g.generation) || g.generation < 1 || g.generation > s.generation || gapIds.has(g.id)) throw unavailable("Invalid coverage gap");
    gapIds.add(g.id);
    if (g.resolvedAt !== undefined) { timestamp(g.resolvedAt); text(g.operationId, "gap operation"); }
  }
  if (s.maintenance !== null) {
    if (!s.maintenance || !integer(s.maintenance.generation) || s.maintenance.generation < 1 || s.maintenance.generation > s.generation) throw unavailable("Invalid maintenance");
    text(s.maintenance.reason, "maintenance reason", 2000); timestamp(s.maintenance.startedAt);
  }
  for (const r of s.receipts) {
    text(r.operationId, "operation ID"); timestamp(r.acknowledgedAt);
    if (!hex(r.payloadHash) || operations.has(r.operationId) || !integer(r.generation) || r.generation > s.generation) throw unavailable("Invalid coverage receipt");
    operations.add(r.operationId);
  }
  return s;
}
function read(file) {
  let fd;
  try {
    const entry = fs.lstatSync(file);
    if (!entry.isFile() || entry.nlink !== 1) throw unavailable();
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES || (stat.mode & 0o077) !== 0) throw unavailable();
    return validate(JSON.parse(fs.readFileSync(fd, "utf8")));
  } catch (cause) { throw unavailable(`Accounting coverage unavailable: ${cause.code || "invalid material"}`); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function exists(file) {
  try { fs.lstatSync(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

// Raw read capability only: factories call this before PRAGMA, timers or migration.
export function validateAccountingArtifacts(get, directory) {
  const hasTable = name => get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])?.name === name;
  const meta = key => hasTable("_meta") ? get("SELECT value FROM _meta WHERE key=?", [key])?.value : undefined;
  const reference = meta("accountingCoverageId"), keyId = meta("accountingBindingKeyId"), activated = meta("ledgerStartedAt");
  const populated = ["apiKeyBindings", "apiKeyAccounting", "apiKeyAccountingAudit"].some(name => hasTable(name) && get(`SELECT 1 AS found FROM ${name} LIMIT 1`));
  const file = path.join(directory, COVERAGE_FILE);
  if (!exists(file)) {
    if (reference || keyId || activated || populated) throw unavailable("Required accounting coverage missing");
    return;
  }
  const s = read(file);
  if (!reference) {
    if (keyId || activated || populated || s.generation || s.maintenance || s.gaps.length || s.retiredBindings.length || s.receipts.length) throw unavailable("Orphan accounting coverage");
    return;
  }
  if (reference !== s.id || keyId !== digest(s.bindingKey)) throw unavailable("Accounting coverage binding mismatch");
}

export function openAccountingCoverage(db, owner) {
  owner.assertOwned();
  const file = path.join(owner.directory, COVERAGE_FILE);
  let state;
  if (exists(file)) state = read(file);
  else {
    const required = db.get("SELECT value FROM _meta WHERE key IN ('accountingCoverageId','accountingBindingKeyId','ledgerStartedAt') LIMIT 1");
    if (required || db.get("SELECT 1 AS found FROM apiKeyBindings LIMIT 1") || db.get("SELECT 1 AS found FROM apiKeyAccounting LIMIT 1")) throw unavailable();
    state = { version: 1, id: randomUUID(), bindingKey: randomBytes(32).toString("hex"), generation: 0, gaps: [], retiredBindings: [], receipts: [], maintenance: null };
    atomicDurableWrite(file, JSON.stringify(state));
  }
  const keyId = digest(state.bindingKey);
  db.durableTransaction(() => {
    for (const [key, value] of [["accountingCoverageId", state.id], ["accountingBindingKeyId", keyId]]) {
      const previous = db.get("SELECT value FROM _meta WHERE key=?", [key]);
      if (previous && previous.value !== value) throw unavailable("Accounting artifact mismatch");
      db.run("INSERT OR IGNORE INTO _meta(key,value) VALUES(?,?)", [key, value]);
    }
  });
  let poisoned = false;
  function current() {
    owner.assertOwned();
    if (poisoned) throw unavailable();
    const next = read(file);
    const retained = (rows, after, id) => rows.every(row => after.some(other => other[id] === row[id] && JSON.stringify(other) === JSON.stringify(row)));
    const gapsRetained = state.gaps.every(gap => {
      const after = next.gaps.find(g => g.id === gap.id);
      return after && after.apiKeyId === gap.apiKeyId && after.startedAt === gap.startedAt && after.generation >= gap.generation &&
        (!gap.resolvedAt || after.resolvedAt === gap.resolvedAt && after.operationId === gap.operationId);
    });
    if (next.id !== state.id || next.bindingKey !== state.bindingKey || next.generation < state.generation || !gapsRetained ||
        !retained(state.retiredBindings, next.retiredBindings, "apiKeyId") || !retained(state.receipts, next.receipts, "operationId")) throw unavailable("Accounting history changed");
    if (db.health().healthy && (db.get("SELECT value FROM _meta WHERE key='accountingCoverageId'")?.value !== next.id ||
        db.get("SELECT value FROM _meta WHERE key='accountingBindingKeyId'")?.value !== keyId)) throw unavailable("Accounting database reference changed");
    state = next;
    return next;
  }
  function mutate(work) {
    const next = structuredClone(current());
    work(next); validate(next);
    const bytes = JSON.stringify(next);
    if (Buffer.byteLength(bytes) > MAX_BYTES) throw unavailable("Accounting coverage capacity exceeded");
    try { atomicDurableWrite(file, bytes); } catch (error) { poisoned = true; throw error; }
    state = next;
  }
  function status(apiKeyId = null) {
    const s = current();
    return structuredClone({ version: 1, id: s.id, bindingKeyId: keyId, generation: s.generation, maintenance: s.maintenance,
      gaps: s.gaps.filter(g => apiKeyId === null || g.apiKeyId === null || g.apiKeyId === apiKeyId) });
  }
  function fingerprint(secret) {
    text(secret, "key secret", 8192);
    return createHmac("sha256", Buffer.from(current().bindingKey, "hex")).update(secret).digest("hex");
  }
  function retainRetiredBindings(bindings) {
    const next = structuredClone(current());
    for (const b of bindings) {
      text(b.apiKeyId, "key ID", 200);
      if (!hex(b.fingerprint)) throw unavailable();
      if (next.retiredBindings.some(old => old.apiKeyId === b.apiKeyId && old.fingerprint !== b.fingerprint || old.fingerprint === b.fingerprint && old.apiKeyId !== b.apiKeyId)) throw conflict();
      if (!next.retiredBindings.some(old => old.apiKeyId === b.apiKeyId)) next.retiredBindings.push({ apiKeyId: b.apiKeyId, fingerprint: b.fingerprint, retiredAt: new Date().toISOString() });
    }
    if (JSON.stringify(next.retiredBindings) !== JSON.stringify(state.retiredBindings)) mutate(s => { s.retiredBindings = next.retiredBindings; });
  }
  function latchGap(apiKeyId, reason) {
    if (apiKeyId !== null) text(apiKeyId, "key ID", 200);
    text(reason, "gap reason", 2000);
    mutate(s => {
      if (!Number.isSafeInteger(s.generation + 1)) throw unavailable();
      const generation = ++s.generation;
      const gap = s.gaps.find(g => g.apiKeyId === apiKeyId && !g.resolvedAt);
      if (gap) Object.assign(gap, { generation, reason });
      else s.gaps.push({ id: randomUUID(), apiKeyId, generation, reason, startedAt: new Date().toISOString() });
    });
    return status(apiKeyId);
  }
  function enterMaintenance(reason) {
    text(reason, "maintenance reason", 2000);
    mutate(s => { if (!Number.isSafeInteger(s.generation + 1)) throw unavailable(); s.maintenance = { generation: ++s.generation, reason, startedAt: new Date().toISOString() }; });
    return status();
  }
  function reconcile(input) {
    const operation = JSON.parse(canonical(input));
    const { action, operationId, expectedGeneration, actor, reason, evidence, gapId, apiKeyId } = operation;
    for (const [name, value] of Object.entries({ operationId, actor, reason, evidence })) text(value, name, name === "evidence" ? 4000 : 512);
    if (!["gap_waiver", "maintenance_release"].includes(action) || !integer(expectedGeneration) || expectedGeneration < 1 || Object.keys(operation).some(k => !["action", "operationId", "expectedGeneration", "actor", "reason", "evidence", "gapId", "apiKeyId"].includes(k))) throw conflict();
    if (action === "gap_waiver") { text(gapId, "gap ID"); if (apiKeyId !== null) text(apiKeyId, "key ID", 200); }
    else if (gapId !== undefined || apiKeyId !== undefined) throw conflict();
    const payload = canonical(operation), payloadHash = digest(`${state.id}\0${payload}`);
    const s = current(), receipt = s.receipts.find(r => r.operationId === operationId);
    const before = action === "maintenance_release" ? s.maintenance : s.gaps.find(g => g.id === gapId && g.apiKeyId === apiKeyId);
    const audit = db.get("SELECT * FROM apiKeyAccountingAudit WHERE operationId=?", [operationId]);
    if (audit && (audit.action !== action || audit.afterJson !== payload)) throw conflict();
    if (receipt) {
      if (receipt.payloadHash !== payloadHash || !audit) throw conflict();
      return { ...receipt };
    }
    if (!before || before.generation !== expectedGeneration || before.resolvedAt || s.receipts.length >= MAX_RECEIPTS) throw conflict();
    db.durableTransaction(() => {
      if (!audit) db.run("INSERT INTO apiKeyAccountingAudit(id,apiKeyId,gapId,operationId,actor,reason,action,beforeJson,afterJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [randomUUID(), action === "gap_waiver" ? apiKeyId : null, action === "gap_waiver" ? gapId : "global-maintenance", operationId, actor, reason, action, canonical(before), payload, new Date().toISOString()]);
    });
    const acknowledgedAt = new Date().toISOString();
    mutate(next => {
      const target = action === "maintenance_release" ? next.maintenance : next.gaps.find(g => g.id === gapId && g.apiKeyId === apiKeyId);
      if (!target || target.generation !== expectedGeneration || target.resolvedAt) throw conflict();
      if (action === "maintenance_release") next.maintenance = null;
      else Object.assign(target, { resolvedAt: acknowledgedAt, operationId });
      next.receipts.push({ operationId, payloadHash, generation: expectedGeneration, acknowledgedAt });
    });
    return { operationId, payloadHash, generation: expectedGeneration, acknowledgedAt };
  }
  return Object.freeze({ status, fingerprint, latchGap, enterMaintenance, reconcile, retainRetiredBindings,
    retiredBindings: () => structuredClone(current().retiredBindings) });
}
