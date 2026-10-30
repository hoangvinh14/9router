import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openFixture } from '../fixtures/accounting/test-database.js';

const roots = [], children = new Set(), fixtures = [];
afterEach(async () => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended;
  }
  children.clear();
  for (const fixture of fixtures.splice(0)) fixture.db.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
async function history(engine, kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-provenance-')); roots.push(root);
  const file = path.join(root, 'data.sqlite');
  const child = fork(fileURLToPath(new URL('../fixtures/accounting/b1-legacy-process.mjs', import.meta.url)),
    [engine, file, kind], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.add(child); let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const ended = once(child, 'exit');
  const [ready] = await Promise.race([once(child, 'message'), ended.then(([code, signal]) => { throw new Error(`${code}/${signal}: ${stderr}`); })]);
  expect(ready).toEqual({ phase: 'ready', driver: engine === 'node' ? 'node:sqlite' : 'sql.js' });
  child.send('run');
  expect(await ended).toEqual([null, 'SIGKILL']);
  const witness = `${file}.fault-witness`;
  if (kind === 'known-write-lost') expect(JSON.parse(fs.readFileSync(witness, 'utf8'))).toEqual({ phase: 'terminal-mutated', cost: '1200000' });
  else expect(fs.existsSync(witness)).toBe(false);
  const fixture = await openFixture(engine, file); fixtures.push(fixture);
  return fixture.db;
}
function evidence(db) {
  const rows = db.all('SELECT * FROM apiKeyAccounting ORDER BY attemptId');
  const ambiguous = rows.find(row => row.attemptId === 'ambiguous-attempt');
  expect(ambiguous).toMatchObject({ state: 'unrecorded', outcome: 'network_unknown', usageJson: null, costNanoUsd: null, terminalJson: null });
  expect(rows.find(row => row.attemptId === 'known-charge')).toMatchObject({ state: 'settled', costNanoUsd: 1200000 });
  // Separate DB lifetimes necessarily have distinct owners and recovery times.
  // Normalize only those incidental fields, including the retained intent owner.
  const ledger = rows.map(row => ({ ...row, ownerInstanceId: '<owner>',
    finishedAt: row.state === 'unrecorded' ? '<recovery-time>' : row.finishedAt,
    intentJson: JSON.stringify({ ...JSON.parse(row.intentJson), ownerInstanceId: '<owner>' }) }));
  const bindings = db.all('SELECT * FROM apiKeyBindings').map(row => ({ ...row, fingerprint: '<installation-fingerprint>', createdAt: '<key-created>' }));
  const keys = db.all('SELECT * FROM apiKeys').map(row => ({ ...row, createdAt: '<key-created>' }));
  const policies = db.all('SELECT * FROM apiKeyBudgetPolicies').map(row => ({ ...row, updatedAt: '<key-created>' }));
  const status = db.coverage.status('key-one');
  expect(status.gaps).toEqual([]);
  expect(db.health().healthy).toBe(true);
  return { ledger, audit: db.all('SELECT * FROM apiKeyAccountingAudit'), bindings, keys, policies,
    coverage: { generation: status.generation, maintenance: status.maintenance, gaps: status.gaps } };
}
for (const engine of ['node', 'sqljs']) describe(`${engine} B1 approved crash-ambiguity compatibility`, () => {
  it('cannot distinguish absent usage from exact usage lost before commit after actual process death', async () => {
    const absent = await history(engine, 'absent');
    const lost = await history(engine, 'known-write-lost');
    expect(evidence(lost)).toEqual(evidence(absent));
  });
});
