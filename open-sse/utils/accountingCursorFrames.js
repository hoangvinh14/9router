import { types } from 'node:util';
import { gunzipSync } from 'node:zlib';
import {
  CURSOR_ACCOUNTING_FRAME_HEADER_BYTES as HEADER, CURSOR_ACCOUNTING_FRAME_MAX_BYTES,
  CURSOR_ACCOUNTING_FRAME_MAX_CHUNK_BYTES, CURSOR_ACCOUNTING_FRAME_MAX_INFLATED_BYTES,
  CURSOR_ACCOUNTING_FRAME_INITIAL_BYTES, CURSOR_ACCOUNTING_FRAME_FLAG as FLAG,
} from '../config/accountingCursorFrames.js';

// Independent structural framing, not wired into legacy Cursor. Opaque trailers
// and structural EOF never synthesize usage, successful termination or ACK.
export function createCursorAccountingFrameReader(onFrame, {
  maxFrameBytes = CURSOR_ACCOUNTING_FRAME_MAX_BYTES,
  maxChunkBytes = CURSOR_ACCOUNTING_FRAME_MAX_CHUNK_BYTES,
  maxInflatedBytes = CURSOR_ACCOUNTING_FRAME_MAX_INFLATED_BYTES,
} = {}) {
  for (const [value, ceiling] of [[maxFrameBytes, CURSOR_ACCOUNTING_FRAME_MAX_BYTES],
    [maxChunkBytes, CURSOR_ACCOUNTING_FRAME_MAX_CHUNK_BYTES], [maxInflatedBytes, CURSOR_ACCOUNTING_FRAME_MAX_INFLATED_BYTES]]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > ceiling) throw new Error('Invalid Cursor accounting frame limits');
  }
  if (typeof onFrame !== 'function') throw new Error('Invalid Cursor accounting frame limits');
  const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
  let buffer = new Uint8Array(Math.min(CURSOR_ACCOUNTING_FRAME_INITIAL_BYTES, HEADER + maxFrameBytes));
  let used = 0, target = HEADER, flags = null, poisoned = false, ended = false, active = false;
  const invalid = () => { poisoned = true; throw new Error('Invalid Cursor accounting frame'); };
  function ensure(size) {
    if (size <= buffer.length) return;
    const capacity = Math.min(HEADER + maxFrameBytes, Math.max(size, buffer.length * 2));
    const next = new Uint8Array(capacity); next.set(buffer.subarray(0, used)); buffer = next;
  }
  function push(input) {
    if (poisoned || ended || active) invalid();
    active = true;
    try {
      if (types.isProxy(input) || !types.isUint8Array(input)) invalid();
      const length = byteLength.call(input);
      if (length > maxChunkBytes) invalid();
      // Copy with intrinsic typed-array operations; no caller iterator or slice.
      const chunk = new Uint8Array(length); Uint8Array.prototype.set.call(chunk, input);
      let offset = 0;
      while (offset < length) {
        const count = Math.min(target - used, length - offset); ensure(used + count);
        buffer.set(chunk.subarray(offset, offset + count), used); used += count; offset += count;
        if (used < target) continue;
        if (flags === null) {
          flags = buffer[0];
          if (![FLAG.BODY, FLAG.GZIP, FLAG.TRAILER, FLAG.GZIP_TRAILER].includes(flags)) invalid();
          const size = new DataView(buffer.buffer, buffer.byteOffset, HEADER).getUint32(1, false);
          if (size > maxFrameBytes) invalid();
          target = HEADER + size;
          if (used < target) continue;
        }
        const raw = buffer.slice(HEADER, target);
        let payload = raw;
        if (flags === FLAG.GZIP || flags === FLAG.GZIP_TRAILER) {
          // Output limit applies during inflation; no deflate/raw fallback.
          const inflated = gunzipSync(raw, { maxOutputLength: maxInflatedBytes });
          payload = new Uint8Array(inflated.length); payload.set(inflated);
        } else if (raw.length > maxInflatedBytes) invalid();
        const record = { flags, payload };
        used = 0; target = HEADER; flags = null;
        onFrame(record);
        if (poisoned) invalid(); // catches reentrant failure swallowed by callback
      }
    } catch { invalid(); }
    finally { active = false; }
  }
  function finish() {
    if (poisoned || ended || active || used) invalid();
    ended = true;
  }
  return Object.freeze({ push, finish });
}
