// Explicit isolated adapter fixture; no app startup, activation or network.
import fs from 'node:fs';
import path from 'node:path';
import { acquireWriterOwnership } from '../../src/lib/db/writerOwnership.js';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '../../src/lib/db/adapters/sqljsAdapter.js';
import { TABLES, buildCreateTableSql, SCHEMA_VERSION } from '../../src/lib/db/schema.js';
import { installAccountingInvariants } from '../../src/lib/db/accountingInvariants.js';
import { openAccountingCoverage } from '../../src/lib/db/accountingCoverage.js';
const [directory, engine, mode, boundary] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory) || !['node:sqlite', 'sql.js'].includes(engine) || !['crash', 'inspect', 'newer'].includes(mode) || !['audit', 'sidecar'].includes(boundary)) throw new Error('Invalid maintenance fixture arguments');
const owner = acquireWriterOwnership(directory), file = path.join(directory, 'data.sqlite');
const db = engine === 'node:sqlite' ? await createNodeSqliteAdapter(file, owner) : await createSqlJsAdapter(file, owner);
if (mode === 'crash') {
  db.durableTransaction(() => {
    for (const name of ['_meta', 'apiKeys', 'apiKeyBindings', 'apiKeyBudgetPolicies', 'apiKeyAccounting', 'apiKeyAccountingAudit']) db.exec(buildCreateTableSql(name, TABLES[name]));
    db.run("INSERT INTO _meta(key,value) VALUES('schemaVersion',?)", [String(SCHEMA_VERSION)]); installAccountingInvariants(db);
  });
}
db.coverage = openAccountingCoverage(db, owner);
if (mode === 'crash') {
  db.coverage.enterMaintenance('fixture original');
  const input = { expectedGeneration: db.coverage.status().maintenance.generation, operationId: 'process-maintenance-release', actor: 'fixture-operator', reason: 'reviewed', evidence: 'all-scope fixture review' };
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === db.coverage.file) {
      if (boundary === 'sidecar') rename(from, to);
      fs.writeSync(1, 'BOUNDARY:' + JSON.stringify({ boundary, owner: owner.instanceId, generation: input.expectedGeneration }) + '\n');
      process.kill(process.pid, 'SIGKILL');
    }
    return rename(from, to);
  };
  db.coverage.releaseMaintenance(input); throw new Error('Crash boundary was not reached');
} else {
  const audit = db.get("SELECT * FROM apiKeyAccountingAudit WHERE operationId='process-maintenance-release'");
  if (!audit || !owner.recoveredOwnerInstanceId) throw new Error('Missing committed audit or dead owner proof');
  const input = JSON.parse(audit.afterJson), before = db.coverage.status();
  if (mode === 'newer') db.coverage.enterMaintenance('fixture replacement');
  const preserved = db.coverage.status().maintenance, bytes = fs.readFileSync(db.coverage.file);
  let conflict = false;
  try { db.coverage.releaseMaintenance(input); } catch (error) { if (error.status !== 409) throw error; conflict = true; }
  const result = { recoveredOwner: owner.recoveredOwnerInstanceId, beforeMaintenance: before.maintenance, preserved,
    conflict, receipt: db.coverage.maintenanceReceipt(input), afterMaintenance: db.coverage.status().maintenance,
    unchanged: fs.readFileSync(db.coverage.file).equals(bytes), audits: db.get("SELECT COUNT(*) AS n FROM apiKeyAccountingAudit WHERE action='maintenance_release'").n,
    active: Boolean(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")) };
  fs.writeSync(1, 'RESULT:' + JSON.stringify(result) + '\n'); db.close(); owner.release();
}
