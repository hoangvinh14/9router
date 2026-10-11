import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { captureQueuedRequestAuthoritySync } from './queuedRequestAuthority.js';
import { validateQueuedGeminiEmbeddingWire } from './queuedGeminiEmbeddingWire.js';
import { captureGeminiEmbeddingSelectionSync } from './geminiEmbeddingSelection.js';
import { assertQueuedRequestAccountingOrigin } from './requestAccounting.js';
import { ApiKeyBudgetError } from './errors.js';
import { BUDGET_ERROR } from '../../../open-sse/config/apiKeyBudgetConstants.js';

// INTERNAL queued binding only. No public entry issues this mode. The original
// issued context/service owns intent and terminal ACK; this is fresh authority
// and immutable-wire equality, never a second persistence sink or spend cache.
export function bindQueuedGeminiEmbeddingAccounting({ db, credential, accounting, connectionId, wire }) {
  const fail = () => { throw new ApiKeyBudgetError(BUDGET_ERROR.UNAVAILABLE); };
  let retained, pinned, selection, target;
  function capture() {
    if (!db.health().healthy) fail();
    const key = db.get('SELECT id FROM apiKeys WHERE key=?', [credential]);
    if (!key || typeof key.id !== 'string') fail();
    // Exact issued object check precedes every caller flag/method read.
    assertQueuedRequestAccountingOrigin(accounting, { db, credential, apiKeyId: key.id });
    return captureQueuedRequestAuthoritySync(db, { credential, apiKeyId: key.id,
      provider: 'gemini', model: target.model, connectionId: target.connectionId });
  }
  try {
    const command = snapshotAccountingGroup([{ type: 'queued-gemini-binding', value: { wire, connectionId } }])[0];
    if (command.type !== 'queued-gemini-binding') fail();
    wire = command.value.wire;
    target = { model: wire?.geminiEmbeddingTransport?.model, connectionId: command.value.connectionId };
    if (typeof credential !== 'string' || !credential || typeof target.connectionId !== 'string' || !target.connectionId) fail();
    pinned = capture();
    if (accounting.requiresPreparedBaseWire !== true || accounting.requiresUnhealthyEmbeddingsWire === true) fail();
    for (const method of ['gate', 'beforeAttempt', 'completeAttempt', 'assertSupported', 'assertSuccessfulTerminal']) {
      if (typeof accounting[method] !== 'function') fail();
    }
    retained = validateQueuedGeminiEmbeddingWire(pinned, wire);
    selection = captureGeminiEmbeddingSelectionSync(db, pinned);
  } catch { fail(); }
  accounting.gate();
  function assertAuthorityCurrent() {
    try {
      const fresh = capture();
      if (!isDeepStrictEqual(fresh, pinned) || !isDeepStrictEqual(validateQueuedGeminiEmbeddingWire(fresh, retained), retained) ||
          !isDeepStrictEqual(captureGeminiEmbeddingSelectionSync(db, fresh), selection)) fail();
    } catch { fail(); }
  }
  function gate() { assertAuthorityCurrent(); return accounting.gate(); }
  return Object.freeze({ ...accounting, requiresGeminiEmbeddingsWire: true, requiresQueuedGeminiEmbeddingsWire: true, gate,
    assertSupported(supported) { gate(); return accounting.assertSupported(supported); },
    assertGeminiEmbeddingImage(image) {
      gate();
      try {
        const current = validateQueuedGeminiEmbeddingWire(pinned, { ...retained, geminiEmbeddingTransport: image });
        if (!isDeepStrictEqual(current, retained)) fail();
      } catch { fail(); }
    },
    beforeAttempt(meta, supported, preparedWire) {
      gate();
      let command;
      try {
        command = snapshotAccountingGroup([{ type: 'queued-gemini-target', value: { meta, wire: preparedWire } }])[0];
        if (command.type !== 'queued-gemini-target') fail();
        const candidate = command.value.meta;
        if (!candidate || candidate.provider !== 'gemini' || candidate.model !== target.model ||
            candidate.endpoint !== 'embeddings' || candidate.connectionId !== target.connectionId ||
            !isDeepStrictEqual(validateQueuedGeminiEmbeddingWire(pinned, command.value.wire), retained)) fail();
      } catch { fail(); }
      // Service rereads complete selection/wire/price/key inside dequeue. Return
      // its handle intact; the owner must gate AFTER await and settle refusal.
      // Service budget/delivery errors stay outside the authority catch.
      return accounting.beforeAttempt(command.value.meta, supported, command.value.wire);
    },
    assertSuccessfulTerminal(terminal) {
      // Legitimate settlement may cross budget. Fresh authority is still owed;
      // successors, not this dispatched terminal, use admission budget checks.
      assertAuthorityCurrent(); return accounting.assertSuccessfulTerminal(terminal);
    },
    // completeAttempt remains exactly the original queued service sink.
  });
}
