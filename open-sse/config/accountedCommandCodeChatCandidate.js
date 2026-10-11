import { getProviderModels } from './providerModels.js';
import { ROLE } from '../translator/schema/roles.js';

export const COMMANDCODE_CHAT_ORIGINAL_FIELDS = Object.freeze(['model', 'stream', 'max_tokens', 'temperature', 'messages']);
const MESSAGE_FIELDS = Object.freeze(['role', 'content']);
const exactFields = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

// Schema only: the owner must snapshot the entire programmable original before
// calling this helper. No translation, generated defaults, identity or retries.
export function supportsCommandCodeChatOriginal(body, model) {
  if (typeof model !== 'string' || !getProviderModels('commandcode').some(entry => entry.id === model && !entry.upstreamModelId) ||
      !exactFields(body, COMMANDCODE_CHAT_ORIGINAL_FIELDS) || body.model !== model || body.stream !== true ||
      !Number.isSafeInteger(body.max_tokens) || body.max_tokens <= 0 ||
      typeof body.temperature !== 'number' || !Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2 ||
      !Array.isArray(body.messages) || body.messages.length !== 1) return false;
  const message = body.messages[0];
  return exactFields(message, MESSAGE_FIELDS) && message.role === ROLE.USER &&
    typeof message.content === 'string' && message.content.trim().length > 0 && !message.content.includes('\0');
}
