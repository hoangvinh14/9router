import { ACCOUNTING_JSON_MAX_BYTES } from '../config/runtimeConfig.js';
import { observeEmbeddingsJson } from '../utils/accounting-embeddings-usage.js';
import { accountingRefusal } from '../utils/accounting-transport.js';
import { proxyAwareFetch } from '../utils/proxyFetch.js';

// Race every pending read against the original request lifetime. Cleanup is best
// effort, never an ACK barrier (cancel implementations can reject or never settle).
async function readBounded(response,signal) {
  if (!response.body) return {bytes:new Uint8Array(),interrupted:false,invalid:false};
  const reader = response.body.getReader(), chunks = [];
  let size = 0, interrupted = false, invalid = false, ended = false;
  let rejectAbort;
  const aborted = new Promise((_,reject) => {rejectAbort = reject;});
  const abort = () => rejectAbort(signal.reason || new Error('Embeddings body aborted'));
  signal.addEventListener('abort',abort,{once:true});
  if (signal.aborted) abort();
  try {
    while (true) {
      const {done,value} = await Promise.race([reader.read(),aborted]);
      if (done) {ended = true; break;}
      size += value.byteLength;
      if (size > ACCOUNTING_JSON_MAX_BYTES) {invalid = true; break;}
      chunks.push(value);
    }
  } catch {interrupted = true;}
  finally {
    signal.removeEventListener('abort',abort);
    if (!ended) {try {void reader.cancel().catch(() => {});} catch { /* cleanup cannot replace evidence */ }}
    try {reader.releaseLock();} catch { /* pending read canceled above */ }
  }
  if (invalid) {chunks.length = 0; return {bytes:new Uint8Array(),interrupted,invalid:true};}
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk,offset); offset += chunk.byteLength;}
  chunks.length = 0;
  return {bytes,interrupted,invalid};
}

export function createEmbeddingsBoundary(accounting) {
  return Object.freeze({async prepare(wire) {
    const ticket = await accounting.prepare(wire);
    return Object.freeze({...ticket,async response(response) {
      const {bytes,interrupted,invalid} = await readBounded(response,accounting.signal);
      let observation;
      if (invalid) observation = {kind:'malformed'};
      else if (interrupted && !bytes.length) observation = {kind:'absent'};
      else {
        observation = observeEmbeddingsJson(bytes,accounting.profile);
        // A complete authoritative document already received before abort still
        // settles. Any other observed prefix is invalid, not absent evidence.
        if (interrupted && observation.kind !== 'valid') observation = {kind:'malformed'};
      }
      await ticket.finish(observation.usage || null,`http_${response.status}`,{kind:observation.kind,interrupted});
      if (!observation.usage) throw accountingRefusal(new Error('Selected embeddings usage unavailable'));
      const headers = new Headers();
      if (response.headers.has('content-type')) headers.set('content-type',response.headers.get('content-type'));
      headers.set('Access-Control-Allow-Origin','*');
      return new Response([204,205,304].includes(response.status) ? null : bytes,{status:response.status,statusText:response.statusText,headers});
    }});
  }});
}

export async function dispatchEmbeddings({url,options,credentials,accounting}) {
  const specific = credentials.providerSpecificData || {};
  const proxyOptions = {connectionProxyEnabled:specific.connectionProxyEnabled,connectionProxyUrl:specific.connectionProxyUrl,
    connectionNoProxy:specific.connectionNoProxy,strictProxy:specific.strictProxy === true,vercelRelayUrl:specific.vercelRelayUrl || ''};
  return proxyAwareFetch(accounting.resolveUrl(url),options,proxyOptions,createEmbeddingsBoundary(accounting));
}
