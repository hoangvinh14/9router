import { createHash } from 'node:crypto';
import { assertGeminiOwnedFileAuthoritySync, assertGeminiOwnedFileVideoMetadataSync, assertGeminiOwnedFileVideoResolutionSync, assertGeminiOwnedFileClientToolsSync, assertGeminiOwnedFileInlineMediaSync, assertGeminiOwnedFileInlineAudioSync, assertGeminiOwnedFileInlineVideoSync } from './geminiOwnedFileAuthority.js';
import { resolveReferencePriceSync } from '../pricing/referenceResolver.js';
import { decimalToNanoUsd } from '../pricing/decimalMoney.js';
import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';
import { createGeminiOwnedFileRawAuthority, assertGeminiOwnedFileRawAuthority } from '../../../open-sse/config/accountingGeminiOwnedFileRaw.js';
import { ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE, ACCOUNTING_GEMINI_MODALITY_RATES } from '../../../open-sse/config/accountingGeminiModalityRates.js';
import { validateGeminiInputRateCategories } from '../../../open-sse/config/accountingGeminiModalityUsage.js';

const unavailable = () => { throw new Error('Owned Gemini file reference pricing unavailable'); };
// Captures operator reference price, not observed usage or dispatch permission.
// No fake zero terminal is constructed to validate required rates.
export function captureGeminiOwnedFilePriceSync(db, capability, original, expectedModel) {
  if (typeof expectedModel !== 'string' || !expectedModel) unavailable();
  const bound = assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel);
  const grant = assertGeminiOwnedFileVideoMetadataSync(db, capability, original, expectedModel);
  const resolution = assertGeminiOwnedFileVideoResolutionSync(db, capability, original, expectedModel);
  const client = assertGeminiOwnedFileClientToolsSync(db, capability, original, expectedModel);
  const inline = assertGeminiOwnedFileInlineMediaSync(db, capability, original, expectedModel);
  const audio = assertGeminiOwnedFileInlineAudioSync(db, capability, original, expectedModel);
  const video = assertGeminiOwnedFileInlineVideoSync(db, capability, original, expectedModel);
  const raw = createGeminiOwnedFileRawAuthority(bound.original, bound.resources, grant, resolution, client, inline, audio, video);
  const categories = assertGeminiOwnedFileRawAuthority(raw).allowedInputModalities;
  const price = resolveReferencePriceSync(db, 'gemini', expectedModel, 'chat');
  if (price.status !== 'priced' || price.snapshot.provider !== 'gemini' || price.snapshot.model !== expectedModel || price.snapshot.endpoint !== 'chat') unavailable();
  const snapshot = snapshotAccountingPreparedData({ ...price.snapshot, usageSemantics: {
    inputModalities: ACCOUNTING_GEMINI_OWNED_FILE_MODALITY_PROVENANCE, allowedInputModalities: categories,
  } });
  for (const modality of validateGeminiInputRateCategories(snapshot)) {
    const row = ACCOUNTING_GEMINI_MODALITY_RATES.find(item => item.modality === modality);
    decimalToNanoUsd(snapshot.rates[row.input]); decimalToNanoUsd(snapshot.rates[row.cached]);
  }
  decimalToNanoUsd(snapshot.rates.output);
  if (Object.hasOwn(snapshot.rates, 'reasoning')) decimalToNanoUsd(snapshot.rates.reasoning);
  assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel);
  // Category semantics become part of this capture's revision, while retaining
  // the actual resolver revision for provenance; no original data in prices.
  const revision = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return snapshotAccountingPreparedData({ usageCertified: false, snapshot: {
    ...snapshot, referenceRevision: price.snapshot.revision, revision,
  } });
}
