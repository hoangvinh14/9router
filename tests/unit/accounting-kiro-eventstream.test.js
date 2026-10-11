import { beforeAll, describe, expect, it } from 'vitest';
import { checksumFixtureFrame, concatFixtureBytes, fixtureFrame, fixtureHeader, fixtureKiroEvent as frame } from '../helpers/accountingKiroFrames.js';

let createAccountingKiroEventStreamParser;
beforeAll(async () => {
  ({ createAccountingKiroEventStreamParser } = await import('open-sse/utils/accountingKiroEventStreamParser.js'));
});
const metrics = () => ({ inputTokens: 100, outputTokens: 20, totalTokens: 120,
  cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 });
const text = () => frame('assistantResponseEvent', { content: 'Xin chào 🌍' });
const usage = () => frame('metricsEvent', metrics());
const stop = () => frame('messageStopEvent', { stopReason: 'end_turn' });
const expected = () => ({ exact: true, input: 100, output: 20, cacheRead: 0,
  cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true,
  provenance: { schema: 'kiro', endpoint: 'chat', inputIncludesCache: true } });
function make(options) {
  const events = [];
  const parser = createAccountingKiroEventStreamParser(event => events.push(event), options);
  return { events, parser };
}
function prefix(parser, events) {
  parser.push(text());
  expect(events).toHaveLength(1);
  expect(events[0]).toEqual({ bytes: text(), terminal: false, done: false });
  expect(parser.evidence()).toBeNull();
}

