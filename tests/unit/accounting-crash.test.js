import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { openFixture } from '../fixtures/accounting/test-database.js';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '../../src/lib/db/adapters/sqljsAdapter.js';

const children = new Set(); let root, reopened;
afterEach(async () => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; }
  children.clear(); reopened?.db.close(); reopened = null; if (root) fs.rmSync(root, { recursive: true, force: true });
});
async function start(engine, mode) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'accounting-crash-')); const file = path.join(root, 'data.sqlite');
  const child = fork(fileURLToPath(new URL('../fixtures/accounting/accounting-process.mjs', import.meta.url)), [engine, file, mode], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.add(child); let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const ready = await Promise.race([once(child, 'message').then(([message]) => message), once(child, 'exit').then(([code]) => { throw new Error(`Accounting child exited ${code}: ${stderr}`); })]);
  expect(ready).toEqual({ phase: 'ready', driver: engine === 'node' ? 'node:sqlite' : 'sql.js' });
  return { child, file };
}
for (const engine of ['node', 'sqljs']) describe(`${engine} actual process crash boundaries`, () => {
  it('reuses pristine durable sidecar after crash before its DB reference', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'accounting-crash-')); const file = path.join(root, 'data.sqlite');
    const child = fork(fileURLToPath(new URL('../fixtures/accounting/accounting-process.mjs', import.meta.url)), [engine, file, 'after-sidecar'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    children.add(child); const [code, signal] = await once(child, 'exit');
    expect(code).toBeNull(); expect(signal).toBe('SIGKILL');
    const original = JSON.parse(fs.readFileSync(path.join(root, '.accounting-coverage.json'), 'utf8'));
    const raw = await (engine === 'node' ? createNodeSqliteAdapter : createSqlJsAdapter)(file);
    expect(raw.get("SELECT value FROM _meta WHERE key='accountingCoverageId'")).toBeUndefined(); raw.close();
    reopened = await openFixture(engine, file);
    expect(reopened.db.coverage.status().id).toBe(original.id);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.accounting-coverage.json'), 'utf8')).bindingKey).toBe(original.bindingKey);
  });
  it('retains retirement across crash before the key delete commits', async () => {
    const { child, file } = await start(engine, 'after-retirement');
    const ended = once(child, 'exit'); child.send('run'); await ended;
    reopened = await openFixture(engine, file);
    expect(reopened.db.get("SELECT isActive FROM apiKeys WHERE id='key-one'").isActive).toBe(0);
    expect(reopened.db.get("SELECT retiredAt FROM apiKeyBindings WHERE apiKeyId='key-one'").retiredAt).toBeTruthy();
    expect(reopened.db.coverage.retiredBindings()).toHaveLength(1);
  });
  for (const mode of ['before-intent', 'inside-intent', 'after-intent', 'after-intent-lost-ack', 'before-terminal', 'inside-terminal', 'after-terminal']) {
    it(`${mode}: reopens persisted truth without manufacturing an ACK`, async () => {
      const { child, file } = await start(engine, mode);
      const ended = once(child, 'exit');
      const checkpoint = mode.startsWith('inside-') ? null : Promise.race([
        once(child, 'message'), ended.then(([code, signal]) => { throw new Error(`Accounting child exited before checkpoint: ${code}/${signal}`); }),
      ]);
      child.send('run');
      if (checkpoint) { const [message] = await checkpoint; expect(message.phase).toBe('checkpoint'); child.kill('SIGKILL'); }
      await ended;
      reopened = await openFixture(engine, file);
      const row = reopened.db.get("SELECT * FROM apiKeyAccounting WHERE attemptId='attempt-one'");
      if (['before-intent', 'inside-intent'].includes(mode)) expect(row).toBeUndefined();
      else if (mode === 'after-terminal') { expect(row.state).toBe('settled'); expect(String(row.costNanoUsd)).toBe('1200000'); }
      else { expect(row.state).toBe('unrecorded'); expect(row.costNanoUsd).toBeNull(); }
    });
  }
  it('competing writer cannot mutate an active accounting file or sidecar', async () => {
    const { child, file } = await start(engine, 'after-intent');
    const bytes = fs.readFileSync(file), sidecar = fs.readFileSync(path.join(root, '.accounting-coverage.json'));
    await expect((engine === 'node' ? createNodeSqliteAdapter : createSqlJsAdapter)(file)).rejects.toThrow(/active/);
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);
    expect(fs.readFileSync(path.join(root, '.accounting-coverage.json')).equals(sidecar)).toBe(true);
    const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended;
  });
  it('SIGTERM recovers pending, releases only after close and permits another signal owner to run', async () => {
    const { child, file } = await start(engine, 'signal');
    const messages = []; child.on('message', message => messages.push(message));
    const ended = once(child, 'exit'); child.kill('SIGTERM'); const [code] = await ended;
    expect(code).toBe(0); expect(messages.some(message => message.phase === 'other-signal-owner')).toBe(true);
    expect(fs.existsSync(path.join(root, '.gateway-writer.lock'))).toBe(false);
    reopened = await openFixture(engine, file);
    expect(reopened.db.get('SELECT state FROM apiKeyAccounting').state).toBe('unrecorded');
  });
});
it('SQL.js crash after file fsync before rename keeps the last acknowledged file', async () => {
  const { child, file } = await start('sqljs', 'during-publication');
  const ended = once(child, 'exit'); child.send('run'); await ended;
  reopened = await openFixture('sqljs', file);
  expect(reopened.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
});
