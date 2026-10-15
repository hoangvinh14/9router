import { describe, it, expect } from 'vitest';
import { createAccountingClaudeSseParser } from 'open-sse/utils/accountingClaudeSseParser.js';
import { supportsClaudeOauthOriginal, prepareAccountingClaudeOauthBody } from 'open-sse/config/accountedClaudeOauth.js';
import { supportsAnthropicLiveRequest } from 'open-sse/config/accountedAnthropicCandidate.js';
import { prepareClaudeRequest } from 'open-sse/translator/formats/claude.js';
const enc = new TextEncoder();
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const usage = { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 5 }, server_tool_use: { web_search_requests: 0 } };
const start = () => event('message_start', { message: { id: 'fixture', type: 'message', role: 'assistant', model: 'fixture-model', content: [], usage } });
const block = (value = { type: 'thinking', thinking: '' }) => event('content_block_start', { index: 0, content_block: value });
const delta = (type, value) => event('content_block_delta', { index: 0, delta: { type, ...value } });
const stop = () => event('content_block_stop', { index: 0 });
const terminal = () => event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + event('message_stop');
const wire = () => start() + block() + delta('thinking_delta', { thinking: 'observed🙂' }) + delta('signature_delta', { signature: 'opaque-signature' }) + stop() + terminal();
const parser = (onEvent = () => {}, options = {}) => createAccountingClaudeSseParser(onEvent, { expectedModel: 'fixture-model', allowThinking: true, allowCache1h: true, requireCacheTiers: true, ...options });
const request = () => ({ model: 'fixture-model', stream: true, max_tokens: 4096, thinking: { type: 'enabled', budget_tokens: 1024 },
  messages: [{ role: 'user', content: 'first' }, { role: 'assistant', content: [{ type: 'thinking', thinking: 'previous', signature: 'EgAB' }, { type: 'text', text: 'answer' }] }, { role: 'user', content: 'next' }] });
