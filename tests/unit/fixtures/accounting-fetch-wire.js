// Owned HTTP test payload only. No provider calls or production rate values.
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
export const fetchTool = () => ({ type: 'web_fetch_20250910', name: 'web_fetch', citations: { enabled: true }, max_uses: 3 });
export function fetchHistory(id = 'srvtoolu_fetch_fixture') {
  return [{ type: 'server_tool_use', id, name: 'web_fetch', input: { url: 'https://example.com/article' } },
    { type: 'web_fetch_tool_result', tool_use_id: id, content: { type: 'web_fetch_result', url: 'https://example.com/article', retrieved_at: '2026-10-03T00:00:00Z', content: {
      type: 'document', title: 'private fetch title', source: { type: 'text', media_type: 'text/plain', data: 'private fetched corpus' }, citations: { enabled: true },
    } } }];
}
export function fetchWire(model, { omit = false, cacheTiers = false, search = false, count = 3, stop = 'end_turn', error = false, id = 'srvtoolu_fetch_fixture', documentIndex = 0 } = {}) {
  const history = fetchHistory(id);
  const citation = { type: 'char_location', document_index: documentIndex, document_title: 'private fetch title', cited_text: 'private', start_char_index: 0, end_char_index: 7 };
  return event('message_start', { message: { id: 'msg_fetch_fixture', type: 'message', role: 'assistant', model, content: [], usage: {
    input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
    ...(cacheTiers ? { cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 5 } } : {}),
  } } }) + event('content_block_start', { index: 0, content_block: { ...history[0], input: {} } }) +
    event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"url":"https://example.com/article"}' } }) + event('content_block_stop', { index: 0 }) +
    (stop === 'pause_turn' ? '' : event('content_block_start', { index: 1, content_block: error ? { ...history[1], content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } } : history[1] }) + event('content_block_stop', { index: 1 })) +
    (stop === 'pause_turn' || error ? '' : event('content_block_start', { index: 2, content_block: { type: 'text', text: '', citations: [] } }) + event('content_block_delta', { index: 2, delta: { type: 'text_delta', text: 'private answer' } }) +
      event('content_block_delta', { index: 2, delta: { type: 'citations_delta', citation } }) + event('content_block_stop', { index: 2 })) +
    event('message_delta', { delta: { stop_reason: stop }, usage: { input_tokens: 60, output_tokens: 20,
      ...(omit && !search ? {} : { server_tool_use: { ...(omit ? {} : { web_fetch_requests: count }), ...(search ? { web_search_requests: 2 } : {}) } }) } }) + event('message_stop');
}
