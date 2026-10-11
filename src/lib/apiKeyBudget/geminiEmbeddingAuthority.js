import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';
import { captureGeminiEmbeddingDispatch } from '../../../open-sse/config/accountedGeminiEmbeddingDispatch.js';
import { captureUnhealthyApiKeyMaterial } from '../../../open-sse/config/accountedUnhealthyChatDispatch.js';
import { validateQueuedSavedProxyWire } from './queuedSavedProxyWire.js';
import { validateQueuedSelectedPoolWire } from './queuedPoolWire.js';

const unavailable = () => { throw new Error('Gemini embedding authority unavailable'); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function parseRecord(value) {
  if (typeof value !== 'string') unavailable();
  const parsed = JSON.parse(value);
  if (!record(parsed)) unavailable();
  return parsed;
}

// Private equality prerequisite only. Caller must supply independently captured
// SQL authority, verify key binding/selection and re-read it after every await.
// This function does NOT issue provenance, pricing, own ACK or POST permission.
export function validateGeminiEmbeddingAuthority(authority, image) {
  try {
    const material = snapshotAccountingPreparedData({ authority, image });
    authority = material.authority;
    image = captureGeminiEmbeddingDispatch(material.image);
    if (!record(authority) || authority.provider !== 'gemini' || authority.model !== image.model ||
        !record(authority.connection) || authority.connectionId !== authority.connection.id ||
        typeof authority.connectionId !== 'string' || !authority.connectionId ||
        authority.connection.provider !== authority.provider || authority.connection.authType !== 'apikey' ||
        ![1, true].includes(authority.connection.isActive)) unavailable();
    // Snapshot parsed records too: encoded JSON is not a way around depth/node
    // bounds or forbidden object keys. No coercion or programmable reads.
    const parsed = snapshotAccountingPreparedData({ connection: parseRecord(authority.connection.data), settings: parseRecord(authority.settings) });
    const { connection, settings } = parsed;
    if (typeof connection.apiKey !== 'string' || !connection.apiKey || connection.accessToken != null ||
        connection.refreshToken != null || connection.runtimeTransport != null ||
        image.credentials.apiKey !== connection.apiKey ||
        image.credentials.connectionId !== undefined && image.credentials.connectionId !== authority.connectionId ||
        settings.providerOverrides?.gemini != null ||
        settings.headroomEnabled || settings.pxpipeEnabled || settings.cavemanEnabled || settings.ponytailEnabled ||
        settings.providerThinking?.gemini?.mode && settings.providerThinking.gemini.mode !== 'auto') unavailable();
    const specific = connection.providerSpecificData ?? {};
    if (!record(specific) || !isDeepStrictEqual(image.credentials.providerSpecificData ?? {}, specific)) unavailable();
    // Validate the persisted PSD, not just the caller's projected credential
    // subset. Unknown route semantics cannot be silently erased for equality.
    captureUnhealthyApiKeyMaterial({ apiKey: connection.apiKey, providerSpecificData: specific }, image.proxyOptions);
    validateQueuedSavedProxyWire(authority, image.proxyOptions);
    if (authority.proxyPool) validateQueuedSelectedPoolWire(authority, image.proxyOptions);
    return image;
  } catch { unavailable(); } // Never emit private JSON, query URLs or key values.
}
