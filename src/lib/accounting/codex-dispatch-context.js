import { randomUUID } from 'node:crypto';
import { prepareAccountedDirectPost } from '../../../open-sse/utils/proxyFetch.js';
import { unavailable } from './attempt-payload.js';
import { budgetInstant } from './budget-windows.js';
import { codexAccountId, directAccountData } from './node-anthropic-account.js';

const endpoint = 'https://chatgpt.com/backend-api/codex/responses';
const fields = new Set(['model', 'input', 'instructions', 'tools', 'tool_choice', 'stream', 'store',
  'reasoning', 'include', 'prompt_cache_key', 'text', 'parallel_tool_calls']);
const itemTypes = new Set(['message', 'reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output']);

export function createCodexDispatchContext({ identity, routeProof, credentials, profile, clock }) {
  const { connectionId, accessToken, providerSpecificData } = credentials;
  const accountId = codexAccountId(providerSpecificData);
  const { model } = profile;
  if (profile.provider !== 'codex' || profile.auth !== 'oauth' || profile.producerAdmitted !== true ||
      profile.connectionId !== connectionId || credentials.authType !== 'oauth' || credentials.apiKey ||
      !accessToken || !accountId || !routeProof || !directAccountData(providerSpecificData)) throw unavailable();
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
    validateInput(body) {
      if (validated || ![model, `codex/${model}`].includes(body?.model)) throw unavailable();
      validate(body);
      validated = true;
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

      const { proof, price } = await identity.bindCodexAccount(routeProof, connectionId, accessToken, accountId, profile.priceBasis);
      const initiate = await prepareAccountedDirectPost(url, options, proxyOptions);
      const attempt = identity.prepare({ attemptId: randomUUID(), provider, model, startedAt: budgetInstant(clock), price }, routeProof, proof);
      return Object.freeze({
        dispatch: () => identity.dispatch(attempt.ack, budgetInstant(clock), initiate),
        priceCacheWrites: 'included-in-input',
        settleResponses: attempt.settle,
      });
    },
  });
}
