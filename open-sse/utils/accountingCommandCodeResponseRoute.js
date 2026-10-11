import { types } from 'node:util';
import { COMMANDCODE_ACCOUNTING_EVENT as EVENT, COMMANDCODE_ACCOUNTING_EVENT_FIELDS as FIELDS } from '../config/accountingCommandCodeStreamSchema.js';
import { COMMANDCODE_INITIAL_ERROR_EVENT } from '../config/accountingCommandCodeInitialErrorSchema.js';
import { ACCOUNTING_SSE_EVENT_MAX_BYTES, ACCOUNTING_SSE_CHUNK_MAX_BYTES, ACCOUNTING_SSE_READY_MAX_BYTES, ACCOUNTING_SSE_IDLE_MS } from '../config/accountingStreamLimits.js';

const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const copyInto = Uint8Array.prototype.set;
const unavailable = () => new Error('Invalid CommandCode accounting response route');

// Routing only: a returned error branch is NOT a validated error, EOF receipt,
// usage, completion ACK or retry permission. Both downstream observers must
// consume the original bytes and validate their complete raw contract.
export async function routeAccountingCommandCodeResponse(response, signal) {
  signal?.throwIfAborted();
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  let stopped = null, timer, output = null, released = false;
  let rejectStop;
  const stoppedPromise = new Promise((_, reject) => { rejectStop = reject; });
  stoppedPromise.catch(() => {});
  function release() {
    if (released) return;
    released = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
    try { reader.releaseLock(); } catch { /* pending read is already observed */ }
  }
  function stop(reason) {
    if (stopped || released) return;
    stopped = { reason }; rejectStop(reason);
    try { Promise.resolve(reader.cancel(reason)).catch(() => {}); } catch { /* cleanup only */ }
    if (output) { try { output.error(reason); } catch { /* already cancelled */ } }
    release();
  }
  const abort = () => stop(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  async function read() {
    if (stopped) throw stopped.reason;
    signal?.throwIfAborted();
    timer = setTimeout(() => stop(new Error('CommandCode response routing deadline exceeded')), ACCOUNTING_SSE_IDLE_MS);
    try {
      const part = await Promise.race([reader.read(), stoppedPromise]);
      if (stopped) throw stopped.reason;
      if (part.done) return part;
      if (types.isProxy(part.value) || !types.isUint8Array(part.value)) throw unavailable();
      const length = byteLength.call(part.value);
      if (length > ACCOUNTING_SSE_CHUNK_MAX_BYTES) throw unavailable();
      const bytes = new Uint8Array(length); copyInto.call(bytes, part.value);
      return { done: false, value: bytes };
    } finally { clearTimeout(timer); }
  }
  let retained = new Uint8Array(4096), length = 0, cursor = 0, lineStart = 0, phase = 0, kind = null;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  try {
    if (signal?.aborted) abort();
    while (!kind) {
      const part = await read();
      if (part.done) throw unavailable();
      const needed = length + part.value.byteLength;
      if (needed > ACCOUNTING_SSE_READY_MAX_BYTES) throw unavailable();
      if (needed > retained.byteLength) {
        const grown = new Uint8Array(Math.min(ACCOUNTING_SSE_READY_MAX_BYTES, Math.max(needed, retained.byteLength * 2)));
        grown.set(retained.subarray(0, length)); retained = grown;
      }
      retained.set(part.value, length); length = needed;
      while (cursor < length && !kind) {
        const end = cursor++;
        if (cursor - lineStart > ACCOUNTING_SSE_EVENT_MAX_BYTES) throw unavailable();
        if (retained[end] !== 10) continue;
        let event;
        try { event = JSON.parse(decoder.decode(retained.subarray(lineStart, cursor))); } catch { throw unavailable(); }
        lineStart = cursor;
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw unavailable();
        if (event.type === COMMANDCODE_INITIAL_ERROR_EVENT.ERROR && (phase === 0 || phase === 2)) { kind = 'initial-error'; break; }
        const fields = FIELDS[event.type];
        if (!fields || Object.keys(event).length !== fields.length || !fields.every(key => Object.hasOwn(event, key))) throw unavailable();
        if (phase === 0 && event.type === EVENT.START) phase = 1;
        else if (phase === 1 && event.type === EVENT.STEP_START) phase = 2;
        else if (phase === 2 && [EVENT.TEXT_START, EVENT.STEP_FINISH].includes(event.type)) kind = 'success';
        else throw unavailable();
      }
    }
    const prefix = retained.slice(0, length);
    retained = null;
    let prefixPending = true;
    const body = new ReadableStream({
      start(controller) { output = controller; },
      async pull(controller) {
        try {
          if (stopped) throw stopped.reason;
          if (prefixPending) { prefixPending = false; controller.enqueue(prefix); return; }
          const part = await read();
          if (part.done) { release(); controller.close(); }
          else controller.enqueue(part.value);
        } catch (error) { stop(error); }
      },
      cancel(reason) { stop(reason); },
    }, { highWaterMark: 0 });
    return { kind, response: new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }) };
  } catch (error) { stop(error); throw error; }
}
