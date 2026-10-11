import { types } from 'node:util';
import { captureAccountingAbortSignal } from '../config/accountedAbortSignal.js';
import { ACCOUNTING_SSE_CHUNK_MAX_BYTES } from '../config/accountingStreamLimits.js';
import { ACCOUNTING_JSON_DEADLINE_MS } from '../config/accountingBodyLimits.js';
import { KIRO_ACCOUNTING_EVENT } from '../config/accountingKiroStreamSchema.js';
import { createAccountingKiroEventStreamParser } from './accountingKiroEventStreamParser.js';
import { parseEventFrame } from './kiroEventStreamFrame.js';

const MAX_BYTES = 8 * 1024 * 1024;
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const copyInto = Uint8Array.prototype.set;
const unavailable = () => new Error('Accounting Kiro repair generation unavailable');

// Sole bounded binary reader for an already independently admitted/POSTed
// generation. This narrow observer does not authorize admission, fallback,
// arbitrary integrity repair kinds, credentials or transport. Exact usage is
// obtained only from the existing raw parser's genuine stop + clean EOF.
export async function observeAccountingKiroRepairGeneration(response, { accounting, attempt, signal } = {}) {
  signal = captureAccountingAbortSignal(signal);
  let retained = new Uint8Array(4096), length = 0, text = '', usage = null, failure = null;
  const parser = createAccountingKiroEventStreamParser(event => {
    // Parser has validated the full frame first; decode only semantic text,
    // never translated usage/defaults or credits. No caller callback involved.
    const frame = parseEventFrame(event.bytes, { fatalUtf8: true });
    if (frame.headers[':event-type'] === KIRO_ACCOUNTING_EVENT.TEXT) text += frame.payload.content;
  });
  let reader, stopped = null, timer, rejectStop;
  const stoppedPromise = new Promise((_, reject) => { rejectStop = reject; });
  stoppedPromise.catch(() => {});
  const stop = reason => {
    if (stopped) return;
    stopped = { reason }; rejectStop(reason);
    if (reader) { try { Promise.resolve(reader.cancel(reason)).catch(() => {}); } catch { /* cleanup only */ } }
  };
  const abort = () => stop(signal.reason);
  try {
    signal?.throwIfAborted();
    if (!response.body) throw unavailable();
    reader = response.body.getReader();
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => stop(new Error('Kiro repair generation deadline exceeded')), ACCOUNTING_JSON_DEADLINE_MS);
    if (signal?.aborted) abort();
    while (true) {
      const part = await Promise.race([reader.read(), stoppedPromise]);
      if (stopped) throw stopped.reason;
      signal?.throwIfAborted();
      if (part.done) break;
      if (types.isProxy(part.value) || !types.isUint8Array(part.value)) throw unavailable();
      const count = byteLength.call(part.value), needed = length + count;
      if (count > ACCOUNTING_SSE_CHUNK_MAX_BYTES || needed > MAX_BYTES) throw unavailable();
      const chunk = new Uint8Array(count); copyInto.call(chunk, part.value);
      if (needed > retained.byteLength) {
        const grown = new Uint8Array(Math.min(MAX_BYTES, Math.max(needed, retained.byteLength * 2)));
        copyInto.call(grown, retained.subarray(0, length)); retained = grown;
      }
      copyInto.call(retained, chunk, length); length = needed;
      parser.push(chunk);
    }
    usage = parser.finish();
    if (!usage) throw unavailable();
  } catch (error) {
    failure = { error }; stop(error);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    try { reader?.releaseLock(); } catch { /* cleanup only, no second observer */ }
  }
  // Completion/persistence failure escapes outside transport/parser catches.
  // A later abort cannot rewrite this claimed terminal, even when ACK is lost.
  const terminal = await accounting.completeAttempt(attempt, {
    usage: failure ? null : usage,
    outcome: signal?.aborted ? 'aborted' : failure ? 'network_unknown' : 'success',
  });
  signal?.throwIfAborted();
  if (failure) { accounting.gate(); throw failure.error; }
  await accounting.assertSuccessfulTerminal(terminal);
  signal?.throwIfAborted();
  const repairKind = /^(?:\.\.\.|…)$/u.test(text.trim()) ? 'ellipsis' : null;
  if (repairKind) accounting.gate();
  return { bytes: retained.slice(0, length), usage, repairKind };
}
