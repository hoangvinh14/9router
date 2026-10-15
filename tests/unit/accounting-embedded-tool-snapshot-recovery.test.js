import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as money from '@/lib/pricing/money.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { insertAttemptSync, finalizeAttemptSync, resolveAttemptSync, getAttemptSync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { recoveryReceiptSync } from '@/lib/apiKeyBudget/recoveryReceipt.js';
import { attemptRecoveryDraft } from '@/shared/utils/budgetManagementDraft.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { createBudgetContext } from '@/lib/apiKeyBudget/service.js';

const usage = () => ({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 10,
  reasoning: 0, reasoningIncludedInOutput: true, toolUses: { webSearchRequests: 2 },
  provenance: { serverToolUses: 'observed_claude_server_tool_use' } });
const snapshot = () => ({ rates: { input: '1', output: '2', web_search_per_1000: '10' },
  rateUnits: { web_search_per_1000: 'USD/1000 uses' }, usageSemantics: { serverToolUses: 'observed_claude_server_tool_use' } });
const recovery = (value = usage()) => ({ action: 'exact_usage', operationId: 'search-recovery', actor: 'fixture-admin',
  reason: 'owned proof', evidence: 'exact observed counters', expectedVersion: 1, usage: value });

describe('required original embedded use/unit snapshot and audited recovery prerequisite', () => {
  it('original snapshot math cannot silently drop required tool count or its units', () => {
    expect(money.costFromExactUsageSnapshot(usage(), snapshot())).toBe('20140000');
    const { toolUses, provenance, ...flat } = usage();
    expect(() => money.costFromExactUsageSnapshot(flat, snapshot())).toThrow();
    expect(() => money.costFromExactUsageSnapshot(usage(), { ...snapshot(), rateUnits: undefined })).toThrow();
    expect(() => money.costFromExactUsageSnapshot(usage(), { ...snapshot(), rateUnits: { web_search_per_1000: 'USD/1M tokens' } })).toThrow();
    expect(() => money.costFromExactUsageSnapshot(usage(), { ...snapshot(), usageSemantics: { serverToolUses: 'unknown' } })).toThrow();
    expect(money.costFromExactUsageSnapshot(flat, { rates: { input: '1', output: '2' } })).toBe('140000');
  });
  it('required snapshot/count/provenance is guarded before programmable input and preserves cache requirement', () => {
    const getter = vi.fn(() => snapshot().usageSemantics), trap = vi.fn(() => ['rates']);
    expect(() => money.costFromExactUsageSnapshot(usage(), Object.defineProperty(snapshot(), 'usageSemantics', { enumerable: true, get: getter }))).toThrow();
    expect(() => money.costFromExactUsageSnapshot(usage(), new Proxy(snapshot(), { ownKeys: trap }))).toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    expect(() => money.costFromExactUsageSnapshot(usage(), { ...snapshot(), usageSemantics: undefined })).toThrow();
    const required = { ...snapshot(), usageSemantics: { ...snapshot().usageSemantics, cacheWriteTiers: 'observed_5m_1h' } };
    expect(() => money.costFromExactUsageSnapshot(usage(), required)).toThrow();
    expect(money.costFromExactUsageSnapshot({ ...usage(), cacheWrite5m: 10, cacheWrite1h: 0 }, required)).toBe('20140000');
  });
  it('client exact-usage draft preserves explicit tool/provenance without allowing unknown categories', () => {
    const make = value => attemptRecoveryDraft({ resolutionVersion: 1 }, { action: 'exact_usage', reason: 'owned', evidence: 'observed', usageJson: JSON.stringify(value) }, 'search-recovery');
    expect(make(usage()).usage).toEqual(usage());
    expect(() => make({ ...usage(), toolUses: { unknown: 0 } })).toThrow();
    expect(() => make({ ...usage(), provenance: { serverToolUses: 'estimated' } })).toThrow();
    expect(() => make({ ...usage(), provenance: { serverToolUses: 'observed_claude_server_tool_use', secret: 'no' } })).toThrow();
  });
  it('SQL.js synchronous and queued terminal service obeys required persisted snapshot; absent counter stays unresolved', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-search-terminal-')), file = path.join(dir, 'db.sqlite'), owner = acquireWriterOwnership(dir); let db;
    try {
      db = await createSqlJsAdapter(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
      db.durableTransaction(() => {
        db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('fixture-key','fixture-secret',1,'2026-10-01T00:00:00.000Z')");
        retainKeyBindings(db, db.coverage, [{ id: 'fixture-key', key: 'fixture-secret' }]);
        db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-01T00:00:00.000Z')");
        db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture',?)", [JSON.stringify({ 'fixture-search': { input: '1', output: '2' } })]);
      });
      const { toolUses, provenance, ...flat } = usage();
      for (const queued of [false, true]) {
        for (const missing of [false, true]) {
          const c = await createBudgetContext('fixture-key', { adapter: async () => db, clock: () => '2026-10-03T00:00:00.000Z', project: () => {} });
          const meta = { provider: 'fixture', model: 'fixture-search', endpoint: 'chat' };
          const attempt = queued ? await c.beginAttemptQueued(meta) : c.beginAttempt(meta);
          // Seed the future required persisted snapshot for terminal-consumer proof
          // only. This is not original-wire admission or a provider POST test.
          db.durableTransaction(() => db.run('UPDATE apiKeyAccounting SET priceSnapshotJson=? WHERE attemptId=?', [JSON.stringify(snapshot()), attempt.attemptId]));
          const terminal = queued ? await c.completeAttemptQueued(attempt, { usage: missing ? flat : usage() }) : c.completeAttempt(attempt, { usage: missing ? flat : usage() });
          expect(terminal).toMatchObject({ state: missing ? 'unresolved' : 'settled', costNanoUsd: missing ? null : '20140000' });
          const persisted = getAttemptSync(db, attempt.attemptId);
          expect(persisted).toMatchObject({ state: terminal.state, costNanoUsd: terminal.costNanoUsd });
          expect(JSON.stringify(persisted)).not.toMatch(/query|encrypted_content|fixture-secret/);
        }
      }
    } finally { db?.close(); owner.release(); fs.rmSync(dir, { recursive: true, force: true }); }
  }, 20000);
  it('SQL.js recovery uses original units/rates, refuses count erasure, replays receipt after reopen without content', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-search-recovery-')), file = path.join(dir, 'db.sqlite'), owner = acquireWriterOwnership(dir); let db;
    try {
      db = await createSqlJsAdapter(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
      insertAttemptSync(db, { attemptId: 'search-attempt', requestId: 'search-request', apiKeyId: 'fixture-key', ownerInstanceId: owner.instanceId,
        provider: 'anthropic', model: 'fixture-search', endpoint: 'chat', startedAt: '2026-10-03T00:00:00.000Z', priceSnapshot: snapshot() });
      finalizeAttemptSync(db, 'search-attempt', { state: 'unresolved', outcome: 'failed', finishedAt: '2026-10-03T00:01:00.000Z' });
      const { toolUses, provenance, ...flat } = usage();
      expect(() => resolveAttemptSync(db, 'search-attempt', recovery(flat))).toThrow();
      expect(getAttemptSync(db, 'search-attempt')).toMatchObject({ state: 'unresolved', costNanoUsd: null });
      expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(0);
      // Current pricing drift never changes retained attempt authority.
      db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','anthropic',?)", [JSON.stringify({ 'fixture-search': { input: '100', output: '200', web_search_per_1000: '200' } })]));
      const resolved = resolveAttemptSync(db, 'search-attempt', recovery());
      expect(resolved).toMatchObject({ state: 'settled', costNanoUsd: '20140000', resolutionVersion: 2 });
      const receipt = recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'search-attempt' }, recovery());
      expect(receipt.costUsd).toBe('0.02014');
      expect(resolveAttemptSync(db, 'search-attempt', recovery())).toEqual(resolved);
      db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner);
      expect(recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'search-attempt' }, recovery())).toEqual(receipt);
      expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(1);
      expect(JSON.stringify(receipt)).not.toMatch(/owned|observed counters|fixture-admin|encrypted|query/);
    } finally { db?.close(); owner.release(); fs.rmSync(dir, { recursive: true, force: true }); }
  }, 20000);
});
