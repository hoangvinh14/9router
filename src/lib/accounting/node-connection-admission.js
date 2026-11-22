import { openNodeSqliteAttempt } from '../db/adapters/nodeSqliteAdapter.js';
import { assertAccountingHealthy, faultAccounting } from './process-state.js';
import { unavailable } from './attempt-payload.js';
import { quarantineNodeAccountingConnection } from './node-outer-transaction.js';

// Candidate selected-Node boundary only. Ordinary driver/fallback is NOT wired to
// this path. No alternative engine, automatic retry/replacement, migration, own
// ACK, exclusive lifetime ownership, terminal-recording or dispatch authority.
const KEY = Symbol.for('9router.accounting.node-connection-admission.v1');
if (!Object.hasOwn(globalThis, KEY)) {
  const handles = new WeakMap();
  Object.defineProperty(globalThis, KEY, { value: Object.freeze({
    version: 1,
    put: (handle, entry) => handles.set(handle, entry),
    get: handle => handles.get(handle),
  }), writable: false, configurable: false });
}
const descriptor = Object.getOwnPropertyDescriptor(globalThis, KEY);
const registry = descriptor?.value;
if (descriptor?.writable !== false || descriptor?.configurable !== false ||
    !Object.isFrozen(registry) || registry?.version !== 1 ||
    typeof registry.put !== 'function' || typeof registry.get !== 'function') throw unavailable();

function dispose(closeStrict) {
  try {
    const result = closeStrict();
    if (result?.closure !== 'confirmed' || result.checkpoint === 'failed') faultAccounting();
    return result;
  } catch {
    faultAccounting();
    return Object.freeze({ closure: 'unknown', checkpoint: 'not_attempted' });
  }
}

export async function admitNodeAccountingConnection(filePath) {
  assertAccountingHealthy();
  let attempt;
  try { attempt = await openNodeSqliteAttempt(filePath); }
  catch { faultAccounting(); throw unavailable(); } // unclassified failure, never fallback
  if (!attempt.ok) {
    // Only actual import-unavailable-before-open is exempt from unknown-open fault.
    // Confirmed cleanup is not permission to retry or replace after init failure.
    if (attempt.phase !== 'unavailable_before_open') faultAccounting();
    throw Object.assign(unavailable(), { initializationPhase: attempt.phase, closure: attempt.closure });
  }
  try {
    // A peer may fault while this attempt awaits import/initialization.
    assertAccountingHealthy();
    const handle = Object.freeze({ adapter: attempt.adapter });
    registry.put(handle, { closeStrict: attempt.closeStrict });
    return handle;
  } catch {
    faultAccounting();
    dispose(attempt.closeStrict);
    throw unavailable();
  }
}

export function closeNodeAccountingConnection(handle) {
  const entry = handle && typeof handle === 'object' ? registry.get(handle) : null;
  if (!entry) throw unavailable(); // caller-supplied adapter/closure fields grant nothing
  // Closing remains available after the process fault; it never clears the latch.
  // Closing retires this connection from all cooperative accounting use, even
  // if native close throws before execution. Retained terminal rights cannot
  // treat a still-open handle as permission to use a lifecycle-uncertain DB.
  quarantineNodeAccountingConnection(handle.adapter);
  return dispose(entry.closeStrict);
}
