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
import { attemptRecoveryDraft } from '@/shared/utils/budgetManagementDraft.js';
import { normalizeExactUsage } from 'open-sse/utils/exactUsage.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const raw = (count = 3) => ({ input_tokens: 60, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10, server_tool_use: { code_execution_requests: count } });
const options = { allowCodeExecutionUsage: true };
const snapshot = () => ({ rates: { input: '1', output: '2', cached: '0.1', cache_creation: '1.25' }, usageSemantics: { codeServerToolUses: 'observed_claude_included_code_token_only' } });
const normalized = () => normalizeExactUsage(raw(), 'claude', 'chat', options);
describe('isolated observed code counter/original included regime snapshot money, not admission/time proof', () => {
  it('retains exact observed code requests with separate provenance; only exact tokens cost money', () => {
    const usage = normalized(); expect(usage).toMatchObject({ input: 110, codeToolUses: { codeExecutionRequests: 3 }, provenance: { codeServerToolUses: 'observed_claude_included_code_token_only' } });
    expect(costFromExactUsageSnapshot(usage, snapshot())).toBe('116500');
    expect(normalizeExactUsage(raw(0), 'claude', 'chat', options).codeToolUses).toEqual({ codeExecutionRequests: 0 });
    expect(costFromExactUsageSnapshot(normalizeExactUsage(raw(0), 'claude', 'chat', options), snapshot())).toBe('116500');
  });
  it('missing/unknown/negative/unsafe code counters cannot become exact token-only; default remains closed', () => {
    expect(normalizeExactUsage(raw(), 'claude')).toBeNull();
    for (const usage of [{ input_tokens: 1, output_tokens: 1 }, { ...raw(), server_tool_use: { unknown_requests: 0 } }, raw(-1), raw(Number.MAX_SAFE_INTEGER + 1)])
      expect(normalizeExactUsage(usage, 'claude', 'chat', options)).toBeNull();
  });
  it('code opt-in is strict Claude/chat boolean; programmable raw sources refuse before reads', () => {
    expect(normalizeExactUsage(raw(), 'claude', 'chat', { allowCodeExecutionUsage: 'true' })).toBeNull();
    expect(normalizeExactUsage(raw(), 'openai', 'chat', options)).toBeNull(); expect(normalizeExactUsage(raw(), 'claude', 'embeddings', options)).toBeNull();
    const getter = vi.fn(), trap = vi.fn();
    expect(normalizeExactUsage(Object.defineProperty(raw(), 'server_tool_use', { enumerable: true, get: getter }), 'claude', 'chat', options)).toBeNull();
    expect(normalizeExactUsage(new Proxy(raw(), { ownKeys: trap }), 'claude', 'chat', options)).toBeNull(); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
  it('required original code marker forbids category/counter erasure, invented provenance or tool-only snapshot', () => {
    const usage = normalized(); expect(usage).not.toBeNull();
    for (const value of [{ ...usage, codeToolUses: undefined }, { ...usage, codeToolUses: {} }, { ...usage, provenance: { ...usage.provenance, codeServerToolUses: 'free' } }]) expect(() => costFromExactUsageSnapshot(value, snapshot())).toThrow();
    expect(() => costFromExactUsageSnapshot(usage, { rates: snapshot().rates })).toThrow();
    expect(() => costFromExactUsageSnapshot(usage, { ...snapshot(), usageSemantics: { codeServerToolUses: 'duration-unobservable' } })).toThrow();
    const erased = structuredClone(usage); delete erased.codeToolUses; expect(() => costFromExactUsageSnapshot(erased, snapshot())).toThrow();
  });
  it('independent search/fetch/code quantities coexist, paid search still owes original rate/unit and one rounded cost', () => {
    const usage = normalizeExactUsage({ ...raw(), server_tool_use: { code_execution_requests: 3, web_fetch_requests: 2, web_search_requests: 1 } }, 'claude', 'chat', { ...options, allowWebFetchUsage: true, allowWebSearchUsage: true });
    expect(usage).toMatchObject({ codeToolUses: { codeExecutionRequests: 3 }, nonBillableToolUses: { webFetchRequests: 2 }, toolUses: { webSearchRequests: 1 } });
    const price = snapshot(); price.rates.web_search_per_1000 = '10'; price.rateUnits = { web_search_per_1000: 'USD/1000 uses' };
    Object.assign(price.usageSemantics, { serverToolUses: 'observed_claude_server_tool_use', nonBillableServerToolUses: 'observed_claude_web_fetch_token_only' });
    expect(costFromExactUsageSnapshot(usage, price)).toBe('10116500'); delete price.rateUnits; expect(() => costFromExactUsageSnapshot(usage, price)).toThrow();
  });
  it('parsed operator draft permits exact typed code category only; no count-to-duration/free wildcard evidence', () => {
    const make = usage => attemptRecoveryDraft({ resolutionVersion: 1 }, { action: 'exact_usage', reason: 'observed', evidence: 'owned fixture', usageJson: JSON.stringify(usage) }, 'code-op');
    expect(make(normalized()).usage).toEqual(normalized());
    for (const usage of [{ ...normalized(), codeToolUses: { durationSeconds: 5 } }, { ...normalized(), codeToolUses: { codeExecutionRequests: -1 } }, { ...normalized(), provenance: { codeServerToolUses: 'free' } }]) expect(() => make(usage)).toThrow();
  });
  it('actual SQL.js audited recovery requires original code category/count and preserves idempotent reopened receipt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-code-recovery-')), file = path.join(dir, 'db.sqlite'), owner = acquireWriterOwnership(dir); let db;
    try {
      db = await createSqlJsAdapter(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
      insertAttemptSync(db, { attemptId: 'code-attempt', requestId: 'code-request', apiKeyId: 'fixture-key', ownerInstanceId: owner.instanceId,
        provider: 'anthropic', model: 'fixture-code', endpoint: 'chat', startedAt: '2026-10-03T00:00:00.000Z', priceSnapshot: snapshot() });
      finalizeAttemptSync(db, 'code-attempt', { state: 'unresolved', outcome: 'failed', finishedAt: '2026-10-03T00:01:00.000Z' });
      const operation = { action: 'exact_usage', operationId: 'code-recovery', actor: 'fixture-admin', reason: 'owned proof', evidence: 'observed code counter', expectedVersion: 1, usage: normalized() };
      const flat = structuredClone(operation.usage); delete flat.codeToolUses; delete flat.provenance;
      expect(() => resolveAttemptSync(db, 'code-attempt', { ...operation, usage: flat })).toThrow();
      expect(getAttemptSync(db, 'code-attempt')).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(0);
      const resolved = resolveAttemptSync(db, 'code-attempt', operation);
      expect(resolved).toMatchObject({ state: 'settled', costNanoUsd: '116500' }); expect(resolved.usage.codeToolUses).toEqual({ codeExecutionRequests: 3 });
      const target = { kind: 'attempt', id: 'code-attempt' }, receipt = recoveryReceiptSync(db, 'fixture-key', target, operation);
      expect(receipt.costUsd).toBe('0.0001165'); expect(resolveAttemptSync(db, 'code-attempt', operation)).toEqual(resolved);
      db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner);
      expect(recoveryReceiptSync(db, 'fixture-key', target, operation)).toEqual(receipt); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(1);
      expect(JSON.stringify(receipt)).not.toMatch(/observed code counter|fixture-admin|owned proof/);
    } finally { db?.close(); owner.release(); fs.rmSync(dir, { recursive: true, force: true }); }
  }, 20000);
  it('snapshot/evidence guards reject getters and counts not time; no duration-field escape hatch', () => {
    const usage = normalized(), getter = vi.fn(); expect(usage).not.toBeNull();
    expect(() => costFromExactUsageSnapshot(usage, Object.defineProperty(snapshot(), 'usageSemantics', { enumerable: true, get: getter }))).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(() => costFromExactUsageSnapshot({ ...usage, codeToolUses: { codeExecutionRequests: 3, durationSeconds: 5 } }, snapshot())).toThrow();
    expect(normalizeExactUsage({ ...raw(), duration_seconds: 5 }, 'claude', 'chat', options)).toBeNull();
  });
});
