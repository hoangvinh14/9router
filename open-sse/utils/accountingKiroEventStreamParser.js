import { FORMATS } from '../translator/formats.js';
import { normalizeExactUsage } from './exactUsage.js';
import { crc32, parseEventFrame } from './kiroEventStreamFrame.js';
import { EVENTSTREAM_MAX_MESSAGE_BYTES, EVENTSTREAM_MAX_HEADERS_BYTES } from '../config/kiroEventStream.js';
import { ACCOUNTING_SSE_EVENT_MAX_BYTES, ACCOUNTING_SSE_CHUNK_MAX_BYTES } from '../config/accountingStreamLimits.js';
import { KIRO_ACCOUNTING_EVENT as EVENT, KIRO_ACCOUNTING_EVENT_FIELDS as FIELDS, KIRO_ACCOUNTING_STOP_REASON, KIRO_ACCOUNTING_HEADER_VALUES } from '../config/accountingKiroStreamSchema.js';

// Binary framing comes before schema/usage. No converter defaults, credits,
// synthetic terminal, recovery-generation or output estimation authority.
export function createAccountingKiroEventStreamParser(onEvent, {
  maxEventBytes = ACCOUNTING_SSE_EVENT_MAX_BYTES,
  maxChunkBytes = ACCOUNTING_SSE_CHUNK_MAX_BYTES,
} = {}) {
  if (typeof onEvent !== 'function' || ![maxEventBytes, maxChunkBytes].every(value => Number.isSafeInteger(value) && value > 0) || maxEventBytes < 16) {
    throw new Error('Invalid Kiro EventStream limits');
  }
  const frameLimit = Math.min(maxEventBytes, EVENTSTREAM_MAX_MESSAGE_BYTES);
  let buffer = new Uint8Array(Math.min(4096, frameLimit)), length = 0, target = 12;
  let phase = 0, exact = null, ended = false, invalid = false;
  const unavailable = () => { throw new Error('Invalid raw Kiro accounting stream'); };
  function append(bytes) {
    const needed = length + bytes.byteLength;
    if (needed > frameLimit) unavailable();
    if (needed > buffer.byteLength) {
      const grown = new Uint8Array(Math.min(frameLimit, Math.max(needed, buffer.byteLength * 2)));
      grown.set(buffer.subarray(0, length)); buffer = grown;
    }
    buffer.set(bytes, length); length = needed;
  }
  function prelude() {
    const view = new DataView(buffer.buffer, buffer.byteOffset, length);
    const size = view.getUint32(0, false), headers = view.getUint32(4, false);
    if (size < 16 || size > frameLimit || headers > EVENTSTREAM_MAX_HEADERS_BYTES || headers > size - 16 ||
        view.getUint32(8, false) !== crc32(buffer.subarray(0, 8))) unavailable();
    target = size;
  }
  function dispatch() {
    const bytes = buffer.slice(0, length);
    const { headers, payload, headerNames } = parseEventFrame(bytes, { fatalUtf8: true, includeHeaderNames: true });
    if (phase === 2 || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
        headerNames.some(name => name !== ':event-type' && !Object.hasOwn(KIRO_ACCOUNTING_HEADER_VALUES, name)) ||
        Object.entries(KIRO_ACCOUNTING_HEADER_VALUES).some(([name, value]) => headerNames.includes(name) && headers[name] !== value)) unavailable();
    const type = headers[':event-type'];
    let terminal = false, done = false;
    if (type === EVENT.TEXT) {
      const fields = FIELDS[EVENT.TEXT];
      if (phase !== 0 || Object.keys(payload).length !== fields.length || !fields.every(key => Object.hasOwn(payload, key)) ||
          typeof payload.content !== 'string') unavailable();
    } else if (type === EVENT.METRICS) {
      if (phase !== 0) unavailable();
      exact = normalizeExactUsage(payload, FORMATS.KIRO);
      if (!exact) unavailable();
      phase = 1; terminal = true;
    } else if (type === EVENT.STOP) {
      const fields = FIELDS[EVENT.STOP];
      if (phase !== 1 || Object.keys(payload).length !== fields.length || !fields.every(key => Object.hasOwn(payload, key)) ||
          payload.stopReason !== KIRO_ACCOUNTING_STOP_REASON) unavailable();
      phase = 2; terminal = true; done = true;
    } else unavailable();
    length = 0; target = 12;
    onEvent({ bytes, terminal, done });
  }
  return {
    evidence() { return null; },
    push(chunk) {
      try {
        if (invalid || ended || !(chunk instanceof Uint8Array) || chunk.byteLength > maxChunkBytes) unavailable();
        let offset = 0;
        while (offset < chunk.byteLength) {
          const count = Math.min(target - length, chunk.byteLength - offset);
          append(chunk.subarray(offset, offset + count)); offset += count;
          if (length === 12 && target === 12) prelude();
          if (length === target) dispatch();
        }
      } catch (error) { invalid = true; throw error; }
    },
    finish() {
      try {
        if (invalid || ended) unavailable();
        ended = true;
        if (length) unavailable();
        return phase === 2 ? exact : null;
      } catch (error) { invalid = true; throw error; }
    },
  };
}
