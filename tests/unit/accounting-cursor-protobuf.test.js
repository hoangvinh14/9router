import { beforeAll, describe, expect, it } from 'vitest';
let scan;
beforeAll(async () => { ({ scanCursorAccountingMessage: scan } = await import('open-sse/utils/accountingCursorProtobuf.js')); });
// Independent test encoder; no legacy bitwise32 decoder/encoder round-trip.
const varint = value => { let n = BigInt(value); const out = []; do { const byte = Number(n & 127n); n >>= 7n; out.push(byte | (n ? 128 : 0)); } while (n); return out; };
const bytes = (...parts) => Uint8Array.from(parts.flatMap(part => Array.from(part)));
const field = (id, type, payload) => bytes(varint(BigInt(id) * 8n + BigInt(type)), payload);
const len = (id, payload) => field(id, 2, bytes(varint(payload.length), payload));
const valid = () => bytes(field(1, 0, varint(0)), len(2, [65, 66]));
describe('bounded Cursor accounting protobuf structural reader only (no token-field or terminal authority)', () => {
  it('preserves explicit zero, repeated fields and ordered wire types without semantic aliases/defaults', () => {
    const result = scan(bytes(valid(), field(1, 0, varint(7))));
    expect(result).toEqual([{ fieldNumber: 1, wireType: 0, value: 0n }, { fieldNumber: 2, wireType: 2, value: Uint8Array.of(65, 66) }, { fieldNumber: 1, wireType: 0, value: 7n }]);
  });
  it('retains full uint64 and maximum protobuf field number without signed32 truncation', () => {
    expect(scan(field(536870911, 0, varint(18446744073709551615n)))).toEqual([{ fieldNumber: 536870911, wireType: 0, value: 18446744073709551615n }]);
  });
  it('returns detached fixed64, fixed32 and length-delimited bytes, not numeric money', () => {
    const raw = bytes(field(1, 1, [1, 2, 3, 4, 5, 6, 7, 8]), field(2, 5, [9, 10, 11, 12]), len(3, [13]));
    const result = scan(raw); raw.fill(0);
    expect(result.map(entry => Array.from(entry.value))).toEqual([[1, 2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12], [13]]);
  });
  it('accepts empty message and explicit empty length-delimited field without inventing counters', () => {
    expect(scan(new Uint8Array())).toEqual([]); expect(scan(len(1, []))).toEqual([{ fieldNumber: 1, wireType: 2, value: new Uint8Array() }]);
  });
  it.each([
    ['incomplete tag', [128]],
    ['zero field number', [0, 0]],
    ['field number above protobuf maximum', field(536870912, 0, [0])],
    ['unsupported group start', field(1, 3, [])],
    ['unsupported group end', field(1, 4, [])],
    ['unsupported wire6', field(1, 6, [])],
    ['unsupported wire7', field(1, 7, [])],
    ['missing varint value', field(1, 0, [])],
    ['unterminated value', field(1, 0, [128])],
    ['uint64 overflow', field(1, 0, [...Array(9).fill(255), 2])],
    ['eleven-byte varint', field(1, 0, [...Array(10).fill(128), 0])],
    ['noncanonical tag', [136, 0, 0]],
    ['noncanonical value', field(1, 0, [128, 0])],
    ['noncanonical length', field(1, 2, [128, 0])],
    ['missing length', field(1, 2, [])],
    ['length exceeds remaining bytes', field(1, 2, [3, 65])],
    ['uint64 length exceeds safe message bound', field(1, 2, varint(18446744073709551615n))],
    ['truncated fixed64', field(1, 1, [1, 2])],
    ['truncated fixed32', field(1, 5, [1, 2])],
    ['valid prefix then truncated next tag', bytes(valid(), [128])],
  ])('%s rejects after valid positive structural control', (_label, bad) => {
    expect(scan(valid())).toHaveLength(2); expect(() => scan(Uint8Array.from(bad))).toThrow('Invalid Cursor accounting protobuf');
  });
  it('enforces byte bound at equality and before decode beyond it', () => {
    const raw = valid(); expect(scan(raw, { maxMessageBytes: raw.length })).toHaveLength(2);
    expect(() => scan(raw, { maxMessageBytes: raw.length - 1 })).toThrow('Invalid Cursor accounting protobuf');
  });
  it('enforces field-count bound without collapsing duplicate entries', () => {
    expect(scan(valid(), { maxFields: 2 })).toHaveLength(2);
    expect(() => scan(valid(), { maxFields: 1 })).toThrow('Invalid Cursor accounting protobuf');
  });
  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid/unbounded structural limits %s', value => {
    expect(scan(valid())).toHaveLength(2);
    expect(() => scan(valid(), { maxMessageBytes: value })).toThrow('Invalid Cursor accounting protobuf limits');
    expect(() => scan(valid(), { maxFields: value })).toThrow('Invalid Cursor accounting protobuf limits');
  });
  it('rejects Proxy byte input before any trap with positive structural support established', () => {
    expect(scan(valid())).toHaveLength(2); let touched = 0;
    const trap = () => { touched++; throw new Error('fixture Proxy trap executed'); };
    const input = new Proxy(valid(), { get: trap, getPrototypeOf: trap, ownKeys: trap });
    expect(() => scan(input)).toThrow('Invalid Cursor accounting protobuf'); expect(touched).toBe(0);
  });
  it('copies typed byte input intrinsically without custom iterator, length, buffer or slice reads', () => {
    const input = valid(); let touched = 0;
    const trap = () => { touched++; throw new Error('fixture typed-byte hook executed'); };
    for (const name of ['buffer', 'byteLength', 'length', 'slice', 'subarray']) Object.defineProperty(input, name, { get: trap });
    Object.defineProperty(input, Symbol.iterator, { value: trap });
    expect(scan(input)).toEqual([{ fieldNumber: 1, wireType: 0, value: 0n }, { fieldNumber: 2, wireType: 2, value: Uint8Array.of(65, 66) }]); expect(touched).toBe(0);
  });
  it('rejects non-byte input without programmable conversion', () => {
    let called = false; const input = { valueOf() { called = true; throw new Error('must not coerce'); } };
    expect(() => scan(input)).toThrow('Invalid Cursor accounting protobuf'); expect(called).toBe(false);
  });
});
