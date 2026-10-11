import { isDeepStrictEqual, types } from 'node:util';
import { PROVIDER_MEDIA } from '../providers/index.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_GEMINI_BASE } from './accountedGeminiCandidate.js';
import { captureGeminiEmbeddingConversion } from './accountedGeminiEmbeddingCandidate.js';
import { captureUnhealthyApiKeyMaterial } from './accountedUnhealthyChatDispatch.js';

export const GEMINI_EMBED_DISPATCH_FIELDS = Object.freeze(['model', 'original', 'actual', 'mediaConfig', 'credentials', 'headers', 'url', 'serialized', 'proxyOptions']);
export const QUEUED_GEMINI_EMBEDDING_PROTOCOL = 'native-gemini-embeddings';
export const GEMINI_EMBED_SINGLE_ACTION = ':embedContent';
export const GEMINI_EMBED_BATCH_ACTION = ':batchEmbedContents';
const POST_FIELDS = Object.freeze(['method', 'headers', 'body', 'redirect']);
const unavailable = () => { throw new Error('Gemini embedding dispatch unavailable'); };
const exactKeys = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));

// Private request-owned equality data. NEVER log/export this image: the current
// adapter authenticates via the URL query. No origin/selection/ACK grant here.
export function captureGeminiEmbeddingDispatch(input) {
  try {
    const evidence = snapshotAccountingPreparedData(input);
    if (!exactKeys(evidence, GEMINI_EMBED_DISPATCH_FIELDS)) unavailable();
    const conversion = captureGeminiEmbeddingConversion({ model: evidence.model, original: evidence.original, actual: evidence.actual });
    const currentConfig = snapshotAccountingPreparedData(PROVIDER_MEDIA.gemini?.embeddingConfig ?? null);
    if (!isDeepStrictEqual(evidence.mediaConfig, currentConfig) ||
        currentConfig?.baseUrl !== ACCOUNTED_GEMINI_BASE || currentConfig.authType !== 'apikey' || currentConfig.authHeader !== 'key') unavailable();
    // Shared bounded credential/proxy data checks only, not Chat schema support
    // or independently persisted route/credential permission.
    captureUnhealthyApiKeyMaterial(evidence.credentials, evidence.proxyOptions);
    const expectedUrl = `${ACCOUNTED_GEMINI_BASE}/${evidence.model}${conversion.inspection.batch ? GEMINI_EMBED_BATCH_ACTION : GEMINI_EMBED_SINGLE_ACTION}?key=${encodeURIComponent(evidence.credentials.apiKey)}`;
    if (evidence.url !== expectedUrl || evidence.serialized !== JSON.stringify(evidence.actual) ||
        !isDeepStrictEqual(evidence.headers, { 'Content-Type': 'application/json' })) unavailable();
    return evidence;
  } catch { unavailable(); } // Guard errors are fixed; never expose secret-bearing values.
}

// Signal is separate native lifecycle input, not serialized equality data. All
// other POST fields are descriptor-projected before programmable field reads.
export function validateGeminiEmbeddingOptions(value, url, options, proxyOptions) {
  try {
    if (typeof url !== 'string' || !options || typeof options !== 'object' || types.isProxy(options) ||
        Object.getPrototypeOf(options) !== Object.prototype) unavailable();
    const descriptors = Object.getOwnPropertyDescriptors(options);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || ![...POST_FIELDS, 'signal'].includes(key)) ||
        !POST_FIELDS.every(key => Object.hasOwn(descriptors, key)) ||
        Object.values(descriptors).some(entry => !entry.enumerable || !Object.hasOwn(entry, 'value'))) unavailable();
    const retained = captureGeminiEmbeddingDispatch(value);
    const current = snapshotAccountingPreparedData({ url, options: Object.fromEntries(POST_FIELDS.map(key => [key, descriptors[key].value])), proxyOptions });
    if (current.url !== retained.url || current.options.method !== 'POST' || current.options.redirect !== 'error' ||
        current.options.body !== retained.serialized || !isDeepStrictEqual(current.options.headers, retained.headers) ||
        !isDeepStrictEqual(current.proxyOptions, retained.proxyOptions)) unavailable();
    return retained;
  } catch { unavailable(); }
}
