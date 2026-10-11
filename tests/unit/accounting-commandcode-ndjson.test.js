import { beforeAll, describe, expect, it } from 'vitest';
import { FORMATS } from 'open-sse/translator/formats.js';
let createParser;
// Dynamic collection avoids fabricating catch-all green when module is absent.
beforeAll(async () => { ({ createAccountingCommandCodeNdjsonParser: createParser } = await import('open-sse/utils/accountingCommandCodeNdjsonParser.js')); });
const encoder = new TextEncoder(), usage = () => ({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 });
const events = () => [
  { type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 'text_fixture' },
  { type: 'text-delta', id: 'text_fixture', text: 'héllo' }, { type: 'text-end', id: 'text_fixture' },
  { type: 'finish-step', finishReason: 'stop', usage: usage() },
  { type: 'finish', finishReason: 'stop', totalUsage: usage() },
];
const line = event => JSON.stringify(event) + '\n';
function parser(limits = {}) { const observed = []; return { observed, reader: createParser(event => observed.push(event), limits) }; }
function prefix(reader, observed, count) {
  for (const event of events().slice(0, count)) reader.push(encoder.encode(line(event)));
  expect(observed).toHaveLength(count); expect(observed.every(event => event.bytes instanceof Uint8Array)).toBe(true);
}
describe('bounded raw CommandCode single-step text NDJSON (not generation/retry/schema-wide approval)', () => {
  it('one-byte UTF8 preserves raw bytes and exact usage only at genuine finish plus clean EOF', () => {
    const { reader, observed } = parser(), text = events().map(line).join(''), bytes = encoder.encode(text);
    for (const byte of bytes) reader.push(Uint8Array.of(byte));
    expect(observed.map(event => new TextDecoder().decode(event.bytes)).join('')).toBe(text);
    expect(observed.filter(event => event.terminal)).toHaveLength(2);
    expect(observed.filter(event => event.done)).toHaveLength(1);
    expect(reader.evidence()).toBeNull();
    expect(reader.finish()).toEqual({ exact: true, input: 100, output: 20, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true,
      provenance: { schema: FORMATS.COMMANDCODE, endpoint: 'chat', inputIncludesCache: true } });
    expect(() => reader.finish()).toThrow(); expect(() => reader.push(bytes)).toThrow();
  });
  it('explicit zero usage with no text is not missing metadata', () => {
    const { reader } = parser(), zero = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
    for (const event of [{ type: 'start' }, { type: 'start-step' }, { type: 'finish-step', finishReason: 'stop', usage: zero }, { type: 'finish', finishReason: 'stop', totalUsage: zero }]) reader.push(encoder.encode(line(event)));
    expect(reader.finish()).toMatchObject({ exact: true, input: 0, output: 0 });
  });
  it('CRLF and final unterminated JSON preserve bytes without inventing terminal', () => {
    const { reader, observed } = parser(), text = events().map(event => JSON.stringify(event)).join('\r\n');
    reader.push(encoder.encode(text)); expect(observed).toHaveLength(6);
    expect(reader.finish()).toMatchObject({ exact: true, input: 100, output: 20 });
    expect(observed.map(event => new TextDecoder().decode(event.bytes)).join('')).toBe(text);
  });
  it('missing finish remains null despite exact finish-step metadata', () => {
    const { reader, observed } = parser(); prefix(reader, observed, 6); expect(observed.at(-1).terminal).toBe(true);
    expect(reader.finish()).toBeNull(); expect(reader.evidence()).toBeNull();
  });
  it.each([
    ['step without start', 0, { type: 'start-step' }],
    ['delta before text-start', 2, { type: 'text-delta', id: 'text_fixture', text: 'late' }],
    ['different text identity', 3, { type: 'text-delta', id: 'other', text: 'wrong' }],
    ['finish-step with open text', 4, { type: 'finish-step', finishReason: 'stop', usage: usage() }],
    ['second generation step', 6, { type: 'start-step' }],
    ['finish without finish-step', 5, { type: 'finish', finishReason: 'stop', totalUsage: usage() }],
    ['unknown zero hosted metadata', 5, { type: 'provider-metadata', cost: 0 }],
    ['tool schema', 2, { type: 'tool-input-start', id: 'tool_fixture', toolName: 'terminal' }],
    ['reasoning schema', 2, { type: 'reasoning-start', id: 'reason_fixture' }],
    ['initial raw error', 2, { type: 'error', error: 'unavailable' }],
    ['missing total usage', 6, { type: 'finish', finishReason: 'stop' }],
    ['conflicting exact usage', 6, { type: 'finish', finishReason: 'stop', totalUsage: { ...usage(), inputTokens: 101, totalTokens: 121 } }],
    ['unsupported cache charge', 5, { type: 'finish-step', finishReason: 'stop', usage: { ...usage(), cachedInputTokens: 1 } }],
    ['event after terminal', 7, { type: 'start' }],
  ])('%s refuses after verified valid prefix', (_label, count, invalid) => {
    const { reader, observed } = parser(); prefix(reader, observed, count);
    expect(() => reader.push(encoder.encode(line(invalid)))).toThrow('Invalid raw CommandCode accounting stream');
    expect(reader.evidence()).toBeNull(); expect(() => reader.finish()).toThrow();
  });
  it.each(['[DONE]\n', 'data: {"type":"finish"}\n', '{invalid}\n'])('synthetic/framed/malformed %s cannot authenticate raw NDJSON terminal', invalid => {
    const { reader, observed } = parser(); prefix(reader, observed, 6);
    expect(() => reader.push(encoder.encode(invalid))).toThrow('Invalid raw CommandCode accounting stream'); expect(() => reader.finish()).toThrow();
  });
  it('fatal invalid UTF8 after valid start cannot become replacement text', () => {
    const { reader, observed } = parser(); prefix(reader, observed, 2);
    expect(() => reader.push(Uint8Array.of(0xc3, 0x28))).toThrow(); expect(() => reader.finish()).toThrow();
  });
  it('bounded partial line rejects before framing/JSON parse', () => {
    const { reader, observed } = parser({ maxEventBytes: 256 }); prefix(reader, observed, 3);
    expect(() => reader.push(encoder.encode('{"type":"text-delta","id":"text_fixture","text":"' + 'x'.repeat(300)))).toThrow();
    expect(observed).toHaveLength(3); expect(() => reader.finish()).toThrow();
  });
  it('oversize transport chunk refuses before event callback', () => {
    const { reader, observed } = parser({ maxChunkBytes: 16 });
    expect(() => reader.push(new Uint8Array(17))).toThrow(); expect(observed).toHaveLength(0); expect(() => reader.finish()).toThrow();
  });
});
