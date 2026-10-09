import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { createNodeSqliteAdapter } from '@/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { createBudgetContext } from '@/lib/apiKeyBudget/service.js';
import { getAccountingWriteCoordinator } from '@/lib/apiKeyBudget/accountingWriteCoordinator.js';
import { describe, expect, it } from 'vitest';

// Explicit service-only matched measurement, not HTTP/app or deployment acceptance.
// 64 attempts per scenario, alternating two keys, widths1/16, ledgers0/256.
// Each scenario gets fresh owned storage. Seed/setup excluded, warm price resolver.
const timestamp = '2026-10-03T00:00:00.000Z';
const candidate = { provider: 'fixture', model: 'fixture' };
const usage = { exact: true, input: 1000000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true };
const receipts = [];
const quantile = (samples, q) => [...samples].sort((a, b) => a - b)[Math.max(0, Math.ceil(samples.length * q) - 1)];
async function measure(engine, mode, width, ledgerSize) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-group-io-bench-'));
  fs.mkdirSync(path.join(directory, 'db')); const file = path.join(directory, 'db/data.sqlite');
  let db, owner, coordinator, restoreIo;
  const delay = monitorEventLoopDelay({ resolution: 10 });
  try {
    owner = acquireWriterOwnership(directory);
    db = await (engine === 'node:sqlite' ? createNodeSqliteAdapter(file, owner) : createSqlJsAdapter(file, owner));
    await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
    db.durableTransaction(() => {
      const keys = ['a', 'b'].map(id => ({ id, key: `dummy-${id}` }));
      for (const key of keys) db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)', [key.id, key.key, timestamp]);
      retainKeyBindings(db, db.coverage, keys);
      db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt',?)", [timestamp]);
      db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture',?)", [JSON.stringify({ fixture: { input: '1', output: '2' } })]);
    });
    coordinator = getAccountingWriteCoordinator(db);
    const contexts = await Promise.all(['a', 'b'].map(id => createBudgetContext(id, { adapter: async () => db, clock: () => timestamp, project: () => {} })));
    for (const context of contexts) context.updatePolicy({ weeklyLimitUsd: '10000', monthlyLimitUsd: '10000', expectedVersion: 0 });
    // Matched history, same real service arithmetic/ACKs. These unmeasured setup
    // operations also warm resolver state; no spend cache or admission bypass.
    for (let i = 0; i < ledgerSize; i++) {
      const context = contexts[i % 2]; context.completeAttempt(context.beginAttempt(candidate), { usage });
    }
    const admissions = [], terminals = [];
    let commits = 0, publishedImages = 0, imageBytes = 0;
    const durable = db.durableTransaction.bind(db), rename = fs.renameSync;
    db.durableTransaction = callback => { const result = durable(callback); commits++; return result; };
    fs.renameSync = (from, to) => {
      if (engine === 'sql.js' && to === file) { imageBytes += fs.statSync(from).size; publishedImages++; }
      return rename(from, to);
    };
    const readCounters = process.env.ACCOUNTING_BENCH_COUNTERS === '1' ? {} : null;
    const restores = [];
    if (readCounters) {
      // Diagnostic-only counters: no SQL params/credentials, and accumulated
      // inclusive method time may overlap nested methods. Not performance proof.
      for (const [object, name] of [[db, 'get'], [db, 'all'], [db, 'health'], [db.coverage, 'status']]) {
        const original = object[name];
        object[name] = function(...args) {
          const label = name === 'get' || name === 'all' ? `${name}:${args[0].replace(/\s+/g, ' ').trim()}` : name === 'status' ? 'coverage.status' : name;
          const counter = readCounters[label] ??= { count: 0, inclusiveMs: 0 };
          counter.count++; const before = performance.now();
          try { return original.apply(this, args); } finally { counter.inclusiveMs += performance.now() - before; }
        };
        restores.push(() => { object[name] = original; });
      }
    }
    restoreIo = () => { for (const restore of restores) restore(); db.durableTransaction = durable; fs.renameSync = rename; };
    // Yield before/after the finite workload to sample event-loop delay. No
    // sleep-to-coalesce timer; width controls same-turn burst scheduling only.
    delay.enable(); await new Promise(resolve => setImmediate(resolve));
    const cpuStart = process.cpuUsage(); const started = performance.now(); const rssStart = process.memoryUsage().rss;
    for (let start = 0; start < 64; start += width) {
      const wave = [];
      for (let i = start; i < Math.min(64, start + width); i++) {
        const context = contexts[i % 2], before = performance.now();
        if (mode === 'sync') { const attempt = context.beginAttempt(candidate); admissions.push(performance.now() - before); wave.push({ context, attempt }); }
        else wave.push({ context, promise: context.beginAttemptQueued(candidate), before });
      }
      if (mode === 'queued') {
        const handles = await Promise.all(wave.map(async item => { const attempt = await item.promise; admissions.push(performance.now() - item.before); return { context: item.context, attempt }; }));
        wave.splice(0, wave.length, ...handles);
      }
      const completions = [];
      for (const item of wave) {
        const before = performance.now();
        if (mode === 'sync') { item.context.completeAttempt(item.attempt, { usage }); terminals.push(performance.now() - before); }
        else completions.push({ promise: item.context.completeAttemptQueued(item.attempt, { usage }), before });
      }
      if (mode === 'queued') await Promise.all(completions.map(async item => { await item.promise; terminals.push(performance.now() - item.before); }));
    }
    const elapsedMs = performance.now() - started, cpu = process.cpuUsage(cpuStart);
    await new Promise(resolve => setImmediate(resolve)); delay.disable(); restoreIo(); restoreIo = null;
    const rows = db.all('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting');
    expect(rows).toHaveLength(ledgerSize + 64);
    expect(rows.every(row => row.state === 'settled' && BigInt(row.costNanoUsd) === 1000000000n)).toBe(true);
    expect(db.health().healthy).toBe(true);
    for (const key of ['a', 'b']) expect(rows.filter(row => row.apiKeyId === key)).toHaveLength((ledgerSize + 64) / 2);
    const receipt = { engine, mode, width, ledgerSize, attempts: 64, elapsedMs, attemptsPerSecond: 64000 / elapsedMs,
      commits, publishedImages, imageBytes, readCounters, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
      admissionMs: { p50: quantile(admissions, .5), p95: quantile(admissions, .95), p99: quantile(admissions, .99) },
      terminalMs: { p50: quantile(terminals, .5), p95: quantile(terminals, .95), p99: quantile(terminals, .99) },
      eventLoopDelayMs: { sampled: Number.isFinite(delay.mean), mean: Number.isFinite(delay.mean) ? delay.mean / 1e6 : null, max: delay.max / 1e6 },
      rssStart, rssEnd: process.memoryUsage().rss, exactLedgerNanoUsd: String(BigInt(rows.length) * 1000000000n) };
    receipts.push(receipt);
    return receipt;
  } finally {
    delay.disable(); restoreIo?.(); await coordinator?.stop(); db?.close(); owner?.release(); fs.rmSync(directory, { recursive: true, force: true });
  }
}
describe('explicit matched service group I/O measurement (no performance acceptance or app authority)', { timeout: 120000 }, () => {
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => [0, 256].flatMap(size => [1, 16].map(width => [engine, size, width]))))('%s ledger=%s width=%s preserves outcome and reports both modes', async (engine, size, width) => {
    // Alternate order to expose rather than pretend to remove warm-process bias.
    const order = (size === 0) === (width === 1) ? ['sync', 'queued'] : ['queued', 'sync'];
    const pair = {};
    for (const mode of order) pair[mode] = await measure(engine, mode, width, size);
    expect(pair.sync.exactLedgerNanoUsd).toBe(pair.queued.exactLedgerNanoUsd);
    expect(pair.sync.commits).toBe(128);
    if (width === 1) expect(pair.queued.commits).toBe(128);
    else expect(pair.queued.commits).toBeLessThan(pair.sync.commits);
    if (engine === 'sql.js') for (const mode of order) expect(pair[mode].publishedImages).toBe(pair[mode].commits);
    const output = process.env.ACCOUNTING_BENCH_REPORT;
    expect(output).toBeTruthy();
    fs.writeFileSync(output, JSON.stringify({ scope: 'service-only; no wire authority/throughput threshold/full-adapter acceptance', workload: '64attempts 2keys widths1/16 history0/256 fixedexactusage/rates; no liveproviders; project=noop',
      instrumentation: process.env.ACCOUNTING_BENCH_COUNTERS === '1' ? 'diagnostic read/health/coverage counters; inclusive timings overlap and add overhead, not comparable to uninstrumented receipt' : 'durable/publication count only',
      limitations: ['one sample per scenario, alternating order not full statistical matching', 'latency includes fresh gates+own ACK; queue delay not separately instrumented', 'SQL.js image bytes not native WAL/fsync/system-wide disk bytes', 'RSS endpoints not peak/queue-retained heap; event-loop sample may be unavailable', 'Node/SQL.js only; no Bun/better/app/build/browser acceptance'], receipts }, null, 2));
  });
});
