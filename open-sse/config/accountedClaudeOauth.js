import { ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE } from './accountingClaudeDynamicModes.js';
import { supportsClaudeDynamicOriginal } from './accountingClaudeDynamicOriginal.js';
import { CLAUDE_ACCOUNTING_CODE_NAME } from './accountingClaudeCodeRegime.js';
import { CLAUDE_ACCOUNTING_CODE_SUBTOOLS } from './accountingClaudeToolGraph.js';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { PROVIDERS } from './providers.js';
import { captureAccountingBaseTransport } from './accountedBaseTransport.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsAnthropicLiveRequest, ANTHROPIC_OAUTH_TOKEN_PREFIX } from './accountedAnthropicCandidate.js';
import { prepareClaudeRequest, anchorClaudeCache } from '../translator/formats/claude.js';
import { cloakClaudeTools } from '../utils/claudeCloaking.js';
import { selectAnthropicBeta, ANTHROPIC_API_VERSION, CLAUDE_CLI_VERSION } from '../providers/shared.js';
import { CLAUDE_BLOCK, ROLE } from '../translator/schema/index.js';
import { getCapabilitiesForModel } from '../providers/capabilities.js';
import { DEFAULT_MAX_TOKENS } from './runtimeConfig.js';
import { CLAUDE_ACCOUNTING_SERVER_FETCH_NAME } from './accountingClaudeServerFetch.js';
import { CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME } from './accountingClaudeServerSearch.js';
import { captureClaudeSearchResults } from './accountingClaudeSearchResults.js';

