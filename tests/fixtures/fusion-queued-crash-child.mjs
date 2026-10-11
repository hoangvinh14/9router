// Disposable fusion process-death fixture. No user DB, live provider, or
// independent child agent. Death is this fixture's own PID only.
import fs from 'node:fs';
import path from 'node:path';
const [directory, engine, mode, stage] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory) || !['node:sqlite', 'sql.js'].includes(engine) || !['crash', 'inspect'].includes(mode) || !['pending', 'installed-panel', 'judge-intent', 'judge-completion'].includes(stage)) throw new Error('Invalid fusion crash fixture arguments');
process.env.DATA_DIR = directory;
// Bound this disposable child even when a shutdown hook observes SIGTERM.
const deadline = setTimeout(() => { fs.writeSync(2, 'Fixture child deadline exceeded\n'); process.exit(2); }, 25000);
deadline.unref();
const file = path.join(directory, 'db/data.sqlite');
let posted = 0, releasePhase;
const phase = new Promise(resolve => { releasePhase = resolve; });
// Install before loading proxyFetch: exact URL/method allowlist, no native
// fallback. Mock dispatch count is not native socket/TLS evidence.
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://api.openai.com/v1/chat/completions' || options.method !== 'POST' || options.redirect !== 'error') throw new Error('Unexpected fusion fixture transport');
  posted++;
  if (stage === 'pending') { if (posted === 2) releasePhase(); return new Promise(() => {}); }
  const body = JSON.parse(options.body);
  return Response.json({ choices: [{ message: { role: 'assistant', content: body.model }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
};
const { createServer } = await import('../node_modules/vite/dist/node/index.js');
const server = await createServer({ configFile: false, root: path.resolve(import.meta.dirname, '../..'), server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@': path.resolve(import.meta.dirname, '../../src'), 'open-sse': path.resolve(import.meta.dirname, '../../open-sse') } } });
const load = p => server.ssrLoadModule(p);
if (mode === 'crash') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { acquireWriterOwnership } = await load('/src/lib/db/writerOwnership.js');
  const owner = acquireWriterOwnership(directory);
  const { createNodeSqliteAdapter } = await load('/src/lib/db/adapters/nodeSqliteAdapter.js');
  const { createSqlJsAdapter } = await load('/src/lib/db/adapters/sqljsAdapter.js');
  const db = await (engine === 'node:sqlite' ? createNodeSqliteAdapter(file, owner) : createSqlJsAdapter(file, owner));
  await (await load('/src/lib/db/migrate.js')).runMigrationOnce(db);
  db.coverage = (await load('/src/lib/db/accountingCoverage.js')).openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
  const { retainKeyBindings } = await load('/src/lib/db/helpers/apiKeyBindings.js');
  db.durableTransaction(() => {
    db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('a','dummy-key-a',1,'2026-10-03T00:00:00.000Z')");
    retainKeyBindings(db, db.coverage, [{ id: 'a', key: 'dummy-key-a' }]);
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO settings(id,data) VALUES(1,?)", [JSON.stringify({ requireApiKey: true })]);
    db.run('INSERT INTO providerConnections(id,provider,authType,name,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?,?)',
      ['c', 'openai', 'apikey', 'fixture', 0, JSON.stringify({ apiKey: 'dummy-provider' }), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify(Object.fromEntries(['fixture-a', 'fixture-b', 'fixture-judge'].map(m => [m, { input: '1', output: '2' }])))]);
  });
  const { createBudgetContext } = await load('/src/lib/apiKeyBudget/service.js');
  (await createBudgetContext('a', { adapter: async () => db })).updatePolicy({ weeklyLimitUsd: '1', monthlyLimitUsd: '1', expectedVersion: 0 });
  const context = await (await load('/src/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true });
  let completions = 0, returned = false;
  const accounting = { ...context,
    async beforeAttempt(...args) {
      const h = await context.beforeAttempt(...args);
      if (stage === 'judge-intent' && h.model === 'fixture-judge') { releasePhase(); await new Promise(() => {}); }
      return h;
    },
    async completeAttempt(h, completion) {
      const terminal = await context.completeAttempt(h, completion); completions++;
      if (stage === 'installed-panel') { if (completions === 2) releasePhase(); await new Promise(() => {}); }
      if (stage === 'judge-completion' && h.model === 'fixture-judge') { releasePhase(); await new Promise(() => {}); }
      return terminal;
    } };
  const { BaseExecutor } = await load('/open-sse/executors/base.js');
  const { handleFusionChat } = await load('/open-sse/services/combo.js');
  // Same 1s collector as other fixtures; cold SSR transformation is setup,
  // not inference. Capture strict mocked fetch before starting any generation.
  await load('/open-sse/utils/proxyFetch.js');
  const { PROVIDERS } = await load('/open-sse/config/providers.js');
  if (PROVIDERS.openai.baseUrl !== 'https://api.openai.com/v1/chat/completions' || PROVIDERS.openai.forceStream !== true) throw new Error('Fixture canonical OpenAI transport changed');
  const executor = new BaseExecutor('openai', { ...PROVIDERS.openai, retry: { 502: { attempts: 0, delayMs: 0 } } });
  fs.writeSync(1, 'STAGE:dispatch-ready\n');
  const work = handleFusionChat({ body: { stream: false, messages: [{ role: 'user', content: 'fixture' }] }, models: ['fixture-a', 'fixture-b'], judgeModel: 'fixture-judge',
    tuning: { minPanel: 2, stragglerGraceMs: 5, panelHardTimeoutMs: 1000 }, accounting,
    log: { info(...args) { fs.writeSync(1, 'FUSION:' + JSON.stringify(args) + '\n'); }, warn(...args) { fs.writeSync(1, 'FUSION:' + JSON.stringify(args) + '\n'); } },
    async handleSingleModel(body, model, _panel, signal) {
      try {
        const result = await executor.execute({ body: { ...body, model }, model, stream: false, credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accounting, signal });
        if (!result.accountingOwned) throw new Error('Fixture missing own accounting'); return result.response;
      } catch (error) {
        fs.writeSync(2, 'LEAF:' + JSON.stringify({ model, name: error.name, code: error.code, message: error.message, stack: error.stack }) + '\n'); throw error;
      }
    } }).then(() => { returned = true; }, error => { returned = true; fs.writeSync(2, String(error) + '\n'); });
  const reached = await Promise.race([phase.then(() => true), work.then(() => false)]);
  if (!reached) {
    fs.writeSync(1, 'PREMATURE:' + JSON.stringify({ posted, completions, returned, rows: db.all('SELECT model,state,costNanoUsd FROM apiKeyAccounting') }) + '\n');
    throw new Error('Fusion finished before death fixture boundary');
  }
  const rows = db.all('SELECT attemptId,requestId,model,state,costNanoUsd FROM apiKeyAccounting');
  const expectedPosted = stage === 'judge-completion' ? 3 : 2;
  const expectedRows = stage.startsWith('judge-') ? 3 : 2;
  if (returned || posted !== expectedPosted || rows.length !== expectedRows || rows.some(r => r.state !==
      (stage === 'pending' || stage === 'judge-intent' && r.model === 'fixture-judge' ? 'pending' : 'settled'))) throw new Error('Fusion death boundary not reached');
  fs.writeSync(1, 'FAULT:' + JSON.stringify({ ownerInstanceId: owner.instanceId, posted, completions, returned, rows }) + '\n');
  // Only this child, at its verified fixture boundary. No blanket process kill.
  process.kill(process.pid, 'SIGKILL');
  await work;
} else {
  const db = await (await load('/src/lib/db/driver.js')).getAdapter();
  const repo = await load('/src/lib/db/repos/apiKeyAccountingRepo.js');
  const rows = db.all('SELECT attemptId FROM apiKeyAccounting').map(row => repo.getAttemptSync(db, row.attemptId));
  fs.writeSync(1, 'RESULT:' + JSON.stringify({ driver: db.driver, recoveredOwnerInstanceId: db.recoveredOwnerInstanceId, rows,
    spend: repo.sumSpendSync(db, 'a', '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z'),
    usageRows: db.get('SELECT COUNT(*) AS n FROM usageHistory').n, audits: db.get('SELECT COUNT(*) AS n FROM apiKeyAccountingAudit').n, posted }) + '\n');
  db.close(); await server.close(); clearTimeout(deadline);
}
