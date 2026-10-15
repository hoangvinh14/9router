import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { GEMINI_ROLE } from '../translator/schema/roles.js';

export const ACCOUNTING_GEMINI_FUNCTION_NAME = /^[a-zA-Z0-9_.:-]{1,128}$/;
export const ACCOUNTING_GEMINI_CALL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;
export const ACCOUNTING_GEMINI_FUNCTION_MODES = Object.freeze(['AUTO', 'ANY', 'NONE', 'VALIDATED']);
export const ACCOUNTING_GEMINI_SCHEMA_TYPES = Object.freeze(['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT', 'NULL']);
export const ACCOUNTING_GEMINI_SCHEMA_FIELDS = Object.freeze(['type', 'format', 'title', 'description', 'nullable', 'enum', 'items', 'properties', 'required', 'propertyOrdering', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minProperties', 'maxProperties', 'pattern', 'anyOf', 'default', 'example']);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, names) => object(value) && Object.keys(value).every(key => names.includes(key));
const stringList = value => Array.isArray(value) && value.every(item => typeof item === 'string') && new Set(value).size === value.length;
const int64 = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 9223372036854775807n;
export const supportsGeminiThoughtSignature = value => typeof value === 'string' && value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').toString('base64') === value;
function schema(value) {
  if (!fields(value, ACCOUNTING_GEMINI_SCHEMA_FIELDS) || !ACCOUNTING_GEMINI_SCHEMA_TYPES.includes(value.type)) return false;
  if (['format', 'title', 'description', 'pattern'].some(key => value[key] !== undefined && typeof value[key] !== 'string') ||
      value.nullable !== undefined && typeof value.nullable !== 'boolean' ||
      ['minimum', 'maximum'].some(key => value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) ||
      ['minItems', 'maxItems', 'minLength', 'maxLength', 'minProperties', 'maxProperties'].some(key => value[key] !== undefined && !int64(value[key]))) return false;
  for (const [minimum, maximum] of [['minimum', 'maximum'], ['minItems', 'maxItems'], ['minLength', 'maxLength'], ['minProperties', 'maxProperties']]) {
    if (value[minimum] !== undefined && value[maximum] !== undefined &&
        (minimum === 'minimum' ? value[minimum] > value[maximum] : BigInt(value[minimum]) > BigInt(value[maximum]))) return false;
  }
  if (value.enum !== undefined && !stringList(value.enum) || value.items !== undefined && (value.type !== 'ARRAY' || !schema(value.items)) ||
      value.properties !== undefined && (value.type !== 'OBJECT' || !object(value.properties) || !Object.values(value.properties).every(schema)) ||
      value.anyOf !== undefined && (!Array.isArray(value.anyOf) || !value.anyOf.length || !value.anyOf.every(schema))) return false;
  return ['required', 'propertyOrdering'].every(key => value[key] === undefined || value.type === 'OBJECT' && stringList(value[key]) && value[key].every(name => Object.hasOwn(value.properties || {}, name)));
}
function declaration(tool) {
  if (!fields(tool, ['name', 'description', 'parameters', 'parametersJsonSchema', 'response', 'responseJsonSchema']) ||
      typeof tool.name !== 'string' || !ACCOUNTING_GEMINI_FUNCTION_NAME.test(tool.name) || typeof tool.description !== 'string') return false;
  for (const [typed, json] of [['parameters', 'parametersJsonSchema'], ['response', 'responseJsonSchema']]) {
    if (tool[typed] !== undefined && tool[json] !== undefined || tool[typed] !== undefined && (!schema(tool[typed]) || typed === 'parameters' && tool[typed].type !== 'OBJECT')) return false;
    // JSON Schema is opaque bounded original provider input, never evaluated,
    // dereferenced or used to execute a function in the gateway.
    if (tool[json] !== undefined && (!object(tool[json]) || typed === 'parameters' && tool[json].type !== 'object')) return false;
  }
  return true;
}
// Local original grammar prerequisite only. Projection reuses the legacy text
// grammar after each removed field has an independent schema/association check.
// The original, not this projection, must remain the actual dispatch body.
export function supportsGeminiClientToolsOriginal(value, validateText) {
  try {
    const body = snapshotAccountingPreparedData(value);
    if (!object(body) || !Array.isArray(body.tools) || !body.tools.length || !Array.isArray(body.contents) || !body.contents.length) return false;
    const names = new Set();
    for (const tool of body.tools) {
      if (!fields(tool, ['functionDeclarations']) || !Array.isArray(tool.functionDeclarations) || !tool.functionDeclarations.length) return false;
      for (const item of tool.functionDeclarations) { if (!declaration(item) || names.has(item.name)) return false; names.add(item.name); }
    }
    if (body.toolConfig !== undefined) {
      if (!fields(body.toolConfig, ['functionCallingConfig']) || !fields(body.toolConfig.functionCallingConfig, ['mode', 'allowedFunctionNames'])) return false;
      const config = body.toolConfig.functionCallingConfig;
      if (config.mode !== undefined && !ACCOUNTING_GEMINI_FUNCTION_MODES.includes(config.mode) || config.allowedFunctionNames !== undefined &&
          (!['ANY', 'VALIDATED'].includes(config.mode) || !stringList(config.allowedFunctionNames) || !config.allowedFunctionNames.length || !config.allowedFunctionNames.every(name => names.has(name)))) return false;
    }
    const issued = new Set(), pending = new Map();
    const contents = [];
    for (const content of body.contents) {
      if (!fields(content, ['role', 'parts']) || ![undefined, GEMINI_ROLE.USER, GEMINI_ROLE.MODEL].includes(content.role) || !Array.isArray(content.parts) || !content.parts.length) return false;
      if (content.role === GEMINI_ROLE.MODEL && pending.size) return false;
      const parts = [];
      for (const part of content.parts) {
        if (!fields(part, ['text', 'thought', 'thoughtSignature', 'functionCall', 'functionResponse']) ||
            ['text', 'functionCall', 'functionResponse'].filter(key => Object.hasOwn(part, key)).length !== 1 ||
            part.thought !== undefined && (content.role !== GEMINI_ROLE.MODEL || typeof part.thought !== 'boolean') ||
            part.thoughtSignature !== undefined && (content.role !== GEMINI_ROLE.MODEL || !supportsGeminiThoughtSignature(part.thoughtSignature))) return false;
        if (Object.hasOwn(part, 'text')) {
          if (typeof part.text !== 'string' || content.role !== GEMINI_ROLE.MODEL && pending.size) return false;
          parts.push({ text: part.text }); continue;
        }
        const call = part.functionCall, result = part.functionResponse;
        const payload = call ?? result;
        if (!fields(payload, call ? ['name', 'args', 'id'] : ['name', 'response', 'id']) ||
            typeof payload.name !== 'string' || !ACCOUNTING_GEMINI_CALL_NAME.test(payload.name) || !names.has(payload.name) ||
            payload.id !== undefined && (typeof payload.id !== 'string' || !payload.id) ||
            (call ? content.role !== GEMINI_ROLE.MODEL || payload.args !== undefined && !object(payload.args) : content.role !== GEMINI_ROLE.USER || !object(payload.response))) return false;
        const key = payload.id === undefined ? `name:${payload.name}` : `id:${payload.id}`;
        if (call) {
          if (pending.has(key) || payload.id !== undefined && issued.has(key)) return false;
          pending.set(key, payload.name); if (payload.id !== undefined) issued.add(key);
        } else {
          if (pending.get(key) !== payload.name) return false;
          pending.delete(key);
        }
        parts.push({ text: call ? '[validated original client call]' : '[validated original client result]' });
      }
      contents.push({ ...content, parts });
    }
    if (pending.size) return false;
    const { tools: _tools, toolConfig: _config, ...textBody } = body;
    return validateText({ ...textBody, contents });
  } catch { return false; }
}
