// Disposable fixture only. Writer engine explicit; restart uses the actual
// production driver (Node on this runtime), not an invented SQL.js fallback.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const [directory, engine, mode, installedText] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory) || !['node:sqlite', 'sql.js'].includes(engine) || !['crash', 'inspect', 'recover'].includes(mode) || !['true', 'false'].includes(installedText)) throw new Error('Invalid ACK crash fixture arguments');
process.env.DATA_DIR = directory;
const file = path.join(directory, 'db', 'data.sqlite');
const installed = installedText === 'true';
let calls = 0, inject;
// Installed before SSR loads proxyFetch so no external traffic is possible.
globalThis.fetch = async () => {
  calls++; inject();
  return Response.json({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
};
const { createServer } = await import('../node_modules/vite/dist/node/index.js');
const server = await createServer({ configFile: false, root: path.resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@': path.resolve(import.meta.dirname, '../../src'), 'open-sse': path.resolve(import.meta.dirname, '../../open-sse') } } });
const load = p => server.ssrLoadModule(p);
const repo = await load('/src/lib/db/repos/apiKeyAccountingRepo.js');
if (mode === 'crash') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { acquireWriterOwnership } = await load('/src/lib/db/writerOwnership.js');
  const { createNodeSqliteAdapter } = await load('/src/lib/db/adapters/nodeSqliteAdapter.js');
  const { createSqlJsAdapter } = await load('/src/lib/db/adapters/sqljsAdapter.js');
  const { runMigrationOnce } = await load('/src/lib/db/migrate.js');
  const { openAccountingCoverage } = await load('/src/lib/db/accountingCoverage.js');
  const { retainKeyBindings } = await load('/src/lib/db/helpers/apiKeyBindings.js');
  let owner = acquireWriterOwnership(directory);
  const open = () => engine === 'node:sqlite' ? createNodeSqliteAdapter(file, owner) : createSqlJsAdapter(file, owner);
  let db = await open(); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
  db.durableTransaction(() => { db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('ack-key','ack-fixture-secret',1,'2026-10-03T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: 'ack-key', key: 'ack-fixture-secret' }]); });
  db.close(); owner.release();
  const { initializePoliciesOffline } = await load('/src/lib/db/offlinePolicyInitialization.js');
  await initializePoliciesOffline({ directory, engine, actor: 'fixture', reason: 'ACK process fixture' });
  owner = acquireWriterOwnership(directory); db = await open(); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  db.durableTransaction(() => {
    // Only this disposable fixture is activated, never user data.
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'ack-model': { input: '1', output: '2' } })]);
  });
  repo.putPolicySync(db, 'ack-key', { weeklyLimitNanoUsd: '1000000000', monthlyLimitNanoUsd: null }, 0);
  let faultReached = false;
  inject = () => {
    if (engine === 'node:sqlite') {
      const exec = DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec = function (sql) { if (!faultReached && sql.startsWith('RELEASE')) { faultReached = true; if (installed) exec.call(this, sql); throw new Error('fixture RELEASE ACK lost'); } return exec.call(this, sql); };
    } else {
      const rename = fs.renameSync, sync = fs.fsyncSync; let renamed = false;
      fs.renameSync = (from, to) => { if (!installed && to === file) { faultReached = true; throw new Error('fixture rename failed'); } const value = rename(from, to); if (to === file) renamed = true; return value; };
      fs.fsyncSync = fd => { if (installed && renamed && fs.fstatSync(fd).isDirectory()) { faultReached = true; throw new Error('fixture directory ACK lost'); } return sync(fd); };
    }
  };
  const { createRequestAccounting } = await load('/src/lib/apiKeyBudget/requestAccounting.js');
  const context = await createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer ack-fixture-secret' } }), { adapter: async () => db });
  let completions = 0;
  const accounting = { ...context, completeAttempt(...args) { completions++; return context.completeAttempt(...args); } };
  const { BaseExecutor } = await load('/open-sse/executors/base.js');
  let code;
  try { await new BaseExecutor('openai', { baseUrl: 'http://fixture.invalid/chat', retry: { 502: { attempts: 2, delayMs: 0 } } }).execute({ model: 'ack-model', body: { messages: [{ role: 'user', content: 'fixture' }] }, stream: false, credentials: { apiKey: 'fixture' }, accounting }); }
  catch (error) { code = error.code; }
  if (code !== 'api_key_accounting_unavailable' || calls !== 1 || completions !== 1 || !faultReached || db.health().healthy) throw new Error('ACK fixture did not reach required failure boundary');
  // Synchronous output before actual death, never labels the failed settlement ACKed.
  fs.writeSync(1, 'FAULT:' + JSON.stringify({ code, calls, completions, faultReached, ownerInstanceId: owner.instanceId }) + '\n');
  process.kill(process.pid, 'SIGKILL');
} else {
  const { getAdapter } = await load('/src/lib/db/driver.js'); const db = await getAdapter();
  const before = db.get('SELECT * FROM apiKeyAccounting');
  const usage = { exact: true, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true };
  const operation = { operationId: 'ack-recovery-fixture', expectedVersion: 1, action: 'exact_usage', usage, actor: 'fixture-operator', reason: 'captured fixture raw usage', evidence: 'disposable fixture response only' };
  if (mode === 'recover') {
    // Change current prices: recovery must use the immutable original snapshot.
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='openai'", [JSON.stringify({ 'ack-model': { input: '9', output: '9' } })]));
    if (!installed) { repo.resolveAttemptSync(db, before.attemptId, operation); repo.resolveAttemptSync(db, before.attemptId, operation); }
    else { repo.finalizeAttemptSync(db, before.attemptId, JSON.parse(before.terminalJson)); repo.finalizeAttemptSync(db, before.attemptId, JSON.parse(before.terminalJson)); }
    const { replayAccountingUsageSync } = await load('/src/lib/db/repos/usageRepo.js'); replayAccountingUsageSync(db); replayAccountingUsageSync(db);
  }
  const result = { driver: db.driver, recoveredOwnerInstanceId: db.recoveredOwnerInstanceId || null, beforeState: before.state, attempt: repo.getAttemptSync(db, before.attemptId), attempts: db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n, audits: db.get("SELECT COUNT(*) AS n FROM apiKeyAccountingAudit WHERE operationId='ack-recovery-fixture'").n, usageRows: db.get('SELECT COUNT(*) AS n FROM usageHistory').n, receipts: db.get("SELECT COUNT(*) AS n FROM kv WHERE scope='accountingProjection'").n, spend: repo.sumSpendSync(db, 'ack-key', '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z') };
  fs.writeSync(1, 'RESULT:' + JSON.stringify(result) + '\n'); db.close(); await server.close();
}
