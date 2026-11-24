import { snapshotPayload, unavailable } from './attempt-payload.js';
import { claudeToolStore } from './claude-tool-continuity.js';

const only = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k));
function requireShape(ok) { if (!ok) throw unavailable(); }
function call(id, name, args) {
  requireShape(typeof id === 'string' && id && typeof name === 'string' && name && typeof args === 'string');
  const input = JSON.parse(args);
  requireShape(input && typeof input === 'object' && !Array.isArray(input));
  return { id, name, input };
}
function functionTool(tool, responses) {
  requireShape(tool?.type === 'function');
  const fn = responses ? tool : tool.function;
  requireShape((responses || only(tool, ['type', 'function'])) &&
    only(fn, [...(responses ? ['type'] : []), 'name', 'description', 'parameters', 'strict']));
  return { name: fn.name, input_schema: fn.parameters ?? { type: 'object' },
    ...Object.fromEntries(['description', 'strict'].filter(k => Object.hasOwn(fn, k)).map(k => [k, fn[k]])) };
}

export function convertClaudeBudgetRequest(body, endpoint, scope, store = claudeToolStore) {
  const value = snapshotPayload(body);
  const responses = endpoint === '/v1/responses';
  const budgetTokens = responses ? 'max_output_tokens' : 'max_tokens';
  const history = responses ? 'input' : 'messages';
  requireShape(only(value, [history, 'model', 'tools', 'stream', budgetTokens, 'temperature', 'top_p',
    ...(responses ? ['instructions', 'reasoning'] : ['stream_options', 'max_completion_tokens', 'reasoning_effort'])]));
  requireShape(value.stream === undefined || typeof value.stream === 'boolean');
  if (value.stream_options !== undefined) requireShape(only(value.stream_options, ['include_usage']) &&
    typeof value.stream_options.include_usage === 'boolean');
  requireShape(value.max_completion_tokens === undefined || value.max_tokens === undefined);
  const native = { model: value.model, stream: true, service_tier: 'standard_only',
    max_tokens: value[budgetTokens] ?? value.max_completion_tokens ?? 4096, messages: [] };
  if (value.reasoning !== undefined || value.reasoning_effort !== undefined) {
    const reasoning = responses ? value.reasoning : { effort: value.reasoning_effort, summary: 'auto' };
    requireShape(only(reasoning, ['effort','summary']) && ['low','medium','high'].includes(reasoning.effort) &&
      (reasoning.summary === undefined || ['auto','concise','detailed'].includes(reasoning.summary)));
    native.thinking = { type: 'adaptive', ...(reasoning.summary ? { display: 'summarized' } : {}) };
    native.output_config = { effort: reasoning.effort };
  }
  if (value.tools !== undefined) native.tools = value.tools.map(t => functionTool(t, responses));
  for (const key of ['temperature', 'top_p']) if (Object.hasOwn(value, key)) native[key] = value[key];
  if (value.instructions !== undefined) {
    requireShape(typeof value.instructions === 'string');
    native.system = value.instructions;
  }
  const items = responses && typeof value.input === 'string' ? [{ role: 'user', content: value.input }] : value[history];
  requireShape(Array.isArray(items) && items.length);
  const seen = new Set();
  let pending = new Set();
  let calls = [];
  let resultMessage;
  let visible = [];
  function restore() {
    requireShape(!pending.size);
    const blocks = store.restore(scope, calls);
    if (visible.length) {
      const expected = blocks.filter(b => ['text', 'thinking'].includes(b.type))
        .map(b => ({ type: b.type, text: b.type === 'text' ? b.text : b.thinking }));
      requireShape(JSON.stringify(expected) === JSON.stringify(visible));
      visible = [];
    }
    pending = new Set(calls.map(c => c.id));
    for (const id of pending) { requireShape(!seen.has(id)); seen.add(id); }
    native.messages.push({ role: 'assistant', content: blocks });
    resultMessage = { role: 'user', content: [] };
    native.messages.push(resultMessage);
    calls = [];
    return blocks;
  }
  for (const item of items) {
    if (responses && (item.type === 'reasoning' || item.type === 'message' && item.role === 'assistant' && item.id)) {
      const reasoning = item.type === 'reasoning';
      requireShape(only(item, reasoning ? ['type', 'id', 'summary'] : ['type', 'id', 'role', 'content', 'status']) && !pending.size);
      const pieces = reasoning ? item.summary : item.content;
      requireShape(Array.isArray(pieces) && pieces.length === 1);
      const [piece] = pieces;
      requireShape(only(piece, reasoning ? ['type','text'] : ['type','text','annotations']) &&
        piece.type === (reasoning ? 'summary_text' : 'output_text') && typeof piece.text === 'string' &&
        (piece.annotations === undefined || Array.isArray(piece.annotations) && !piece.annotations.length));
      requireShape(item.status === undefined || item.status === 'completed');
      visible.push({ type: reasoning ? 'thinking' : 'text', text: piece.text });
      continue;
    }
    if (responses && item.type === 'function_call') {
      requireShape(only(item, ['type', 'id', 'call_id', 'name', 'arguments', 'status']) &&
        (item.id === undefined || item.id === 'fc_' + item.call_id) &&
        (item.status === undefined || item.status === 'completed'));
      calls.push(call(item.call_id, item.name, item.arguments));
      continue;
    }
    if (calls.length) restore();
    if (visible.length) {
      requireShape(visible.every(b => b.type === 'text'));
      native.messages.push({ role: 'assistant', content: visible });
      visible = [];
    }
    if ((responses && item.type === 'function_call_output') || (!responses && item.role === 'tool')) {
      const id = responses ? item.call_id : item.tool_call_id;
      const content = responses ? item.output : item.content;
      requireShape(only(item, [...(responses ? ['type', 'call_id', 'output'] : ['role', 'tool_call_id', 'content']), 'is_error', 'status']) &&
        typeof content === 'string' && pending.delete(id) &&
        (item.is_error === undefined || typeof item.is_error === 'boolean') &&
        (item.status === undefined || ['error','completed'].includes(item.status)) &&
        !(item.status === 'error' && item.is_error === false));
      resultMessage.content.push({ type: 'tool_result', tool_use_id: id, content,
        ...(item.is_error !== undefined || item.status === 'error' ? { is_error: item.is_error ?? true } : {}) });
      continue;
    }
    requireShape(!pending.size);
    if (!responses && item.role === 'assistant' && item.tool_calls) {
      requireShape(only(item, ['role', 'content', 'reasoning_content', 'tool_calls']));
      calls = item.tool_calls.map(t => {
        requireShape(only(t, ['type', 'id', 'function']) && t.type === 'function' && only(t.function, ['name', 'arguments']));
        return call(t.id, t.function.name, t.function.arguments);
      });
      const blocks = restore();
      requireShape((item.content ?? '') === blocks.filter(b => b.type === 'text').map(b => b.text).join('') &&
        (item.reasoning_content === undefined || item.reasoning_content === blocks.filter(b => b.type === 'thinking').map(b => b.thinking).join('')));
      continue;
    }
    requireShape(only(item, ['role', 'content', ...(responses ? ['type'] : [])]) &&
      (!responses || item.type === undefined || item.type === 'message'));
    let content = item.content;
    if (Array.isArray(content)) {
      requireShape(content.every(b => only(b, ['type', 'text']) && b.type === (responses ? 'input_text' : 'text') && typeof b.text === 'string'));
      content = content.map(b => ({ type: 'text', text: b.text }));
    }
    requireShape(typeof content === 'string' || Array.isArray(content));
    if (item.role === 'system' || item.role === 'developer') {
      requireShape(typeof content === 'string' && !native.messages.length && native.system === undefined);
      native.system = content;
    } else {
      requireShape(['assistant', 'user'].includes(item.role));
      native.messages.push({ role: item.role, content });
    }
  }
  requireShape(!calls.length && !pending.size && !visible.length);
  return native;
}
