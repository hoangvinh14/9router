import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
let create;
beforeAll(async () => { ({ createCursorAccountingFrameReader: create } = await import('open-sse/utils/accountingCursorFrames.js')); });
// Independent unsigned32 ConnectRPC header fixture, not legacy codec round-trip.
const frame = (flags, payload, declared = payload.length) => {
  const bytes = new Uint8Array(5 + payload.length); bytes[0] = flags;
  new DataView(bytes.buffer).setUint32(1, declared, false); bytes.set(payload, 5); return bytes;
};
const concat = (...parts) => { const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0)); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes; };
const sample = () => Uint8Array.of(8, 1, 18, 2, 65, 66);
const setup = options => { const records = []; return { records, reader: create(value => records.push(value), options) }; };
describe('Cursor bounded ConnectRPC structural frame reader only (not usage, trailer or successful terminal authority)', () => {
  it('decodes uncompressed body and trailer as detached ordered records preserving flags', () => {
    const raw = concat(frame(0, sample()), frame(2, Uint8Array.of(123, 125))), { reader, records } = setup();
    reader.push(raw); raw.fill(0); expect(reader.finish()).toBeUndefined();
    expect(records).toEqual([{ flags: 0, payload: sample() }, { flags: 2, payload: Uint8Array.of(123, 125) }]);
  });
  it('handles every two-chunk split and one-byte input without treating chunks as frames', () => {
    const raw = concat(frame(0, sample()), frame(0, sample()));
    for (let split = 0; split <= raw.length; split++) {
      const { reader, records } = setup(); reader.push(raw.slice(0, split)); reader.push(raw.slice(split)); reader.finish(); expect(records).toHaveLength(2);
    }
    const { reader, records } = setup(); for (const byte of raw) reader.push(Uint8Array.of(byte)); reader.finish(); expect(records).toHaveLength(2);
  });
  it.each([1, 3])('bounded gzip flags=%s preserves inflated bytes and original flags', flags => {
    const { reader, records } = setup(); reader.push(frame(flags, gzipSync(sample()))); reader.finish();
    expect(records).toEqual([{ flags, payload: sample() }]);
  });
  it('accepts structural empty frames and empty stream without synthesizing done or usage', () => {
    const { reader, records } = setup(); reader.push(frame(0, new Uint8Array())); reader.finish(); expect(records).toEqual([{ flags: 0, payload: new Uint8Array() }]);
    const empty = setup(); empty.reader.finish(); expect(empty.records).toEqual([]);
  });
  it.each([4, 128, 255])('unsupported flags=%s poison after valid prefix and never callback invalid frame', flags => {
    const { reader, records } = setup(); reader.push(frame(0, sample())); expect(records).toHaveLength(1);
    expect(() => reader.push(frame(flags, sample()))).toThrow('Invalid Cursor accounting frame');
    expect(records).toHaveLength(1); expect(() => reader.finish()).toThrow('Invalid Cursor accounting frame');
  });
  it.each([1, 2, 3, 4, 5, 6])('truncated frame length=%s is refused at EOF after accepted prefix', length => {
    const { reader, records } = setup(); reader.push(frame(0, sample())); reader.push(frame(0, sample()).slice(0, length));
    expect(records).toHaveLength(1); expect(() => reader.finish()).toThrow('Invalid Cursor accounting frame');
  });
  it('unsigned32 oversized declaration fails at prelude without waiting for claimed payload', () => {
    const { reader, records } = setup(); reader.push(frame(0, sample()));
    expect(() => reader.push(frame(0, new Uint8Array(), 4294967295))).toThrow('Invalid Cursor accounting frame'); expect(records).toHaveLength(1);
  });
  it('raw payload bound is inclusive and oversized prelude rejects before payload buffering', () => {
    const { reader, records } = setup({ maxFrameBytes: 6 }); reader.push(frame(0, sample())); expect(records).toHaveLength(1);
    expect(() => reader.push(frame(0, new Uint8Array(), 7))).toThrow('Invalid Cursor accounting frame');
  });
  it('inflated output ceiling refuses a gzip expansion instead of fallback-to-raw or emitting bytes', () => {
    const { reader, records } = setup({ maxInflatedBytes: 6 }); reader.push(frame(1, gzipSync(sample()))); expect(records).toHaveLength(1);
    expect(() => reader.push(frame(1, gzipSync(new Uint8Array(10000))))).toThrow('Invalid Cursor accounting frame'); expect(records).toHaveLength(1);
  });
  it('malformed gzip poisons without legacy deflate/raw fallback', () => {
    const { reader, records } = setup(); reader.push(frame(0, sample()));
    expect(() => reader.push(frame(1, sample()))).toThrow('Invalid Cursor accounting frame'); expect(records).toHaveLength(1);
  });
  it('chunk limit refuses before callbacks and remains poisoned', () => {
    const { reader, records } = setup({ maxChunkBytes: 11 }); reader.push(frame(0, sample())); expect(records).toHaveLength(1);
    expect(() => reader.push(concat(frame(0, sample()), Uint8Array.of(0)))).toThrow('Invalid Cursor accounting frame');
    expect(records).toHaveLength(1); expect(() => reader.push(frame(0, sample()))).toThrow('Invalid Cursor accounting frame');
  });
  it('rejects push or repeated finish after structural EOF', () => {
    const { reader } = setup(); reader.push(frame(0, sample())); reader.finish();
    expect(() => reader.push(frame(0, sample()))).toThrow('Invalid Cursor accounting frame'); expect(() => reader.finish()).toThrow('Invalid Cursor accounting frame');
  });
  it('callback exception poisons the reader without continuing into later frames', () => {
    let count = 0; const reader = create(() => { count++; throw new Error('fixture callback unavailable'); });
    expect(() => reader.push(concat(frame(0, sample()), frame(0, sample())))).toThrow(); expect(count).toBe(1);
    expect(() => reader.finish()).toThrow('Invalid Cursor accounting frame');
  });
  it('rejects Proxy bytes before any programmable trap after a valid accepted frame', () => {
    const { reader, records } = setup(); reader.push(frame(0, sample())); expect(records).toHaveLength(1);
    let touched = 0; const trap = () => { touched++; throw new Error('fixture Proxy trap executed'); };
    const input = new Proxy(frame(0, sample()), { get: trap, getPrototypeOf: trap, ownKeys: trap });
    expect(() => reader.push(input)).toThrow('Invalid Cursor accounting frame'); expect(touched).toBe(0); expect(records).toHaveLength(1);
    expect(() => reader.finish()).toThrow('Invalid Cursor accounting frame');
  });
  it('copies typed bytes intrinsically without custom iterator, buffer, length or slice reads', () => {
    const raw = frame(0, sample()), { reader, records } = setup(); let touched = 0;
    const trap = () => { touched++; throw new Error('fixture typed-byte hook executed'); };
    for (const name of ['buffer', 'byteLength', 'length', 'slice', 'subarray']) Object.defineProperty(raw, name, { get: trap });
    Object.defineProperty(raw, Symbol.iterator, { value: trap });
    reader.push(raw); reader.finish(); expect(touched).toBe(0); expect(records).toEqual([{ flags: 0, payload: sample() }]);
  });
  it('rejects non-byte input without coercion or serialization hooks', () => {
    const { reader, records } = setup(); reader.push(frame(0, sample())); let touched = 0;
    const trap = () => { touched++; throw new Error('fixture conversion executed'); };
    expect(() => reader.push({ valueOf: trap, toJSON: trap, [Symbol.iterator]: trap })).toThrow('Invalid Cursor accounting frame');
    expect(touched).toBe(0); expect(records).toHaveLength(1);
  });
  it('callback-swallowed reentry failure poisons outer push and suppresses subsequent callbacks', () => {
    let count = 0, reader;
    reader = create(() => { count++; try { reader.push(frame(0, sample())); } catch { /* a swallowed inner fault must stay poisoned */ } });
    expect(() => reader.push(concat(frame(0, sample()), frame(0, sample())))).toThrow('Invalid Cursor accounting frame');
    expect(count).toBe(1); expect(() => reader.finish()).toThrow('Invalid Cursor accounting frame');
  });
  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid/unbounded limits %s', value => {
    for (const key of ['maxFrameBytes', 'maxChunkBytes', 'maxInflatedBytes']) expect(() => setup({ [key]: value })).toThrow('Invalid Cursor accounting frame limits');
  });
});
