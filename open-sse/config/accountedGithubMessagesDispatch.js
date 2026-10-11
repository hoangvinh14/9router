import { isDeepStrictEqual } from 'node:util';
import { PROVIDERS } from './providers.js';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { captureAccountingGithubResponsesConfig } from './accountedGithubResponsesDispatch.js';
import { ACCOUNTED_GITHUB_MESSAGES_URL, ACCOUNTED_GITHUB_MESSAGES_MODE, ACCOUNTED_GITHUB_MESSAGES_HEADER_FIELDS, githubMessagesIdentity, githubMessagesHeaders, supportsGithubMessagesOriginal, githubMessagesAccountingBody } from './accountedGithubMessagesCandidate.js';
const unavailable = () => { throw new Error('Accounting GitHub Messages transport unavailable'); };
export function captureAccountingGithubMessagesConfig(config) {
  const plain = snapshotAccountingPreparedData(config);
  return snapshotAccountingPreparedData({ ...captureAccountingGithubResponsesConfig(plain), timeoutMs: plain.timeoutMs ?? null });
}
export function validateAccountingGithubMessagesDispatch(value, url) {
  const evidence = snapshotAccountingPreparedData(value);
  if (!evidence || Object.keys(evidence).length !== 6 || !['model', 'mode', 'githubConfig', 'requestId', 'serializedBody', 'originalSerializedBody'].every(key => Object.hasOwn(evidence, key)) ||
      evidence.mode !== ACCOUNTED_GITHUB_MESSAGES_MODE || url !== ACCOUNTED_GITHUB_MESSAGES_URL ||
      !githubMessagesIdentity(evidence.requestId) || !isDeepStrictEqual(evidence.githubConfig, captureAccountingGithubMessagesConfig(PROVIDERS.github)) ||
      evidence.githubConfig.messagesUrl !== url) unavailable();
  let body, original;
  try { body = JSON.parse(evidence.serializedBody); original = JSON.parse(evidence.originalSerializedBody); } catch { unavailable(); }
  if (!supportsGithubMessagesOriginal(original, evidence.model) || body.stream !== true || !supportsGithubMessagesOriginal(body, evidence.model) ||
      !isDeepStrictEqual(body, githubMessagesAccountingBody(original))) unavailable();
  return evidence;
}
export function validateAccountingGithubMessagesPost(value, url, options) {
  const evidence = validateAccountingGithubMessagesDispatch(value, url), headers = new Headers(options.headers);
  const canonical = new Headers(githubMessagesHeaders({ copilotToken: 'placeholder' }, evidence.requestId));
  if (options.method !== 'POST' || options.redirect !== 'error' || options.body !== evidence.serializedBody ||
      [...headers.keys()].some(key => !ACCOUNTED_GITHUB_MESSAGES_HEADER_FIELDS.includes(key)) ||
      !headers.get('authorization')?.startsWith('Bearer ') || !githubMessagesIdentity(headers.get('authorization')?.slice(7))) unavailable();
  for (const [key, expected] of canonical) if (key !== 'authorization' && headers.get(key) !== expected) unavailable();
  return evidence;
}