describe('explicit queued OAuth thinking original and raw evidence, not server-tool/media approval', () => {
  it('passes one-byte raw thinking/signature frames without estimating extra reasoning spend', () => {
    const frames = [], p = parser(value => frames.push(value));
    for (const byte of enc.encode(wire())) p.push(new Uint8Array([byte]));
    expect(p.finish()).toMatchObject({ exact: true, input: 100, output: 20, reasoning: 0, reasoningIncludedInOutput: true });
    expect(Buffer.concat(frames.map(f => f.bytes)).toString()).toBe(wire()); expect(frames.filter(f => f.terminal)).toHaveLength(2);
  });
  it('preserves opaque redacted thinking and signature-only summaries', () => {
    for (const content of [block({ type: 'redacted_thinking', data: 'opaque-data' }) + stop(), block() + delta('signature_delta', { signature: 'opaque' }) + stop()]) {
      const frames = [], p = parser(value => frames.push(value)); p.push(enc.encode(start() + content + terminal()));
      expect(p.finish()?.exact).toBe(true); expect(Buffer.concat(frames.map(f => f.bytes)).toString()).toBe(start() + content + terminal());
    }
  });
  it('default live parser stays closed and thinking opt-in requires boolean', () => {
    const p = parser(() => {}, { allowThinking: false }); expect(() => p.push(enc.encode(wire()))).toThrow();
    expect(() => parser(() => {}, { allowThinking: 'true' })).toThrow();
  });
  it.each(['no-signature', 'text-after-signature', 'redacted-delta', 'wrong-field', 'oversize-signature'])('valid prefix before %s poisons evidence', mode => {
    const p = parser(() => {}, mode === 'oversize-signature' ? { maxThinkingSignatureBytes: 8 } : {}); p.push(enc.encode(start()));
    p.push(enc.encode(mode === 'redacted-delta' ? block({ type: 'redacted_thinking', data: 'opaque' }) : block()));
    if (mode === 'no-signature') { p.push(enc.encode(delta('thinking_delta', { thinking: 'work' }))); expect(() => p.push(enc.encode(stop()))).toThrow(); }
    if (mode === 'text-after-signature') { p.push(enc.encode(delta('signature_delta', { signature: 'sig' }))); expect(() => p.push(enc.encode(delta('thinking_delta', { thinking: 'late' })))).toThrow(); }
    if (mode === 'redacted-delta') expect(() => p.push(enc.encode(delta('thinking_delta', { thinking: 'work' })))).toThrow();
    if (mode === 'wrong-field') expect(() => p.push(enc.encode(delta('signature_delta', { signature: 'sig', text: 'hidden' })))).toThrow();
    if (mode === 'oversize-signature') { p.push(enc.encode(delta('signature_delta', { signature: '12345678' }))); expect(() => p.push(enc.encode(delta('signature_delta', { signature: '9' })))).toThrow(); }
    expect(p.finish()).toBeNull();
  });
  it('no genuine message_stop stays unknown even with valid signed block', () => {
    const p = parser(); p.push(enc.encode(wire().split('event: message_stop')[0])); expect(p.finish()).toBeNull();
  });
  it('OAuth original signed history/config survives actual production transform, default app guard unchanged', () => {
    const original = request(); expect(supportsAnthropicLiveRequest(original, original.model, true, true)).toBe(false);
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
    const prepared = prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy');
    expect(prepared.thinking).toEqual(original.thinking); expect(prepared.messages[1].content[0]).toEqual(original.messages[1].content[0]);
    expect(original.messages[1].content[1].cache_control).toBeUndefined();
  });
  it('adaptive effort and signature-only original history remain unchanged', () => {
    const original = request(); original.thinking = { type: 'adaptive', display: 'omitted' }; original.output_config = { effort: 'high' };
    original.messages[1].content[0].thinking = '';
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
    const prepared = prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy');
    expect(prepared.thinking).toEqual(original.thinking); expect(prepared.output_config).toEqual(original.output_config);
    expect(prepared.messages[1].content[0]).toEqual(original.messages[1].content[0]);
  });
  it.each(['with-text', 'only-redacted', 'tool-loop'])('original opaque redacted history %s survives queued production transform with no invented signature', mode => {
    const original = request();
    original.messages[1].content = [{ type: 'redacted_thinking', data: 'opaque-original🙂' }, ...(mode === 'only-redacted' ? [] : [{ type: 'text', text: 'answer' }])];
    if (mode === 'tool-loop') {
      original.tools = [{ name: 'lookup', input_schema: { type: 'object' } }];
      original.messages[1].content.push({ type: 'tool_use', id: 'use', name: 'lookup', input: {} });
      original.messages[2].content = [{ type: 'tool_result', tool_use_id: 'use', is_error: true, content: 'original error' }];
    }
    expect(supportsAnthropicLiveRequest(original, original.model, true, true)).toBe(false);
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
    const prepared = prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy');
    expect(prepared.messages[1].content[0]).toEqual(original.messages[1].content[0]);
    expect(prepared.messages[1].content.some(block => block.type === 'thinking')).toBe(false);
  });
  it('ordinary transform retains legacy cleanup; accounting preservation is explicit and Claude-only', () => {
    const original = request(); original.messages[1].content[0] = { type: 'redacted_thinking', data: 'opaque-original' };
    for (const flag of [undefined, false, 'true']) {
      const body = prepareClaudeRequest(structuredClone(original), 'claude', 'sk-ant-oat-dummy', null, null, 'fixture-session', flag);
      expect(body.messages[1].content.some(block => block.type === 'redacted_thinking')).toBe(false);
    }
    const preserved = prepareClaudeRequest(structuredClone(original), 'claude', 'sk-ant-oat-dummy', null, null, 'fixture-session', true);
    expect(preserved.messages[1].content[0]).toEqual(original.messages[1].content[0]);
    const compatible = prepareClaudeRequest(structuredClone(original), 'anthropic-compatible-fixture', null, null, null, null, true);
    expect(compatible.messages[1].content[0]).not.toEqual(original.messages[1].content[0]);
  });
  it.each(['signature', 'empty', 'unknown', 'wrong-role', 'after-text'])('invalid redacted original %s remains refused without normalization', mode => {
    const original = request(), block = { type: 'redacted_thinking', data: 'opaque' }; original.messages[1].content[0] = block;
    if (mode === 'signature') block.signature = 'EgAB';
    if (mode === 'empty') block.data = '';
    if (mode === 'unknown') block.hidden = true;
    if (mode === 'wrong-role') original.messages[1].role = 'user';
    if (mode === 'after-text') original.messages[1].content.reverse();
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false);
  });
  it.each(['foreign-signature', 'budget-range', 'unknown-thinking', 'unknown-output', 'erased-budget'])('original %s cannot be normalized into support', mode => {
    const original = request();
    if (mode === 'foreign-signature') original.messages[1].content[0].signature = 'foreign';
    if (mode === 'budget-range') original.thinking.budget_tokens = 4096;
    if (mode === 'unknown-thinking') original.thinking.hidden = true;
    if (mode === 'unknown-output') original.output_config = { effort: 'high', hidden: true };
    if (mode === 'erased-budget') original.max_tokens = 999999;
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false);
  });
});
