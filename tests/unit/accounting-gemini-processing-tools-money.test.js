import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { inspectRawGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { costFromExactUsageSnapshot, costFromExactUsage } from '@/lib/pricing/money.js';
import { attemptRecoveryDraft } from '@/shared/utils/budgetManagementDraft.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { insertAttemptSync, finalizeAttemptSync, resolveAttemptSync, getAttemptSync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { recoveryReceiptSync } from '@/lib/apiKeyBudget/recoveryReceipt.js';
import { createBudgetContext } from '@/lib/apiKeyBudget/service.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
const marker = 'observed_gemini_video_processing_tool_prompt_modalities';
const original = () => ({ contents: [{ parts: [{ inlineData: { mimeType: 'video/mp4', data: 'YQ==' }, mediaProcessing: 'AGENTIC' }] }] });
const observed = () => inspectRawGeminiAccounting({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ toolCall: { toolType: 'MEDIA_PROCESSING', id: 'private_id', args: { private: 'opaque' } }, thoughtSignature: 'YQ==' }, { toolResponse: { toolType: 'MEDIA_PROCESSING', id: 'private_id', response: { private: 'opaque' } }, thoughtSignature: 'Yg==' }, { text: 'private output' }] } }], usageMetadata: {
  promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, toolUsePromptTokenCount: 50, totalTokenCount: 180,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'VIDEO', tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'VIDEO', tokenCount: 30 }], toolUsePromptTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 30 }, { modality: 'AUDIO', tokenCount: 10 }],
} }, 'fixture-gemini', { inlineVideoOriginal: original(), videoProcessingOriginal: original(), processingToolsOriginal: original() }).usage;
const toolFields = ['processing_tool_text', 'processing_tool_video', 'processing_tool_image', 'processing_tool_audio'];
const snapshot = () => ({ rates: { input: '1', output: '2', cached: '0.1', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4', input_video: '11', cached_video: '0.5', processing_tool_text: '13', processing_tool_image: '17', processing_tool_audio: '19', processing_tool_video: '23' }, rateUnits: Object.fromEntries(['input', 'cached', 'input_image', 'cached_image', 'input_audio', 'cached_audio', 'input_video', 'cached_video', ...toolFields].map(key => [key, 'USD/1M tokens'])), usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'], videoProcessingToolPrompt: marker, allowedProcessingToolModalities: ['TEXT', 'VIDEO', 'IMAGE', 'AUDIO'] } });
const erased = () => { const value = observed(); delete value.processingToolPromptTokens; delete value.processingToolModalities; delete value.provenance.videoProcessingToolPrompt; return value; };
const operation = value => ({ action: 'exact_usage', operationId: 'processing-tools-recovery', actor: 'fixture-admin', reason: 'owned proof', evidence: 'observed terminal details', expectedVersion: 1, usage: value });
async function withDb(label, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `9router-processing-tools-${label}-`)), file = path.join(dir, 'db.sqlite'), owner = acquireWriterOwnership(dir); let db;
  try {
    db = await createSqlJsAdapter(file, owner); expect(db.driver).toBe('sql.js'); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId;
    await run(db, async () => { db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner); return db; });
  } finally { db?.close(); owner.release(); fs.rmSync(dir, { recursive: true, force: true }); }
}
describe('original independent reference processing tool-prompt modality money; not hosted per-call fee or provider admission', () => {
  it('adds observed tool-prompt tokens at independent typed rates without initial-input/cache/thought/output double counting', () => {
    const usage = observed(), price = snapshot(); expect(costFromExactUsageSnapshot(usage, price)).toBe('1366000'); expect(costFromExactUsage(usage, price.rates)).toBe('1366000');
    const drift = snapshot(); drift.rates.input_image = '300'; expect(costFromExactUsageSnapshot(usage, drift)).toBe('1366000');
    drift.rates.processing_tool_image = '18'; expect(costFromExactUsageSnapshot(usage, drift)).toBe('1396000');
    expect(usage.input).toBe(100); expect(usage.processingToolPromptTokens).toBe(50); expect(JSON.stringify(usage)).not.toMatch(/private|opaque|YQ==|AGENTIC/);
  });
  it('combines rational components before one round-half-up and preserves explicit zero money with complete observed nonzero evidence', () => {
    const price = snapshot(); for (const key of Object.keys(price.rates)) price.rates[key] = '0'; expect(costFromExactUsageSnapshot(observed(), price)).toBe('0');
    const tiny = observed(); tiny.input = 1; tiny.cacheRead = 0; tiny.inputModalities = { TEXT: { input: 1, cacheRead: 0 } }; tiny.output = tiny.reasoning = 0; tiny.processingToolPromptTokens = 1; tiny.processingToolModalities = { TEXT: 1 };
    price.rates.input = '0.0003'; price.rates.processing_tool_text = '0.0003'; expect(costFromExactUsageSnapshot(tiny, price)).toBe('1');
    const zero = observed(); zero.processingToolPromptTokens = 0; zero.processingToolModalities = {}; expect(costFromExactUsageSnapshot(zero, snapshot())).toBe('536000');
  });
  it('requires complete typed original marker/category/rate/unit authority even unobserved VIDEO, zero counts/rates; no flat fallback or erasure', () => {
    expect(costFromExactUsageSnapshot(observed(), snapshot())).toBe('1366000'); expect(() => costFromExactUsageSnapshot(erased(), snapshot())).toThrow();
    for (const mutate of [p => { delete p.rates.processing_tool_video; }, p => { p.rateUnits.processing_tool_audio = 'USD/1000 uses'; }, p => { delete p.usageSemantics.videoProcessingToolPrompt; }, p => { p.usageSemantics.videoProcessingToolPrompt = 'observed_gemini_video_processing_tool_prompt_zero'; }, p => { delete p.usageSemantics.allowedProcessingToolModalities; }, p => { p.usageSemantics.allowedProcessingToolModalities = ['TEXT', 'IMAGE', 'AUDIO', 'AUDIO']; }, p => { p.usageSemantics.allowedProcessingToolModalities = ['TEXT', 'IMAGE']; }, p => { p.usageSemantics.videoProcessingToolPrompt = undefined; }, p => { p.rates.processing_tool_image = '-1'; }]) { const price = snapshot(); mutate(price); expect(() => costFromExactUsageSnapshot(observed(), price)).toThrow(); }
    for (const mutate of [u => { delete u.processingToolPromptTokens; }, u => { delete u.processingToolModalities; }, u => { delete u.provenance.videoProcessingToolPrompt; }, u => { u.processingToolPromptTokens = 49; }, u => { u.processingToolModalities.UNKNOWN = 0; }, u => { u.processingToolModalities.TEXT = -1; }, u => { u.provenance.schema = 'claude'; }]) { const usage = observed(); mutate(usage); expect(() => costFromExactUsageSnapshot(usage, snapshot())).toThrow(); }
    const getter = vi.fn(), usage = observed(); Object.defineProperty(usage.processingToolModalities, 'TEXT', { enumerable: true, get: getter }); expect(() => costFromExactUsageSnapshot(usage, snapshot())).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('typed DOCUMENT/VIDEO loaded-token components have explicit independent rates and cannot launder maps into legacy zero or flat usage', () => {
    const price = snapshot(), usage = observed(); price.usageSemantics.allowedInputModalities.push('DOCUMENT'); price.usageSemantics.allowedProcessingToolModalities.push('DOCUMENT');
    price.rates.input_document = '4'; price.rates.cached_document = '0.3'; price.rates.processing_tool_document = '29';
    for (const key of ['input_document', 'cached_document', 'processing_tool_document']) price.rateUnits[key] = 'USD/1M tokens';
    usage.processingToolModalities = { VIDEO: 20, DOCUMENT: 30 }; expect(costFromExactUsageSnapshot(usage, price)).toBe('1866000');
    delete price.rates.processing_tool_document; expect(() => costFromExactUsageSnapshot(usage, price)).toThrow();
    const zero = observed(); zero.processingToolPromptTokens = 0; zero.processingToolModalities = {}; const missing = snapshot(); delete missing.rates.processing_tool_video; expect(() => costFromExactUsageSnapshot(zero, missing)).toThrow();
    const flat = erased(); delete flat.inputModalities; delete flat.provenance.inputModalities; flat.processingToolModalities = {}; expect(() => costFromExactUsageSnapshot(flat, snapshot())).toThrow();
    const legacy = observed(); legacy.processingToolPromptTokens = 0; legacy.provenance.videoProcessingToolPrompt = 'observed_gemini_video_processing_tool_prompt_zero'; expect(() => costFromExactUsageSnapshot(legacy, snapshot())).toThrow();
    const stripped = snapshot(); delete stripped.usageSemantics.videoProcessingToolPrompt; expect(() => costFromExactUsageSnapshot(observed(), stripped)).toThrow();
  });
  it('pure parsed recovery preserves complete tool quantity/modality/provenance and rejects partial/foreign claims without server dependency imports', () => {
    const draft = value => attemptRecoveryDraft({ resolutionVersion: 1 }, { action: 'exact_usage', reason: 'owned', evidence: 'observed details', usageJson: JSON.stringify(value) }, 'processing-tools-recovery');
    expect(draft(observed()).usage).toEqual(observed());
    for (const mutate of [u => { delete u.processingToolPromptTokens; }, u => { delete u.processingToolModalities; }, u => { delete u.provenance.videoProcessingToolPrompt; }, u => { u.processingToolPromptTokens++; }, u => { u.processingToolModalities.UNKNOWN = 0; }, u => { u.provenance.schema = 'claude'; }]) { const usage = observed(); mutate(usage); expect(() => draft(usage)).toThrow(); }
  });
  it('actual SQL.js recovery uses original typed tool rates despite current drift; erased usage has no audit, valid receipt survives idempotency/reopen', async () => withDb('recovery', async (db, reopen) => {
    insertAttemptSync(db, { attemptId: 'tools-attempt', requestId: 'tools-request', apiKeyId: 'fixture-key', ownerInstanceId: db.ownerInstanceId, provider: 'gemini', model: 'fixture-gemini', endpoint: 'chat', startedAt: '2026-10-03T00:00:00.000Z', priceSnapshot: snapshot() });
    finalizeAttemptSync(db, 'tools-attempt', { state: 'unresolved', outcome: 'failed', finishedAt: '2026-10-03T00:01:00.000Z' });
    expect(() => resolveAttemptSync(db, 'tools-attempt', operation(erased()))).toThrow(); expect(getAttemptSync(db, 'tools-attempt')).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(0);
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','gemini',?)", [JSON.stringify({ 'fixture-gemini': { input: '100', output: '200', processing_tool_image: '1700' } })]));
    const result = resolveAttemptSync(db, 'tools-attempt', operation(observed())); expect(result).toMatchObject({ state: 'settled', costNanoUsd: '1366000', usage: { processingToolPromptTokens: 50, processingToolModalities: { TEXT: 10, IMAGE: 30, AUDIO: 10 } } }); expect(resolveAttemptSync(db, 'tools-attempt', operation(observed()))).toEqual(result);
    const receipt = recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'tools-attempt' }, operation(observed())); expect(receipt.costUsd).toBe('0.001366'); expect(() => recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'tools-attempt' }, operation(erased()))).toThrow();
    db = await reopen(); expect(recoveryReceiptSync(db, 'fixture-key', { kind: 'attempt', id: 'tools-attempt' }, operation(observed()))).toEqual(receipt); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(1); expect(JSON.stringify(receipt)).not.toMatch(/fixture-admin|owned proof|private|opaque|AGENTIC/);
  }), 20000);
  it('SQL.js sync/queued terminal consumers require retained tool modality evidence, including zero observed tokens; seeded snapshots do not prove provider admission', async () => withDb('terminal', async db => {
    db.durableTransaction(() => {
      db.run("INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES('fixture-key','fixture-secret',1,'2026-10-01T00:00:00.000Z')"); retainKeyBindings(db, db.coverage, [{ id: 'fixture-key', key: 'fixture-secret' }]);
      db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-01T00:00:00.000Z')"); db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture',?)", [JSON.stringify({ 'fixture-gemini': { input: '1', output: '2' } })]);
    });
    for (const queued of [false, true]) for (const missing of [true, false]) {
      const context = await createBudgetContext('fixture-key', { adapter: async () => db, clock: () => '2026-10-03T00:00:00.000Z', project: () => {} }), meta = { provider: 'fixture', model: 'fixture-gemini', endpoint: 'chat' }, attempt = queued ? await context.beginAttemptQueued(meta) : context.beginAttempt(meta);
      db.durableTransaction(() => db.run('UPDATE apiKeyAccounting SET priceSnapshotJson=? WHERE attemptId=?', [JSON.stringify(snapshot()), attempt.attemptId]));
      const terminal = queued ? await context.completeAttemptQueued(attempt, { usage: missing ? erased() : observed() }) : context.completeAttempt(attempt, { usage: missing ? erased() : observed() });
      expect(terminal).toMatchObject({ state: missing ? 'unresolved' : 'settled', costNanoUsd: missing ? null : '1366000' }); expect(getAttemptSync(db, attempt.attemptId)).toMatchObject({ state: terminal.state, costNanoUsd: terminal.costNanoUsd });
    }
  }), 20000);
});
