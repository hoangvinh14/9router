import { isDeepStrictEqual } from 'node:util';
import { PROVIDERS } from './providers.js';
import { FORMATS } from '../translator/formats.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_KIRO_URL, KIRO_ACCOUNTING_UUID, supportsKiroOriginal } from './accountedKiroCandidate.js';
export { ACCOUNTED_KIRO_URL } from './accountedKiroCandidate.js';

// Explicit internal single-generation Q route only. Current registry equality
// is a fingerprint, never authority for regional/fallback/custom destinations.
export const ACCOUNTED_KIRO_MODE = 'native-kiro-eventstream';
export const ACCOUNTED_KIRO_DISPATCH_FIELDS = Object.freeze(['model', 'mode', 'kiroConfig', 'invocationId', 'serializedBody']);
export const ACCOUNTED_KIRO_HEADER_FIELDS = Object.freeze([
  'content-type', 'accept', 'user-agent', 'x-amz-user-agent', 'amz-sdk-request', 'amz-sdk-invocation-id',
  'authorization', 'tokentype', 'x-amz-sso-bearer', 'x-amzn-kiro-agent-mode',
  'x-amzn-codewhisperer-machine-id', 'x-amzn-codewhisperer-profile-arn',
]);
export const ACCOUNTED_KIRO_REGISTRY_HEADER_FIELDS = Object.freeze(['content-type', 'accept', 'user-agent', 'x-amz-user-agent']);
export const ACCOUNTED_KIRO_PROFILE_PREFIX = 'arn:aws:codewhisperer:us-east-1:';
export const ACCOUNTED_KIRO_FIXED_HEADERS = Object.freeze({
  'content-type': 'application/json', accept: 'application/vnd.amazon.eventstream',
  'amz-sdk-request': 'attempt=1; max=3', tokentype: 'API_KEY',
  'x-amzn-kiro-agent-mode': 'spec', 'x-amzn-codewhisperer-machine-id': 'kiro-desktop',
});
const unavailable = () => { throw new Error('Accounting Kiro transport unavailable'); };
export const kiroAccountingToken = value => typeof value === 'string' && value.length > 0 && !/[\s\x00-\x1f\x7f]/.test(value);
export function captureAccountingKiroConfig(config) {
  // Whole config guard before any projection/property read; full original
  // registry configuration retained, not just the selected route/headers.
  return snapshotAccountingPreparedData(config);
}
export function validateAccountingKiroDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  if (!evidence || Object.keys(evidence).length !== ACCOUNTED_KIRO_DISPATCH_FIELDS.length ||
      !ACCOUNTED_KIRO_DISPATCH_FIELDS.every(key => Object.hasOwn(evidence, key)) ||
      evidence.mode !== ACCOUNTED_KIRO_MODE || url !== ACCOUNTED_KIRO_URL ||
      typeof evidence.invocationId !== 'string' || !KIRO_ACCOUNTING_UUID.test(evidence.invocationId) ||
      !isDeepStrictEqual(evidence.kiroConfig, captureAccountingKiroConfig(PROVIDERS.kiro))) unavailable();
  const config = evidence.kiroConfig;
  if (config.format !== FORMATS.KIRO || config.noAuth === true || config.urlSuffix != null || config.transports != null ||
      !Array.isArray(config.baseUrls) || !config.baseUrls.includes(url)) unavailable();
  let body;
  try { body = JSON.parse(evidence.serializedBody); } catch { unavailable(); }
  if (!supportsKiroOriginal(body, evidence.model) ||
      Object.hasOwn(body, 'profileArn') && !body.profileArn.startsWith(ACCOUNTED_KIRO_PROFILE_PREFIX)) unavailable();
  return evidence;
}
export function validateAccountingKiroPost(value, url, options) {
  const evidence = validateAccountingKiroDispatch(value, url), headers = new Headers(options.headers);
  const registry = new Headers(evidence.kiroConfig.headers || {});
  const token = headers.get('authorization')?.startsWith('Bearer ') ? headers.get('authorization').slice(7) : null;
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== evidence.serializedBody ||
      [...headers.keys()].some(key => !ACCOUNTED_KIRO_HEADER_FIELDS.includes(key)) ||
      [...registry.keys()].length !== ACCOUNTED_KIRO_REGISTRY_HEADER_FIELDS.length ||
      [...registry.keys()].some(key => !ACCOUNTED_KIRO_REGISTRY_HEADER_FIELDS.includes(key)) ||
      !kiroAccountingToken(token) || headers.get('x-amz-sso-bearer') !== token ||
      headers.get('amz-sdk-invocation-id') !== evidence.invocationId) unavailable();
  for (const [key, expected] of Object.entries(ACCOUNTED_KIRO_FIXED_HEADERS)) {
    if (headers.get(key) !== expected) unavailable();
  }
  for (const key of ACCOUNTED_KIRO_REGISTRY_HEADER_FIELDS) {
    if (!registry.get(key) || headers.get(key) !== registry.get(key)) unavailable();
  }
  const body = JSON.parse(evidence.serializedBody);
  if (headers.get('x-amzn-codewhisperer-profile-arn') !== (body.profileArn ?? null)) unavailable();
  // Header presence/pair equality is not mutable original-token identity or
  // persisted profile/authMethod authority. Future frozen owner + queued
  // fresh credential equality must establish those independently.
  return evidence;
}