export const ACCOUNTED_CLAUDE_OAUTH_MODE = 'native-claude-oauth-sse';
const unavailable = () => { throw new Error('Accounting Claude OAuth transport unavailable'); };
export function claudeOauthToken(credentials) {
  const token = credentials?.apiKey || credentials?.accessToken;
  if (typeof token !== 'string' || !token.startsWith(ANTHROPIC_OAUTH_TOKEN_PREFIX) || /[\r\n\u0000]/.test(token)) unavailable();
  // The production header owner prefers apiKey, whereas the translator prefers
  // accessToken. Ambiguous simultaneous credentials cannot select two identities.
  if (credentials.apiKey && credentials.accessToken && credentials.apiKey !== credentials.accessToken) unavailable();
  return token;
}
export function supportsClaudeOauthOriginal(body, model, allowDynamic = false) {
  if (typeof allowDynamic !== 'boolean' || !(allowDynamic ? supportsClaudeDynamicOriginal(body, model) : supportsAnthropicLiveRequest(body, model, true, true, true, true, true, true, true, true, true))) return false;
  const caps = getCapabilitiesForModel('claude', model);
  if (body.max_tokens > (caps.maxOutput || DEFAULT_MAX_TOKENS) || caps.thinkingOffType && body.thinking?.type === 'disabled' ||
      caps.forcedToolChoice === false && ['any', 'tool'].includes(body.tool_choice?.type)) return false;
  // Normalization cannot erase requested content to obtain accounting support.
  // Direct search has original/actual/raw/per-use owners. Other server tools
  // and files remain separate F obligations.
  // URL media is forwarded verbatim only; no local retrieval/type inference.
  if (Array.isArray(body.system) && body.system.some(b => !b.text.trim())) return false;
  let previous = null;
  for (const message of body.messages) {
    if (message.role === previous) return false;
    previous = message.role;
    if (typeof message.content === 'string') { if (!message.content.trim()) return false; continue; }
    if (!message.content.length) return false;
    let used = false;
    for (const block of message.content) {
      if (block.type === CLAUDE_BLOCK.TOOL_USE) used = true;
      if (block.type === CLAUDE_BLOCK.TEXT && (!block.text.trim() || message.role === ROLE.ASSISTANT && used)) return false;
    }
  }
  return true;
}
export function prepareAccountingClaudeOauthBody(original, token, sessionId = randomUUID(), allowDynamic = false) {
  if (!supportsClaudeOauthOriginal(original, original?.model, allowDynamic)) unavailable();
  const prepared = prepareClaudeRequest(structuredClone(original), 'claude', token, null, null, sessionId, true, true, true, true, allowDynamic);
  const thinkingHistory = body => body.messages.map(message => Array.isArray(message.content)
    ? message.content.filter(block => [CLAUDE_BLOCK.THINKING, CLAUDE_BLOCK.REDACTED_THINKING].includes(block.type)) : []);
  if (!isDeepStrictEqual(prepared.thinking, original.thinking) || !isDeepStrictEqual(prepared.output_config, original.output_config) ||
      prepared.max_tokens !== original.max_tokens || !isDeepStrictEqual(thinkingHistory(prepared), thinkingHistory(original))) unavailable();
  const inlineHistory = body => body.messages.map(message => Array.isArray(message.content) ? message.content.flatMap(block => {
    const media = value => [CLAUDE_BLOCK.IMAGE, CLAUDE_BLOCK.DOCUMENT].includes(value.type);
    const clean = value => { const { cache_control: _cache, ...content } = value; return content; };
    if (media(block)) return [{ content: clean(block) }];
    if (block.type === CLAUDE_BLOCK.TOOL_RESULT && Array.isArray(block.content)) return block.content.filter(media).map(value => ({ toolUseId: block.tool_use_id, content: clean(value) }));
    return [];
  }) : []);
  if (!isDeepStrictEqual(inlineHistory(prepared), inlineHistory(original))) unavailable();
  const cloaked = cloakClaudeTools(prepared).body;
  const anchored = anchorClaudeCache(cloaked, true, true, true, allowDynamic);
  const serverHistory = body => body.messages.map(message => Array.isArray(message.content)
    ? message.content.filter(block => [CLAUDE_BLOCK.SERVER_TOOL_USE, CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT, CLAUDE_BLOCK.WEB_FETCH_TOOL_RESULT, ...(allowDynamic ? Object.values(CLAUDE_ACCOUNTING_CODE_SUBTOOLS) : [])].includes(block.type)) : []);
  const serverTools = body => (body.tools || []).filter(tool => [CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME, CLAUDE_ACCOUNTING_SERVER_FETCH_NAME, ...(allowDynamic ? [CLAUDE_ACCOUNTING_CODE_NAME] : [])].includes(tool.name)).map(tool => {
    const { cache_control: _cache, ...definition } = tool; return definition;
  });
  if (!isDeepStrictEqual(serverHistory(anchored), serverHistory(original)) ||
      !isDeepStrictEqual(serverTools(anchored), serverTools(original))) unavailable();
  const citationHistory = body => body.messages.map(message => Array.isArray(message.content)
    ? message.content.filter(block => Object.hasOwn(block, 'citations') && block.type === CLAUDE_BLOCK.TEXT) : []);
  if (!isDeepStrictEqual(citationHistory(anchored), citationHistory(original)) ||
      !isDeepStrictEqual(captureClaudeSearchResults(anchored), captureClaudeSearchResults(original))) unavailable();
  return snapshotAccountingPreparedData(anchored);
}
// Build the raw declared-name owner from validated original deterministic
// client renaming, never from decoy declarations. This is not a POST body.
export function claudeOauthServerSearchOwner(original) {
  return claudeOauthServerToolOwner(original, CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME);
}
export function claudeOauthServerFetchOwner(original) {
  return claudeOauthServerToolOwner(original, CLAUDE_ACCOUNTING_SERVER_FETCH_NAME);
}
export function claudeOauthDynamicOwner(original) {
  return claudeOauthServerToolOwner(original, null, true);
}
function claudeOauthServerToolOwner(original, toolName, allowDynamic = false) {
  original = snapshotAccountingPreparedData(original);
  if (!supportsClaudeOauthOriginal(original, original.model, allowDynamic)) unavailable();
  if (!allowDynamic && !original.tools?.some(tool => tool.name === toolName)) return null;
  const cloaked = cloakClaudeTools(structuredClone(original)).body;
  const owner = { ...original, tools: cloaked.tools.slice(0, original.tools.length), messages: cloaked.messages };
  if (!(allowDynamic ? supportsClaudeDynamicOriginal(owner, original.model) : supportsAnthropicLiveRequest(owner, original.model, true, true, true, true, true, true, true, true, true))) unavailable();
  return snapshotAccountingPreparedData(owner);
}
// The only nondeterministic field is the three-hex client build discriminator.
// Validate its full billing grammar/cch/version, then compare every other byte
// of the deterministic production transform. Never remove cache/tool/history.
function stableBilling(body) {
  const clone = structuredClone(body), text = clone.system?.[0]?.text;
  const escaped = CLAUDE_CLI_VERSION.replaceAll('.', '\\.');
  const pattern = new RegExp(`^x-anthropic-billing-header: cc_version=${escaped}\\.[0-9a-f]{3}; cc_entrypoint=sdk-cli; cch=[0-9a-f]{5};$`);
  if (typeof text !== 'string' || !pattern.test(text)) unavailable();
  clone.system[0].text = text.replace(/(cc_version=[0-9.]+\.)[0-9a-f]{3};/, '$1BUILD;');
  return clone;
}
export function validateAccountingClaudeOauthDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  const fields = ['model', 'mode', 'baseTransport', 'serializedBody', 'originalSerializedBody', 'credentials'];
  if (!evidence || Array.isArray(evidence) || Object.keys(evidence).length !== fields.length || fields.some(key => !Object.hasOwn(evidence, key)) ||
      ![ACCOUNTED_CLAUDE_OAUTH_MODE, ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE].includes(evidence.mode) || typeof evidence.model !== 'string' ||
      !isDeepStrictEqual(evidence.baseTransport, captureAccountingBaseTransport(PROVIDERS.claude)) ||
      url !== `${evidence.baseTransport.baseUrl}${evidence.baseTransport.urlSuffix || ''}`) unavailable();
  const credentials = evidence.credentials;
  if (!credentials || Object.keys(credentials).length !== 2 || !['apiKey', 'accessToken'].every(key => Object.hasOwn(credentials, key))) unavailable();
  const token = claudeOauthToken(credentials);
  let original, body;
  try { original = JSON.parse(evidence.originalSerializedBody); body = JSON.parse(evidence.serializedBody); } catch { unavailable(); }
  const dynamic = evidence.mode === ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE;
  if (!supportsClaudeOauthOriginal(original, evidence.model, dynamic)) unavailable();
  let sessionId;
  try { sessionId = JSON.parse(body.metadata.user_id).session_id; } catch { unavailable(); }
  if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) unavailable();
  const expected = prepareAccountingClaudeOauthBody(original, token, sessionId, dynamic);
  if (!isDeepStrictEqual(stableBilling(body), stableBilling(expected))) unavailable();
  return evidence;
}
export function claudeOauthAccountingHeaders(evidence) {
  let body, sessionId;
  try { body = JSON.parse(evidence.serializedBody); sessionId = JSON.parse(body.metadata.user_id).session_id; } catch { unavailable(); }
  const credentials = evidence.credentials;
  const headers = new Headers({ 'Content-Type': 'application/json', ...evidence.baseTransport.headers });
  if (credentials.apiKey) headers.set('x-api-key', credentials.apiKey);
  else headers.set('Authorization', `Bearer ${credentials.accessToken}`);
  headers.set('Anthropic-Version', ANTHROPIC_API_VERSION);
  headers.set('Anthropic-Beta', selectAnthropicBeta(evidence.model, body));
  headers.set('Accept', 'text/event-stream');
  headers.set('x-claude-code-session-id', sessionId);
  return headers;
}
export function validateAccountingClaudeOauthPost(value, url, options) {
  const evidence = validateAccountingClaudeOauthDispatch(value, url);
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== evidence.serializedBody ||
      !isDeepStrictEqual([...new Headers(options.headers)], [...claudeOauthAccountingHeaders(evidence)])) unavailable();
  return evidence;
}
