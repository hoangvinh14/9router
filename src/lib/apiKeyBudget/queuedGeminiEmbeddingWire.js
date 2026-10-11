import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { validateGeminiEmbeddingAuthority } from './geminiEmbeddingAuthority.js';
import { validateAccountingProxyEnvironment } from '../../../open-sse/config/accountedProxyEnvironment.js';

import { QUEUED_GEMINI_EMBEDDING_PROTOCOL } from '../../../open-sse/config/accountedGeminiEmbeddingDispatch.js';
export { QUEUED_GEMINI_EMBEDDING_PROTOCOL };
const fields = Object.freeze(['protocol', 'geminiEmbeddingTransport', 'proxyEnvironment']);
const unavailable = () => { throw new Error('Queued Gemini embedding wire unavailable'); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function parseRecord(value) {
  if (typeof value !== 'string') unavailable();
  let parsed;
  try { parsed = JSON.parse(value); } catch { unavailable(); }
  if (!record(parsed)) unavailable();
  return parsed;
}

// INTERNAL complete prepared-wire equality only, not a dispatch/selection/origin
// or own ACK grant. The embedding image contains a query-key URL; never store
// it in ledger, logs, management output or exception messages.
export function validateQueuedGeminiEmbeddingWire(authority, value) {
  try {
    // Guard both arguments as one aggregate BEFORE any authority/wire reads.
    const command = snapshotAccountingGroup([{ type: 'gemini-embedding-wire', value: { authority, wire: value } }])[0];
    if (command.type !== 'gemini-embedding-wire') unavailable();
    const material = command.value;
    authority = material.authority;
    const wire = material.wire;
    if (!record(authority) || !record(authority.connection) || !record(wire) ||
        wire.protocol !== QUEUED_GEMINI_EMBEDDING_PROTOCOL || Object.keys(wire).length !== fields.length ||
        fields.some(field => !Object.hasOwn(wire, field))) unavailable();
    // Encoded strings do not establish key/depth/bounds safety. Guard complete
    // decoded settings/connection alongside the original material, before any
    // projection can discard unsupported fields or a forbidden nested key.
    const parsed = snapshotAccountingGroup([{ type: 'gemini-embedding-json', value: { material,
      settings: parseRecord(authority.settings), connection: parseRecord(authority.connection.data) } }])[0];
    if (parsed.type !== 'gemini-embedding-json') unavailable();
    validateGeminiEmbeddingAuthority(authority, wire.geminiEmbeddingTransport);
    validateAccountingProxyEnvironment(wire.proxyEnvironment);
    return wire;
  } catch { unavailable(); }
}
