import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ROLE } from '../translator/schema/roles.js';

// Explicit raw-schema compatibility slices, not inferred from provider labels
// or an OpenAI-compatible prefix. Specialized executors remain independently gated.
export const ACCOUNTED_OPENAI_CHAT_PROVIDERS = Object.freeze(['openai', 'deepseek']);
// Unwired original-body schema only. Never selection, credential, gap-ACK or
// dispatch authority; no stripping unknown fields into a supported request.
const UNHEALTHY_CHAT_ROLES = Object.freeze([ROLE.SYSTEM, ROLE.DEVELOPER, ROLE.USER, ROLE.ASSISTANT]);
export function supportsUnhealthyChatRequest(body, model) {
  try {
    const original = snapshotAccountingPreparedData(body);
    if (!original || Array.isArray(original) || typeof model !== 'string' || !model ||
        Object.keys(original).length !== 3 || !['model', 'messages', 'stream'].every(key => Object.hasOwn(original, key)) ||
        original.model !== model || original.stream !== false || !Array.isArray(original.messages) || !original.messages.length) return false;
    return original.messages.every(message => message && !Array.isArray(message) && typeof message === 'object' &&
      Object.keys(message).length === 2 && Object.hasOwn(message, 'role') && Object.hasOwn(message, 'content') &&
      UNHEALTHY_CHAT_ROLES.includes(message.role) && typeof message.content === 'string');
  } catch { return false; }
}

export function isAccountedOpenaiChatProvider(provider) {
  return ACCOUNTED_OPENAI_CHAT_PROVIDERS.includes(provider);
}
// DeepSeek's approved slice is the registry's fixed chat-completions endpoint.
// A stale Claude runtime transport or endpoint override is not schema authority.
export function isAccountedChatTransport(provider, url, runtimeTransport) {
  if (provider === 'openai') return !runtimeTransport || runtimeTransport.format === 'openai';
  return provider === 'deepseek' && (!runtimeTransport || runtimeTransport.format === 'openai') &&
    url === 'https://api.deepseek.com/chat/completions';
}
