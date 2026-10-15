import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { inspectRawGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { costFromExactUsage, costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
import { completeReferenceRates, resolveReferencePriceSync } from '@/lib/pricing/referenceResolver.js';
import { validatePricingMutation } from '@/lib/pricing/pricingValidation.js';
import { validateCatalog } from '@/lib/pricing/catalogSync.js';
import { pricingDraft, changedPricingModels } from '@/shared/utils/pricingDraft.js';
import { attemptRecoveryDraft } from '@/shared/utils/budgetManagementDraft.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { insertAttemptSync, finalizeAttemptSync, resolveAttemptSync, getAttemptSync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { recoveryReceiptSync } from '@/lib/apiKeyBudget/recoveryReceipt.js';
const marker = 'observed_gemini_inline_input_modalities';
const rates = () => ({ input: '1', output: '2', cached: '0.1', input_audio: '7', cached_audio: '0.4' });
const snapshot = () => ({ rates: rates(), rateUnits: { input: 'USD/1M tokens', cached: 'USD/1M tokens', input_audio: 'USD/1M tokens', cached_audio: 'USD/1M tokens' }, usageSemantics: { inputModalities: marker, allowedInputModalities: ['TEXT', 'AUDIO'] } });
const usage = () => inspectRawGeminiAccounting({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'private transcript' }] } }], usageMetadata: {
  promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130, cachedContentTokenCount: 40,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'AUDIO', tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'AUDIO', tokenCount: 30 }],
} }, 'fixture-gemini', { inlineAudioOriginal: { contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data: 'b3BhcXVl' } }] }] } }).usage;
const flat = () => { const value = usage(); delete value.inputModalities; delete value.provenance.inputModalities; return value; };
describe('explicit observed input AUDIO monetary/reference/recovery prerequisite, not queued admission', () => {
  it('explicit AUDIO input/cache replaces aggregate input and combines separate thoughts/output once; zero priced and single rounding preserved', () => {
    // TEXT20*1+10*.1=21000; AUDIO40*7+30*.4=292000;
    // output20*2=40000 plus separate thoughts10*2=20000:373000.
    expect(costFromExactUsageSnapshot(usage(), snapshot())).toBe('373000'); expect(costFromExactUsage(usage(), rates())).toBe('373000');
    const zero = rates(); for (const key of Object.keys(zero)) zero[key] = '0'; expect(costFromExactUsage(usage(), zero)).toBe('0');
    const tiny = usage(); Object.assign(tiny, { input: 2, cacheRead: 0, output: 1, reasoning: 0 }); tiny.inputModalities = { TEXT: { input: 1, cacheRead: 0 }, AUDIO: { input: 1, cacheRead: 0 } };
    expect(costFromExactUsage(tiny, { input: '0.0002', cached: '0', input_audio: '0.0002', cached_audio: '0', output: '0.0002' })).toBe('1');
  });
  it('required original rate/unit/category authority even observed zero forbids flat fallback, erasure, unknown modalities and programmable inputs', () => {
    expect(costFromExactUsageSnapshot(usage(), snapshot())).toBe('373000');
    for (const change of [s => { delete s.rates.input_audio; }, s => { delete s.rates.cached_audio; }, s => { delete s.rateUnits.cached_audio; },
      s => { s.rateUnits.input_audio = 'USD/second'; }, s => { delete s.usageSemantics; }, s => { s.usageSemantics.allowedInputModalities = ['TEXT']; }]) {
      const price = snapshot(); change(price); expect(() => costFromExactUsageSnapshot(usage(), price)).toThrow();
    }
    expect(() => costFromExactUsageSnapshot(flat(), snapshot())).toThrow();
    const observedZero = usage(); observedZero.inputModalities = { TEXT: { input: 100, cacheRead: 40 }, AUDIO: { input: 0, cacheRead: 0 } };
    const missing = snapshot(); delete missing.rates.cached_audio; expect(() => costFromExactUsageSnapshot(observedZero, missing)).toThrow();
    const getter = vi.fn(), value = usage(); Object.defineProperty(value, 'inputModalities', { enumerable: true, get: getter }); expect(() => costFromExactUsage(value, rates())).toThrow(); expect(getter).not.toHaveBeenCalled();
    const foreign = usage(); foreign.inputModalities.VIDEO = { input: 0, cacheRead: 0 }; expect(() => costFromExactUsage(foreign, rates())).toThrow();
  });
  it('manual chat AUDIO rate ingress/draft/immutable resolver units never supplies usage semantics or catalog duration pricing', () => {
    expect(completeReferenceRates(rates())).toEqual(rates()); expect(validatePricingMutation({ gemini: { fixture: { ...rates(), cached_audio: 0 } } }).gemini.fixture.cached_audio).toBe('0');
    expect(() => completeReferenceRates(rates(), 'embeddings')).toThrow();
    for (const value of [null, '-1', '1e1', '0.0000000001']) expect(() => completeReferenceRates({ ...rates(), input_audio: value })).toThrow();
    let current = rates(); const db = { readReferencePricing: (scope, key) => scope === 'pricing' && key === 'gemini' ? { fixture: current } : null };
    const original = resolveReferencePriceSync(db, 'gemini', 'fixture').snapshot; expect(original.rateUnits.input_audio).toBe('USD/1M tokens'); expect(original).not.toHaveProperty('usageSemantics'); expect(Object.isFrozen(original.rateUnits)).toBe(true);
    current = { ...rates(), input_audio: '70' }; expect(resolveReferencePriceSync(db, 'gemini', 'fixture').snapshot.revision).not.toBe(original.revision); expect(original.rates.input_audio).toBe('7');
    const baseline = pricingDraft({ gemini: { fixture: rates() } }), draft = pricingDraft({ gemini: { fixture: rates() } }); expect(draft.gemini.fixture.input_audio).toBe('7');
    draft.gemini.fixture.cached_audio = ''; expect(changedPricingModels(baseline, draft).gemini.fixture).not.toHaveProperty('cached_audio');
    const catalog = validateCatalog(JSON.stringify({ fixture: { id: 'fixture', models: { fixture: { id: 'fixture', cost: { input: 1, output: 2, input_audio: 7 } } } } })); expect(catalog.entries['fixture/fixture'].status).toBe('unsupported');
  });
  it('parsed draft strict observed AUDIO and actual SQL.js original snapshot recovery reject erasure/noaudit; exact receipt survives drift/reopen', async () => {
    const draft = value => attemptRecoveryDraft({ resolutionVersion: 1 }, { action: 'exact_usage', reason: 'owned', evidence: 'observed AUDIO', usageJson: JSON.stringify(value) }, 'audio-recovery');
    expect(draft(usage()).usage).toEqual(usage()); const bad = usage(); bad.inputModalities.AUDIO.seconds = 1; expect(() => draft(bad)).toThrow();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-audio-recovery-')), file = path.join(directory, 'db.sqlite'), owner = acquireWriterOwnership(directory); let db;
    try {
      db = await createSqlJsAdapter(file, owner); expect(db.driver).toBe('sql.js'); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
      insertAttemptSync(db, { attemptId: 'audio-attempt', requestId: 'audio-request', apiKeyId: 'fixture-key', ownerInstanceId: owner.instanceId, provider: 'gemini', model: 'fixture', endpoint: 'chat', startedAt: '2026-10-03T00:00:00.000Z', priceSnapshot: snapshot() });
      finalizeAttemptSync(db, 'audio-attempt', { state: 'unresolved', outcome: 'failed', finishedAt: '2026-10-03T00:01:00.000Z' });
      const operation = { ...draft(usage()), actor: 'fixture-admin' }; expect(() => resolveAttemptSync(db, 'audio-attempt', { ...operation, usage: flat() })).toThrow();
      expect(getAttemptSync(db, 'audio-attempt')).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(0);
      db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','gemini',?)", [JSON.stringify({ fixture: { ...rates(), input_audio: '70' } })]));
      const settled = resolveAttemptSync(db, 'audio-attempt', operation); expect(settled).toMatchObject({ state: 'settled', costNanoUsd: '373000' }); expect(resolveAttemptSync(db, 'audio-attempt', operation)).toEqual(settled);
      const target = { kind: 'attempt', id: 'audio-attempt' }, receipt = recoveryReceiptSync(db, 'fixture-key', target, operation); expect(receipt.costUsd).toBe('0.000373');
      db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner);
      expect(recoveryReceiptSync(db, 'fixture-key', target, operation)).toEqual(receipt); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(1); expect(JSON.stringify(receipt)).not.toMatch(/private|b3BhcXVl|fixture-admin|observed AUDIO/);
    } finally { db?.close(); owner.release(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 20000);
  it('mixed observed IMAGE/AUDIO retains independent typed rates without paying aggregate input twice or borrowing unknown categories', () => {
    const value = usage(); value.inputModalities.AUDIO.input = 60; value.inputModalities.AUDIO.cacheRead = 20; value.inputModalities.IMAGE = { input: 10, cacheRead: 10 };
    const price = snapshot(); Object.assign(price.rates, { input_image: '3', cached_image: '0.2' }); Object.assign(price.rateUnits, { input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens' }); price.usageSemantics.allowedInputModalities.push('IMAGE');
    expect(costFromExactUsageSnapshot(value, price)).toBe('371000'); //21k TEXT+288k AUDIO+2k IMAGE+60k output/thoughts
    delete price.rates.cached_image; expect(() => costFromExactUsageSnapshot(value, price)).toThrow();
  });
  it('original selected AUDIO category requires rates even without an observed AUDIO row; explicit-zero rows carry no corpus or duration', () => {
    const value = usage(); value.inputModalities = { TEXT: { input: 100, cacheRead: 40 } }; const price = snapshot();
    expect(costFromExactUsageSnapshot(value, price)).toBe('124000'); //explicit observed TEXT100, not estimated absent AUDIO tokens
    delete price.rates.input_audio; expect(() => costFromExactUsageSnapshot(value, price)).toThrow();
    const exactZero = usage(); exactZero.inputModalities = { TEXT: { input: 100, cacheRead: 40 }, AUDIO: { input: 0, cacheRead: 0 } };
    expect(costFromExactUsageSnapshot(exactZero, snapshot())).toBe('124000');
    const foreign = snapshot(); foreign.usageSemantics.allowedInputModalities = ['TEXT', 'VIDEO']; expect(() => costFromExactUsageSnapshot(exactZero, foreign)).toThrow();
  });
  it('editor and coverage describe explicit unavailable AUDIO references rather than ordinary cached fallback or output-audio support', () => {
    const modal = fs.readFileSync(new URL('../../src/shared/components/PricingModal.js', import.meta.url), 'utf8'), page = fs.readFileSync(new URL('../../src/app/dashboard/settings/pricing/page.js', import.meta.url), 'utf8');
    expect(modal).toContain('Audio input'); expect(modal).toContain('Audio cached'); expect(page).toContain('Audio input');
  });
});
