import { FORMATS } from '../translator/formats.js';
import { normalizeExactUsage } from './exactUsage.js';
import { ACCOUNTING_SSE_EVENT_MAX_BYTES, ACCOUNTING_SSE_CHUNK_MAX_BYTES } from '../config/accountingStreamLimits.js';
import { COMMANDCODE_ACCOUNTING_EVENT as EVENT, COMMANDCODE_ACCOUNTING_EVENT_FIELDS as FIELDS, COMMANDCODE_ACCOUNTING_FINISH_REASON } from '../config/accountingCommandCodeStreamSchema.js';

// Raw-byte line framing precedes JSON/schema/translation. No generated DONE,
// default counters, step aggregation or hidden generation retries are authority.
export function createAccountingCommandCodeNdjsonParser(onEvent, { maxEventBytes = ACCOUNTING_SSE_EVENT_MAX_BYTES, maxChunkBytes = ACCOUNTING_SSE_CHUNK_MAX_BYTES } = {}) {
  if (typeof onEvent !== 'function' || ![maxEventBytes, maxChunkBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid CommandCode NDJSON limits');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let buffer = new Uint8Array(Math.min(4096, maxEventBytes)), length = 0;
  let phase = 0, textId = null, textEnded = false, stepUsage = null, finalUsage = null, ended = false, invalid = false;
  const unavailable = () => { throw new Error('Invalid raw CommandCode accounting stream'); };
  function append(bytes) {
    const needed = length + bytes.byteLength;
    if (needed > maxEventBytes) unavailable();
    if (needed > buffer.byteLength) {
      const grown = new Uint8Array(Math.min(maxEventBytes, Math.max(needed, buffer.byteLength * 2)));
      grown.set(buffer.subarray(0, length)); buffer = grown;
    }
    buffer.set(bytes, length); length = needed;
  }
  function dispatch() {
    const bytes = buffer.slice(0, length);
    const text = decoder.decode(bytes);
    let event;
    try { event = JSON.parse(text); } catch { unavailable(); }
    if (!event || typeof event !== 'object' || Array.isArray(event) || !Object.hasOwn(FIELDS, event.type)) unavailable();
    const fields = FIELDS[event.type];
    if (Object.keys(event).length !== fields.length || !fields.every(key => Object.hasOwn(event, key)) || phase === 4) unavailable();
    let terminal = false, done = false;
    switch (event.type) {
      case EVENT.START:
        if (phase !== 0) unavailable();
        phase = 1; break;
      case EVENT.STEP_START:
        if (phase !== 1) unavailable();
        phase = 2; break;
      case EVENT.TEXT_START:
        if (phase !== 2 || textId !== null || typeof event.id !== 'string' || !event.id.trim()) unavailable();
        textId = event.id; break;
      case EVENT.TEXT_DELTA:
        if (phase !== 2 || textId === null || textEnded || event.id !== textId || typeof event.text !== 'string') unavailable();
        break;
      case EVENT.TEXT_END:
        if (phase !== 2 || textId === null || textEnded || event.id !== textId) unavailable();
        textEnded = true; break;
      case EVENT.STEP_FINISH:
        if (phase !== 2 || textId !== null && !textEnded || event.finishReason !== COMMANDCODE_ACCOUNTING_FINISH_REASON) unavailable();
        stepUsage = normalizeExactUsage(event.usage, FORMATS.COMMANDCODE);
        if (!stepUsage) unavailable();
        phase = 3; terminal = true; break;
      case EVENT.FINISH:
        if (phase !== 3 || event.finishReason !== COMMANDCODE_ACCOUNTING_FINISH_REASON) unavailable();
        finalUsage = normalizeExactUsage(event.totalUsage, FORMATS.COMMANDCODE);
        if (!finalUsage || JSON.stringify(finalUsage) !== JSON.stringify(stepUsage)) unavailable();
        phase = 4; terminal = true; done = true; break;
      default: unavailable();
    }
    length = 0;
    onEvent({ bytes, terminal, done });
  }
  return {
    // No translated or partial diagnostic is promoted to a monetary receipt.
    evidence() { return null; },
    push(chunk) {
      try {
        if (invalid || ended || !(chunk instanceof Uint8Array) || chunk.byteLength > maxChunkBytes) unavailable();
        // Validate incrementally even before a newline; a trailing incomplete
        // code point is deferred only until the next chunk or clean EOF.
        utf8.decode(chunk, { stream: true });
        let start = 0;
        for (let index = 0; index < chunk.byteLength; index++) {
          if (chunk[index] !== 10) continue;
          append(chunk.subarray(start, index + 1)); dispatch(); start = index + 1;
        }
        append(chunk.subarray(start));
      } catch (error) { invalid = true; throw error; }
    },
    finish() {
      try {
        if (invalid || ended) unavailable();
        ended = true;
        utf8.decode();
        if (length) dispatch();
        return phase === 4 ? finalUsage : null;
      } catch (error) { invalid = true; throw error; }
    },
  };
}
