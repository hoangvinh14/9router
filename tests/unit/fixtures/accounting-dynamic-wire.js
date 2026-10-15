// Owned loopback raw dynamic fixture only. No provider calls or container/file
// reuse; omission here does not certify real provider resource-bearing responses.
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
export const dynamicTools = () => [{ type: 'web_search_20260318', name: 'web_search', response_inclusion: 'full' }];
export function dynamicWire(model, { cacheTiers = false, omit = false, fetch = false, codeCount = 3, searchCount = 2, pause = false, prefix = 'dynamic', resume = false } = {}) {
  const caller = { type: 'code_execution_20260120', tool_id: 'srvtoolu_dynamic_code' };
  const block = (index, value, input = null) => event('content_block_start', { index, content_block: value }) +
    (input === null ? '' : event('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })) + event('content_block_stop', { index });
  const codeResult = id => ({ type: 'code_execution_tool_result', tool_use_id: id, content: { type: 'encrypted_code_execution_result', encrypted_stdout: 'private opaque dynamic stdout', stderr: '', return_code: 0, content: [] } });
  const offset = resume ? 1 : 0;
  const originalBlock = block;
  const shifted = (index, ...args) => originalBlock(index + offset, ...args);
  let raw = event('message_start', { message: { id: 'msg_dynamic_loopback', type: 'message', role: 'assistant', model, content: [], usage: {
    input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
    ...(cacheTiers ? { cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 5 } } : {}),
  } } }) + (resume ? block(0, codeResult('srvtoolu_paused_code')) : '') + shifted(0, { type: 'server_tool_use', id: 'srvtoolu_dynamic_code', name: 'code_execution', input: {} }, { code: 'private dynamic source' }) +
    shifted(1, { type: 'server_tool_use', id: 'srvtoolu_dynamic_search', name: 'web_search', input: {}, caller }, { query: 'private dynamic query' }) +
    shifted(2, { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_dynamic_search', caller, content: [{ type: 'web_search_result', url: 'https://example.com/source', title: 'private dynamic title', encrypted_content: 'private opaque corpus' }] }) +
    (fetch ? shifted(3, { type: 'server_tool_use', id: 'srvtoolu_dynamic_fetch', name: 'web_fetch', input: {}, caller }, { url: 'https://example.com/source' }) +
      shifted(4, { type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_dynamic_fetch', caller, content: { type: 'web_fetch_result', url: 'https://example.com/source', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'private dynamic fetched' }, citations: { enabled: true } } } }) : '') +
    (pause ? '' : shifted(fetch ? 5 : 3, codeResult('srvtoolu_dynamic_code'))) +
    shifted(pause ? (fetch ? 5 : 3) : (fetch ? 6 : 4), { type: 'text', text: 'private answer', citations: [{ type: 'web_search_result_location', url: 'https://example.com/source', title: 'private dynamic title', encrypted_index: 'private opaque index', cited_text: 'private source' }] }) +
    event('message_delta', { delta: { stop_reason: pause ? 'pause_turn' : 'end_turn' }, usage: { input_tokens: 60, output_tokens: 20, server_tool_use: { web_search_requests: searchCount,
      ...(fetch ? { web_fetch_requests: 1 } : {}), ...(omit ? {} : { code_execution_requests: codeCount }) } } }) + event('message_stop');
  raw = raw.replaceAll('srvtoolu_dynamic_', `srvtoolu_${prefix}_`);
  return raw;
}
export function dynamicPausedHistory(model) {
  const content = [], inputs = new Map();
  for (const frame of dynamicWire(model, { pause: true, prefix: 'paused' }).split('\n\n')) {
    const data = frame.split('\n').find(line => line.startsWith('data: ')); if (!data) continue;
    const value = JSON.parse(data.slice(6));
    if (value.type === 'content_block_start') { content.push(value.content_block); inputs.set(value.index, value.content_block); }
    if (value.type === 'content_block_delta' && value.delta.type === 'input_json_delta') inputs.get(value.index).input = JSON.parse(value.delta.partial_json);
  }
  return content;
}
