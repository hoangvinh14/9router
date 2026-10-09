// Prompt caller cancellation without claiming foreign work actually stopped.
// Both late outcomes remain observed; no credential/payload logging.
export function awaitAbortableWork(invoke, signal) {
  signal?.throwIfAborted();
  if (!signal) return Promise.resolve().then(invoke);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort); callback(value);
    };
    const abort = () => finish(reject, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    let work;
    try { work = invoke(); } catch (error) { finish(reject, signal.aborted ? signal.reason : error); return; }
    Promise.resolve(work).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) abort();
  });
}
export function waitAbortable(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    timer = setTimeout(() => { cleanup(); resolve(); }, ms);
  });
}
