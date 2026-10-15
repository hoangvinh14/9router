import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { inspectRawGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createGeminiInputModalityAuthority } from 'open-sse/config/accountingGeminiInputModalities.js';
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
const original = () => ({ contents: [{ parts: [{ inlineData: { mimeType: 'video/mp4', data: 'b3BhcXVl' } }] }] });
const rates = () => ({ input: '1', output: '2', cached: '0.1', input_video: '11', cached_video: '0.5', input_image: '3', cached_image: '0.2', input_audio: '7', cached_audio: '0.4' });
const snapshot = () => ({ rates: rates(), rateUnits: Object.fromEntries(Object.keys(rates()).filter(key => key !== 'output').map(key => [key, 'USD/1M tokens'])),
  usageSemantics: { inputModalities: 'observed_gemini_inline_input_modalities', allowedInputModalities: [...createGeminiInputModalityAuthority(original(), null, false, false, true).allowedInputModalities] } });
const usage = () => inspectRawGeminiAccounting({ modelVersion: 'fixture-gemini', candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'private answer' }] } }],
  usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 10, totalTokenCount: 130,
    promptTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'VIDEO', tokenCount: 70 }], cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'VIDEO', tokenCount: 30 }] } },
'fixture-gemini', { inlineVideoOriginal: original() }).usage;
const erased = () => { const value = usage(); delete value.inputModalities; delete value.provenance.inputModalities; return value; };
describe('explicit observed input VIDEO reference money/recovery prerequisite, not queued admission', () => {
  it('typed VIDEO replaces aggregate input and combines separate thoughts/output once; alternate observed IMAGE/AUDIO never pays VIDEO too', () => {
    // TEXT21k + VIDEO40*11+30*.5=455k + output40k + thoughts20k =536k.
    expect(costFromExactUsageSnapshot(usage(), snapshot())).toBe('536000'); expect(costFromExactUsage(usage(), rates())).toBe('536000');
    const alternate = usage(); alternate.inputModalities = { TEXT: { input: 30, cacheRead: 10 }, IMAGE: { input: 50, cacheRead: 20 }, AUDIO: { input: 20, cacheRead: 10 } };
    expect(costFromExactUsageSnapshot(alternate, snapshot())).toBe('249000'); //21k+94k+74k+60k, no aggregate input/VIDEO double charge.
    const zero = rates(); for (const key of Object.keys(zero)) zero[key] = '0'; expect(costFromExactUsage(usage(), zero)).toBe('0');
    const tiny = usage(); Object.assign(tiny, { input: 2, cacheRead: 0, output: 1, reasoning: 0 }); tiny.inputModalities = { TEXT: { input: 1, cacheRead: 0 }, VIDEO: { input: 1, cacheRead: 0 } };
    expect(costFromExactUsage(tiny, { input: '0.0002', cached: '0', input_video: '0.0002', cached_video: '0', output: '0.0002' })).toBe('1');
  });
  it('original allowed VIDEO/IMAGE/AUDIO categories require each independent rate and unit even unobserved/zero; erasure cannot settle flat', () => {
    expect(costFromExactUsageSnapshot(usage(), snapshot())).toBe('536000');
    for (const field of ['input_video', 'cached_video', 'input_image', 'cached_image', 'input_audio', 'cached_audio']) {
      const missing = snapshot(); delete missing.rates[field]; expect(() => costFromExactUsageSnapshot(usage(), missing)).toThrow();
      const unit = snapshot(); delete unit.rateUnits[field]; expect(() => costFromExactUsageSnapshot(usage(), unit)).toThrow();
    }
    const wrong = snapshot(); wrong.rateUnits.input_video = 'USD/second'; expect(() => costFromExactUsageSnapshot(usage(), wrong)).toThrow();
    const noMarker = snapshot(); delete noMarker.usageSemantics; expect(() => costFromExactUsageSnapshot(usage(), noMarker)).toThrow();
    expect(() => costFromExactUsageSnapshot(erased(), snapshot())).toThrow();
    const exactZero = usage(); exactZero.inputModalities = { TEXT: { input: 100, cacheRead: 40 }, VIDEO: { input: 0, cacheRead: 0 } };
    expect(costFromExactUsageSnapshot(exactZero, snapshot())).toBe('124000'); const missing = snapshot(); delete missing.rates.cached_video; expect(() => costFromExactUsageSnapshot(exactZero, missing)).toThrow();
    const unknown = usage(); unknown.inputModalities.UNKNOWN = { input: 0, cacheRead: 0 }; expect(() => costFromExactUsage(unknown, rates())).toThrow();
  });
  it('manual lexical VIDEO ingress/draft freezes unit/revision but never supplies usage semantics, codec prices or catalog duration authority', () => {
    expect(completeReferenceRates(rates())).toEqual(rates()); expect(validatePricingMutation({ gemini: { fixture: { ...rates(), cached_video: 0 } } }).gemini.fixture.cached_video).toBe('0');
    expect(() => completeReferenceRates(rates(), 'embeddings')).toThrow(); for (const value of [null, '-1', '1e1', '0.0000000001']) expect(() => completeReferenceRates({ ...rates(), input_video: value })).toThrow();
    let current = rates(); const db = { readReferencePricing: (scope, key) => scope === 'pricing' && key === 'gemini' ? { fixture: current } : null };
    const retained = resolveReferencePriceSync(db, 'gemini', 'fixture').snapshot; expect(retained.rateUnits.input_video).toBe('USD/1M tokens'); expect(retained).not.toHaveProperty('usageSemantics'); expect(Object.isFrozen(retained.rateUnits)).toBe(true);
    current = { ...rates(), input_video: '110' }; expect(resolveReferencePriceSync(db, 'gemini', 'fixture').snapshot.revision).not.toBe(retained.revision); expect(retained.rates.input_video).toBe('11');
    const baseline = pricingDraft({ gemini: { fixture: rates() } }), draft = pricingDraft({ gemini: { fixture: rates() } }); draft.gemini.fixture.cached_video = ''; expect(changedPricingModels(baseline, draft).gemini.fixture).not.toHaveProperty('cached_video');
    const catalog = validateCatalog(JSON.stringify({ fixture: { id: 'fixture', models: { fixture: { id: 'fixture', cost: { input: 1, output: 2, input_video: 11 } } } } })); expect(catalog.entries['fixture/fixture'].status).toBe('unsupported');
  });
  it('parsed VIDEO recovery and actual SQL.js original snapshot settle536000 despite price drift; erasure unresolved/noaudit and receipt survives reopen', async () => {
    const draft = value => attemptRecoveryDraft({ resolutionVersion: 1 }, { action: 'exact_usage', reason: 'owned', evidence: 'observed VIDEO', usageJson: JSON.stringify(value) }, 'video-recovery');
    expect(draft(usage()).usage).toEqual(usage()); const bad = usage(); bad.inputModalities.VIDEO.seconds = 1; expect(() => draft(bad)).toThrow();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-video-recovery-')), file = path.join(directory, 'db.sqlite'), owner = acquireWriterOwnership(directory); let db;
    try {
      db = await createSqlJsAdapter(file, owner); expect(db.driver).toBe('sql.js'); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner);
      insertAttemptSync(db, { attemptId: 'video-attempt', requestId: 'video-request', apiKeyId: 'fixture-key', ownerInstanceId: owner.instanceId, provider: 'gemini', model: 'fixture', endpoint: 'chat', startedAt: '2026-10-03T00:00:00.000Z', priceSnapshot: snapshot() });
      finalizeAttemptSync(db, 'video-attempt', { state: 'unresolved', outcome: 'failed', finishedAt: '2026-10-03T00:01:00.000Z' });
      const operation = { ...draft(usage()), actor: 'fixture-admin' }; expect(() => resolveAttemptSync(db, 'video-attempt', { ...operation, usage: erased() })).toThrow();
      expect(getAttemptSync(db, 'video-attempt')).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(0);
      db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','gemini',?)", [JSON.stringify({ fixture: { ...rates(), input_video: '110' } })]));
      const settled = resolveAttemptSync(db, 'video-attempt', operation); expect(settled).toMatchObject({ state: 'settled', costNanoUsd: '536000' }); expect(resolveAttemptSync(db, 'video-attempt', operation)).toEqual(settled);
      const target = { kind: 'attempt', id: 'video-attempt' }, receipt = recoveryReceiptSync(db, 'fixture-key', target, operation); expect(receipt.costUsd).toBe('0.000536');
      db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner); expect(recoveryReceiptSync(db, 'fixture-key', target, operation)).toEqual(receipt); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(1);
      expect(JSON.stringify(receipt)).not.toMatch(/private|b3BhcXVl|fixture-admin|observed VIDEO/);
    } finally { db?.close(); owner.release(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 20000);
  it('editor and settings show explicit VIDEO token input/cache references, never seconds/FPS or output-video support', () => {
    const modal = fs.readFileSync(new URL('../../src/shared/components/PricingModal.js', import.meta.url), 'utf8'), page = fs.readFileSync(new URL('../../src/app/dashboard/settings/pricing/page.js', import.meta.url), 'utf8');
    expect(modal).toContain('Video input'); expect(modal).toContain('Video cached'); expect(page).toContain('Video input');
  });
});
