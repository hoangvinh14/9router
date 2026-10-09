import { describe, it, expect } from 'vitest';
import { createAccountingSseParser } from '../../open-sse/utils/accountingSseParser.js';
const encode = text => new TextEncoder().encode(text);
const delta = 'data: {"choices":[{"index":0,"delta":{"content":"Việt🙂"}}]}\r\n\r\n';
const finish = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n';
const usage = 'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\n';
const done = 'data: [DONE]\n\n';
describe('raw incremental accounting SSE parser', () => {
  it('all byte splits preserve framed bytes and exact terminal evidence', () => {
    const source = encode(delta + finish + usage + done);
    for (let split = 0; split <= source.length; split++) {
      const events = [], parser = createAccountingSseParser(event => events.push(event));
      parser.push(source.slice(0, split)); parser.push(source.slice(split));
      expect(parser.finish()).toMatchObject({ exact: true, input: 100, output: 50 });
      expect(events.map(event => new TextDecoder().decode(event.bytes)).join('')).toBe(delta + finish + usage + done);
      expect(events.map(event => event.terminal)).toEqual([false, true, true, true]);
    }
  });
  it('CR framing/comments/multiline/EOF compatibility never invents DONE', () => {
    const events = [], parser = createAccountingSseParser(event => events.push(event));
    parser.push(encode(': comment\r\rdata: {"choices":[],\rdata: "usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}\r\rdata: [DONE]'));
    expect(parser.finish()).toMatchObject({ exact: true, input: 0, output: 0 });
    expect(events).toHaveLength(3); expect(events[0].terminal).toBe(false);
    const missing = createAccountingSseParser(() => {}); missing.push(encode(usage)); expect(missing.finish()).toBeNull();
    const noUsage = createAccountingSseParser(() => {}); noUsage.push(encode(done)); expect(noUsage.finish()).toBeNull();
  });
  it.each([
    'data: [DONE]\n\ndata: [DONE]\n\n',
    usage + done + usage,
    'data: {bad}\n\n',
    'data: {"error":{"message":"fixture"}}\n\n',
    'event: error\ndata: {"choices":[]}\n\n',
    'data: {"choices":[{"index":0},{"index":1}]}\n\n',
    'data: {"choices":[{"index":1}]}\n\n',
    'data: {"choices":[{"index":0}],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}\n\n',
    usage + 'data: {"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}\n\n',
  ])('rejects invalid/error/conflicting/post-DONE frame %# before forwarding that frame', text => {
    const parser = createAccountingSseParser(() => {});
    expect(() => parser.push(encode(text))).toThrow();
  });
  it('fatal UTF-8, event and chunk bounds include comments/unknown fields', () => {
    const parser = createAccountingSseParser(() => {});
    expect(() => parser.push(new Uint8Array([0xc3, 0x28]))).toThrow();
    const incomplete = createAccountingSseParser(() => {}); incomplete.push(new Uint8Array([0xc3])); expect(() => incomplete.finish()).toThrow();
    const small = createAccountingSseParser(() => {}, { maxEventBytes: 8 }); expect(() => small.push(encode(':123456789'))).toThrow('limit');
    const chunk = createAccountingSseParser(() => {}, { maxChunkBytes: 1 }); expect(() => chunk.push(encode('ab'))).toThrow('chunk');
  });
});