describe('Raw bounded Kiro text-only EventStream accounting prerequisite', () => {
  it('preserves raw bytes and terminal classification, exact only at clean EOF', () => {
    const { parser, events } = make();
    prefix(parser, events); parser.push(usage()); parser.push(stop());
    expect(parser.evidence()).toBeNull();
    expect(events).toEqual([
      { bytes: text(), terminal: false, done: false },
      { bytes: usage(), terminal: true, done: false },
      { bytes: stop(), terminal: true, done: true },
    ]);
    expect(parser.finish()).toEqual(expected());
  });
  it('accepts one-byte fragmentation including multibyte UTF-8 and coalesced frames', () => {
    const bytes = concatFixtureBytes([text(), usage(), stop()]);
    for (const fragmented of [true, false]) {
      const { parser, events } = make();
      if (fragmented) for (const byte of bytes) parser.push(new Uint8Array([byte]));
      else parser.push(bytes);
      expect(parser.finish()).toEqual(expected());
      expect(concatFixtureBytes(events.map(event => event.bytes))).toEqual(bytes);
    }
  });
  it('detaches retained frame bytes from caller chunk mutation', () => {
    const { parser, events } = make(); const bytes = text();
    parser.push(bytes); bytes.fill(0);
    expect(events[0].bytes).toEqual(text());
    parser.push(usage()); parser.push(stop()); expect(parser.finish()).toEqual(expected());
  });
  it('accepts explicit all-zero usage with no text, never fabricates an output token', () => {
    const { parser } = make();
    parser.push(frame('metricsEvent', Object.fromEntries(Object.keys(metrics()).map(key => [key, 0]))));
    parser.push(stop()); expect(parser.finish()).toMatchObject({ exact: true, input: 0, output: 0 });
  });
  it('accepts optional explicit event/JSON bindings without dropping raw headers', () => {
    const { parser, events } = make();
    const bytes = fixtureFrame([fixtureHeader(':event-type', 'assistantResponseEvent'),
      fixtureHeader(':message-type', 'event'), fixtureHeader(':content-type', 'application/json')], { content: 'text' });
    parser.push(bytes); expect(events[0].bytes).toEqual(bytes);
    parser.push(usage()); parser.push(stop()); expect(parser.finish()).toEqual(expected());
  });
  it('missing genuine stop remains unresolved despite exact metrics', () => {
    const { parser, events } = make(); prefix(parser, events); parser.push(usage());
    expect(parser.finish()).toBeNull();
  });
  it('empty stream returns no monetary evidence', () => {
    const { parser } = make(); expect(parser.finish()).toBeNull();
  });
  it.each([
    ['tool event', () => frame('toolUseEvent', { name: 'tool', input: '{}' })],
    ['reasoning event', () => frame('reasoningContentEvent', { text: 'private' })],
    ['credit metering', () => frame('meteringEvent', { usage: 2, unit: 'credit' })],
    ['context estimate', () => frame('contextUsageEvent', { contextUsagePercentage: 10 })],
    ['unknown event', () => frame('futureBillingEvent', {})],
    ['unknown skipped timestamp header', () => fixtureFrame([
      fixtureHeader(':event-type', 'assistantResponseEvent'), fixtureHeader('future-cost', new Uint8Array(8), 8)
    ], { content: 'text' })],
    ['metadata stop alias', () => frame('metadataEvent', { stopReason: 'end_turn' })],
    ['missing total', () => { const value = metrics(); delete value.totalTokens; return frame('metricsEvent', value); }],
    ['positive cache', () => frame('metricsEvent', { ...metrics(), cacheReadInputTokens: 1 })],
    ['enveloped metrics', () => frame('metricsEvent', { metricsEvent: metrics() })],
    ['implicit stop', () => frame('messageStopEvent', {})],
    ['refusal stop', () => frame('messageStopEvent', { stopReason: 'refusal' })],
    ['stop without usage', () => stop()],
    ['extra text field', () => frame('assistantResponseEvent', { content: 'text', futureCost: 0 })],
    ['SSE synthetic DONE', () => new TextEncoder().encode('data: [DONE]\n\n')],
    ['upstream exception', () => fixtureFrame([fixtureHeader(':message-type', 'exception'), fixtureHeader(':exception-type', 'Failure')], { message: 'failed' })],
  ])('rejects %s after an accepted raw prefix and poisons later reuse', (_label, badFrame) => {
    const { parser, events } = make(); prefix(parser, events);
    expect(() => parser.push(badFrame())).toThrow();
    expect(() => parser.push(usage())).toThrow(); expect(() => parser.finish()).toThrow();
    expect(parser.evidence()).toBeNull();
  });
  it.each(['duplicate metrics', 'text after metrics', 'duplicate stop', 'postterminal text'])('rejects %s at its actual phase boundary', fault => {
    const { parser, events } = make(); prefix(parser, events); parser.push(usage());
    expect(events[1].terminal).toBe(true);
    if (fault === 'duplicate metrics') expect(() => parser.push(usage())).toThrow();
    if (fault === 'text after metrics') expect(() => parser.push(text())).toThrow();
    if (fault === 'duplicate stop' || fault === 'postterminal text') {
      parser.push(stop()); expect(events[2].done).toBe(true);
      expect(() => parser.push(fault === 'duplicate stop' ? stop() : text())).toThrow();
    }
    expect(() => parser.finish()).toThrow();
  });
  it.each(['partial prelude', 'partial frame', 'trailing byte'])('rejects %s at EOF rather than accepting installed counters', fault => {
    const { parser, events } = make(); prefix(parser, events);
    if (fault === 'partial prelude') parser.push(usage().subarray(0, 7));
    if (fault === 'partial frame') parser.push(usage().subarray(0, usage().length - 1));
    if (fault === 'trailing byte') { parser.push(usage()); parser.push(stop()); parser.push(new Uint8Array([0])); }
    expect(() => parser.finish()).toThrow();
  });
  it.each(['prelude CRC', 'message CRC', 'fatal payload UTF-8'])('rejects %s after valid prefix', fault => {
    const { parser, events } = make(); prefix(parser, events); let bytes = usage();
    if (fault === 'prelude CRC') bytes[8] ^= 1;
    if (fault === 'message CRC') bytes[bytes.length - 5] ^= 1;
    if (fault === 'fatal payload UTF-8') bytes = fixtureFrame([fixtureHeader(':event-type', 'assistantResponseEvent')], concatFixtureBytes([
      new TextEncoder().encode('{"content":"'), new Uint8Array([0xc3, 0x28]), new TextEncoder().encode('"}')
    ]));
    expect(() => parser.push(bytes)).toThrow(); expect(() => parser.finish()).toThrow();
  });
  it('refuses declared oversized frame at prelude before buffering its payload', () => {
    const { parser, events } = make({ maxEventBytes: 256 }); prefix(parser, events);
    const bytes = new Uint8Array(16); new DataView(bytes.buffer).setUint32(0, 257, false);
    checksumFixtureFrame(bytes);
    expect(() => parser.push(bytes.subarray(0, 12))).toThrow();
  });
  it('bounds chunks independently of frame size and validates limit configuration', () => {
    const { parser, events } = make({ maxChunkBytes: 256 }); prefix(parser, events);
    expect(() => parser.push(new Uint8Array(257))).toThrow();
    for (const value of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => make({ maxEventBytes: value })).toThrow();
      expect(() => make({ maxChunkBytes: value })).toThrow();
    }
    expect(() => createAccountingKiroEventStreamParser(null)).toThrow();
  });
  it('never permits push/finish after clean EOF', () => {
    const { parser, events } = make(); prefix(parser, events); parser.push(usage()); parser.push(stop());
    expect(parser.finish()).toEqual(expected());
    expect(() => parser.push(text())).toThrow(); expect(() => parser.finish()).toThrow();
  });
});
