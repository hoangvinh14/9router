import { getProviderModels } from './providerModels.js';
import { ROLE, OPENAI_BLOCK } from '../translator/schema/index.js';

// Caller-native original only. No OpenAI translation/default/thread/config
// generation, context erasure, tools, multi-turn continuity or retry authority.
export const ACCOUNTED_COMMANDCODE_URL = 'https://api.commandcode.ai/alpha/generate';
export const ACCOUNTED_COMMANDCODE_MODE = 'native-commandcode-ndjson';
export const ACCOUNTED_COMMANDCODE_PROTOCOL = 'native-commandcode';
export const ACCOUNTED_COMMANDCODE_HEADER_FIELDS = Object.freeze(['content-type', 'accept', 'authorization', 'x-session-id', 'x-command-code-version', 'x-cli-environment']);
export const commandCodeToken = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x20\x7f]/.test(value);
export const COMMANDCODE_ORIGINAL_FIELDS = Object.freeze(['threadId', 'memory', 'config', 'params']);
export const COMMANDCODE_CONFIG_FIELDS = Object.freeze(['workingDir', 'date', 'environment', 'structure', 'isGitRepo', 'currentBranch', 'mainBranch', 'gitStatus', 'recentCommits']);
export const COMMANDCODE_PARAMS_FIELDS = Object.freeze(['model', 'stream', 'max_tokens', 'temperature', 'messages']);
export const COMMANDCODE_ENVIRONMENTS = Object.freeze(['linux', 'darwin', 'win32']);
export const COMMANDCODE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fieldsEqual = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const nonemptyText = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
// Operates on already bounded plain snapshots. It is not a programmable-input
// guard: future owner must snapshot before any of these reads/serialization.
export function supportsCommandCodeOriginal(body, model) {
  if (typeof model !== 'string' || !getProviderModels('commandcode').some(entry => entry.id === model && !entry.upstreamModelId) ||
      !fieldsEqual(body, COMMANDCODE_ORIGINAL_FIELDS) || typeof body.threadId !== 'string' || !COMMANDCODE_UUID.test(body.threadId) || body.memory !== '') return false;
  const config = body.config;
  if (!fieldsEqual(config, COMMANDCODE_CONFIG_FIELDS) || !nonemptyText(config.workingDir) || !calendarDate(config.date) || !COMMANDCODE_ENVIRONMENTS.includes(config.environment) ||
      !Array.isArray(config.structure) || config.structure.length !== 0 || !Array.isArray(config.recentCommits) || config.recentCommits.length !== 0 ||
      config.isGitRepo !== false || config.currentBranch !== '' || config.mainBranch !== '' || config.gitStatus !== '') return false;
  const params = body.params;
  if (!fieldsEqual(params, Object.hasOwn(params || {}, 'system') ? [...COMMANDCODE_PARAMS_FIELDS, 'system'] : COMMANDCODE_PARAMS_FIELDS) ||
      params.model !== model || params.stream !== true || !Number.isSafeInteger(params.max_tokens) || params.max_tokens <= 0 ||
      typeof params.temperature !== 'number' || !Number.isFinite(params.temperature) || params.temperature < 0 || params.temperature > 2 ||
      Object.hasOwn(params, 'system') && !nonemptyText(params.system) || !Array.isArray(params.messages) || params.messages.length !== 1) return false;
  const message = params.messages[0];
  if (!fieldsEqual(message, ['role', 'content']) || message.role !== ROLE.USER || !Array.isArray(message.content) || message.content.length !== 1) return false;
  const block = message.content[0];
  return fieldsEqual(block, ['type', 'text']) && block.type === OPENAI_BLOCK.TEXT && nonemptyText(block.text);
}
