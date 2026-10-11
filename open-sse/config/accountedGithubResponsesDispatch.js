import { isDeepStrictEqual } from 'node:util';
import { PROVIDERS } from './providers.js';
import { captureAccountingBaseTransport } from './accountedBaseTransport.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTED_GITHUB_RESPONSES_URL, ACCOUNTED_GITHUB_RESPONSES_MODE, ACCOUNTED_GITHUB_RESPONSES_HEADER_FIELDS, githubResponsesIdentity, githubResponsesHeaders, supportsGithubResponsesRequest } from './accountedGithubResponsesCandidate.js';
const unavailable = () => { throw new Error('Accounting GitHub Responses transport unavailable'); };
export function captureAccountingGithubResponsesConfig(config) {
  // Guard the complete plain config BEFORE programmable reads of extra route fields.
  const plain = snapshotAccountingPreparedData(config);
  return snapshotAccountingPreparedData({ baseTransport: captureAccountingBaseTransport(plain), responsesUrl: plain.responsesUrl ?? null, messagesUrl: plain.messagesUrl ?? null });
}
export function validateAccountingGithubResponsesDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  if (!evidence || Object.keys(evidence).length !== 5 || !['model', 'mode', 'githubConfig', 'requestId', 'serializedBody'].every(key => Object.hasOwn(evidence, key)) ||
      evidence.mode !== ACCOUNTED_GITHUB_RESPONSES_MODE || url !== ACCOUNTED_GITHUB_RESPONSES_URL ||
      !githubResponsesIdentity(evidence.requestId) || !isDeepStrictEqual(evidence.githubConfig, captureAccountingGithubResponsesConfig(PROVIDERS.github)) ||
      evidence.githubConfig.responsesUrl !== url) unavailable();
  let body;
  try { body = JSON.parse(evidence.serializedBody); } catch { unavailable(); }
  if (!supportsGithubResponsesRequest(body, evidence.model)) unavailable();
  return evidence;
}
export function validateAccountingGithubResponsesPost(value, url, options) {
  const evidence = validateAccountingGithubResponsesDispatch(value, url), headers = new Headers(options.headers);
  const canonical = new Headers(githubResponsesHeaders({ copilotToken: 'placeholder' }, evidence.requestId));
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== evidence.serializedBody ||
      [...headers.keys()].some(key => !ACCOUNTED_GITHUB_RESPONSES_HEADER_FIELDS.includes(key)) ||
      !headers.get('authorization')?.startsWith('Bearer ') || !githubResponsesIdentity(headers.get('authorization')?.slice(7))) unavailable();
  for (const [key, expected] of canonical) if (key !== 'authorization' && headers.get(key) !== expected) unavailable();
  return evidence;
}
