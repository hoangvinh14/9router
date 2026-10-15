import dns from 'node:dns';
import { describe, it, expect, vi } from 'vitest';
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
  it.each(['image', 'document'])('queued URL %s retains reference bytes without local retrieval; default paths remain closed', type => {
    const block = { type, source: { type: 'url', url: 'https://media.example.invalid/original%20asset?version=1' } };
    if (type === 'document') Object.assign(block, { title: 'URL title', context: 'URL context', citations: { enabled: true } });
    const original = request(block);
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true)).toBe(false);
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true, 'true')).toBe(false);
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
    expect(supportsAnthropicLiveRequest(original, original.model, true, true, true, true, true, true)).toBe(true);
    const prepared = prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy');
    const { cache_control: _cache, ...sent } = prepared.messages[0].content[0]; expect(sent).toEqual(block);
    expect(original.messages[0].content[0]).toEqual(block);
  });
  it.each(['file:///etc/passwd', 'data:image/png;base64,YQ==', 'ftp://public.example.invalid/x', 'https://user:pass@public.example.invalid/x', 'http://localhost./x', 'http://2130706433/x', 'http://[::ffff:7f00:1]/x', 'http://169.254.169.254/x', 'https://public.example.invalid/x#hidden', ' https://public.example.invalid/x', 'https://public.example.invalid/\\nsecret', 'https://public.example.invalid/\nsecret', 'https:public.example.invalid/path', 'https:///public.example.invalid/path', 'https://@public.example.invalid/path'])('rejects unsafe/ambiguous original URL %s before transform', url => {
    expect(supportsClaudeOauthOriginal(request({ type: 'image', source: { type: 'url', url } }), 'fixture-model')).toBe(false);
  });
  it('URL authority validation and production prepare never perform local fetch or DNS lookup', () => {
    const fetched = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('unexpected local media fetch'); });
    const lookup = vi.spyOn(dns, 'lookup').mockImplementation(() => { throw new Error('unexpected local DNS'); });
    const asyncLookup = vi.spyOn(dns.promises, 'lookup').mockImplementation(() => { throw new Error('unexpected async DNS'); });
    try {
      const original = request({ type: 'image', source: { type: 'url', url: 'https://media.example.invalid/source.png' } });
      expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
      expect(prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy').messages[0].content[0].source).toEqual(original.messages[0].content[0].source);
      expect(fetched).not.toHaveBeenCalled(); expect(lookup).not.toHaveBeenCalled(); expect(asyncLookup).not.toHaveBeenCalled();
    } finally { fetched.mockRestore(); lookup.mockRestore(); asyncLookup.mockRestore(); }
  });
  it.each(['extra-source', 'extra-block', 'assistant', 'getter', 'toJSON', 'char-citation'])('URL original %s cannot acquire support through normalization', mode => {
    const original = request({ type: 'document', source: { type: 'url', url: 'https://media.example.invalid/document.pdf' }, citations: { enabled: true } });
    const block = original.messages[0].content[0]; let invoked = 0;
    if (mode === 'extra-source') block.source.media_type = 'application/pdf';
    if (mode === 'extra-block') block.hidden = true;
    if (mode === 'assistant') original.messages[0].role = 'assistant';
    if (mode === 'getter') Object.defineProperty(block.source, 'url', { enumerable: true, get() { invoked++; return 'https://media.example.invalid/document.pdf'; } });
    if (mode === 'toJSON') block.source.toJSON = () => { invoked++; return {}; };
    if (mode === 'char-citation') original.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'answer', citations: [{ type: 'char_location', document_index: 0, document_title: null, cited_text: 'text', start_char_index: 0, end_char_index: 4 }] }] });
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(false); expect(invoked).toBe(0);
  });
  it('URL tool-result and custom child image preserve error/source with explicit queued opt-in only', () => {
    const media = { type: 'image', source: { type: 'url', url: 'https://media.example.invalid/error.png' } };
    const original = request(media); original.messages = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'use', name: 'lookup', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'use', is_error: true, content: [media] }] }];
    original.tools = [{ name: 'lookup', input_schema: { type: 'object' } }];
    expect(supportsClaudeOauthOriginal(original, original.model)).toBe(true);
    expect(prepareAccountingClaudeOauthBody(original, 'sk-ant-oat-dummy').messages[1].content[0]).toMatchObject(original.messages[1].content[0]);
    const custom = request({ type: 'document', source: { type: 'content', content: [media] } });
    expect(supportsClaudeOauthOriginal(custom, original.model)).toBe(true);
    expect(supportsAnthropicLiveRequest(custom, original.model, true, true, true, true, true)).toBe(false);
    expect(prepareAccountingClaudeOauthBody(custom, 'sk-ant-oat-dummy').messages[0].content[0].source).toEqual(custom.messages[0].content[0].source);
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
  it.each(['url', 'file-id', 'svg', 'bad-base64', 'empty', 'extra-source', 'unknown-citation-config', 'extra-block', 'wrong-role', 'nested-document'])('refuses unsupported original %s before transform', mode => {
    const original = request(image()), block = original.messages[0].content[0];
    if (mode === 'url') block.source = { type: 'url', url: 'http://127.0.0.1/private' };
    if (mode === 'file-id') block.source = { type: 'file', file_id: 'fixture' };
    if (mode === 'svg') block.source.media_type = 'image/svg+xml';
    if (mode === 'bad-base64') block.source.data = 'not base64!';
    if (mode === 'empty') block.source.data = '';
    if (mode === 'extra-source') block.source.hidden = true;
    if (mode === 'unknown-citation-config') { original.messages[0].content[0] = document(); original.messages[0].content[0].citations = { enabled: true, hidden: true }; }
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
