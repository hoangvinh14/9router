import { beforeAll, describe, expect, it } from 'vitest';
import { checksumFixtureFrame, concatFixtureBytes, fixtureFrame, fixtureHeader, fixtureKiroEvent } from '../helpers/accountingKiroFrames.js';

let parseEventFrame;
beforeAll(async () => {
  ({ parseEventFrame } = await import('open-sse/utils/kiroEventStreamFrame.js'));
});
const valid = () => fixtureKiroEvent('assistantResponseEvent', { content: 'Xin chào 🌍' });
const parse = bytes => parseEventFrame(bytes, { fatalUtf8: true });
const positive = () => {
  expect(parse(valid())).toMatchObject({ headers: { ':event-type': 'assistantResponseEvent' }, payload: { content: 'Xin chào 🌍' } });
};

describe('Shared Kiro frame integrity with explicit fatal UTF-8 accounting opt-in', () => {
  it('decodes exact CRC-framed UTF-8 without mutating input', () => {
    const bytes = valid(); const before = bytes.slice();
    positive(); expect(parse(bytes).payload.content).toBe('Xin chào 🌍');
    expect(bytes).toEqual(before);
  });
  it('honors Uint8Array offsets, not the backing buffer prefix', () => {
    const bytes = valid(); const padded = concatFixtureBytes([new Uint8Array(11), bytes, new Uint8Array(9)]);
    expect(parse(padded.subarray(11, 11 + bytes.byteLength))).toEqual(parse(bytes));
  });
  it('preserves supported typed header semantics and skipped timestamp/UUID fields', () => {
    const parsed = parse(fixtureFrame([
      fixtureHeader('yes', new Uint8Array(), 0), fixtureHeader('no', new Uint8Array(), 1),
      fixtureHeader('byte', new Uint8Array([255]), 2), fixtureHeader('short', new Uint8Array([0, 7]), 3),
      fixtureHeader('int', new Uint8Array([0, 0, 0, 9]), 4),
      fixtureHeader('long', new Uint8Array(8), 5), fixtureHeader('time', new Uint8Array(8), 8),
      fixtureHeader('id', new Uint8Array(16), 9), fixtureHeader('bytes', new Uint8Array([1, 2]), 6),
    ], { value: 1 }));
    expect(parsed.headers).toMatchObject({ yes: true, no: false, byte: -1, short: 7, int: 9, bytes: new Uint8Array([1, 2]) });
    for (const key of ['long', 'time', 'id']) expect(Object.hasOwn(parsed.headers, key)).toBe(false);
    expect(Object.getPrototypeOf(parsed.headers)).toBeNull();
  });
  it('retains legacy empty/whitespace payload behavior', () => {
    expect(parse(fixtureFrame([], new Uint8Array())).payload).toBeNull();
    expect(parse(fixtureFrame([], new TextEncoder().encode(' \n '))).payload).toBeNull();
  });
  it.each([
    ['short frame', () => new Uint8Array(15), /shorter than 16/],
    ['length mismatch', () => { const b = valid(); new DataView(b.buffer).setUint32(0, b.length - 1, false); return b; }, /length does not match/],
    ['header overflow', () => { const b = valid(); new DataView(b.buffer).setUint32(4, b.length, false); return checksumFixtureFrame(b); }, /bounds are invalid/],
    ['prelude CRC', () => { const b = valid(); b[8] ^= 1; return b; }, /prelude CRC mismatch/],
    ['message CRC', () => { const b = valid(); b[b.length - 5] ^= 1; return b; }, /message CRC mismatch/],
    ['duplicate header', () => fixtureFrame([fixtureHeader('a', 'x'), fixtureHeader('a', 'y')], {}), /duplicate header/],
    ['typed value overrun', () => fixtureFrame([new Uint8Array([1, 97, 4, 0])], {}), /declared bounds/],
    ['string overrun', () => fixtureFrame([new Uint8Array([1, 97, 7, 0, 9, 65])], {}), /declared bounds/],
    ['name overrun', () => fixtureFrame([new Uint8Array([9, 97])], {}), /declared bounds/],
    ['unknown header type', () => fixtureFrame([fixtureHeader('a', new Uint8Array(), 10)], {}), /unknown type/],
    ['invalid JSON', () => fixtureFrame([], new TextEncoder().encode('{bad}')), /not valid JSON/],
    ['header ceiling', () => fixtureFrame([new Uint8Array(128 * 1024 + 1)], {}), /bounds are invalid/],
  ])('rejects %s after a valid-frame control', (_label, factory, error) => {
    positive(); expect(() => parse(factory())).toThrow(error);
  });
  it.each(['name', 'value', 'payload'])('fatal UTF-8 rejects invalid %s with valid CRC, without changing legacy decoding', field => {
    positive();
    const invalid = new Uint8Array([0xc3, 0x28]);
    let bytes;
    if (field === 'name') bytes = fixtureFrame([fixtureHeader(invalid, 'ok')], {});
    if (field === 'value') bytes = fixtureFrame([fixtureHeader('a', invalid)], {});
    if (field === 'payload') bytes = fixtureFrame([], concatFixtureBytes([
      new TextEncoder().encode('{"content":"'), invalid, new TextEncoder().encode('"}')
    ]));
    // Independently checksummed frames pass legacy CRC and replacement decoding.
    expect(() => parseEventFrame(bytes)).not.toThrow();
    expect(() => parse(bytes)).toThrow(/encoded data|UTF-8/i);
  });
});
