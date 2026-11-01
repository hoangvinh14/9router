import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { extractClientApiKey } from './keyAccess.js';
import { createPersistedEmbeddingsAuthority, embeddingsTarget } from '../../lib/accounting/persisted-embeddings-authority.js';
import { createAccountingService } from '../../lib/accounting/service.js';
import { resolveReferencePriceSync } from '../../lib/pricing/referenceResolver.js';
import { unavailable } from '../../lib/accounting/attempt-payload.js';
import { accountingRefusal, captureTransportEnvironment } from '../../../open-sse/utils/accounting-transport.js';
import { EMBEDDINGS_USAGE_PROFILE, assertEmbeddingsRequest, assertEmbeddingsPrice } from '../../../open-sse/utils/accounting-embeddings-usage.js';
import { budgetInstant, serverBudgetClock } from '../../lib/accounting/budget-windows.js';
import { FETCH_CONNECT_TIMEOUT_MS } from '../../../open-sse/config/runtimeConfig.js';

const fixtures = new WeakMap();
// Private, single-use fixture enrollment; no shipping caller activates it.
export function associateEmbeddingsAccountingFixture(request, db, hooks = {}, { clock = serverBudgetClock } = {}) {
  if (fixtures.has(request) || !db?.ownerInstanceId || !db.coverage) throw unavailable('Invalid embeddings fixture association');
  budgetInstant(clock); fixtures.set(request,{db,hooks,clock});
}
export function captureEmbeddingsAccounting(request) {
  const fixture = fixtures.get(request);
  if (!fixture) return null;
  fixtures.delete(request);
  try {return createSession(request,fixture);} catch (error) {throw accountingRefusal(error);}
}
function createSession(request,{db,hooks,clock}) {
  const authority = createPersistedEmbeddingsAuthority(db,extractClientApiKey(request));
  const service = db.health().healthy ? createAccountingService(db) : null;
  const environment = captureTransportEnvironment(), contexts = new Set();
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener('abort',abort,{once:true});
  if (request.signal.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error('Embeddings request deadline exceeded')),FETCH_CONNECT_TIMEOUT_MS);
  timer.unref?.();
  const signal = controller.signal;
  let disposed = false, target = null, expectedBody = null;
  // Only fixture delivery hooks are asynchronous ACK barriers. A canceled
  // request cannot wait forever for a withheld delivery; the durable operation
  // remains owned and a later hook resolution grants no dispatch permission.
  async function deliver(pending) {
    let abortDelivery;
    const canceled = new Promise((_,reject) => {abortDelivery = () => reject(signal.reason || unavailable('Embeddings delivery canceled'));});
    signal.addEventListener('abort',abortDelivery,{once:true});
    if (signal.aborted) abortDelivery();
    try {return await Promise.race([pending,canceled]);}
    finally {signal.removeEventListener('abort',abortDelivery);}
  }
  function live() {
    if (disposed || environment !== captureTransportEnvironment()) throw unavailable('Embeddings request authority unavailable');
    signal.throwIfAborted(); return true;
  }
  async function gap() {
    if (!authority.unlimited || db.health().healthy) throw unavailable('Explicit unlimited recording failure required');
    authority.assertCurrent();
    const operationId = randomUUID(), before = authority.generation();
    const result = db.coverage.latchGap(authority.apiKeyId,'Embeddings accounting recording unavailable');
    if (result.generation !== before + 1) throw unavailable('Unexpected embeddings coverage operation');
    await deliver(hooks.gapAck?.(Object.freeze({operationId,generation:result.generation})));
    authority.acceptOwnGap(result.generation);
    return Object.freeze({operationId,generation:result.generation});
  }
  function bind(candidate,credentials) {
    if (db.health().healthy && db.health().dirty) {
      authority.assertSelection(candidate,credentials,db); db.durableTransaction(() => {});
    }
    live();
    if (!target || candidate.provider !== target.provider || candidate.model !== target.model || candidate.endpoint !== 'embeddings') throw unavailable('Embeddings route outside request');
    authority.assertSelection(candidate,credentials);
    const price = () => assertEmbeddingsPrice(resolveReferencePriceSync(db,candidate.provider,candidate.model,'embeddings'));
    // E1 cannot certify a missing original input-only price under degraded
    // storage. Own coverage ACK protects failures; it never substitutes price.
    if (!service || !db.health().healthy) throw unavailable('Embeddings original price unavailable');
    price();
    // Retain immutable credentials, not the object that core refresh may mutate.
    const retainedCredentials = structuredClone(credentials);
    const context = service && db.health().healthy ? service.createContext({apiKeyId:authority.apiKeyId,clock,
      validateAuthoritySync:({candidate:current}) => {
        if (!isDeepStrictEqual(current,candidate) || disposed || environment !== captureTransportEnvironment()) return false;
        price(); return authority.assertSelection(candidate,retainedCredentials,db);
      }}) : null;
    if (context) contexts.add(context);
    return Object.freeze({profile:EMBEDDINGS_USAGE_PROFILE,signal,
      resolveUrl(adapterUrl) {
        live(); authority.assertSelection(candidate,credentials);
        const saved = retainedCredentials.providerSpecificData.baseUrl;
        const expectedAdapter = `${saved.replace(/\/$/, '').replace(/\/embeddings$/, '')}/embeddings`;
        if (adapterUrl !== expectedAdapter) throw accountingRefusal(unavailable('Embeddings adapter target changed'));
        return embeddingsTarget(saved);
      },
      async prepare(wire) {
        try {
          live(); authority.assertSelection(candidate,credentials);
          if (!isDeepStrictEqual(credentials,retainedCredentials)) throw unavailable('Embeddings runtime credentials changed');
          const body = JSON.parse(wire.body); assertEmbeddingsRequest(body);
          if (!isDeepStrictEqual(body,expectedBody)) throw unavailable('Embeddings serialized input changed');
          const headers = new Headers(JSON.parse(wire.headers));
          const expectedUrl = embeddingsTarget(credentials.providerSpecificData.baseUrl);
          const savedProxy = retainedCredentials.providerSpecificData;
          const expectedProxy = savedProxy.connectionProxyEnabled ? savedProxy.connectionProxyUrl : null;
          if ((expectedProxy && (wire.route.kind !== 'proxy' || wire.route.proxyUrl !== expectedProxy)) ||
              (!expectedProxy && (wire.route.kind !== 'direct' || wire.route.proxyUrl))) throw unavailable('Embeddings effective proxy changed');
          if (wire.targetUrl !== expectedUrl || wire.url !== expectedUrl || wire.method !== 'POST' || body.model !== candidate.model ||
              !['direct','proxy'].includes(wire.route.kind) || wire.route.insecure ||
              (wire.route.kind === 'proxy' && (!/^http:\/\//.test(wire.route.proxyUrl) || !credentials.providerSpecificData.strictProxy)) ||
              headers.get('authorization') !== `Bearer ${retainedCredentials.apiKey}` ||
              [...headers.keys()].some(key => !['authorization','content-type'].includes(key))) throw unavailable('Embeddings wire authority changed');
          const retainedWire = JSON.stringify(wire);
          let receipt = null, consumed = false, terminal = null, disposition = null, retainedUsage = null;
          if (context && db.health().healthy) {
            try {receipt = await service.beginAttempt(context,candidate,{signal});}
            catch (error) {
              if (!db.health().healthy) await gap();
              throw error;
            }
          }
          if (receipt) {
            try {await deliver(hooks.intentAck?.(receipt,wire));}
            catch (error) {
              if (signal.aborted) await service.completeAttempt(receipt,{state:'not_dispatched',outcome:'local_refusal',finishedAt:budgetInstant(clock),notDispatchedEvidence:'Canceled before intent delivery'});
              throw error;
            }
          } else {
            if (!db.health().healthy) await gap();
            throw unavailable('Embeddings own intent unavailable');
          }
          function assertDispatch(currentWire) {
            live(); authority.assertPersistedSelection(candidate,credentials);
            if (consumed || JSON.stringify(currentWire) !== retainedWire || !isDeepStrictEqual(credentials,retainedCredentials)) throw unavailable('Embeddings POST permission absent');
            service.assertDispatchAuthority(receipt,context);
            consumed = true; return true;
          }
          function finish(usage,outcome,observation = null,exposed = true) {
            const evidence = observation && {kind:observation.kind,interrupted:observation.interrupted};
            const state = !exposed ? 'not_dispatched' : usage ? 'settled' : evidence?.kind === 'absent' && evidence.interrupted === true ? 'unrecorded' : 'unresolved';
            async function persist() {
              const payload = {state,outcome,finishedAt:budgetInstant(clock),...(usage && exposed ? {usage} : {}),
                ...(evidence ? {evidence} : {}),...(!exposed ? {notDispatchedEvidence:'Transport refused before invocation'} : {})};
              let ack;
              try {ack = await service.completeAttempt(receipt,payload);}
              catch (error) {
                if (db.health().healthy) throw error;
                await gap();
                // Durable coverage ACK protects the key; it is not a terminal
                // settlement ACK and cannot authorize replay or account advance.
                throw unavailable('Embeddings terminal recording failed');
              }
              // Late evidence may settle after disposal/abort. Durable charge
              // publication is independent of request liveness; only client
              // delivery (when a hook exists) is cancelable.
              if (hooks.terminalAck) await deliver(hooks.terminalAck(ack,payload));
              return ack;
            }
            if (terminal) {
              if (state !== 'settled' || (disposition === 'settled' && isDeepStrictEqual(retainedUsage,usage)) || !['unrecorded','unresolved','settled'].includes(disposition)) return terminal;
            }
            const previous = terminal; disposition = state; retainedUsage = usage;
            terminal = (previous ? previous.then(persist) : persist()).catch(error => {throw accountingRefusal(error);});
            return terminal;
          }
          return Object.freeze({assertDispatch,finish,
            failed:(_error,{exposed}) => finish(null,exposed ? 'network_unknown' : 'local_refusal',{kind:'absent',interrupted:true},exposed)});
        } catch (error) {throw accountingRefusal(error);}
      },
    });
  }
  return Object.freeze({signal,
    // Bound orchestration waiting locally; underlying lookups may finish late,
    // but disposed contexts and live gates cannot publish new intent/POSTs.
    wait:deliver,
    get degraded() {return !db.health().healthy;},
    responseHeaders:Object.freeze({'Cache-Control':'no-store','X-Request-Id':randomUUID(),'Access-Control-Expose-Headers':'X-Request-Id, Retry-After'}),
    settings:authority.settings,modelInfo:authority.modelInfo,credentials:authority.resolveCredentials,
    authorizeTarget(requested,body) {
      try {
        live(); assertEmbeddingsRequest(body); target = authority.authorizeTarget(requested);
        expectedBody = structuredClone({model:target.model,input:body.input,encoding_format:body.encoding_format || 'float'});
        if (body.dimensions !== undefined) expectedBody.dimensions = body.dimensions;
      } catch (error) {throw accountingRefusal(error);}
    },
    assertCurrent() {try {live(); authority.assertCurrent();} catch (error) {throw accountingRefusal(error);}},
    validateSelection(candidate,credentials) {try {live(); return authority.assertSelection(candidate,credentials);} catch (error) {throw accountingRefusal(error);}},
    bind(candidate,credentials) {try {return bind(candidate,credentials);} catch (error) {throw accountingRefusal(error);}},
    async accountFailure(connectionId,model,patch,update) {
      try {live(); const acknowledge = authority.prepareAccountFailure(connectionId,model,patch); await update(); acknowledge();}
      catch (error) {throw accountingRefusal(error);}
    },
    dispose() {
      disposed = true; clearTimeout(timer); request.signal.removeEventListener('abort',abort);
      for (const context of contexts) service.disposeContext(context); contexts.clear();
    },
  });
}
