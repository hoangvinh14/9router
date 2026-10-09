import { createAccountingSseParser } from './accountingSseParser.js';
import { ACCOUNTING_SSE_TERMINAL_MAX_BYTES, ACCOUNTING_SSE_TERMINAL_MAX_EVENTS, ACCOUNTING_SSE_READY_MAX_EVENTS, ACCOUNTING_SSE_READY_MAX_BYTES, ACCOUNTING_SSE_IDLE_MS, ACCOUNTING_SSE_POST_DONE_MS } from '../config/accountingStreamLimits.js';

// This stream is the only terminal owner of an already dispatched POST. It must
// not be fed into a legacy transform that can synthesize successful terminals.
export function createAccountedOpenaiStream(response, { accounting, attempt, signal, limits = {}, provider = 'openai', parserFactory = createAccountingSseParser, expectedModel = null }) {
  const { idleMs = ACCOUNTING_SSE_IDLE_MS, postDoneMs = ACCOUNTING_SSE_POST_DONE_MS,
    terminalMaxBytes = ACCOUNTING_SSE_TERMINAL_MAX_BYTES, terminalMaxEvents = ACCOUNTING_SSE_TERMINAL_MAX_EVENTS,
    readyMaxBytes = ACCOUNTING_SSE_READY_MAX_BYTES, readyMaxEvents = ACCOUNTING_SSE_READY_MAX_EVENTS } = limits;
  if (![idleMs, postDoneMs, terminalMaxBytes, terminalMaxEvents, readyMaxBytes, readyMaxEvents].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid accounting stream limits');
  const reader = response.body?.getReader();
  const stopped = new AbortController();
  let controller, idleTimer, doneTimer, terminalPromise, cancelled = false, ended = false;
  let holding = false, held = [], heldBytes = 0, ready = [], readyBytes = 0;
  const publicError = () => new Error('Gateway accounting stream unavailable');
  function cleanup() {
    clearTimeout(idleTimer); clearTimeout(doneTimer);
    signal?.removeEventListener('abort', onAbort);
  }
  function cancelReader(reason) {
    // Never await foreign cancellation to acknowledge the ledger terminal.
    try { Promise.resolve(reader?.cancel(reason)).catch(() => {}); } catch { /* cleanup only */ }
  }
  function finalize(usage, outcome, usageEvidence = null) {
    if (terminalPromise) return terminalPromise;
    // Claim the winner before invoking a synchronous or reentrant persistence sink.
    // Post-DONE transport deadline ends at EOF/failure. The existing local idle
    // deadline stays armed through ACK/authorization and downstream backpressure;
    // never reset it on EOF or ACK. Timeout stops delivery, not persistence.
    clearTimeout(doneTimer);
    // Keep caller cancellation observable while ACK is pending. It suppresses
    // delivery, but cannot replace the already claimed exact terminal payload.
    terminalPromise = Promise.resolve().then(() => accounting.completeAttempt(attempt, { usage, outcome, ...(usageEvidence ? { usageEvidence } : {}) }));
    return terminalPromise;
  }
  let detachedAckObserved = false;
  function observeDetachedAck(work) {
    if (detachedAckObserved) return;
    detachedAckObserved = true;
    // Local failure/cancellation is not a persistence acknowledgement. The original
    // sink retains its own health/error handling; observe its late rejection
    // without retry, payload rewrite, private diagnostics or success delivery.
    work.catch(() => {
      try {
        Promise.resolve(console.warn('[Accounting] terminal acknowledgement unavailable after local stream termination')).catch(() => {});
      } catch { /* observer must not reject */ }
    });
  }
  function endLocally() {
    held = []; heldBytes = 0; ended = true; cleanup();
    if (!cancelled) { try { controller.error(publicError()); } catch { /* downstream already closed */ } }
  }
  async function fail(reason, outcome = 'network_unknown') {
    // Claim before abort listeners or foreign cleanup can reenter and replace
    // the observed failure with their own cancellation outcome.
    const work = finalize(null, outcome, parser.evidence(outcome === 'aborted' ? 'cancelled' : 'interrupted'));
    if (!stopped.signal.aborted) stopped.abort(reason);
    cancelReader(reason); ready = []; readyBytes = 0;
    // Failed local delivery cannot wait on foreign persistence. Keep its original
    // authoritative promise/winner running; this is not a durable ACK, success,
    // readiness or permission to dispatch a successor. Successful EOF still waits.
    observeDetachedAck(work); endLocally();
  }
  function onAbort() { void fail(signal.reason, 'aborted'); }
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { void fail(publicError()); }, idleMs);
  }
  const parser = parserFactory(event => {
    if (event.terminal) holding = true;
    if (holding) {
      heldBytes += event.bytes.byteLength;
      if (heldBytes > terminalMaxBytes || held.length >= terminalMaxEvents) throw new Error('Accounting terminal buffer limit');
      held.push(event.bytes);
    } else {
      if (ready.length >= readyMaxEvents || readyBytes + event.bytes.byteLength > readyMaxBytes) throw new Error('Accounting delta queue limit');
      readyBytes += event.bytes.byteLength; ready.push(event.bytes);
    }
    if (event.done && !doneTimer) doneTimer = setTimeout(() => { void fail(publicError()); }, postDoneMs);
  }, { ...limits, provider, expectedModel });
  function read() {
    if (stopped.signal.aborted) return Promise.reject(stopped.signal.reason);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => { if (settled) return; settled = true; stopped.signal.removeEventListener('abort', abort); callback(value); };
      const abort = () => finish(reject, stopped.signal.reason);
      stopped.signal.addEventListener('abort', abort, { once: true });
      if (stopped.signal.aborted) { abort(); return; }
      let work;
      try { work = reader ? reader.read() : Promise.resolve({ done: true }); } catch (error) { finish(reject, error); return; }
      // Observe late foreign read outcomes; they cannot create another terminal.
      Promise.resolve(work).then(value => finish(resolve, value), error => finish(reject, error));
    });
  }
  return new ReadableStream({
    start(value) {
      controller = value; armIdle();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    },
    async pull() {
      if (cancelled || stopped.signal.aborted) return;
      try {
        while (!ready.length && !ended && !cancelled && !stopped.signal.aborted) {
          const chunk = await read();
          if (cancelled || stopped.signal.aborted) return;
          if (chunk.done) {
            const usage = parser.finish();
            if (!usage) {
              const work = finalize(null, 'network_unknown', parser.evidence('missing_terminal'));
              observeDetachedAck(work); await fail(publicError()); return;
            }
            const result = await finalize(usage, 'success');
            if (cancelled || stopped.signal.aborted) return;
            // Raw protocol validity and accounting permission are independent.
            // Only the trusted request-local policy can authorize a durable
            // unlimited unknown/gap outcome; never infer success from state alone.
            await accounting.assertSuccessfulTerminal(result);
            if (cancelled || stopped.signal.aborted) return;
            ready.push(...held); readyBytes += heldBytes; held = []; ended = true;
            try { reader?.releaseLock(); } catch { /* no authority change */ }
          } else { armIdle(); parser.push(chunk.value); }
        }
        // One framed event per pull; retained nonterminal bytes are bounded by
        // parser event/chunk bounds, not total response size.
        if (ready.length && !cancelled && !stopped.signal.aborted) {
          const bytes = ready.shift(); readyBytes -= bytes.byteLength; controller.enqueue(bytes);
        }
        if (ended && !ready.length && !cancelled && !stopped.signal.aborted) { cleanup(); controller.close(); }
      } catch (error) { await fail(error, signal?.aborted ? 'aborted' : 'network_unknown'); }
    },
    async cancel(reason) {
      cancelled = true; ready = []; readyBytes = 0; held = []; heldBytes = 0;
      const work = finalize(null, 'aborted', parser.evidence('cancelled'));
      if (!stopped.signal.aborted) stopped.abort(reason);
      cancelReader(reason);
      observeDetachedAck(work); cleanup(); ended = true;
    },
  }, { highWaterMark: 0 });
}
