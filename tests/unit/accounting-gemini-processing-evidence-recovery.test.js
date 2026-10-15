import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { inspectRawGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
import { attemptRecoveryDraft } from '@/shared/utils/budgetManagementDraft.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { insertAttemptSync, finalizeAttemptSync, resolveAttemptSync, getAttemptSync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { recoveryReceiptSync } from '@/lib/apiKeyBudget/recoveryReceipt.js';
import { createBudgetContext } from '@/lib/apiKeyBudget/service.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
const marker = 'observed_gemini_video_processing_tool_prompt_zero';
const original = () => ({ contents: [{ parts: [{ inlineData: { mimeType: 'video/mp4', data: 'YQ==' }, mediaProcessing: 'AGENTIC' }] }] });
const rawUsage = () => inspectRawGeminiAccounting({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'private output' }] } }], usageMetadata: {
  promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, toolUsePromptTokenCount: 0, totalTokenCount: 130,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'VIDEO', tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'VIDEO', tokenCount: 30 }],
} }, 'fixture-gemini', { inlineVideoOriginal: original(), videoProcessingOriginal: original() }).usage;
const snapshot = () => ({ rates: { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4', input_video: '11', cached_video: '0.5' }, rateUnits: Object.fromEntries(['input', 'cached', 'input_image', 'cached_image', 'input_audio', 'cached_audio', 'input_video', 'cached_video'].map(key => [key, 'USD/1M tokens'])), usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'], videoProcessingToolPrompt: marker } });
const observed = () => ({ ...rawUsage(), processingToolPromptTokens: 0, provenance: { ...rawUsage().provenance, videoProcessingToolPrompt: marker } });
const erased = () => { const value = observed(); delete value.processingToolPromptTokens; delete value.provenance.videoProcessingToolPrompt; return value; };
const operation = value => ({ action: 'exact_usage', operationId: 'processing-recovery', actor: 'fixture-admin', reason: 'owned proof', evidence: 'observed terminal zero', expectedVersion: 1, usage: value });
async function withDb(label, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `9router-processing-${label}-`)), file = path.join(dir, 'db.sqlite'), owner = acquireWriterOwnership(dir); let db;
  try {
    db = await createSqlJsAdapter(file, owner); expect(db.driver).toBe('sql.js'); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
    await run(db, async () => { db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner); return db; });
  } finally { db?.close(); owner.release(); fs.rmSync(dir, { recursive: true, force: true }); }
}
function seedAttempt(db, attemptId = 'processing-attempt') {
  insertAttemptSync(db, { attemptId, requestId: 'processing-request', apiKeyId: 'fixture-key', ownerInstanceId: db.ownerInstanceId, provider: 'gemini', model: 'fixture-gemini', endpoint: 'chat', startedAt: '2026-10-03T00:00:00.000Z', priceSnapshot: snapshot() });
  finalizeAttemptSync(db, attemptId, { state: 'unresolved', outcome: 'failed', finishedAt: '2026-10-03T00:01:00.000Z' });
}
describe('processing explicit terminal zero survives normalization, original snapshot settlement and recovery', () => {
  it('raw inspected usage retains observed zero plus typed provenance instead of losing evidence during normalization', () => {
    expect(rawUsage()).toMatchObject({ processingToolPromptTokens: 0, provenance: { videoProcessingToolPrompt: marker } });
    expect(JSON.stringify(rawUsage())).not.toMatch(/AGENTIC|private output|YQ==|mediaProcessing/);
  });
  it('original snapshot rejects marker/count erasure or laundering, even all-zero rates, while one-round observed cost is unchanged', () => {
    expect(() => costFromExactUsageSnapshot(erased(), snapshot())).toThrow();
    expect(costFromExactUsageSnapshot(observed(), snapshot())).toBe('536000');
    for (const change of [v => { delete v.processingToolPromptTokens; }, v => { delete v.provenance.videoProcessingToolPrompt; }, v => { v.processingToolPromptTokens = 1; }, v => { v.processingToolPromptTokens = null; }, v => { v.provenance.videoProcessingToolPrompt = 'estimated'; }]) { const value = observed(); change(value); expect(() => costFromExactUsageSnapshot(value, snapshot())).toThrow(); }
    const absent = snapshot(); delete absent.usageSemantics.videoProcessingToolPrompt; expect(() => costFromExactUsageSnapshot(observed(), absent)).toThrow();
    const zero = snapshot(); for (const key of Object.keys(zero.rates)) zero.rates[key] = '0'; expect(costFromExactUsageSnapshot(observed(), zero)).toBe('0'); expect(() => costFromExactUsageSnapshot(erased(), zero)).toThrow();
    const getter = vi.fn(), value = observed(); Object.defineProperty(value, 'processingToolPromptTokens', { enumerable: true, get: getter }); expect(() => costFromExactUsageSnapshot(value, snapshot())).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('pure parsed recovery draft preserves zero provenance and refuses partial/nonzero/cross-family claims without server imports', () => {
    const draft = value => attemptRecoveryDraft({ resolutionVersion: 1 }, { action: 'exact_usage', reason: 'owned', evidence: 'observed zero', usageJson: JSON.stringify(value) }, 'processing-recovery');
    expect(draft(observed()).usage).toEqual(observed());
    for (const change of [v => { delete v.processingToolPromptTokens; }, v => { delete v.provenance.videoProcessingToolPrompt; }, v => { v.processingToolPromptTokens = 1; }, v => { delete v.inputModalities; delete v.provenance.inputModalities; }, v => { v.provenance.schema = 'claude'; }]) { const value = observed(); change(value); expect(() => draft(value)).toThrow(); }
  });
  it('actual SQL.js audited recovery requires original zero evidence; erasure has no audit, drift/reopen cannot reprice or lose marker', async () => withDb('recovery', async (db, reopen) => {
    seedAttempt(db); expect(() => resolveAttemptSync(db, 'processing-attempt', operation(erased()))).toThrow(); expect(getAttemptSync(db, 'processing-attempt')).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(0);
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','gemini',?)", [JSON.stringify({ 'fixture-gemini': { input: '100', output: '200', input_video: '1100' } })]));
    const result = resolveAttemptSync(db, 'processing-attempt', operation(observed())); expect(result).toMatchObject({ state: 'settled', costNanoUsd: '536000', usage: { processingToolPromptTokens: 0, provenance: { videoProcessingToolPrompt: marker } } }); expect(resolveAttemptSync(db, 'processing-attempt', operation(observed()))).toEqual(result);
    const receipt = recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'processing-attempt' }, operation(observed())); expect(receipt.costUsd).toBe('0.000536'); expect(() => recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'processing-attempt' }, operation(erased()))).toThrow();
    db = await reopen(); expect(recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'processing-attempt' }, operation(observed()))).toEqual(receipt); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(1); expect(JSON.stringify(receipt)).not.toMatch(/fixture-admin|owned proof|AGENTIC|private|YQ==/);
  }), 20000);
  it('processing snapshot/evidence cannot survive own-undefined markers, missing modality owner, flat or cross-family laundering', () => {
    expect(costFromExactUsageSnapshot(observed(), snapshot())).toBe('536000');
    for (const change of [v => { v.usageSemantics.videoProcessingToolPrompt = undefined; }, v => { v.usageSemantics.videoProcessingToolPrompt = 'estimated'; }, v => { delete v.usageSemantics.inputModalities; }, v => { delete v.usageSemantics.allowedInputModalities; }]) { const price = snapshot(); change(price); expect(() => costFromExactUsageSnapshot(observed(), price)).toThrow(); }
    const flat = erased(); delete flat.inputModalities; delete flat.provenance.inputModalities; flat.processingToolPromptTokens = 0; flat.provenance.videoProcessingToolPrompt = marker;
    expect(() => costFromExactUsageSnapshot(flat, snapshot())).toThrow();
    const cross = observed(); cross.provenance.schema = 'claude'; expect(() => costFromExactUsageSnapshot(cross, snapshot())).toThrow();
    const absent = snapshot(); delete absent.usageSemantics.videoProcessingToolPrompt; expect(costFromExactUsageSnapshot(erased(), absent)).toBe('536000');
  });
  it('SQL.js sync/queued terminal consumers cannot settle processing snapshot using token-only modality usage', async () => withDb('terminal', async db => {
    db.durableTransaction(() => {
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('fixture-key','fixture-secret',1,'2026-10-01T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: 'fixture-key', key: 'fixture-secret' }]);
      db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-01T00:00:00.000Z')"); db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture',?)", [JSON.stringify({ 'fixture-gemini': { input: '1', output: '2' } })]);
    });
    for (const queued of [false, true]) for (const missing of [true, false]) {
      const context = await createBudgetContext('fixture-key', { adapter: async () => db, clock: () => '2026-10-03T00:00:00.000Z', project: () => {} }); const meta = { provider: 'fixture', model: 'fixture-gemini', endpoint: 'chat' }, attempt = queued ? await context.beginAttemptQueued(meta) : context.beginAttempt(meta);
      // Seeded original snapshot proves terminal consumer, not provider admission.
      db.durableTransaction(() => db.run('UPDATE apiKeyAccounting SET priceSnapshotJson=? WHERE attemptId=?', [JSON.stringify(snapshot()), attempt.attemptId]));
      const terminal = queued ? await context.completeAttemptQueued(attempt, { usage: missing ? erased() : observed() }) : context.completeAttempt(attempt, { usage: missing ? erased() : observed() });
      expect(terminal).toMatchObject({ state: missing ? 'unresolved' : 'settled', costNanoUsd: missing ? null : '536000' }); expect(getAttemptSync(db, attempt.attemptId)).toMatchObject({ state: terminal.state, costNanoUsd: terminal.costNanoUsd });
    }
  }), 20000);
});
