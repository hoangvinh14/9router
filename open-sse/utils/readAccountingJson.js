import { ACCOUNTING_JSON_MAX_BYTES, ACCOUNTING_JSON_DEADLINE_MS } from '../config/accountingBodyLimits.js';

// Own the sole raw reader; stop before cancellation can turn partial bytes into EOF.
export async function readAccountingText(response, signal, { onChunk = null } = {}) {
  if (onChunk !== null && typeof onChunk !== 'function') throw new Error('Invalid accounting response observer');
  signal?.throwIfAborted();
  if (!response.body) throw new Error('Missing accounting response body');
  const reader = response.body.getReader();
  let stopped, rejectStop, timer;
  const stopPromise = new Promise((_, reject) => { rejectStop = reject; });
  const stop = error => {
    if (stopped) return; stopped = { error }; rejectStop(error);
    try { Promise.resolve(reader.cancel(error)).catch(() => {}); } catch { /* cleanup only */ }
  };
  const abort = () => stop(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  timer = setTimeout(() => stop(new Error('Accounting response deadline exceeded')), ACCOUNTING_JSON_DEADLINE_MS);
  let length = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    if (signal?.aborted) abort();
    while (true) {
      const part = await Promise.race([reader.read(), stopPromise]);
      if (stopped) throw stopped.error;
      signal?.throwIfAborted();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > ACCOUNTING_JSON_MAX_BYTES) { stop(new Error('Accounting response bound exceeded')); throw stopped.error; }
      // Synchronous diagnostic tap only. Reader still requires clean EOF and
      // never returns partial text when a timeout/abort/read/UTF-8 failure wins.
      if (onChunk) onChunk(part.value);
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (!stopped) stop(error);
    // Observed even when synchronous overflow/parse failure wins, not a late rejection.
    await stopPromise.catch(() => {});
    throw signal?.aborted ? signal.reason : error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    try { reader.releaseLock(); } catch { /* no later accounting observation */ }
  }
}

export async function readAccountingJson(response, signal) {
  const text = await readAccountingText(response, signal);
  try { return JSON.parse(text); }
  catch { throw new Error('Invalid accounting response JSON'); }
}
