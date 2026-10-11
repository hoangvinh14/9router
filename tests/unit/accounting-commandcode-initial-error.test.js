import { beforeAll, describe, expect, it } from 'vitest';
let create;
beforeAll(async () => {
  ({ createCommandCodeInitialErrorParser: create } = await import('open-sse/utils/accountingCommandCodeInitialErrorParser.js'));
});
const encoder = new TextEncoder();
const line = value => encoder.encode(`${JSON.stringify(value)}\n`);
const failure = () => ({ type: 'error', error: { statusCode: 503, message: 'fixture unavailable' } });
const prefix = parser => { parser.push(line({ type: 'start' })); parser.push(line({ type: 'start-step' })); };
const receipt = { statusCode: 503, usage: null };

describe('raw CommandCode initial error boundary (unresolved failure, not retry/usage permission)', () => {
  it('accepts explicit initial error only at clean EOF without invented usage', () => {
    const parser = create(); parser.push(line(failure())); expect(parser.finish()).toEqual(receipt);
  });
  it('accepts ordered start/start-step/error one byte at a time, awaiting clean EOF', () => {
    const parser = create();
    for (const event of [{ type: 'start' }, { type: 'start-step' }, failure()]) for (const byte of line(event)) parser.push(Uint8Array.of(byte));
    expect(parser.finish()).toEqual(receipt);
  });
  it('returns no failure receipt for incomplete prelude rather than synthesizing an error', () => {
    const parser = create(); prefix(parser); expect(parser.finish()).toBeNull();
  });
  it.each([
    ['repeated-start', parser => parser.push(line({ type: 'start' }))],
    ['text', parser => parser.push(line({ type: 'text-delta', id: 'fixture', text: 'not initial' }))],
    ['unknown', parser => parser.push(line({ type: 'provider-metadata' }))],
    ['missing-status', parser => parser.push(line({ type: 'error', error: { message: 'fixture' } }))],
    ['string-status', parser => parser.push(line({ type: 'error', error: { statusCode: '503', message: 'fixture' } }))],
    ['unknown-error-field', parser => parser.push(line({ type: 'error', error: { statusCode: 503, message: 'fixture', usage: {} } }))],
    ['invalid-utf8', parser => parser.push(Uint8Array.of(255, 10))],
  ])('refuses %s after accepted ordered prelude', (_name, fault) => {
    const valid = create(); prefix(valid); valid.push(line(failure())); expect(valid.finish()).toEqual(receipt);
    const parser = create(); prefix(parser); expect(() => fault(parser)).toThrow(); expect(() => parser.finish()).toThrow();
  });
  it('rejects any event after initial error, never authorizing from an earlier error alone', () => {
    const parser = create(); prefix(parser); parser.push(line(failure()));
    expect(() => parser.push(line({ type: 'finish' }))).toThrow(); expect(() => parser.finish()).toThrow();
  });
  it('requires terminated raw line, refusing a truncated JSON error at EOF', () => {
    const parser = create(); prefix(parser); parser.push(encoder.encode('{"type":"error"'));
    expect(() => parser.finish()).toThrow();
  });
  it('bounds event and chunk bytes before unbounded buffering', () => {
    const parser = create({ maxEventBytes: 100, maxChunkBytes: 100 }); prefix(parser);
    expect(() => parser.push(encoder.encode('x'.repeat(101)))).toThrow(); expect(() => parser.finish()).toThrow();
  });
  it('refuses Proxy bytes without invoking traps after an accepted prelude', () => {
    const parser = create(); prefix(parser); let touched = 0;
    const trap = () => { touched++; throw new Error('fixture trap'); };
    expect(() => parser.push(new Proxy(line(failure()), { get: trap, getPrototypeOf: trap }))).toThrow(); expect(touched).toBe(0);
  });
});
