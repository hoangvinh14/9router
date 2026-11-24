import { toOpenAIUsage } from '../translator/concerns/usage.js';
import { toOpenAIFinish } from '../translator/concerns/finishReason.js';

function check(ok) { if (!ok) throw new Error('Invalid Claude content stream'); }
const frame = value => 'data: ' + JSON.stringify(value) + '\n\n';

function visibleItem(block, messageId, index) {
  if (block.type === 'tool_use') return { type: 'function_call', call_id: block.id, id: 'fc_' + block.id,
    name: block.name, arguments: '', status: 'in_progress' };
  if (block.type === 'text') return { type: 'message', id: 'msg_' + messageId + '_' + index,
    role: 'assistant', status: 'in_progress', content: [] };
  if (block.type === 'thinking') return { type: 'reasoning', id: 'rs_' + messageId + '_' + index, summary: [] };
  check(block.type === 'redacted_thinking');
  return null;
}

// The native meter supplies already-parsed frames and awaits settlement before
// message_stop. Signatures and redacted blocks stay in process memory.
export function createClaudeBudgetOutput({ endpoint, model, includeUsage, rememberTools }) {
  const responses = endpoint === '/v1/responses';
  const blocks = [], output = [], created = Math.floor(Date.now() / 1000);
  let id, current, args, item, callIndex = -1, size = 0, seq = 0, usage = {}, finish, json;
  const chat = (delta, finish_reason = null) => ({ id: 'chatcmpl-' + id, object: 'chat.completion.chunk', model,
    created, choices: [{ index: 0, delta, finish_reason }], ...(includeUsage ? { usage: null } : {}) });
  const response = status => ({ id: 'resp_' + id, object: 'response', model, created_at: created, status, output: [...output] });
  const event = (type, fields) => 'event: ' + type + '\n' + frame({ type, sequence_number: seq++, ...fields });

  function itemPart(text) {
    return item.type === 'reasoning' ? { type: 'summary_text', text } : { type: 'output_text', text, annotations: [] };
  }
  function partFields() {
    return { item_id: item.id, output_index: output.length, [item.type === 'reasoning' ? 'summary_index' : 'content_index']: 0 };
  }
  function partEvent() { return item.type === 'reasoning' ? 'response.reasoning_summary_part' : 'response.content_part'; }
  function textEvent() { return item.type === 'reasoning' ? 'response.reasoning_summary_text' : 'response.output_text'; }
  function emitDelta(text) {
    if (!text) return '';
    if (item.type === 'function_call') {
      if (responses) return event('response.function_call_arguments.delta', { item_id: item.id, output_index: output.length, delta: text });
      return frame(chat({ tool_calls: [{ index: callIndex, function: { arguments: text } }] }));
    }
    if (responses) return event(textEvent() + '.delta', { ...partFields(), delta: text });
    return frame(chat({ [item.type === 'reasoning' ? 'reasoning_content' : 'content']: text }));
  }
  function start(block) {
    current = structuredClone(block);
    item = visibleItem(current, id, blocks.length);
    args = '';
    if (!item) return '';
    if (item.type === 'function_call') {
      check(typeof item.call_id === 'string' && item.call_id && typeof item.name === 'string' && item.name);
      callIndex++;
      if (!responses) return frame(chat({ tool_calls: [{ index: callIndex, id: item.call_id, type: 'function', function: { name: item.name, arguments: '' } }] }));
    }
    const added = responses ? event('response.output_item.added', { output_index: output.length, item }) : '';
    if (item.type === 'function_call') return added;
    const initial = current.type === 'text' ? current.text : current.thinking;
    check(typeof initial === 'string');
    return added + (responses ? event(partEvent() + '.added', { ...partFields(), part: itemPart('') }) : '') + emitDelta(initial);
  }
  function delta(d) {
    const prop = { thinking_delta: ['thinking','thinking'], signature_delta: ['thinking','signature'],
      text_delta: ['text','text'], input_json_delta: ['tool_use','partial_json'] }[d.type];
    check(prop && current.type === prop[0] && typeof d[prop[1]] === 'string');
    const fragment = d[prop[1]];
    if (d.type === 'input_json_delta') args += fragment;
    else current[prop[1]] = (current[prop[1]] ?? '') + fragment;
    return d.type === 'signature_delta' ? '' : emitDelta(fragment);
  }
  function close() {
    let emitted = '';
    if (current.type === 'tool_use') {
      if (args) current.input = JSON.parse(args);
      check(current.input && typeof current.input === 'object' && !Array.isArray(current.input));
      item.arguments = args || JSON.stringify(current.input);
      if (!args) emitted += emitDelta(item.arguments);
      item.status = 'completed';
      if (responses) emitted += event('response.function_call_arguments.done', { item_id: item.id, output_index: output.length, arguments: item.arguments });
    } else if (current.type === 'redacted_thinking') {
      check(typeof current.data === 'string' && current.data);
    } else {
      const thought = current.type === 'thinking';
      if (thought) check(typeof current.signature === 'string' && current.signature);
      const text = thought ? current.thinking : current.text;
      const part = itemPart(text);
      if (thought) item.summary = [part];
      else { item.status = 'completed'; item.content = [part]; }
      if (responses) emitted += event(textEvent() + '.done', { ...partFields(), text }) + event(partEvent() + '.done', { ...partFields(), part });
    }
    if (item) {
      if (responses) emitted += event('response.output_item.done', { output_index: output.length, item });
      output.push(item);
    }
    blocks.push(current);
    current = null;
    return emitted;
  }
  function complete() {
    check(!current && finish);
    rememberTools(blocks);
    const totals = toOpenAIUsage(usage, 'claude');
    if (responses) {
      const incomplete = finish === 'max_tokens';
      json = { ...response(incomplete ? 'incomplete' : 'completed'), usage: { input_tokens: totals.prompt_tokens,
        output_tokens: totals.completion_tokens, total_tokens: totals.total_tokens },
        ...(incomplete ? { incomplete_details: { reason: 'max_output_tokens' } } : {}) };
      return event('response.' + json.status, { response: json });
    }
    const reason = toOpenAIFinish(finish, 'claude');
    const message = { role: 'assistant', content: blocks.filter(b => b.type === 'text').map(b => b.text).join('') || null };
    const thinking = blocks.filter(b => b.type === 'thinking').map(b => b.thinking).join('');
    if (thinking) message.reasoning_content = thinking;
    const tools = output.filter(i => i.type === 'function_call');
    if (tools.length) message.tool_calls = tools.map(i => ({ id: i.call_id, type: 'function', function: { name: i.name, arguments: i.arguments } }));
    json = { id: 'chatcmpl-' + id, object: 'chat.completion', created, model, choices: [{ index: 0, message, finish_reason: reason }], usage: totals };
    const final = chat({}, reason);
    return frame(final) + (includeUsage ? frame({ ...final, choices: [], usage: totals }) : '') + 'data: [DONE]\n\n';
  }
  return {
    render(e) {
      if (e.type === 'error') return responses ? event('error', { message: 'Claude response failed', code: 'upstream_error' }) :
        frame({ error: { message: 'Claude response failed', type: 'upstream_error' } }) + 'data: [DONE]\n\n';
      if (e.type === 'ping') return '';
      size += Buffer.byteLength(JSON.stringify(e));
      check(size <= 2 * 1024 * 1024);
      if (e.type === 'message_start') {
        check(!id && typeof e.message?.id === 'string' && e.message.id);
        id = e.message.id;
        usage = { ...e.message.usage };
        return responses ? event('response.created', { response: response('in_progress') }) : frame(chat({ role: 'assistant' }));
      }
      check(id);
      if (e.type === 'content_block_start') {
        check(!current && e.index === blocks.length && e.index < 100);
        return start(e.content_block);
      }
      if (e.type === 'content_block_delta' || e.type === 'content_block_stop') {
        check(current && e.index === blocks.length);
        return e.type === 'content_block_delta' ? delta(e.delta) : close();
      }
      if (e.type === 'message_delta') {
        check(!current);
        usage = { ...usage, ...e.usage };
        finish = e.delta?.stop_reason;
        return '';
      }
      check(e.type === 'message_stop');
      return complete();
    },
    result() { check(json); return json; },
  };
}
