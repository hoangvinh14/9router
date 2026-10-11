import { types } from 'node:util';
import {
  CURSOR_ACCOUNTING_PROTOBUF_MAX_BYTES, CURSOR_ACCOUNTING_PROTOBUF_MAX_FIELDS,
  CURSOR_PROTOBUF_MAX_FIELD_NUMBER, CURSOR_PROTOBUF_VARINT_MAX_BYTES, CURSOR_PROTOBUF_WIRE as WIRE,
} from '../config/accountingCursorProtobuf.js';

const invalid = () => { throw new Error('Invalid Cursor accounting protobuf'); };
// Structural reader only. Repeated/unknown fields remain ordered, explicit
// uint64 values remain BigInt, and byte fields are detached. No nested schema,
// decompression, token normalization, terminal interpretation or legacy wiring.
export function scanCursorAccountingMessage(input, { maxMessageBytes = CURSOR_ACCOUNTING_PROTOBUF_MAX_BYTES, maxFields = CURSOR_ACCOUNTING_PROTOBUF_MAX_FIELDS } = {}) {
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0 || maxMessageBytes > CURSOR_ACCOUNTING_PROTOBUF_MAX_BYTES ||
      !Number.isSafeInteger(maxFields) || maxFields <= 0 || maxFields > CURSOR_ACCOUNTING_PROTOBUF_MAX_FIELDS) {
    throw new Error('Invalid Cursor accounting protobuf limits');
  }
  if (types.isProxy(input) || !types.isUint8Array(input)) invalid();
  const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get.call(input);
  if (byteLength > maxMessageBytes) invalid();
  // No caller-defined iterator, slice, numeric conversion or serialization.
  const data = new Uint8Array(byteLength);
  Uint8Array.prototype.set.call(data, input);
  let offset = 0;
  function varint() {
    let value = 0n;
    for (let index = 0; index < CURSOR_PROTOBUF_VARINT_MAX_BYTES; index++) {
      if (offset === data.length) invalid();
      const byte = data[offset++];
      if (index === CURSOR_PROTOBUF_VARINT_MAX_BYTES - 1 && byte > 1) invalid();
      value |= BigInt(byte & 127) << BigInt(index * 7);
      if (!(byte & 128)) {
        if (index && byte === 0) invalid(); // refuse nonminimal aliases
        return value;
      }
    }
    invalid();
  }
  function take(length) {
    if (length > BigInt(data.length - offset)) invalid();
    const end = offset + Number(length);
    const value = data.slice(offset, end); offset = end; return value;
  }
  const fields = [];
  while (offset < data.length) {
    if (fields.length === maxFields) invalid();
    const tag = varint(), fieldNumber = tag >> 3n, wireType = Number(tag & 7n);
    if (!fieldNumber || fieldNumber > CURSOR_PROTOBUF_MAX_FIELD_NUMBER) invalid();
    let value;
    if (wireType === WIRE.VARINT) value = varint();
    else if (wireType === WIRE.LENGTH) value = take(varint());
    else if (wireType === WIRE.FIXED64) value = take(8n);
    else if (wireType === WIRE.FIXED32) value = take(4n);
    else invalid();
    fields.push({ fieldNumber: Number(fieldNumber), wireType, value });
  }
  return fields;
}
