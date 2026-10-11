import { beforeAll, describe, expect, it } from 'vitest';
let create;
beforeAll(async () => { ({ createQoderAccountingEnvelopeReader: create } = await import('open-sse/utils/accountingQoderEnvelope.js')); });
const encode = value => new TextEncoder().encode(value);
const frame = (statusCodeValue = 200, body = '{"choices":[]}') => 'data: ' + JSON.stringify({ statusCodeValue, body }) + '\n\n';
describe('bounded Qoder raw envelope structure only (no usage/terminal/ACK/retry certification)', () => {
  it('retains complete raw body without parsing, coercion or token defaults', () => {
    const reader = create(); reader.push(encode(frame(200, '{"usage":{"input_tokens":"100"}}'))); reader.push(encode('data: [DONE]\n\n'));
    expect(reader.finish()).toEqual([{ kind: 'envelope', statusCodeValue: 200, body: '{"usage":{"input_tokens":"100"}}' }, { kind: 'done' }]);
  });
  it('fragmented UTF8/CRLF with heartbeat preserves envelope order and frozen detached output', () => {
    const bytes = encode(': heartbeat\r\n\r\n' + frame(200, 'fixture …').replaceAll('\n', '\r\n') + frame(503, 'fixture error') + 'data: [DONE]\n\n');
    const reader = create(); for (const byte of bytes) reader.push(Uint8Array.of(byte)); const records = reader.finish();
    bytes.fill(0); expect(records).toEqual([{ kind: 'envelope', statusCodeValue: 200, body: 'fixture …' }, { kind: 'envelope', statusCodeValue: 503, body: 'fixture error' }, { kind: 'done' }]);
    expect(Object.isFrozen(records)).toBe(true); expect(records.every(Object.isFrozen)).toBe(true);
  });
  it('empty EOF retains no records and never manufactures DONE or exact usage', () => { expect(create().finish()).toEqual([]); });
  it.each([['string status', { statusCodeValue: '200', body: 'x' }], ['zero status', { statusCodeValue: 0, body: 'x' }], ['object body', { statusCodeValue: 200, body: {} }], ['extra field', { statusCodeValue: 200, body: 'x', ignored: true }]])('%s refuses after accepted positive envelope, without erasure', (_label, value) => {
    const reader = create(); reader.push(encode(frame())); expect(() => reader.push(encode('data: ' + JSON.stringify(value) + '\n\n'))).toThrow('Invalid raw Qoder accounting envelope');
    expect(() => reader.finish()).toThrow();
  });
  it('unterminated tail, invalid JSON and unknown SSE field refuse instead of permissive flush', () => {
    for (const input of [frame().trimEnd(), 'data: {invalid}\n\n', 'event: unknown\ndata: [DONE]\n\n']) {
      const reader = create(); expect(() => { reader.push(encode(input)); reader.finish(); }).toThrow('Invalid raw Qoder accounting envelope');
    }
  });
  it('post-DONE raw envelope poisons the reader rather than cancelling away late evidence', () => {
    const reader = create(); reader.push(encode(frame() + 'data: [DONE]\n\n')); expect(() => reader.push(encode(frame(503, 'late failure')))).toThrow(); expect(() => reader.finish()).toThrow();
  });
  it('rejects malformed UTF8 without replacement and preserves poison', () => {
    const reader = create(); expect(() => reader.push(Uint8Array.of(255))).toThrow(); expect(() => reader.finish()).toThrow();
  });
  it('intrinsic copies bytes without caller subarray/set/getter reads; rejects Proxy without traps', () => {
    const input = encode(frame()); let reads = 0;
    Object.defineProperty(input, 'byteLength', { get() { reads++; throw new Error('caller getter'); } });
    input.subarray = () => { reads++; throw new Error('caller method'); };
    const reader = create(); reader.push(input); expect(reader.finish()).toHaveLength(1); expect(reads).toBe(0);
    const proxy = new Proxy(encode(frame()), { get() { reads++; throw new Error('proxy getter'); }, getPrototypeOf() { reads++; throw new Error('proxy prototype'); } });
    expect(() => create().push(proxy)).toThrow(); expect(reads).toBe(0);
  });
  it.each([
    '{"statusCodeValue":503,"statusCodeValue":200,"body":"x"}',
    '{"statusCodeValue":200,"body":"original","body":"changed"}',
    '{"statusCodeValue":503,"statusCode\\u0056alue":200,"body":"x"}',
  ])('duplicate decoded envelope keys refuse without last-value erasure: %s', raw => {
    const reader = create(); reader.push(encode(frame()));
    expect(() => reader.push(encode('data: ' + raw + '\n\n'))).toThrow('Invalid raw Qoder accounting envelope'); expect(() => reader.finish()).toThrow();
  });
  it('JSON escapes/order/whitespace remain valid while inner body duplicate keys stay opaque and are not certified', () => {
    const reader = create(); reader.push(encode('data: { "body":"{\\\"token\\\":1,\\\"token\\\":2}", "statusCode\\u0056alue":2e2 }\n\n'));
    expect(reader.finish()).toEqual([{ kind: 'envelope', statusCodeValue: 200, body: '{"token":1,"token":2}' }]);
  });
  it('options accessor/Proxy refuse zero programmable reads, aggregate raw bytes and multiline data refuse', () => {
    let reads = 0; const trap = () => { reads++; throw new Error('caller options read'); };
    expect(() => create({ get maxRecords() { return trap(); } })).toThrow();
    expect(() => create(new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap }))).toThrow(); expect(reads).toBe(0);
    const reader = create({ maxTotalBytes: encode(frame()).length }); reader.push(encode(frame()));
    expect(() => reader.push(encode(frame()))).toThrow(); expect(() => reader.finish()).toThrow();
    expect(() => create().push(encode('data: {"statusCodeValue":200,\ndata: "body":"x"}\n\n'))).toThrow();
  });
  it('event/chunk/record bounds and repeated finish are explicit refusals', () => {
    expect(() => create({ maxEventBytes: 32 }).push(encode(frame()))).toThrow();
    expect(() => create({ maxChunkBytes: 2 }).push(encode(frame()))).toThrow();
    expect(() => create({ maxRecords: 1 }).push(encode(frame() + frame()))).toThrow();
    const reader = create(); reader.finish(); expect(() => reader.finish()).toThrow();
  });
});
