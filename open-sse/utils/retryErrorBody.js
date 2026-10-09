import { RETRY_ERROR_BODY_MAX_BYTES, RETRY_ERROR_BODY_TIMEOUT_MS } from "../config/retryBodyLimits.js";

// Read an owned clone, never consume the original response. Cancellation is
// initiated before releasing the lock, but not awaited: tee cancellation may
// wait for the original branch's consumer. Deadline/overflow is a read failure,
// not accounting provenance and never a truncated retry-metadata success.
export async function readRetryErrorBody(response, { signal, maxBytes = RETRY_ERROR_BODY_MAX_BYTES, timeoutMs = RETRY_ERROR_BODY_TIMEOUT_MS } = {}) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("Invalid retry body bounds");
  const clone = response.clone();
  if (!clone.body) return "";
  const reader = clone.body.getReader();
  let finished = false, stopReason, timer;
  let stopped = false;
  let rejectStop;
  const stop = new Promise((_resolve, reject) => { rejectStop = reject; });
  // A pre-read abort can reject this promise before the first race is installed.
  // Observe that rejection as well as every late reader.read outcome.
  stop.catch(() => {});
  const cancel = reason => {
    if (stopped) return;
    stopped = true; stopReason = reason;
    // Reject first: cancelling a pending read can synchronously yield done=true.
    // The authoritative stopped check below also covers a read already queued.
    rejectStop(reason);
    try { Promise.resolve(reader.cancel(reason)).catch(() => {}); } catch { /* cleanup only */ }
  };
  const abort = () => cancel(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) { abort(); signal.throwIfAborted(); }
    timer = setTimeout(() => cancel(new Error("Retry error body inspection timed out")), timeoutMs);
    const decoder = new TextDecoder(); let bytes = 0, text = "";
    while (true) {
      const row = await Promise.race([reader.read(), stop]);
      signal?.throwIfAborted();
      if (stopped) throw stopReason;
      if (row.done) { finished = true; return text + decoder.decode(); }
      bytes += row.value.byteLength;
      if (bytes > maxBytes) throw new Error("Retry error body exceeds byte limit");
      text += decoder.decode(row.value, { stream: true });
    }
  } catch (error) {
    stopReason = signal?.aborted ? signal.reason : error;
    throw stopReason;
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort);
    if (!finished) cancel(stopReason);
    try { reader.releaseLock(); } catch { /* cleanup only */ }
  }
}
