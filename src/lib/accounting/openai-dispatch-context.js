import { randomUUID } from 'node:crypto';
import { prepareAccountedDirectPost } from '../../../open-sse/utils/proxyFetch.js';
import { unavailable } from './attempt-payload.js';
import { budgetInstant } from './budget-windows.js';
import { directAccountData } from './node-anthropic-account.js';
import { openAIStandardUsage } from './responses-usage.js';

const allowed = new Set(['model', 'messages', 'tools', 'tool_choice', 'parallel_tool_calls', 'stream',
  'stream_options', 'service_tier', 'reasoning_effort', 'temperature', 'top_p', 'max_completion_tokens',
  'max_tokens', 'stop', 'seed', 'frequency_penalty', 'presence_penalty', 'response_format', 'prompt_cache_key']);
const responsesFields = new Set(['model', 'input', 'instructions', 'stream', 'service_tier', 'tools', 'tool_choice',
  'parallel_tool_calls', 'reasoning', 'include', 'text', 'max_output_tokens', 'store', 'prompt_cache_key']);
function validateResponses(body) {
  const textBlock = b => b && ['input_text', 'output_text', 'refusal'].includes(b.type) &&
    !Object.hasOwn(b, 'prompt_cache_breakpoint');
  if (!body || Object.keys(body).some(k => !responsesFields.has(k)) ||
      (body.stream !== undefined && typeof body.stream !== 'boolean') ||
      (body.service_tier !== undefined && body.service_tier !== 'default') ||
      !(typeof body.input === 'string' || (Array.isArray(body.input) && body.input.length && body.input.every(item =>
        item && !Object.hasOwn(item, 'prompt_cache_breakpoint') &&
        (['reasoning', 'function_call', 'function_call_output'].includes(item.type)
          ? item.type !== 'function_call_output' || typeof item.output === 'string'
          : (item.type === 'message' || (!item.type && item.role)) &&
            (typeof item.content === 'string' || (Array.isArray(item.content) && item.content.every(textBlock))))))) ||
      (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(t => t?.type !== 'function'))) ||
      (body.tool_choice && typeof body.tool_choice === 'object' && body.tool_choice.type !== 'function')) throw unavailable();
}

function validate(body) {
  if (!body || Object.keys(body).some(k => !allowed.has(k)) ||
      (body.service_tier !== undefined && body.service_tier !== 'default') ||
      (body.stream !== undefined && typeof body.stream !== 'boolean') ||
      (body.stream_options !== undefined && (body.stream !== true || !body.stream_options ||
        typeof body.stream_options.include_usage !== 'boolean' || Object.keys(body.stream_options).length !== 1)) ||
      !Array.isArray(body.messages) || !body.messages.length || body.messages.some(m =>
        !m || !['system', 'developer', 'user', 'assistant', 'tool'].includes(m.role) ||
        Object.keys(m).some(k => !['role', 'content', 'name', 'tool_calls', 'tool_call_id', 'refusal'].includes(k)) ||
        !(typeof m.content === 'string' || (m.content == null && m.role === 'assistant' && m.tool_calls?.length) ||
          (Array.isArray(m.content) && m.content.every(b => b?.type === 'text' && typeof b.text === 'string' && Object.keys(b).every(k => ['type', 'text'].includes(k))))) ||
        (m.tool_calls !== undefined && (!Array.isArray(m.tool_calls) || m.tool_calls.some(c =>
          c?.type !== 'function' || typeof c.id !== 'string' || typeof c.function?.arguments !== 'string')))) ||
      (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(t =>
        t?.type !== 'function' || typeof t.function?.name !== 'string'))) ||
      (body.tool_choice && typeof body.tool_choice === 'object' && body.tool_choice.type !== 'function')) throw unavailable();
}

export function createOpenAIDispatchContext({ identity, routeProof, credentials, profile, model, body, endpoint, clock }) {
  const { apiKey, connectionId } = credentials;
  if (profile.provider !== 'openai' || profile.auth !== 'api-key' || !profile.producerAdmitted ||
      profile.serviceTier !== 'standard' || connectionId !== profile.connectionId ||
      credentials.authType !== 'apikey' || !apiKey || credentials.accessToken || credentials.refreshToken ||
      !directAccountData(credentials.providerSpecificData) || !routeProof) throw unavailable();
  const responses = endpoint === '/v1/responses';
  if (!responses && endpoint !== '/v1/chat/completions') throw unavailable();
  const urlExpected = 'https://api.openai.com' + endpoint;
  const stream = body.stream === true;
  let expectedWire;
  return Object.freeze({
    provider: 'openai', stream, nativeDefaults: true,
    runtimeTransport: responses ? Object.freeze({ format: 'openai-responses', baseUrl: urlExpected }) : null,
    validateInput(input) {
      if (expectedWire) throw unavailable();
      if (responses) validateResponses(input);
      else validate(input);
      expectedWire = { ...input, model, stream, service_tier: 'default',
        ...(!responses && stream ? { stream_options: { include_usage: true } } : {}) };
      if (!responses && Object.hasOwn(expectedWire, 'max_tokens') && !Object.hasOwn(expectedWire, 'max_completion_tokens')) {
        expectedWire.max_completion_tokens = expectedWire.max_tokens;
        delete expectedWire.max_tokens;
      }
      return structuredClone(expectedWire);
    },
    async prepare({ url, options, proxyOptions, provider, model: selected, stream: wireStream }) {
      if (!expectedWire || url !== urlExpected || provider !== 'openai' || selected !== model ||
          wireStream !== stream || JSON.stringify(expectedWire) !== options.body ||
          new Headers(options.headers).get('authorization') !== `Bearer ${apiKey}`) throw unavailable();
      expectedWire = null;
      const { proof, price } = await identity.bindOpenAIAccount(routeProof, connectionId, apiKey);
      const initiate = await prepareAccountedDirectPost(url, options, proxyOptions);
      const attempt = identity.prepare({ attemptId: randomUUID(), provider, model, startedAt: budgetInstant(clock), price }, routeProof, proof);
      return Object.freeze({ dispatch: () => identity.dispatch(attempt.ack, budgetInstant(clock), initiate),
        settleJson: raw => attempt.settle(openAIStandardUsage(raw, price, responses)),
        ...(responses ? { settleResponses: attempt.settle, mapResponsesUsage: raw => openAIStandardUsage(raw, price, true) } : {}) });
    },
  });
}
