import { ACCOUNTED_ANTHROPIC_DYNAMIC_MODE, ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE } from './accountingClaudeDynamicModes.js';
import { supportsClaudeDynamicOriginal } from './accountingClaudeDynamicOriginal.js';
import { isDeepStrictEqual } from 'node:util';
import { PROVIDERS } from './providers.js';
import { FORMATS } from '../translator/formats.js';
import { captureAccountingBaseTransport } from './accountedBaseTransport.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_ANTHROPIC_CANDIDATE_URL, ACCOUNTED_ANTHROPIC_CANDIDATE_MODE, ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE, ACCOUNTED_ANTHROPIC_BETA_FLAGS, ACCOUNTED_ANTHROPIC_MODES, isAnthropicLiveMode, supportsAnthropicAccountingHeaders, supportsAnthropicLiveRequest } from './accountedAnthropicCandidate.js';

import { ACCOUNTED_CLAUDE_OAUTH_MODE, validateAccountingClaudeOauthDispatch, validateAccountingClaudeOauthPost } from './accountedClaudeOauth.js';

const unavailable = () => { throw new Error('Accounting Anthropic transport unavailable'); };
// Buffered stays text-only; explicit live permits native client-tool histories.
// Queued beta additionally preserves signed thinking and bounded media/reference
// wire with tiered cache rates. It pins production registry flags exactly, not
// arbitrary beta/other-server-tool/file or public application approval.
// Explicit queued API-key direct search has original/raw/per-use price owners;
// OAuth and ordinary modes do not inherit that provider admission.
// URL references are never locally retrieved; upstream retrieval safety is separate.
// Preserve original input as well as forced-SSE wire, so transforms cannot erase
// unsupported work. Standard registry-module fixtures are not beta approval.
export function validateAccountingAnthropicDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  if ([ACCOUNTED_CLAUDE_OAUTH_MODE, ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE].includes(evidence?.mode)) return validateAccountingClaudeOauthDispatch(evidence, url);
  if (!evidence || Array.isArray(evidence) || Object.keys(evidence).length !== 5 ||
      !['model', 'mode', 'baseTransport', 'serializedBody', 'originalSerializedBody'].every(key => Object.hasOwn(evidence, key)) ||
      typeof evidence.model !== 'string' || !ACCOUNTED_ANTHROPIC_MODES.includes(evidence.mode) ||
      url !== ACCOUNTED_ANTHROPIC_CANDIDATE_URL ||
      !isDeepStrictEqual(evidence.baseTransport, captureAccountingBaseTransport(PROVIDERS.anthropic)) || evidence.baseTransport.format !== FORMATS.CLAUDE) unavailable();
  if ([ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE, ACCOUNTED_ANTHROPIC_DYNAMIC_MODE].includes(evidence.mode) &&
      new Headers(evidence.baseTransport.headers).get('anthropic-beta') !== ACCOUNTED_ANTHROPIC_BETA_FLAGS) unavailable();
  const dynamic = evidence.mode === ACCOUNTED_ANTHROPIC_DYNAMIC_MODE;
  const beta = dynamic || evidence.mode === ACCOUNTED_ANTHROPIC_BETA_LIVE_MODE;
  let original, body;
  try { original = JSON.parse(evidence.originalSerializedBody); body = JSON.parse(evidence.serializedBody); } catch { unavailable(); }
  if (!original || typeof original !== 'object' || Array.isArray(original) ||
      original.stream !== isAnthropicLiveMode(evidence.mode) ||
      evidence.mode === ACCOUNTED_ANTHROPIC_CANDIDATE_MODE && (original.tools !== undefined || original.tool_choice !== undefined || body.tools !== undefined || body.tool_choice !== undefined) ||
      (dynamic ? !supportsClaudeDynamicOriginal(original, evidence.model) || !supportsClaudeDynamicOriginal(body, evidence.model) :
        !supportsAnthropicLiveRequest({ ...original, stream: true }, evidence.model, isAnthropicLiveMode(evidence.mode), beta, beta, beta, beta, beta, beta, beta, beta) ||
        !supportsAnthropicLiveRequest(body, evidence.model, isAnthropicLiveMode(evidence.mode), beta, beta, beta, beta, beta, beta, beta, beta)) || !isDeepStrictEqual(body, { ...original, stream: true })) unavailable();
  return evidence;
}
export function validateAccountingAnthropicPost(evidence, url, options) {
  const original = validateAccountingAnthropicDispatch(evidence, url), headers = new Headers(options.headers);
  if ([ACCOUNTED_CLAUDE_OAUTH_MODE, ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE].includes(original.mode)) return validateAccountingClaudeOauthPost(original, url, options);
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== original.serializedBody ||
      !supportsAnthropicAccountingHeaders(headers, original.mode) || !headers.get('x-api-key')) unavailable();
  return original;
}
