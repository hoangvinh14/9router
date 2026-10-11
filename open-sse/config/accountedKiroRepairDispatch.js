import { isDeepStrictEqual, types } from 'node:util';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { captureKiroEllipsisRepairConversion } from './accountedKiroRepairConversion.js';
import { validateAccountingKiroPost, ACCOUNTED_KIRO_FIXED_HEADERS, kiroAccountingToken } from './accountedKiroDispatch.js';
import { validateAccountingProxyEnvironment } from './accountedProxyEnvironment.js';
import { captureAccountingAbortSignal } from './accountedAbortSignal.js';

const fields = Object.freeze(['protocol', 'url', 'headers', 'credentials', 'providerOverrides', 'proxyOptions', 'proxyEnvironment', 'kiroTransport', 'kiroRepairCapture']);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const unavailable = () => { throw new Error('Accounting Kiro repair transport unavailable'); };

// Full retained work equality only. Fresh persisted selection, predecessor ACK
// and successor admission are separate owner obligations, not implied here.
export function validateAccountingKiroRepairOptions(value, url, options, proxyOptions) {
  const wire = snapshotAccountingPreparedData(value), selected = snapshotAccountingPreparedData(proxyOptions);
  if (!exact(wire, fields) || wire.protocol !== 'native-kiro' || wire.url !== url || !isDeepStrictEqual(selected, wire.proxyOptions)) unavailable();
  if (!options || typeof options !== 'object' || types.isProxy(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(options), postFields = ['method', 'redirect', 'body', 'headers'];
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || ![...postFields, 'signal'].includes(key)) ||
      !postFields.every(key => Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some(entry => !Object.hasOwn(entry, 'value') || !entry.enumerable)) unavailable();
  if (descriptors.signal) captureAccountingAbortSignal(descriptors.signal.value);
  const post = snapshotAccountingPreparedData(Object.fromEntries(postFields.map(key => [key, descriptors[key].value])));
  const capture = captureKiroEllipsisRepairConversion(wire.kiroRepairCapture);
  const transport = validateAccountingKiroPost(wire.kiroTransport, url, post);
  if (capture.model !== transport.model || transport.serializedBody !== JSON.stringify(capture.actual) ||
      !isDeepStrictEqual(post.headers, wire.headers)) unavailable();
  const credentials = wire.credentials;
  if (!exact(credentials, ['apiKey', 'accessToken', 'connectionId', 'providerSpecificData']) ||
      !kiroAccountingToken(credentials.accessToken) || credentials.apiKey !== null && credentials.apiKey !== credentials.accessToken ||
      typeof credentials.connectionId !== 'string' || !credentials.connectionId ||
      credentials.providerSpecificData?.authMethod !== 'api_key' || credentials.providerSpecificData.region !== 'us-east-1' ||
      (capture.actual.profileArn ?? null) !== (credentials.providerSpecificData.profileArn ?? null)) unavailable();
  const expected = new Headers(transport.kiroConfig.headers);
  for (const [key, header] of Object.entries(ACCOUNTED_KIRO_FIXED_HEADERS)) expected.set(key, header);
  expected.set('authorization', `Bearer ${credentials.apiKey ?? credentials.accessToken}`);
  expected.set('x-amz-sso-bearer', credentials.accessToken); expected.set('amz-sdk-invocation-id', transport.invocationId);
  if (Object.hasOwn(capture.actual, 'profileArn')) expected.set('x-amzn-codewhisperer-profile-arn', capture.actual.profileArn);
  const names = new Set();
  for (const [key, header] of Object.entries(wire.headers)) {
    if (names.has(key.toLowerCase()) || typeof header !== 'string') unavailable();
    names.add(key.toLowerCase());
  }
  const canonical = Object.fromEntries(expected);
  if (!isDeepStrictEqual(Object.fromEntries(new Headers(wire.headers)), canonical)) unavailable();
  if (wire.providerOverrides !== null) {
    if (!exact(wire.providerOverrides, ['headers'])) unavailable();
    for (const [key, header] of Object.entries(wire.providerOverrides.headers)) expected.set(key, header);
    if (!isDeepStrictEqual(Object.fromEntries(expected), canonical)) unavailable();
  }
  validateAccountingProxyEnvironment(wire.proxyEnvironment);
  return wire;
}
