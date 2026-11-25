import { settleOAuthErrorUsage } from './terminal-cost.js';
import { randomUUID } from 'node:crypto';
import { prepareAccountedDirectPost } from '../../../open-sse/utils/proxyFetch.js';
import { unavailable } from './attempt-payload.js';
import { openaiToOpenAIResponsesRequest } from '../../../open-sse/translator/request/openai-responses.js';
import { codexStandardReferenceKey } from '../pricing/constants.js';
import { responsesTokenUsage } from './responses-usage.js';
import { budgetInstant } from './budget-windows.js';
import { estimateInputTokens } from '../../../open-sse/utils/usageTracking.js';
import { codexAccountId, selectedAccountProxy } from './node-anthropic-account.js';

const endpoint = 'https://chatgpt.com/backend-api/codex/responses';
const fields = new Set(['model', 'input', 'instructions', 'tools', 'tool_choice', 'stream', 'store',
  'reasoning', 'include', 'prompt_cache_key', 'text', 'parallel_tool_calls']);
const itemTypes = new Set(['message', 'reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output']);

const chatFields = new Set(['model', 'messages', 'stream', 'reasoning_effort', 'tools', 'prompt_cache_key', 'stream_options']);
const plainText = content => typeof content === 'string' || (Array.isArray(content) && content.length > 0 &&
  content.every(block => block?.type === 'text' && typeof block.text === 'string' &&
    Object.keys(block).every(key => key === 'type' || key === 'text')));
const functionName = name => typeof name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(name);

function estimateCodexInput(body) {
  if (!Array.isArray(body.input)) return estimateInputTokens(body);
  const input = body.input.map(item => {
    if (item.type !== 'reasoning' || !Object.hasOwn(item, 'encrypted_content')) return item;
    const { encrypted_content, ...visible } = item;
    return visible;
  });
  return estimateInputTokens({ ...body, input });
}

function chatInput(model, body) {
  if (Object.keys(body).some(key => !chatFields.has(key)) ||
      (body.stream !== undefined && typeof body.stream !== 'boolean') ||
      (body.stream_options !== undefined && (body.stream !== true || !body.stream_options ||
        Object.keys(body.stream_options).length !== 1 || typeof body.stream_options.include_usage !== 'boolean')) ||
      !Array.isArray(body.messages) || !body.messages.length) throw unavailable();
  let instructions = false;
  for (const [index, message] of body.messages.entries()) {
    if (!message || !['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role) ||
        Object.keys(message).some(key => !['role', 'content',
          ...(message.role === 'assistant' ? ['tool_calls', 'reasoning_content', 'reasoning_encrypted_content'] : []),
          ...(message.role === 'tool' ? ['tool_call_id'] : [])].includes(key))) throw unavailable();
    if (message.role === 'system' || message.role === 'developer') {
      if (instructions || index !== 0) throw unavailable();
      instructions = true;
    }
    if (message.role === 'tool' && (typeof message.tool_call_id !== 'string' ||
        !message.tool_call_id || message.tool_call_id.length > 64 || typeof message.content !== 'string')) throw unavailable();
    const calls = message.tool_calls;
    if (calls !== undefined && (!Array.isArray(calls) || !calls.length || calls.some(call =>
      call?.type !== 'function' || typeof call.id !== 'string' || !call.id || call.id.length > 64 ||
      !functionName(call.function?.name) || typeof call.function.arguments !== 'string'))) throw unavailable();
    if (!plainText(message.content) && !(calls?.length && message.content == null)) throw unavailable();
    for (const field of ['reasoning_content', 'reasoning_encrypted_content']) {
      if (message[field] !== undefined && typeof message[field] !== 'string') throw unavailable();
    }
  }
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool =>
    tool?.type !== 'function' || !functionName(tool.function?.name)))) throw unavailable();
  return openaiToOpenAIResponsesRequest(model, body, true);
}

