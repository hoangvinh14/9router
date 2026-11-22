import { unavailable } from './attempt-payload.js';

// Internal primitive only: no adapter durability, intent ownership or route admission.
// One JS global (including module/HMR copies), NOT worker-thread/realm coordination.
const STATE = Symbol.for('9router.accounting.process-fault.v1');

function sharedState() {
  if (!Object.hasOwn(globalThis, STATE)) {
    let faulted = false;
    Object.defineProperty(globalThis, STATE, {
      value: Object.freeze({
        version: 1,
        isFaulted: () => faulted,
        trip: () => { faulted = true; },
      }),
      writable: false, configurable: false, enumerable: false,
    });
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, STATE);
  const state = descriptor?.value;
  // Never replace an incompatible/old state with a fresh healthy one.
  if (descriptor?.configurable !== false || descriptor?.writable !== false ||
      !Object.isFrozen(state) || state?.version !== 1 ||
      typeof state.isFaulted !== 'function' || typeof state.trip !== 'function') {
    throw unavailable();
  }
  return state;
}

const state = sharedState();

export function assertAccountingHealthy() {
  if (state.isFaulted() !== false) throw unavailable();
}

// No reset/probe/recovery API. Store no causes, keys, payloads or adapter objects.
export function faultAccounting() {
  state.trip();
}

function requireSynchronousApproval(callback, value) {
  if (typeof callback !== 'function') throw unavailable();
  const approved = callback(value);
  if (approved !== true) {
    // Accidental async callbacks are refused; observe late rejection as well.
    // Callbacks must be side-effect-free: rejecting cannot undo their side effects.
    if (approved && (typeof approved === 'object' || typeof approved === 'function')) {
      Promise.resolve(approved).catch(() => {});
    }
    throw unavailable();
  }
}

// Writer contract: { ok: true, ack }, only AFTER the selected adapter's qualified
// outer commit/publication. Missing/false ok is an error result, not D01 usage.
// validateOwnAck must synchronously verify this exact command/payload/owner; a row,
// generic boolean, nested RELEASE or scheduled export cannot establish own ACK.
// This primitive does not qualify the adapter or manufacture/consume intent rights.
export async function awaitAccountingWrite(write, validateOwnAck) {
  assertAccountingHealthy();
  const ack = await recordWithAck(write, validateOwnAck);
  // Another recording operation may have faulted while this write was pending.
  assertAccountingHealthy();
  return ack;
}

// Retained sink ONLY for evidence of an already admitted original attempt.
// Future caller must establish that ownership; this ACK is recording confirmation,
// never dispatch authority or recovery. Do not drop known evidence after a fault.
export function awaitTerminalAccountingWrite(write, validateOwnAck) {
  return recordWithAck(write, validateOwnAck);
}

async function recordWithAck(write, validateOwnAck) {
  try {
    if (typeof write !== 'function' || typeof validateOwnAck !== 'function') throw unavailable();
    const result = await write();
    if (!result || result.ok !== true || !Object.hasOwn(result, 'ack')) throw unavailable();
    const ack = result.ack;
    if (ack === undefined || ack === null) throw unavailable();
    requireSynchronousApproval(validateOwnAck, ack);
    return ack;
  } catch {
    faultAccounting();
    throw unavailable();
  }
}

// finalCheck must synchronously check current identity/policy/spend/price/window,
// destination and OWN unused intent ACK. Denial (false/throw/async) is NOT itself
// storage corruption. All callbacks are server-owned, never client authority.
// No await gap between approval/fault recheck and invocation. initiate must start
// the real transport immediately; queued/async preludes require a gate THERE.
// Return/throw from transport is not proof of accounting failure or non-exposure.
export function finalAccountingDispatch(finalCheck, initiate) {
  assertAccountingHealthy();
  if (typeof initiate !== 'function') throw unavailable();
  try {
    requireSynchronousApproval(finalCheck);
  } catch {
    throw unavailable();
  }
  assertAccountingHealthy();
  return initiate();
}
