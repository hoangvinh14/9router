import { isDeepStrictEqual, types } from 'node:util';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { validateAccountingEmbeddingsDispatch } from './accountedEmbeddingsDispatch.js';
import { captureUnhealthyApiKeyMaterial } from './accountedUnhealthyChatDispatch.js';

const unavailable = () => { throw new Error('Unhealthy embeddings dispatch unavailable'); };
const FIELDS = Object.freeze(['model', 'body', 'actual', 'mediaConfig', 'credentials', 'headers', 'url', 'serialized', 'proxyOptions']);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

// Complete original + prepared equality, never endpoint/credential origin or
// independently durable selection/own ACK authority. No Chat schema is used.
export function captureUnhealthyEmbeddingsDispatch(input) {
  const evidence = snapshotAccountingPreparedData(input);
  if (!exactKeys(evidence, FIELDS) || typeof evidence.serialized !== 'string' ||
      evidence.serialized !== JSON.stringify(evidence.actual)) unavailable();
  captureUnhealthyApiKeyMaterial(evidence.credentials, evidence.proxyOptions);
  validateAccountingEmbeddingsDispatch({ model: evidence.model, mediaConfig: evidence.mediaConfig,
    serializedBody: evidence.serialized, originalSerializedBody: JSON.stringify(evidence.body) }, evidence.url);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${evidence.credentials.apiKey}` };
  if (!isDeepStrictEqual(evidence.headers, headers)) unavailable();
  return evidence;
}

// AbortSignal stays a separate lifecycle input. Descriptor projection is before
// any body/header/proxy read, including the strict transport acquisition path.
export function validateUnhealthyEmbeddingsOptions(value, url, options, proxyOptions) {
  if (typeof url !== 'string' || !options || typeof options !== 'object' || types.isProxy(options) ||
      Object.getPrototypeOf(options) !== Object.prototype) unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const fields = ['method', 'headers', 'body', 'redirect'];
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || ![...fields, 'signal'].includes(key)) ||
      !fields.every(key => Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some(entry => !entry.enumerable || !Object.hasOwn(entry, 'value'))) unavailable();
  const retained = captureUnhealthyEmbeddingsDispatch(value);
  const current = snapshotAccountingPreparedData({ url, options: Object.fromEntries(fields.map(key => [key, descriptors[key].value])), proxyOptions });
  if (current.url !== retained.url || current.options.method !== 'POST' || current.options.redirect !== 'error' ||
      current.options.body !== retained.serialized || !isDeepStrictEqual(current.options.headers, retained.headers) ||
      !isDeepStrictEqual(current.proxyOptions, retained.proxyOptions)) unavailable();
  return retained;
}
