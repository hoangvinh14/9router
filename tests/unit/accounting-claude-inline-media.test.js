import { describe, it, expect } from 'vitest';
import { supportsClaudeOauthOriginal, prepareAccountingClaudeOauthBody, validateAccountingClaudeOauthDispatch } from 'open-sse/config/accountedClaudeOauth.js';
import { supportsAnthropicLiveRequest } from 'open-sse/config/accountedAnthropicCandidate.js';
const image = () => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW5saW5l' } });
const document = () => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'aW5saW5l' }, title: 'fixture', context: 'original context' });
const request = block => ({ model: 'fixture-model', stream: true, max_tokens: 100, messages: [{ role: 'user', content: [block] }] });
describe('queued OAuth original inline media authority, not URL retrieval/citations/server tool approval', () => {
  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain'])('retains original %s source through production transform while default app remains closed', type => {
    const block = type.startsWith('image/') ? image() : document(); block.source.media_type = type;
    if (type === 'text/plain') block.source = { type: 'text', media_type: type, data: 'original🙂 document' };
    const original = request(block); expect(supportsAnthropicLiveRequest(original, original.model, true, true)).toBe(false);
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
    const prepared = prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy');
    expect(prepared.messages[0].content[0].source).toEqual(block.source);
    if (block.title) { expect(prepared.messages[0].content[0].title).toBe(block.title); expect(prepared.messages[0].content[0].context).toBe(block.context); }
    expect(original.messages[0].content[0].cache_control).toBeUndefined();
  });
  it('keeps image inside tool_result rather than hoisting or discarding original error semantics', () => {
    const original = request(image()); original.messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'use', name: 'lookup', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'use', is_error: true, content: [{ type: 'text', text: 'original error' }, image()] }] },
    ]; original.tools = [{ name: 'lookup', input_schema: { type: 'object' } }];
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
    const prepared = prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy');
    expect(prepared.messages[1].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'use', is_error: true, content: original.messages[1].content[0].content });
    expect(prepared.messages[1].content).toHaveLength(1);
  });
  it.each(['url', 'file-id', 'svg', 'bad-base64', 'empty', 'extra-source', 'citations', 'extra-block', 'wrong-role', 'nested-document'])('refuses unsupported original %s before transform', mode => {
    const original = request(image()), block = original.messages[0].content[0];
    if (mode === 'url') block.source = { type: 'url', url: 'http://127.0.0.1/private' };
    if (mode === 'file-id') block.source = { type: 'file', file_id: 'fixture' };
    if (mode === 'svg') block.source.media_type = 'image/svg+xml';
    if (mode === 'bad-base64') block.source.data = 'not base64!';
    if (mode === 'empty') block.source.data = '';
    if (mode === 'extra-source') block.source.hidden = true;
    if (mode === 'citations') { original.messages[0].content[0] = document(); original.messages[0].content[0].citations = { enabled: true }; }
    if (mode === 'extra-block') block.hidden = true;
    if (mode === 'wrong-role') original.messages[0].role = 'assistant';
    if (mode === 'nested-document') { original.messages = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'use', name: 'lookup', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'use', content: [document()] }] }]; }
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false);
  });
  it('bounded canonical large base64 avoids recursion and oversize capture remains refused', () => {
    const original = request(image()); original.messages[0].content[0].source.data = 'YQ=='.repeat(1);
    original.messages[0].content[0].source.data = Buffer.alloc(30000, 1).toString('base64');
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
    expect(prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy').messages[0].content[0].source.data).toBe(original.messages[0].content[0].source.data);
    original.messages[0].content[0].source.data = Buffer.alloc(210000, 1).toString('base64');
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false);
  });
  it('programmable source is refused without reading getters or toJSON', () => {
    for (const mode of ['getter', 'toJSON']) {
      const original = request(image()); let invoked = 0;
      if (mode === 'getter') Object.defineProperty(original.messages[0].content[0].source, 'data', { enumerable: true, get() { invoked++; return 'aW5saW5l'; } });
      else original.messages[0].content[0].source.toJSON = () => { invoked++; return image().source; };
      expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false); expect(invoked).toBe(0);
    }
  });
  it('dispatch validator remains required independently of media-shaped input', () => {
    expect(() => validateAccountingClaudeOauthDispatch({ model: 'fixture-model' }, 'https://api.anthropic.com/v1/messages?beta=true')).toThrow();
  });
});
