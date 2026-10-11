import { isDeepStrictEqual } from 'node:util';
import { PROVIDERS } from './providers.js';
import { FORMATS } from '../translator/formats.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { captureAccountingBaseTransport } from './accountedBaseTransport.js';
import { ACCOUNTED_COMMANDCODE_URL, ACCOUNTED_COMMANDCODE_MODE, ACCOUNTED_COMMANDCODE_HEADER_FIELDS, COMMANDCODE_UUID, commandCodeToken, supportsCommandCodeOriginal } from './accountedCommandCodeCandidate.js';
const unavailable = () => { throw new Error('Accounting CommandCode transport unavailable'); };
export function captureAccountingCommandCodeConfig(config) {
  // Guard full config before projecting/reading; no accessor/proxy execution or
  // erased unsupported body can establish original work authority.
  const plain = snapshotAccountingPreparedData(config);
  return snapshotAccountingPreparedData({ baseTransport: captureAccountingBaseTransport(plain), timeoutMs: plain.timeoutMs ?? null });
}
export function validateAccountingCommandCodeDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  if (!evidence || Object.keys(evidence).length !== 5 || !['model', 'mode', 'commandCodeConfig', 'sessionId', 'serializedBody'].every(key => Object.hasOwn(evidence, key)) ||
      evidence.mode !== ACCOUNTED_COMMANDCODE_MODE || url !== ACCOUNTED_COMMANDCODE_URL ||
      typeof evidence.sessionId !== 'string' || !COMMANDCODE_UUID.test(evidence.sessionId) ||
      !isDeepStrictEqual(evidence.commandCodeConfig, captureAccountingCommandCodeConfig(PROVIDERS.commandcode))) unavailable();
  const transport = evidence.commandCodeConfig.baseTransport;
  if (transport.baseUrl !== url || transport.baseUrls !== null || transport.urlSuffix !== null || transport.transports !== null ||
      transport.format !== FORMATS.COMMANDCODE || transport.forceStream !== true || transport.noAuth === true) unavailable();
  let body;
  try { body = JSON.parse(evidence.serializedBody); } catch { unavailable(); }
  if (!supportsCommandCodeOriginal(body, evidence.model)) unavailable();
  return evidence;
}
export function validateAccountingCommandCodePost(value, url, options) {
  const evidence = validateAccountingCommandCodeDispatch(value, url), headers = new Headers(options.headers);
  const registryHeaders = new Headers(evidence.commandCodeConfig.baseTransport.headers || {});
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== evidence.serializedBody ||
      [...headers.keys()].some(key => !ACCOUNTED_COMMANDCODE_HEADER_FIELDS.includes(key)) ||
      !headers.get('authorization')?.startsWith('Bearer ') || !commandCodeToken(headers.get('authorization')?.slice(7)) ||
      headers.get('content-type') !== 'application/json' || headers.get('accept') !== 'text/event-stream' || headers.get('x-session-id') !== evidence.sessionId) unavailable();
  for (const key of ['x-command-code-version', 'x-cli-environment']) {
    if (!registryHeaders.get(key) || headers.get(key) !== registryHeaders.get(key)) unavailable();
  }
  return evidence;
}
