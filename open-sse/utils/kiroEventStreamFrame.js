import { EVENTSTREAM_MAX_MESSAGE_BYTES, EVENTSTREAM_MAX_HEADERS_BYTES } from '../config/kiroEventStream.js';

const legacyDecoder = new TextDecoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Shared wire codec only, NOT usage/terminal authority. Legacy callers retain
// replacement UTF-8 decoding. Accounting callers explicitly opt into fatal
// decoding of header names, string values and complete frame payloads.
export function parseEventFrame(data, { fatalUtf8 = false, includeHeaderNames = false } = {}) {
  const decoder = fatalUtf8 ? fatalDecoder : legacyDecoder;
  if (!(data instanceof Uint8Array) || data.byteLength < 16) {
    throw new Error('AWS EventStream frame is shorter than 16 bytes');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalLength = view.getUint32(0, false);
  const headersLength = view.getUint32(4, false);
  if (totalLength !== data.byteLength) {
    throw new Error('AWS EventStream frame length does not match its prelude');
  }
  if (totalLength > EVENTSTREAM_MAX_MESSAGE_BYTES ||
      headersLength > EVENTSTREAM_MAX_HEADERS_BYTES ||
      headersLength > totalLength - 16) {
    throw new Error('AWS EventStream frame bounds are invalid');
  }
  if (view.getUint32(8, false) !== crc32(data.subarray(0, 8))) {
    throw new Error('AWS EventStream prelude CRC mismatch');
  }
  if (view.getUint32(totalLength - 4, false) !== crc32(data.subarray(0, totalLength - 4))) {
    throw new Error('AWS EventStream message CRC mismatch');
  }

  const headers = Object.create(null);
  const names = new Set();
  let offset = 12;
  const headerEnd = offset + headersLength;
  const requireBytes = count => {
    if (offset + count > headerEnd) {
      throw new Error('AWS EventStream header exceeds its declared bounds');
    }
  };
  while (offset < headerEnd) {
    requireBytes(1);
    const nameLength = data[offset++];
    requireBytes(nameLength + 1);
    const name = decoder.decode(data.subarray(offset, offset + nameLength));
    offset += nameLength;
    if (names.has(name)) throw new Error(`AWS EventStream contains duplicate header: ${name}`);
    names.add(name);
    const type = data[offset++];
    if (type === 0 || type === 1) {
      headers[name] = type === 0;
    } else if (type === 2) {
      requireBytes(1);
      headers[name] = view.getInt8(offset);
      offset += 1;
    } else if (type === 3) {
      requireBytes(2);
      headers[name] = view.getInt16(offset, false);
      offset += 2;
    } else if (type === 4) {
      requireBytes(4);
      headers[name] = view.getInt32(offset, false);
      offset += 4;
    } else if (type === 5 || type === 8) {
      requireBytes(8);
      offset += 8;
    } else if (type === 6 || type === 7) {
      requireBytes(2);
      const valueLength = view.getUint16(offset, false);
      offset += 2;
      requireBytes(valueLength);
      const bytes = data.subarray(offset, offset + valueLength);
      headers[name] = type === 7 ? decoder.decode(bytes) : bytes;
      offset += valueLength;
    } else if (type === 9) {
      requireBytes(16);
      offset += 16;
    } else {
      throw new Error(`AWS EventStream header ${name} has unknown type ${type}`);
    }
  }
  // Accounting must see names even for legacy typed values intentionally
  // skipped above, so an unknown header cannot disappear from its allowlist.
  const result = payload => includeHeaderNames
    ? { headers, payload, headerNames: [...names] }
    : { headers, payload };
  const payloadBytes = data.subarray(headerEnd, totalLength - 4);
  if (payloadBytes.byteLength === 0) return result(null);
  const payloadText = decoder.decode(payloadBytes);
  if (!payloadText.trim()) return result(null);
  try {
    return result(JSON.parse(payloadText));
  } catch (error) {
    throw new Error(`AWS EventStream payload is not valid JSON (${error.message})`);
  }
}
