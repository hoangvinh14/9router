import { describe, expect, it } from 'vitest';
import { supportsAnthropicLiveRequest } from 'open-sse/config/accountedAnthropicCandidate.js';

const request = () => ({ model: 'fixture-model', stream: true, max_tokens: 100,
  messages: [{ role: 'user', content: 'fixture' }, { role: 'assistant', content: [
    { type: 'text', text: 'lookup' }, { type: 'tool_use', id: 'tool_fixture', name: 'fixture_lookup', input: { query: 'đúng🙂', nested: [1, false, null] } },
  ] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_fixture', is_error: false, content: [{ type: 'text', text: 'kết quả🙂' }] }, { type: 'text', text: 'continue' }] }],
  tools: [{ name: 'fixture_lookup', input_schema: { type: 'object' } }], tool_choice: { type: 'auto' } });
const supported = body => supportsAnthropicLiveRequest(body, 'fixture-model', true);
const use = body => body.messages[1].content[1];
const result = body => body.messages[2].content[0];

describe('explicit queued native client-tool text history (not app/beta/OAuth approval)', () => {
  it.each(['text-blocks', 'string', 'error', 'parallel', 'multiple-turns', 'no-current-declarations'])('preserves supported history without mutation: %s', mode => {
    const body = request();
    if (mode === 'string') result(body).content = 'fixture result';
    if (mode === 'error') result(body).is_error = true;
    if (mode === 'parallel') {
      body.messages[1].content.push({ ...structuredClone(use(body)), id: 'tool_second' });
      body.messages[2].content.splice(0, 0, { ...structuredClone(result(body)), tool_use_id: 'tool_second' });
    }
    if (mode === 'multiple-turns') body.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'tool_next', name: 'fixture_lookup', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_next', content: '' }] });
    if (mode === 'no-current-declarations') { delete body.tools; delete body.tool_choice; }
    const original = structuredClone(body); expect(supported(body)).toBe(true); expect(body).toEqual(original);
    expect(supportsAnthropicLiveRequest(body, 'fixture-model')).toBe(false);
    expect(supportsAnthropicLiveRequest(body, 'fixture-model', 'true')).toBe(false);
  });
  it.each(['unknown-result', 'duplicate-use', 'duplicate-result', 'missing-result', 'intervening-turn', 'wrong-use-role', 'wrong-result-role',
    'result-after-text', 'media-result', 'server-use', 'unknown-field', 'nonboolean-error', 'array-input', 'nonfinite-input', 'empty-id', 'empty-name', 'cache-1h', 'deep-input', 'oversize'])('rejects unsupported/malformed history: %s', mode => {
    const body = request();
    if (mode === 'unknown-result') result(body).tool_use_id = 'unknown';
    if (mode === 'duplicate-use') body.messages[1].content.push(structuredClone(use(body)));
    if (mode === 'duplicate-result') body.messages[2].content.unshift(structuredClone(result(body)));
    if (mode === 'missing-result') body.messages[2].content.shift();
    if (mode === 'intervening-turn') body.messages.splice(2, 0, { role: 'assistant', content: 'fixture' });
    if (mode === 'wrong-use-role') body.messages[1].role = 'user';
    if (mode === 'wrong-result-role') body.messages[2].role = 'assistant';
    if (mode === 'result-after-text') body.messages[2].content.reverse();
    if (mode === 'media-result') result(body).content.push({ type: 'image', source: { type: 'url', url: 'https://fixture.invalid' } });
    if (mode === 'server-use') use(body).type = 'server_tool_use';
    if (mode === 'unknown-field') result(body).metadata = {};
    if (mode === 'nonboolean-error') result(body).is_error = 'true';
    if (mode === 'array-input') use(body).input = [];
    if (mode === 'nonfinite-input') use(body).input.value = Infinity;
    if (mode === 'empty-id') use(body).id = '';
    if (mode === 'empty-name') use(body).name = '';
    if (mode === 'cache-1h') result(body).cache_control = { type: 'ephemeral', ttl: '1h' };
    if (mode === 'deep-input') { let next = use(body).input; for (let i = 0; i < 20; i++) next = next.child = {}; }
    if (mode === 'oversize') result(body).content = 'x'.repeat(262144);
    expect(supported(body)).toBe(false);
  });
});
