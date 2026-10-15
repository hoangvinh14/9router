import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { insertAttemptSync, finalizeAttemptSync, resolveAttemptSync, getAttemptSync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { recoveryReceiptSync } from '@/lib/apiKeyBudget/recoveryReceipt.js';
import { normalizeExactUsage } from 'open-sse/utils/exactUsage.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
import { attemptRecoveryDraft } from '@/shared/utils/budgetManagementDraft.js';

const raw = () => ({ input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
  server_tool_use: { web_fetch_requests: 3 } });
const normalize = value => normalizeExactUsage(value, 'claude', 'chat', { allowWebFetchUsage: true });
const expected = () => ({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 10, reasoning: 0, reasoningIncludedInOutput: true,
  nonBillableToolUses: { webFetchRequests: 3 }, provenance: { schema: 'claude', endpoint: 'chat', inputIncludesCache: true,
    nonBillableServerToolUses: 'observed_claude_web_fetch_token_only' } });
const snapshot = () => ({ rates: { input: '1', output: '2' }, usageSemantics: { nonBillableServerToolUses: 'observed_claude_web_fetch_token_only' } });

describe('isolated raw documented fetch operations and required token-only snapshot (no provider admission)', () => {
  it('positive fetch retains observed nonbillable category with explicit opt-in, defaults still refuse', () => {
    expect(normalize(raw())).toEqual(expected());
    expect(normalizeExactUsage(raw(), 'claude')).toBeNull();
    for (const schema of ['openai', 'gemini']) expect(normalizeExactUsage(raw(), schema, 'chat', { allowWebFetchUsage: true })).toBeNull();
    expect(normalizeExactUsage(raw(), 'claude', 'embeddings', { allowWebFetchUsage: true })).toBeNull();
    expect(normalizeExactUsage(raw(), 'claude', 'chat', { allowWebFetchUsage: 'true' })).toBeNull();
  });
  it('missing/unknown/nonexact/positive search/code counters never become fetch-only exact', () => {
    for (const counter of [undefined, {}, { web_fetch_requests: -1 }, { web_fetch_requests: 0.5 }, { unknown: 0 },
      { web_fetch_requests: 3, web_search_requests: 1 }, { web_fetch_requests: 3, code_execution_requests: 0 }]) {
      const value = raw(); value.server_tool_use = counter;
      expect(normalize(value)).toBeNull();
    }
    expect(normalize({ ...raw(), server_tool_use: { web_fetch_requests: 0 } }).nonBillableToolUses).toEqual({ webFetchRequests: 0 });
  });
  it('guards programmable raw evidence before reads; typed cumulative owners must supply terminal quantity', () => {
    const getter = vi.fn(() => raw().server_tool_use), trap = vi.fn(() => ['server_tool_use']);
    expect(normalize(Object.defineProperty(raw(), 'server_tool_use', { enumerable: true, get: getter }))).toBeNull();
    expect(normalize(new Proxy(raw(), { ownKeys: trap }))).toBeNull();
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
  it('snapshot requires observed fetch category but bills only exact tokens, no fabricated zero rate', () => {
    expect(costFromExactUsageSnapshot(expected(), snapshot())).toBe('140000');
    const { nonBillableToolUses, provenance, ...flat } = expected();
    expect(() => costFromExactUsageSnapshot(flat, snapshot())).toThrow();
    expect(() => costFromExactUsageSnapshot(expected(), { rates: snapshot().rates })).toThrow();
    expect(() => costFromExactUsageSnapshot({ ...expected(), nonBillableToolUses: { unknown: 0 } }, snapshot())).toThrow();
    expect(() => costFromExactUsageSnapshot({ ...expected(), provenance: { ...expected().provenance, nonBillableServerToolUses: 'estimated' } }, snapshot())).toThrow();
    expect(() => costFromExactUsageSnapshot(expected(), { ...snapshot(), usageSemantics: { nonBillableServerToolUses: 'free_all_tools' } })).toThrow();
  });
  it('combined search/fetch keeps independent required markers/counts and one original reference calculation', () => {
    const value = { ...raw(), server_tool_use: { web_fetch_requests: 3, web_search_requests: 2 } };
    const usage = normalizeExactUsage(value, 'claude', 'chat', { allowWebFetchUsage: true, allowWebSearchUsage: true });
    expect(usage).toEqual({ ...expected(), toolUses: { webSearchRequests: 2 }, provenance: { ...expected().provenance, serverToolUses: 'observed_claude_server_tool_use' } });
    const both = { rates: { ...snapshot().rates, web_search_per_1000: '10' }, rateUnits: { web_search_per_1000: 'USD/1000 uses' },
      usageSemantics: { ...snapshot().usageSemantics, serverToolUses: 'observed_claude_server_tool_use' } };
    expect(costFromExactUsageSnapshot(usage, both)).toBe('20140000');
    expect(() => costFromExactUsageSnapshot({ ...expected() }, both)).toThrow();
    expect(() => costFromExactUsageSnapshot({ ...usage, nonBillableToolUses: undefined }, both)).toThrow();
  });
  it('guards nonbillable count getters/proxies/undefined/inherited authority before kernel reads', () => {
    const getter = vi.fn(() => ({ webFetchRequests: 3 })), trap = vi.fn(() => ['webFetchRequests']);
    expect(() => costFromExactUsageSnapshot(Object.defineProperty(expected(), 'nonBillableToolUses', { enumerable: true, get: getter }), snapshot())).toThrow();
    expect(() => costFromExactUsageSnapshot({ ...expected(), nonBillableToolUses: new Proxy({}, { ownKeys: trap }) }, snapshot())).toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    expect(() => costFromExactUsageSnapshot({ ...expected(), nonBillableToolUses: undefined }, snapshot())).toThrow();
    expect(() => costFromExactUsageSnapshot(Object.assign(Object.create({ nonBillableToolUses: { webFetchRequests: 3 } }), { ...expected(), nonBillableToolUses: undefined }), snapshot())).toThrow();
  });
  it('actual SQL.js exact recovery retains observed nonbillable category, refuses erasure and reopens committed receipt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-fetch-recovery-')), file = path.join(dir, 'db.sqlite'), owner = acquireWriterOwnership(dir); let db;
    try {
      db = await createSqlJsAdapter(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
      insertAttemptSync(db, { attemptId: 'fetch-attempt', requestId: 'fetch-request', apiKeyId: 'fixture-key', ownerInstanceId: owner.instanceId,
        provider: 'anthropic', model: 'fixture-fetch', endpoint: 'chat', startedAt: '2026-10-03T00:00:00.000Z', priceSnapshot: snapshot() });
      finalizeAttemptSync(db, 'fetch-attempt', { state: 'unresolved', outcome: 'failed', finishedAt: '2026-10-03T00:01:00.000Z' });
      const operation = { action: 'exact_usage', operationId: 'fetch-recovery', actor: 'fixture-admin', reason: 'owned proof', evidence: 'observed counters', expectedVersion: 1, usage: expected() };
      const { nonBillableToolUses, provenance, ...flat } = expected();
      expect(() => resolveAttemptSync(db, 'fetch-attempt', { ...operation, usage: flat })).toThrow();
      expect(getAttemptSync(db, 'fetch-attempt')).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(0);
      const resolved = resolveAttemptSync(db, 'fetch-attempt', operation);
      expect(resolved).toMatchObject({ state: 'settled', costNanoUsd: '140000' });
      expect(resolved.usage.nonBillableToolUses).toEqual({ webFetchRequests: 3 });
      const target = { kind: 'attempt', id: 'fetch-attempt' }, receipt = recoveryReceiptSync(db, 'fixture-key', target, operation);
      expect(receipt.costUsd).toBe('0.00014'); expect(resolveAttemptSync(db, 'fetch-attempt', operation)).toEqual(resolved);
      db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner);
      expect(recoveryReceiptSync(db, 'fixture-key', target, operation)).toEqual(receipt);
      expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(1);
      expect(JSON.stringify(receipt)).not.toMatch(/observed counters|fixture-admin|owned proof/);
    } finally { db?.close(); owner.release(); fs.rmSync(dir, { recursive: true, force: true }); }
  }, 20000);
  it('operator recovery draft accepts only typed observed fetch category, not arbitrary free evidence', () => {
    const make = usage => attemptRecoveryDraft({ resolutionVersion: 1 }, { action: 'exact_usage', reason: 'observed', evidence: 'owned fixture', usageJson: JSON.stringify(usage) }, 'fetch-op');
    expect(make(expected()).usage).toEqual(expected());
    expect(() => make({ ...expected(), nonBillableToolUses: { codeExecutionRequests: 1 } })).toThrow();
    expect(() => make({ ...expected(), provenance: { ...expected().provenance, private: 'no' } })).toThrow();
  });
});
