import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { extractClientApiKey } from "./keyAccess.js";
import { createPersistedChatAuthority } from "../../lib/accounting/persisted-chat-authority.js";
import { createAccountingService } from "../../lib/accounting/service.js";
import { unavailable } from "../../lib/accounting/attempt-payload.js";
import { accountingRefusal, captureTransportEnvironment } from "../../../open-sse/utils/accounting-transport.js";
import { OPENAI_EXPLICIT_USAGE_PROFILE } from "../../../open-sse/utils/accounting-openai-usage.js";

const fixtures = new WeakMap();
// Internal disposable-fixture association only. No header, body, environment,
// settings flag or production call site activates accounting in this slice.
export function associateChatAccountingFixture(request, db, hooks = {}) {
  if (fixtures.has(request) || !db?.ownerInstanceId || !db.coverage) throw unavailable("Invalid chat fixture association");
  fixtures.set(request, { db, hooks });
}

export function captureChatAccounting(request) {
  const fixture = fixtures.get(request);
  if (!fixture) return null;
  fixtures.delete(request);
  try { return createSession(request, fixture); }
  catch (error) { throw accountingRefusal(error); }
}

function createSession(request, { db, hooks }) {
  const authority = createPersistedChatAuthority(db, extractClientApiKey(request));
  const service = db.health().healthy ? createAccountingService(db) : null;
  const environment = captureTransportEnvironment(), contexts = new Set();
  let disposed = false, requested = null, targets = null;
  function live() {
    if (disposed || environment !== captureTransportEnvironment()) throw unavailable("Chat request authority unavailable");
    request.signal.throwIfAborted();
    return true;
  }
  async function gap() {
    if (!authority.unlimited || db.health().healthy) throw unavailable("Explicit unlimited recording failure required");
    authority.assertCurrent();
    const operationId = randomUUID(), before = authority.generation();
    const result = db.coverage.latchGap(authority.apiKeyId, "Chat accounting recording unavailable");
    // Retain the result of this operation in this closure. A visible sidecar
    // row or copied object can never deliver this operation's ACK.
    if (result.generation !== before + 1) throw unavailable("Unexpected coverage operation");
    await hooks.gapAck?.(Object.freeze({ operationId, generation: result.generation }));
    authority.acceptOwnGap(result.generation);
    return Object.freeze({ operationId, generation: result.generation });
  }
  function reachable(target, seen = new Set()) {
    if (seen.has(target)) throw unavailable("Recursive accounting combo");
    seen.add(target);
    const members = authority.comboModels(target);
    if (members) return members.flatMap(member => reachable(member, new Set(seen)));
    return [authority.modelInfo(target)];
  }
  function bind(candidate, credentials) {
    if (db.health().healthy && db.health().dirty) {
      authority.assertSelection(candidate, credentials, db);
      db.durableTransaction(() => {});
    }
    live();
    if (!requested || !targets.some(info => info.provider === candidate.provider && info.model === candidate.model)) throw unavailable("Accounting route outside request authority");
    authority.assertSelection(candidate, credentials);
    const context = service && db.health().healthy ? service.createContext({ apiKeyId: authority.apiKeyId,
      validateAuthoritySync: ({ candidate: current }) => {
        if (!isDeepStrictEqual(current, candidate) || disposed || environment !== captureTransportEnvironment()) return false;
        return authority.assertSelection(candidate, credentials, db);
      } }) : null;
    if (context) contexts.add(context);
    return Object.freeze({ profile: OPENAI_EXPLICIT_USAGE_PROFILE, signal: request.signal,
      async prepare(wire) {
        try {
          live(); authority.assertSelection(candidate, credentials);
          const expectedUrl = `${credentials.providerSpecificData.baseUrl.replace(/\/$/, "")}/chat/completions`;
          if (wire.targetUrl !== expectedUrl || wire.method !== "POST" || JSON.parse(wire.body).model !== candidate.model) throw unavailable("Chat wire outside selected authority");
          const retainedWire = JSON.stringify(wire);
          let receipt = null, gapAck = null, consumed = false, terminal = null;
          if (context && db.health().healthy) {
            try { receipt = await service.beginAttempt(context, candidate, { signal: request.signal }); }
            catch (error) { if (db.health().healthy) throw error; }
          }
          if (receipt) await hooks.intentAck?.(receipt, wire);
          else gapAck = await gap();
          const assertDispatch = currentWire => {
            live(); authority.assertPersistedSelection(candidate, credentials);
            if (consumed || JSON.stringify(currentWire) !== retainedWire) throw unavailable("Chat POST permission absent or consumed");
            if (gapAck && authority.generation() !== gapAck.generation) throw unavailable("Chat gap authority changed");
            if (receipt) service.assertDispatchAuthority(receipt, context);
            consumed = true;
            return true;
          };
          const finish = (usage, outcome, exposed = true) => {
            if (terminal) return terminal;
            terminal = (async () => {
              if (!receipt) return gapAck;
              const evidence = { state: exposed ? usage ? "settled" : "unresolved" : "not_dispatched",
                outcome, finishedAt: new Date().toISOString(), ...(usage && exposed ? { usage } : {}),
                ...(!exposed ? { notDispatchedEvidence: "Transport refused before invocation" } : {}) };
              let ack;
              try { ack = await service.completeAttempt(receipt, evidence); }
              catch (error) { if (db.health().healthy) throw error; return gap(); }
              await hooks.terminalAck?.(ack, evidence);
              return ack;
            })().catch(error => { throw accountingRefusal(error); });
            return terminal;
          };
          return Object.freeze({ assertDispatch, finish,
            failed: (error, { exposed }) => finish(null, exposed ? "network_unknown" : "local_refusal", exposed) });
        } catch (error) { throw accountingRefusal(error); }
      },
    });
  }
  return Object.freeze({
    get degraded() { return !db.health().healthy; },
    settings: authority.settings, modelInfo: authority.modelInfo, comboModels: authority.comboModels,
    credentials: authority.resolveCredentials,
    authorizeTarget(target) { live(); authority.authorizeTarget(target); requested = target; targets = reachable(target); },
    async accountFailure(connectionId, model, patch, update) {
      try {
        live(); const acknowledge = authority.prepareAccountFailure(connectionId, model, patch);
        await update(); acknowledge();
      } catch (error) { throw accountingRefusal(error); }
    },
    bind(candidate, credentials) { try { return bind(candidate, credentials); } catch (error) { throw accountingRefusal(error); } },
    dispose() { disposed = true; for (const context of contexts) service.disposeContext(context); contexts.clear(); },
  });
}
