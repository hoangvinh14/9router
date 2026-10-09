import { FORMATS } from '../translator/formats.js';
import { GEMINI_ROLE, ROLE } from '../translator/schema/roles.js';

export const ACCOUNTED_GEMINI_MODE = 'native-gemini-json';
export const ACCOUNTED_GEMINI_SSE_MODE = 'native-gemini-sse';
export const ACCOUNTED_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const ACCOUNTED_GEMINI_ACTION = ':generateContent';
export const ACCOUNTED_GEMINI_STREAM_ACTION = ':streamGenerateContent';
export const ACCOUNTED_GEMINI_MODEL = /^[a-zA-Z0-9_.-]+$/;
export const ACCOUNTED_GEMINI_REQUEST_FIELDS = Object.freeze(['contents', 'systemInstruction', 'generationConfig', 'serviceTier']);
export const ACCOUNTED_GEMINI_GENERATION_FIELDS = Object.freeze(['maxOutputTokens', 'temperature', 'topP', 'topK', 'candidateCount', 'thinkingConfig']);
export const ACCOUNTED_GEMINI_STANDARD_TIERS = Object.freeze(['unspecified', 'standard']);
export const ACCOUNTED_GEMINI_HEADER_FIELDS = Object.freeze(['content-type', 'x-goog-api-key', 'accept']);
// Internal provenance only: no body/header flag can manufacture original intent
// or native response authority. Keep one app context, never in executor singleton.
const originals = new WeakMap(), nativeResponses = new WeakSet();
export function bindGeminiOriginal(request, body, model, validRoute, stream = false) {
  originals.set(request, Object.freeze({ body: structuredClone(body), model, validRoute, stream }));
}
export function getGeminiOriginal(request) { const value = originals.get(request); return value ? structuredClone(value) : null; }
export function markGeminiNativeResponse(response) { nativeResponses.add(response); return response; }
export function isGeminiNativeResponse(response) { return nativeResponses.has(response); }
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const textParts = parts => Array.isArray(parts) && parts.length > 0 && parts.every(part => fields(part, ['text']) && typeof part.text === 'string');
export function supportsGeminiRequest(body) {
  if (!fields(body, ACCOUNTED_GEMINI_REQUEST_FIELDS) ||
      body.serviceTier !== undefined && !ACCOUNTED_GEMINI_STANDARD_TIERS.includes(body.serviceTier) ||
      !Array.isArray(body.contents) || !body.contents.length ||
      !body.contents.every(content => fields(content, ['role', 'parts']) && [undefined, GEMINI_ROLE.USER, GEMINI_ROLE.MODEL].includes(content.role) && textParts(content.parts)) ||
      body.systemInstruction !== undefined && (!fields(body.systemInstruction, ['role', 'parts']) ||
        ![undefined, ROLE.SYSTEM].includes(body.systemInstruction.role) || !textParts(body.systemInstruction.parts))) return false;
  const config = body.generationConfig;
  return config === undefined || fields(config, ACCOUNTED_GEMINI_GENERATION_FIELDS) &&
    (config.candidateCount === undefined || config.candidateCount === 1) &&
    (config.maxOutputTokens === undefined || Number.isSafeInteger(config.maxOutputTokens) && config.maxOutputTokens > 0) &&
    (config.topK === undefined || Number.isSafeInteger(config.topK) && config.topK > 0) &&
    ['temperature', 'topP'].every(key => config[key] === undefined || typeof config[key] === 'number' && Number.isFinite(config[key]) && config[key] >= 0) &&
    (config.thinkingConfig === undefined || fields(config.thinkingConfig, ['thinkingBudget', 'includeThoughts']) &&
      (config.thinkingConfig.thinkingBudget === undefined || Number.isSafeInteger(config.thinkingConfig.thinkingBudget) && config.thinkingConfig.thinkingBudget >= -1) &&
      (config.thinkingConfig.includeThoughts === undefined || typeof config.thinkingConfig.includeThoughts === 'boolean'));
}
export function supportsGeminiInternalRequest(body, model) {
  if (!object(body) || body.model !== model || typeof body.stream !== 'boolean' || !ACCOUNTED_GEMINI_MODEL.test(model)) return false;
  const { model: _model, stream: _stream, ...wire } = body;
  return supportsGeminiRequest(wire);
}
export function supportsGeminiCandidate(executor, options, url, body, headers) {
  const credentials = options.credentials;
  const live = options.accountingMode === ACCOUNTED_GEMINI_SSE_MODE;
  if (executor.provider !== 'gemini' || executor.config?.format !== FORMATS.GEMINI ||
      ![ACCOUNTED_GEMINI_MODE, ACCOUNTED_GEMINI_SSE_MODE].includes(options.accountingMode) || options.stream !== live || options.body?.stream !== live ||
      !supportsGeminiInternalRequest(options.body, options.model) || !supportsGeminiRequest(body) ||
      url !== `${ACCOUNTED_GEMINI_BASE}/${options.model}${live ? ACCOUNTED_GEMINI_STREAM_ACTION + '?alt=sse' : ACCOUNTED_GEMINI_ACTION}` ||
      credentials?.runtimeTransport || credentials?.accessToken || typeof credentials?.apiKey !== 'string' || !credentials.apiKey ||
      options.proxyOptions?.vercelRelayUrl) return false;
  const normalized = new Headers(headers);
  return [...normalized.keys()].every(key => ACCOUNTED_GEMINI_HEADER_FIELDS.includes(key)) &&
    normalized.get('content-type') === 'application/json' && normalized.get('x-goog-api-key') === credentials.apiKey;
}
