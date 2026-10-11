import { getProviderModels } from './providerModels.js';
import { resolveKiroModel } from './kiroConstants.js';

// Internal caller-native original schema only: no translation, generated
// context/session, model alias normalization, continuation or retry authority.
export const ACCOUNTED_KIRO_URL = 'https://q.us-east-1.amazonaws.com/generateAssistantResponse';
export const KIRO_ORIGINAL_FIELDS = Object.freeze(['conversationState', 'inferenceConfig']);
export const KIRO_CONVERSATION_FIELDS = Object.freeze(['chatTriggerType', 'conversationId', 'currentMessage', 'history']);
export const KIRO_CURRENT_FIELDS = Object.freeze(['userInputMessage']);
export const KIRO_USER_FIELDS = Object.freeze(['content', 'modelId', 'origin']);
export const KIRO_INFERENCE_FIELDS = Object.freeze(['maxTokens', 'temperature', 'topP']);
export const KIRO_ACCOUNTING_TRIGGER = 'MANUAL';
export const KIRO_ACCOUNTING_ORIGIN = 'AI_EDITOR';
export const KIRO_ACCOUNTING_MODEL_PREFIX = 'claude-';
export const KIRO_ACCOUNTING_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const KIRO_ACCOUNTING_PROFILE_ARN = /^arn:aws:codewhisperer:[a-z]{2}-[a-z]+-\d+:\d{12}:profile\/[A-Za-z0-9_-]+$/;
const fieldsEqual = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const nonemptyText = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
const inRange = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

// Caller MUST bound/detach/plain-snapshot before these reads. Schema acceptance
// cannot prove persisted profile/credential, exact route or original headers.
export function supportsKiroOriginal(body, model) {
  if (typeof model !== 'string' || !model.startsWith(KIRO_ACCOUNTING_MODEL_PREFIX) ||
      !getProviderModels('kr').some(entry => entry.id === model && !entry.upstreamModelId)) return false;
  const resolved = resolveKiroModel(model);
  if (resolved.upstream !== model || resolved.agentic || resolved.thinking ||
      !fieldsEqual(body, Object.hasOwn(body || {}, 'profileArn') ? [...KIRO_ORIGINAL_FIELDS, 'profileArn'] : KIRO_ORIGINAL_FIELDS) ||
      Object.hasOwn(body, 'profileArn') && (typeof body.profileArn !== 'string' || !KIRO_ACCOUNTING_PROFILE_ARN.test(body.profileArn))) return false;
  const conversation = body.conversationState;
  if (!fieldsEqual(conversation, KIRO_CONVERSATION_FIELDS) || conversation.chatTriggerType !== KIRO_ACCOUNTING_TRIGGER ||
      typeof conversation.conversationId !== 'string' || !KIRO_ACCOUNTING_UUID.test(conversation.conversationId) ||
      !Array.isArray(conversation.history) || conversation.history.length !== 0 ||
      !fieldsEqual(conversation.currentMessage, KIRO_CURRENT_FIELDS)) return false;
  const user = conversation.currentMessage.userInputMessage;
  if (!fieldsEqual(user, KIRO_USER_FIELDS) || !nonemptyText(user.content) || user.modelId !== model || user.origin !== KIRO_ACCOUNTING_ORIGIN) return false;
  const inference = body.inferenceConfig;
  return fieldsEqual(inference, KIRO_INFERENCE_FIELDS) && Number.isSafeInteger(inference.maxTokens) && inference.maxTokens > 0 &&
    inRange(inference.temperature, 0, 2) && inRange(inference.topP, 0, 1);
}
