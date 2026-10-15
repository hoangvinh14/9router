import { describe, expect, it, vi } from 'vitest';
import { supportsClaudeDynamicOriginal } from 'open-sse/config/accountingClaudeDynamicOriginal.js';
import { supportsAnthropicLiveRequest } from 'open-sse/config/accountedAnthropicCandidate.js';
const tools = () => [{ type: 'web_search_20260318', name: 'web_search' }, { type: 'web_fetch_20260318', name: 'web_fetch', citations: { enabled: true } }];
const body = () => ({ model: 'fixture-dynamic', stream: true, max_tokens: 100, tools: tools(), messages: [{ role: 'user', content: 'Read https://example.com/source' }] });
const parent = () => ({ type: 'server_tool_use', id: 'srvtoolu_parent', name: 'code_execution', input: { code: 'private code' } });
const child = () => ({ type: 'server_tool_use', id: 'srvtoolu_child', name: 'web_search', input: { query: 'private query' }, caller: { type: 'code_execution_20260120', tool_id: 'srvtoolu_parent' } });
const searchResult = () => ({ type: 'web_search_tool_result', tool_use_id: 'srvtoolu_child', caller: child().caller, content: [{ type: 'web_search_result', url: 'https://example.com/source', title: 'source', encrypted_content: 'opaque' }] });
const codeResult = () => ({ type: 'code_execution_tool_result', tool_use_id: 'srvtoolu_parent', content: { type: 'code_execution_result', stdout: 'private result', stderr: '', return_code: 0, content: [] } });
const supported = value => supportsClaudeDynamicOriginal(value, 'fixture-dynamic');
describe('isolated original dynamic regime/graph/full block schemas, not provider/resource admission', () => {
  it('original later web implicit/explicit code definitions preserve full request and defaults remain closed', () => {
    const value = body(); expect(supported(value)).toBe(true); expect(supportsAnthropicLiveRequest(value, value.model, true, true, true, true, true, true, true, true, true)).toBe(false);
    value.tools.push({ type: 'code_execution_20260521', name: 'code_execution' }); expect(supported(value)).toBe(true);
    const original = structuredClone(value); expect(supported(value)).toBe(true); expect(value).toEqual(original);
  });
  it('complete parent/child search result history and source citation retain ordered original authority', () => {
    const value = body(); value.messages.push({ role: 'assistant', content: [parent(), child(), searchResult(), codeResult(), { type: 'text', text: 'answer', citations: [{ type: 'web_search_result_location', url: 'https://example.com/source', title: 'source', cited_text: 'text', encrypted_index: 'opaque index' }] }] }, { role: 'user', content: 'continue' });
    expect(supported(value)).toBe(true);
    value.messages[1].content[2].caller.tool_id = 'srvtoolu_foreign'; expect(supported(value)).toBe(false);
  });
  it('original fetched document adds citation index only after paired nested result', () => {
    const value = body(), fetchCall = { ...child(), name: 'web_fetch', input: { url: 'https://example.com/source' } };
    const fetched = { type: 'web_fetch_tool_result', tool_use_id: fetchCall.id, caller: fetchCall.caller, content: { type: 'web_fetch_result', url: 'https://example.com/source', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'private fetched' }, citations: { enabled: true } } } };
    const text = { type: 'text', text: 'answer', citations: [{ type: 'char_location', document_index: 0, document_title: null, cited_text: 'private', start_char_index: 0, end_char_index: 7 }] };
    value.messages.push({ role: 'assistant', content: [parent(), fetchCall, fetched, codeResult(), text] }, { role: 'user', content: 'continue' }); expect(supported(value)).toBe(true);
    value.messages[1].content = [parent(), fetchCall, text, fetched, codeResult()]; expect(supported(value)).toBe(false);
  });
  it('pending pause history remains original without fabricated results; suppressed pairs cannot create source authority', () => {
    const value = body(); value.messages.push({ role: 'assistant', content: [parent()] }); expect(supported(value)).toBe(true);
    const suppressed = body(); suppressed.tools[0].response_inclusion = 'excluded'; suppressed.messages.push({ role: 'assistant', content: [parent(), codeResult()] }, { role: 'user', content: 'continue' }); expect(supported(suppressed)).toBe(true);
    suppressed.messages[1].content.push({ type: 'text', text: 'answer', citations: [{ type: 'web_search_result_location', url: 'https://example.com/hidden', title: 'hidden', cited_text: '', encrypted_index: 'opaque' }] }); expect(supported(suppressed)).toBe(false);
  });
  it('standalone duration/container/file/unknown-schema input remains unavailable rather than erased', () => {
    const standalone = body(); standalone.tools = [{ type: 'code_execution_20260120', name: 'code_execution' }]; expect(supported(standalone)).toBe(false);
    for (const value of [{ ...body(), container: 'container_foreign' }, { ...body(), arbitrary: true }, { ...body(), model: 'foreign' }]) expect(supported(value)).toBe(false);
    const files = body(); const output = codeResult(); output.content.content = [{ type: 'code_execution_output', file_id: 'file_foreign' }]; files.messages.push({ role: 'assistant', content: [parent(), output] }); expect(supported(files)).toBe(false);
  });
  it('full original code/result schema cannot be erased by local validation projections', () => {
    const value = body(); const call = parent(), output = codeResult();
    value.messages.push({ role: 'assistant', content: [call, output] }); expect(supported(value)).toBe(true);
    call.input = { code: 'private', unknown: 'do not strip' }; expect(supported(value)).toBe(false);
    call.input = { code: 'private' }; output.content.return_code = 0.5; expect(supported(value)).toBe(false);
    output.content.return_code = 0; value.tools.push({ type: 'code_execution_20260521', name: 'code_execution', cache_control: { type: 'ephemeral', ttl: '1h' } });
    expect(supported(value)).toBe(true); value.tools.at(-1).cache_control.ttl = 'unknown'; expect(supported(value)).toBe(false);
  });
  it('client history retains matching original schemas; PTC/container/forced calls cannot sneak through base projection', () => {
    const value = body(); value.tools.push({ name: 'lookup', input_schema: { type: 'object' } });
    value.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_client', name: 'lookup', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_client', content: 'result' }] });
    expect(supported(value)).toBe(true); value.messages[1].content[0].caller = { type: 'code_execution_20260120', tool_id: 'srvtoolu_parent' }; expect(supported(value)).toBe(false);
    delete value.messages[1].content[0].caller; value.tool_choice = { type: 'tool', name: 'lookup' }; expect(supported(value)).toBe(false);
    value.tool_choice = { type: 'auto', disable_parallel_tool_use: true }; expect(supported(value)).toBe(false);
    delete value.tool_choice; value.messages[1].content[0].id = 'srvtoolu_parent'; expect(supported(value)).toBe(false);
  });
  it('programmable/oversize original and malformed pending associations refuse before source access', () => {
    const getter = vi.fn(), trapped = vi.fn(); expect(supported(Object.defineProperty(body(), 'tools', { enumerable: true, get: getter }))).toBe(false);
    expect(supported(new Proxy(body(), { ownKeys: trapped }))).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(trapped).not.toHaveBeenCalled();
    const huge = body(); huge.messages[0].content = 'x'.repeat(262145); expect(supported(huge)).toBe(false);
    const wrong = body(); wrong.messages.push({ role: 'assistant', content: [child()] }); expect(supported(wrong)).toBe(false);
  });
});