function messagesInput(model, body) {
  const only = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj) &&
    Object.keys(obj).every(key => keys.includes(key));
  if (!only(body, ['model', 'messages', 'max_tokens', 'stream', 'system', 'tools']) ||
      !Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1 ||
      (body.stream !== undefined && typeof body.stream !== 'boolean') ||
      !Array.isArray(body.messages) || !body.messages.length) throw unavailable();
  const input = [];
  for (const msg of body.messages) {
    if (!only(msg, ['role', 'content']) || !['user', 'assistant'].includes(msg.role)) throw unavailable();
    const blocks = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content;
    if (!Array.isArray(blocks) || !blocks.length) throw unavailable();
    for (const block of blocks) {
      if (only(block, ['type','text']) && block.type === 'text' && typeof block.text === 'string') {
        input.push({ role: msg.role, content: block.text });
      } else if (msg.role === 'assistant' && only(block, ['type','id','name','input']) &&
          block.type === 'tool_use' && typeof block.id === 'string' && block.id && functionName(block.name) &&
          block.input && typeof block.input === 'object' && !Array.isArray(block.input)) {
        input.push({ type:'function_call', call_id:block.id, name:block.name, arguments:JSON.stringify(block.input) });
      } else if (msg.role === 'user' && only(block, ['type','tool_use_id','content','is_error']) &&
          block.type === 'tool_result' && (block.is_error === undefined || block.is_error === false) &&
          typeof block.tool_use_id === 'string' && block.tool_use_id && typeof block.content === 'string') {
        input.push({ type:'function_call_output', call_id:block.tool_use_id, output:block.content });
      } else throw unavailable();
    }
  }
  const result = { model, input, stream:true };
  if (body.system !== undefined) {
    if (!plainText(body.system)) throw unavailable();
    result.instructions = typeof body.system === 'string' ? body.system : body.system.map(b => b.text).join('\n');
  }
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) throw unavailable();
    result.tools = body.tools.map(tool => {
      if (!only(tool, ['name','description','input_schema']) || !functionName(tool.name) ||
          (tool.description !== undefined && typeof tool.description !== 'string') ||
          tool.input_schema?.type !== 'object') throw unavailable();
      return { type:'function', name:tool.name, description:tool.description, parameters:tool.input_schema };
    });
  }
  return result;
}

export function createCodexDispatchContext({ identity, routeProof, credentials, profile, model = profile.model, endpoint: ingress, clock }) {
  const { connectionId, accessToken, providerSpecificData } = credentials;
  const accountId = codexAccountId(providerSpecificData);
  const priceBasis = codexStandardReferenceKey(model);
  const selectedProxy = selectedAccountProxy(providerSpecificData);
  if (profile.provider !== 'codex' || profile.auth !== 'oauth' || profile.producerAdmitted !== true ||
      profile.connectionId !== connectionId || profile.accountId !== accountId || credentials.authType !== 'oauth' || credentials.apiKey ||
      !priceBasis || !accessToken || !accountId || !routeProof) throw unavailable();
  let validated = false;
  let prepared = false;

  function validate(body) {
    if (!body || Object.keys(body).some(key => !fields.has(key)) || body.stream !== true ||
        (body.store !== undefined && body.store !== false) ||
        (body.include !== undefined && !(Array.isArray(body.include) && body.include.length === 1 &&
          body.include[0] === 'reasoning.encrypted_content')) ||
        !(typeof body.input === 'string' && body.input.trim() || Array.isArray(body.input) && body.input.length &&
          body.input.every(item => item && itemTypes.has(item.type ?? (item.role && 'message')) &&
            (!Array.isArray(item.content) || item.content.every(block =>
              block && ['input_text', 'output_text', 'refusal'].includes(block.type))))) ||
        (body.tools !== undefined && (!Array.isArray(body.tools) ||
          body.tools.some(tool => !tool || !['function', 'custom'].includes(tool.type))))) throw unavailable();
  }

  return Object.freeze({
    provider: 'codex',
    stream: true,
    validateInput(body, chatCompletions = false) {
      if (validated || ![model, `codex/${model}`].includes(body?.model)) throw unavailable();
      const input = ingress === '/v1/messages' ? messagesInput(model, body) : chatCompletions ? chatInput(model, body) : body;
      validate(input);
      validated = true;
      return input;
    },
    async prepare({ url, options, proxyOptions, provider, model: selectedModel, stream }) {
      if (prepared || !validated || provider !== 'codex' || selectedModel !== model || url !== endpoint || stream !== true) throw unavailable();
      prepared = true;
      const body = JSON.parse(options.body);
      validate(body);
      const headers = new Headers(options.headers);
      if (body.model !== model || body.store !== false || headers.get('authorization') !== `Bearer ${accessToken}` ||
          headers.get('chatgpt-account-id') !== accountId || headers.get('content-type') !== 'application/json' ||
          headers.has('x-openai-internal-codex-responses-lite')) throw unavailable();

      const { proof, price } = await identity.bindCodexAccount(routeProof, connectionId, accessToken, accountId, priceBasis, selectedProxy);
      const initiate = await prepareAccountedDirectPost(url, options, proxyOptions, selectedProxy);
      const attempt = identity.prepare({ attemptId: randomUUID(), provider, model, startedAt: budgetInstant(clock), price }, routeProof, proof);
      return Object.freeze({
        dispatch: () => identity.dispatch(attempt.ack, budgetInstant(clock), initiate),
        priceCacheWrites: 'included-in-input',
        inputEstimate: estimateCodexInput(body),
        settleResponses: attempt.settle,
        overloadSuccessor(evidence, receipt) {
          if (!receipt?.recorded || receipt.replay || !evidence) return null;
          const categories = price.usageSemantics?.requiredCategories ?? Object.keys(price.rates);
          return categories.every(category => evidence.components.some(item => item.category === category))
            ? attempt.successorRoute() : null;
        },
        successorRoute: attempt.successorRoute,
        settleAuthError: usage => settleOAuthErrorUsage(attempt, price, responsesTokenUsage(usage, 'included-in-input')),
      });
    },
  });
}
