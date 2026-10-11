import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';
import { captureQueuedRequestAuthoritySync } from './queuedRequestAuthority.js';
import { validateGeminiEmbeddingAuthority } from './geminiEmbeddingAuthority.js';
import { captureGeminiEmbeddingSelectionSync } from './geminiEmbeddingSelection.js';
import { assertRequestAccountingOrigin } from './requestAccounting.js';
import { ApiKeyBudgetError } from './errors.js';
import { BUDGET_ERROR } from '../../../open-sse/config/apiKeyBudgetConstants.js';

// INTERNAL healthy synchronous request-local binding; no public entry issues
// this opt-in yet. Model resolution remains caller-owned; fill-first SQL account
// selection and exact issued context origin are independently checked here.
// This wrapper adds fresh SQL equality, never a second terminal sink.
export function bindGeminiEmbeddingAccounting({ db, credential, accounting, connectionId, image }) {
  const fail = () => { throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE); };
  let retained, pinned, pinnedSelection, target;
  function capture() {
    if (!db.health().healthy) fail();
    const key = db.get('SELECT id FROM apiKeys WHERE key=?', [credential]);
    if (!key || typeof key.id !== 'string') fail();
    assertRequestAccountingOrigin(accounting, { db, credential, apiKeyId: key.id });
    return captureQueuedRequestAuthoritySync(db, { credential, apiKeyId: key.id,
      provider: 'gemini', model: target.model, connectionId: target.connectionId });
  }
  try {
    const detached = snapshotAccountingPreparedData({ image, connectionId });
    image = detached.image;
    target = snapshotAccountingPreparedData({ model: image.model, connectionId: detached.connectionId });
    if (typeof credential !== 'string' || !credential || typeof target.connectionId !== 'string' || !target.connectionId) fail();
    // Provenance must precede any caller-object method/flag read.
    pinned = capture();
    if (accounting.requiresPreparedBaseWire === true || accounting.requiresUnhealthyEmbeddingsWire === true) fail();
    for (const method of ['gate', 'beforeAttempt', 'completeAttempt', 'assertSupported', 'assertSuccessfulTerminal']) {
      if (typeof accounting[method] !== 'function') fail();
    }
    retained = validateGeminiEmbeddingAuthority(pinned, image);
    pinnedSelection = captureGeminiEmbeddingSelectionSync(db, pinned);
  } catch { fail(); }
  // Admission errors retain their budget/unresolved code, not authority errors.
  accounting.gate();
  function assertAuthorityCurrent() {
    try {
      const fresh = capture();
      if (!isDeepStrictEqual(fresh, pinned) || !isDeepStrictEqual(validateGeminiEmbeddingAuthority(fresh, retained), retained) ||
          !isDeepStrictEqual(captureGeminiEmbeddingSelectionSync(db, fresh), pinnedSelection)) fail();
    } catch { fail(); }
  }
  function gate() {
    assertAuthorityCurrent();
    return accounting.gate();
  }
  return Object.freeze({ ...accounting, requiresGeminiEmbeddingsWire: true, gate,
    assertSupported(supported) { gate(); return accounting.assertSupported(supported); },
    assertGeminiEmbeddingImage(current) {
      gate();
      try { if (!isDeepStrictEqual(validateGeminiEmbeddingAuthority(pinned, current), retained)) fail(); } catch { fail(); }
    },
    beforeAttempt(meta, supported, wire = null) {
      gate();
      let candidate;
      try { candidate = snapshotAccountingPreparedData(meta); } catch { fail(); }
      if (wire !== null || !candidate || candidate.provider !== 'gemini' || candidate.model !== target.model ||
          candidate.endpoint !== 'embeddings' || candidate.connectionId !== target.connectionId) fail();
      return accounting.beforeAttempt(candidate, supported);
    },
    assertSuccessfulTerminal(terminal) {
      // A dispatched settlement can legitimately cross a budget. Fresh origin
      // and route authority still apply; only successors use admission gates.
      assertAuthorityCurrent();
      return accounting.assertSuccessfulTerminal(terminal);
    },
    // completeAttempt remains exactly the original own service sink. Fresh
    // admission refusal must not discard settlement for already dispatched work.
  });
}
