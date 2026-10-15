import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { insertAttemptSync, finalizeAttemptSync, resolveAttemptSync, getAttemptSync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { recoveryReceiptSync } from '@/lib/apiKeyBudget/recoveryReceipt.js';
import { attemptRecoveryDraft } from '@/shared/utils/budgetManagementDraft.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { createBudgetContext } from '@/lib/apiKeyBudget/service.js';
import { inspectRawGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
const marker = 'observed_gemini_inline_input_modalities';
const original = () => ({ contents: [{ role: 'user', parts: [{ text: 'private input' }, { inlineData: { mimeType: 'image/png', data: 'b3BhcXVl' } }] }] });
const usage = () => inspectRawGeminiAccounting({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'private output' }] } }], usageMetadata: {
  promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 70 }],
  cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 30 }],
} }, 'fixture-gemini', { inlineMediaOriginal: original() }).usage;
const snapshot = () => ({ rates: { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2' },
  rateUnits: { input: 'USD/1M tokens', cached: 'USD/1M tokens', input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens' },
  usageSemantics: { inputModalities: marker, allowedInputModalities: ['TEXT', 'IMAGE'] } });
const flat = () => { const result = usage(); delete result.inputModalities; delete result.provenance.inputModalities; return result; };
const operation = (value = usage()) => ({ action: 'exact_usage', operationId: 'modality-recovery', actor: 'fixture-admin', reason: 'owned proof', evidence: 'observed raw attribution', expectedVersion: 1, usage: value });
async function withDb(label, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `9router-modality-${label}-`)), file = path.join(dir, 'db.sqlite'), owner = acquireWriterOwnership(dir); let db;
  try {
    db = await createSqlJsAdapter(file, owner); expect(db.driver).toBe('sql.js'); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
    await run(db, async () => { db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner); return db; });
  } finally { db?.close(); owner.release(); fs.rmSync(dir, { recursive: true, force: true }); }
}
function seedAttempt(db, price, attemptId = 'modality-attempt') {
  insertAttemptSync(db, { attemptId, requestId: 'modality-request', apiKeyId: 'fixture-key', ownerInstanceId: db.ownerInstanceId,
    provider: 'gemini', model: 'fixture-gemini', endpoint: 'chat', startedAt: '2026-10-03T00:00:00.000Z', priceSnapshot: price });
  finalizeAttemptSync(db, attemptId, { state: 'unresolved', outcome: 'failed', finishedAt: '2026-10-03T00:01:00.000Z' });
}
describe('observed Gemini modality original-price durable consumers, seeded snapshot not POST/admission proof', () => {
  it('parsed client exact-usage draft retains observed category and rejects malformed/cross-family/provenance fields', () => {
    const draft = value => attemptRecoveryDraft({ resolutionVersion: 1 }, { action: 'exact_usage', reason: 'owned', evidence: 'observed', usageJson: JSON.stringify(value) }, 'modality-recovery');
    expect(draft(usage()).usage).toEqual(usage());
    for (const change of [v => { v.inputModalities.IMAGE.input = 69; }, v => { v.inputModalities.UNKNOWN = { input: 0, cacheRead: 0 }; },
      v => { v.inputModalities.IMAGE.cacheRead = 71; }, v => { v.provenance.inputModalities = 'estimated'; }, v => { delete v.inputModalities; },
      v => { delete v.provenance.inputModalities; }, v => { v.provenance.secret = 'private'; }, v => { v.inputModalities.IMAGE.bytes = 6; },
      v => { v.toolUses = { webSearchRequests: 0 }; }, v => { v.reasoningIncludedInOutput = true; }]) {
      const value = usage(); change(value); expect(() => draft(value)).toThrow();
    }
    expect(JSON.stringify(draft(usage()))).not.toMatch(/private input|private output|b3BhcXVl/);
  });
  it('actual SQL.js audited recovery binds original price, erasure stays unresolved/no audit; retry and reopened receipt own exact cost', async () => withDb('recovery', async (db, reopen) => {
    seedAttempt(db, snapshot());
    expect(() => resolveAttemptSync(db, 'modality-attempt', operation(flat()))).toThrow();
    expect(getAttemptSync(db, 'modality-attempt')).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(0);
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','gemini',?)", [JSON.stringify({ 'fixture-gemini': { input: '100', output: '200', cached: '10', input_image: '300', cached_image: '20' } })]));
    const result = resolveAttemptSync(db, 'modality-attempt', operation()); expect(result).toMatchObject({ state: 'settled', costNanoUsd: '207000', resolutionVersion: 2 });
    expect(result.usage.inputModalities).toEqual(usage().inputModalities); expect(resolveAttemptSync(db, 'modality-attempt', operation())).toEqual(result);
    const receipt = recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'modality-attempt' }, operation()); expect(receipt.costUsd).toBe('0.000207');
    expect(() => recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'modality-attempt' }, operation(flat()))).toThrow();
    const changed = usage(); changed.inputModalities.IMAGE.cacheRead = 29; changed.inputModalities.TEXT.cacheRead = 11;
    expect(() => resolveAttemptSync(db, 'modality-attempt', operation(changed))).toThrow();
    db = await reopen(); expect(recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'modality-attempt' }, operation())).toEqual(receipt);
    expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(1); expect(JSON.stringify(receipt)).not.toMatch(/owned proof|observed raw attribution|fixture-admin|private|b3BhcXVl/);
  }), 20000);
  it('required original rates/units/marker/allowed categories cannot be repaired by current pricing or operator usage; no audit mutation', async () => withDb('unavailable', async db => {
    for (const [index, change] of [s => { delete s.rates.input_image; }, s => { delete s.rateUnits.cached_image; },
      s => { s.rateUnits.cached_image = 'USD/1000 uses'; }, s => { delete s.usageSemantics; }, s => { s.usageSemantics.allowedInputModalities = ['TEXT']; }].entries()) {
      const price = snapshot(); change(price); const id = `modality-unavailable-${index}`; seedAttempt(db, price, id);
      expect(() => resolveAttemptSync(db, id, operation())).toThrow(); expect(getAttemptSync(db, id)).toMatchObject({ state: 'unresolved', costNanoUsd: null });
    }
    expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(0);
    const zero = snapshot(); for (const key of Object.keys(zero.rates)) zero.rates[key] = '0'; seedAttempt(db, zero, 'modality-zero');
    expect(resolveAttemptSync(db, 'modality-zero', operation())).toMatchObject({ state: 'settled', costNanoUsd: '0' });
    expect(recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'modality-zero' }, operation()).costUsd).toBe('0');
  }), 20000);
  it('SQL.js synchronous/queued terminal consumers require retained modality snapshot; no missing-category token-only settlement', async () => withDb('terminal', async db => {
    db.durableTransaction(() => {
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('fixture-key','fixture-secret',1,'2026-10-01T00:00:00.000Z')");
      retainKeyBindings(db, db.coverage, [{ id: 'fixture-key', key: 'fixture-secret' }]);
      db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-01T00:00:00.000Z')");
      db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture',?)", [JSON.stringify({ 'fixture-gemini': { input: '1', output: '2' } })]);
    });
    for (const queued of [false, true]) for (const missing of [false, true]) {
      const context = await createBudgetContext('fixture-key', { adapter: async () => db, clock: () => '2026-10-03T00:00:00.000Z', project: () => {} });
      const meta = { provider: 'fixture', model: 'fixture-gemini', endpoint: 'chat' }, attempt = queued ? await context.beginAttemptQueued(meta) : context.beginAttempt(meta);
      // Future snapshot seeding proves terminal consumers only, never upstream admission.
      db.durableTransaction(() => db.run('UPDATE apiKeyAccounting SET priceSnapshotJson=? WHERE attemptId=?', [JSON.stringify(snapshot()), attempt.attemptId]));
      const terminal = queued ? await context.completeAttemptQueued(attempt, { usage: missing ? flat() : usage() }) : context.completeAttempt(attempt, { usage: missing ? flat() : usage() });
      expect(terminal).toMatchObject({ state: missing ? 'unresolved' : 'settled', costNanoUsd: missing ? null : '207000' });
      expect(getAttemptSync(db, attempt.attemptId)).toMatchObject({ state: terminal.state, costNanoUsd: terminal.costNanoUsd });
    }
    expect(JSON.stringify(db.all('SELECT * FROM apiKeyAccounting'))).not.toMatch(/private input|private output|b3BhcXVl|fixture-secret/);
  }), 20000);
});
