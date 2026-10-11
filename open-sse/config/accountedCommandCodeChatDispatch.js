import { isDeepStrictEqual, types } from 'node:util';
import { PROVIDERS } from './providers.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { captureAccountingCommandCodeConfig, validateAccountingCommandCodePost } from './accountedCommandCodeDispatch.js';
import { validateCommandCodeChatConversion } from './accountedCommandCodeChatConversion.js';
import { commandCodeToken } from './accountedCommandCodeCandidate.js';

const INPUT_FIELDS = Object.freeze(['body', 'model', 'stream', 'credentials', 'providerOverrides', 'proxyOptions', 'config', 'runtime']);
const unavailable = () => { throw new Error('Accounting CommandCode chat transport unavailable'); };
const exactFields = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

// Complete captured equality, not proof of persisted selection or identity origin.
// Caller supplies plain detached POST fields. Headers/Request instances are not
// accepted; persisted authority remains a separate integration boundary.
export function validateAccountingCommandCodeChatPost(value, url, options) {
  const evidence = snapshotAccountingPreparedData(value), post = snapshotAccountingPreparedData(options);
  if (!exactFields(evidence, ['capture', 'nativeTransport']) || !exactFields(evidence.capture, ['original', 'actual', 'identity']) ||
      !exactFields(post, ['method', 'redirect', 'body', 'headers'])) unavailable();
  const { original, actual, identity } = evidence.capture, transport = evidence.nativeTransport;
  if (!exactFields(original, INPUT_FIELDS) || original.stream !== true || transport?.model !== original.model ||
      !isDeepStrictEqual(original.config, PROVIDERS.commandcode) ||
      !isDeepStrictEqual(transport.commandCodeConfig, captureAccountingCommandCodeConfig(original.config)) ||
      !validateCommandCodeChatConversion(original.body, original.model, identity, actual) ||
      !isDeepStrictEqual(original.runtime, { workingDir: identity.workingDir, date: identity.date, environment: identity.environment }) ||
      transport.serializedBody !== JSON.stringify(actual)) unavailable();
  const credentials = original.credentials;
  if (!credentials || Array.isArray(credentials) ||
      Object.keys(credentials).some(key => !['apiKey', 'accessToken', 'connectionId', 'providerSpecificData'].includes(key)) ||
      !commandCodeToken(credentials.apiKey) || credentials.accessToken != null || typeof credentials.connectionId !== 'string' || !credentials.connectionId) unavailable();
  validateAccountingCommandCodePost(transport, url, post);
  const expected = new Headers(original.config.headers || {});
  expected.set('Content-Type', 'application/json'); expected.set('Accept', 'text/event-stream');
  expected.set('Authorization', `Bearer ${credentials.apiKey}`); expected.set('x-session-id', transport.sessionId);
  if (original.providerOverrides !== null) {
    if (!exactFields(original.providerOverrides, ['headers'])) unavailable();
    for (const [key, entry] of Object.entries(original.providerOverrides.headers)) expected.set(key, entry);
  }
  const names = new Set();
  for (const [key, entry] of Object.entries(post.headers)) {
    if (names.has(key.toLowerCase()) || typeof entry !== 'string') unavailable();
    names.add(key.toLowerCase());
  }
  if (expected.get('authorization') !== `Bearer ${credentials.apiKey}` ||
      !isDeepStrictEqual(Object.fromEntries(new Headers(post.headers)), Object.fromEntries(expected))) unavailable();
  return evidence;
}

// Descriptor-only projection before any programmable POST field read. The
// owner's AbortSignal is not plain retained data and is deliberately excluded;
// this does not authenticate arbitrary signal implementations or other inputs.
export function validateAccountingCommandCodeChatOptions(value, url, options, proxyOptions) {
  const selectedProxy = snapshotAccountingPreparedData(proxyOptions);
  if (!options || typeof options !== 'object' || types.isProxy(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const fields = ['method', 'redirect', 'body', 'headers'];
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || ![...fields, 'signal'].includes(key)) ||
      !fields.every(key => Object.hasOwn(descriptors, key))) unavailable();
  for (const descriptor of Object.values(descriptors)) {
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) unavailable();
  }
  const post = Object.fromEntries(fields.map(key => [key, descriptors[key].value]));
  const evidence = validateAccountingCommandCodeChatPost(value, url, post);
  if (!isDeepStrictEqual(selectedProxy, evidence.capture.original.proxyOptions)) unavailable();
  return evidence;
}
