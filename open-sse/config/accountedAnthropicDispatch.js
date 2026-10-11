import { isDeepStrictEqual } from 'node:util';
import { PROVIDERS } from './providers.js';
import { FORMATS } from '../translator/formats.js';
import { captureAccountingBaseTransport } from './accountedBaseTransport.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_ANTHROPIC_CANDIDATE_URL, ACCOUNTED_ANTHROPIC_CANDIDATE_MODE, ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE, ACCOUNTED_ANTHROPIC_BETA_FLAGS, ACCOUNTED_ANTHROPIC_MODES, isAnthropicLiveMode, supportsAnthropicAccountingHeaders, supportsAnthropicLiveRequest } from './accountedAnthropicCandidate.js';

import { ACCOUNTED_CLAUDE_OAUTH_MODE, validateAccountingClaudeOauthDispatch, validateAccountingClaudeOauthPost } from './accountedClaudeOauth.js';

const unavailable = () => { throw new Error('Accounting Anthropic transport unavailable'); };
// Queued buffered candidate stays native text-only. Explicit live candidate
// additionally permits declared client tools and native text-result histories,
// never server tools/media/TTL work. Separate beta mode pins production registry
// flags exactly; it is not arbitrary beta/OAuth/request-feature approval.
// Preserve original input as well as forced-SSE wire, so transforms cannot erase
// unsupported work. Standard registry-module fixtures are not beta approval.
export function validateAccountingAnthropicDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  if (evidence?.mode === ACCOUNTED_CLAUDE_OAUTH_MODE) return validateAccountingClaudeOauthDispatch(evidence, url);
  if (!evidence || Array.isArray(evidence) || Object.keys(evidence).length !== 5 ||
      !['model', 'mode', 'baseTransport', 'serializedBody', 'originalSerializedBody'].every(key => Object.hasOwn(evidence, key)) ||
      typeof evidence.model !== 'string' || !ACCOUNTED_ANTHROPIC_MODES.includes(evidence.mode) ||
      url !== ACCOUNTED_ANTHROPIC_CANDIDATE_URL ||
      !isDeepStrictEqual(evidence.baseTransport, captureAccountingBaseTransport(PROVIDERS.anthropic)) || evidence.baseTransport.format !== FORMATS.CLAUDE) unavailable();
  if (evidence.mode === ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE &&
      new Headers(evidence.baseTransport.headers).get('anthropic-beta') !== ACCOUNTED_ANTHROPIC_BETA_FLAGS) unavailable();
  let original, body;
  try { original = JSON.parse(evidence.originalSerializedBody); body = JSON.parse(evidence.serializedBody); } catch { unavailable(); }
  if (!original || typeof original !== 'object' || Array.isArray(original) ||
      original.stream !== isAnthropicLiveMode(evidence.mode) ||
      evidence.mode === ACCOUNTED_ANTHROPIC_CANDIDATE_MODE && (original.tools !== undefined || original.tool_choice !== undefined || body.tools !== undefined || body.tool_choice !== undefined) ||
      !supportsAnthropicLiveRequest({ ...original, stream: true }, evidence.model, isAnthropicLiveMode(evidence.mode), evidence.mode === ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE) ||
      !supportsAnthropicLiveRequest(body, evidence.model, isAnthropicLiveMode(evidence.mode), evidence.mode === ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE) || !isDeepStrictEqual(body, { ...original, stream: true })) unavailable();
  return evidence;
}
export function validateAccountingAnthropicPost(evidence, url, options) {
  const original = validateAccountingAnthropicDispatch(evidence, url), headers = new Headers(options.headers);
  if (original.mode === ACCOUNTED_CLAUDE_OAUTH_MODE) return validateAccountingClaudeOauthPost(original, url, options);
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== original.serializedBody ||
      !supportsAnthropicAccountingHeaders(headers, original.mode) || !headers.get('x-api-key')) unavailable();
  return original;
}
