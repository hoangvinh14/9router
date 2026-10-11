import { describe, expect, it } from 'vitest';
import { createAccountingClaudeOauthParser } from 'open-sse/utils/accountingClaudeOauthSseParser.js';
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const start = event('message_start', { message: { type: 'message', role: 'assistant', id: 'fixture', model: 'fixture', content: [], usage: {
  input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 0 },
} } });
const end = event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } }) + event('message_stop');
const original = { tools: [{ name: 'lookup', input_schema: {} }], messages: [] };
const encoder = new TextEncoder();
describe('OAuth projection after sole raw validator', () => {
  it.each(['lookup_ide', 'Task', 'foreign_ide'])('only declared client mapping is reversed: %s', name => {
    const frames = []; const parser = createAccountingClaudeOauthParser(original)(e => frames.push(e), { expectedModel: 'fixture', allowClientTools: true });
    const block = event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'fixture-tool', name, input: {} } }) +
      event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"q":"🙂"}' } }) + event('content_block_stop', { index: 0 });
    for (const byte of encoder.encode(start + block + end)) parser.push(Uint8Array.of(byte));
    expect(parser.finish()).toMatchObject({ exact: true, input: 1, output: 1 });
    const text = frames.map(e => new TextDecoder().decode(e.bytes)).join('');
    expect(text).toContain(`"name":"${name === 'lookup_ide' ? 'lookup' : name}"`);
    expect(text).toContain('🙂'); expect(frames.at(-1)).toMatchObject({ terminal: true, done: true });
  });
  it('invalid block never reaches projection and cannot produce exact usage', () => {
    const frames = []; const parser = createAccountingClaudeOauthParser(original)(e => frames.push(e), { expectedModel: 'fixture', allowClientTools: true });
    parser.push(encoder.encode(start));
    expect(() => parser.push(encoder.encode(event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'fixture-tool', name: 'lookup_ide', input: {}, unexpected: true } })))).toThrow();
    expect(frames).toHaveLength(1); expect(parser.finish()).toBeNull();
  });
});
