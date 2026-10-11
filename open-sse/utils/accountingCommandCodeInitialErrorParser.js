import { types } from 'node:util';
import { ACCOUNTING_SSE_EVENT_MAX_BYTES, ACCOUNTING_SSE_CHUNK_MAX_BYTES } from '../config/accountingStreamLimits.js';
import { COMMANDCODE_INITIAL_ERROR_EVENT as EVENT, COMMANDCODE_INITIAL_ERROR_FIELDS, COMMANDCODE_INITIAL_ERROR_DETAIL_FIELDS,
  COMMANDCODE_INITIAL_ERROR_STATUS_MIN, COMMANDCODE_INITIAL_ERROR_STATUS_MAX } from '../config/accountingCommandCodeInitialErrorSchema.js';

const unavailable = () => { throw new Error('Invalid raw CommandCode initial error stream'); };
const byteLengthGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const exactFields = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

// Failure-only raw framing, never token evidence or dispatch/retry permission.
// No callbacks, translated status heuristics, partial terminal or inferred zero.
export function createCommandCodeInitialErrorParser({ maxEventBytes = ACCOUNTING_SSE_EVENT_MAX_BYTES, maxChunkBytes = ACCOUNTING_SSE_CHUNK_MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes <= 0 || maxEventBytes > ACCOUNTING_SSE_EVENT_MAX_BYTES ||
      !Number.isSafeInteger(maxChunkBytes) || maxChunkBytes <= 0 || maxChunkBytes > ACCOUNTING_SSE_CHUNK_MAX_BYTES) {
    throw new Error('Invalid CommandCode initial error limits');
  }
  let buffer = new Uint8Array(Math.min(4096, maxEventBytes)), length = 0, phase = 0, statusCode = null, ended = false, invalid = false;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  function append(data, start, end) {
    const needed = length + end - start;
    if (needed > maxEventBytes) unavailable();
    if (needed > buffer.byteLength) {
      const grown = new Uint8Array(Math.min(maxEventBytes, Math.max(needed, buffer.byteLength * 2)));
      grown.set(buffer.subarray(0, length)); buffer = grown;
    }
    buffer.set(data.subarray(start, end), length); length = needed;
  }
  function dispatch() {
    let event;
    try { event = JSON.parse(decoder.decode(buffer.subarray(0, length))); } catch { unavailable(); }
    if (phase === 3) unavailable();
    if (exactFields(event, ['type']) && event.type === EVENT.START && phase === 0) phase = 1;
    else if (exactFields(event, ['type']) && event.type === EVENT.STEP_START && phase === 1) phase = 2;
    else if (exactFields(event, COMMANDCODE_INITIAL_ERROR_FIELDS) && event.type === EVENT.ERROR && (phase === 0 || phase === 2)) {
      const detail = event.error;
      if (!exactFields(detail, COMMANDCODE_INITIAL_ERROR_DETAIL_FIELDS) || !Number.isInteger(detail.statusCode) ||
          detail.statusCode < COMMANDCODE_INITIAL_ERROR_STATUS_MIN || detail.statusCode > COMMANDCODE_INITIAL_ERROR_STATUS_MAX ||
          typeof detail.message !== 'string' || !detail.message.trim() || detail.message.includes('\0')) unavailable();
      statusCode = detail.statusCode; phase = 3;
    } else unavailable();
    length = 0;
  }
  return Object.freeze({
    push(input) {
      try {
        if (invalid || ended || types.isProxy(input) || !types.isUint8Array(input)) unavailable();
        const size = byteLengthGetter.call(input);
        if (size > maxChunkBytes) unavailable();
        const data = new Uint8Array(size); Uint8Array.prototype.set.call(data, input);
        utf8.decode(data, { stream: true });
        let start = 0;
        for (let index = 0; index < size; index++) {
          if (data[index] !== 10) continue;
          append(data, start, index + 1); dispatch(); start = index + 1;
        }
        append(data, start, size);
      } catch (error) { invalid = true; throw error; }
    },
    finish() {
      try {
        if (invalid || ended) unavailable();
        ended = true; utf8.decode();
        // Require a terminated raw error line, not a permissive tail flush.
        if (length) unavailable();
        return phase === 3 ? Object.freeze({ statusCode, usage: null }) : null;
      } catch (error) { invalid = true; throw error; }
    },
  });
}
