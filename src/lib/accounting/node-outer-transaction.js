import { unavailable } from './attempt-payload.js';
import { assertAccountingHealthy, faultAccounting } from './process-state.js';
import { createSqlOperationScope } from './sql-operation-scope.js';

// Candidate, not installed on the adapter/driver. Same raw connection identity,
// cooperating module copies in one global; unrelated raw users are NOT fenced.
const KEY = Symbol.for('9router.accounting.node-outer-transaction.v1');
if (!Object.hasOwn(globalThis, KEY)) {
  const connections = new WeakMap();
  Object.defineProperty(globalThis, KEY, { value: Object.freeze({
    version: 1,
    claim(raw, token) {
      let entry = connections.get(raw);
      if (!entry) { entry = { owner: null, quarantined: false }; connections.set(raw, entry); }
      if (entry.owner) {
        entry.owner.failed = true; entry.quarantined = true; return false;
      }
      if (entry.quarantined) return false;
      entry.owner = token; return true;
    },
    release(raw) { connections.get(raw).owner = null; },
    quarantine(raw) {
      let entry = connections.get(raw);
      if (!entry) { entry = { owner: null, quarantined: false }; connections.set(raw, entry); }
      entry.quarantined = true;
      if (entry.owner) entry.owner.failed = true;
    },
    canRetain(raw) {
      const entry = connections.get(raw);
      return !entry || (!entry.owner && !entry.quarantined);
    },
  }), writable: false, configurable: false });
}
const descriptor = Object.getOwnPropertyDescriptor(globalThis, KEY);
const registry = descriptor?.value;
if (descriptor?.configurable !== false || descriptor?.writable !== false ||
    !Object.isFrozen(registry) || registry?.version !== 1 ||
    ['claim', 'release', 'quarantine', 'canRetain'].some(name => typeof registry[name] !== 'function')) throw unavailable();

// Internal lifecycle notification. Never clears quarantine or dispatch fault.
export function quarantineNodeAccountingConnection(adapter) {
  if (!adapter?.raw || typeof adapter.raw !== 'object') throw unavailable();
  registry.quarantine(adapter.raw);
}

export function monitorAccountingCheckpoints(adapter, observeCheckpointFailure) {
  observeCheckpointFailure(() => {
    faultAccounting();
    quarantineNodeAccountingConnection(adapter);
  });
  assertAccountingHealthy();
}

export function createNodeOuterTransaction(adapter, definitions) {
  if (adapter?.driver !== 'node:sqlite' || !adapter.raw || typeof adapter.raw !== 'object' ||
      ['run', 'get', 'all', 'exec'].some(name => typeof adapter[name] !== 'function')) throw unavailable();
  const raw = adapter.raw;
  const exec = adapter.exec.bind(adapter);
  const get = adapter.get.bind(adapter);
  // Scoped operations share this immutable wrapper; storage exceptions are
  // distinguished from callback/parameter rejection without exposing raw errors.
  let current = null;
  const failStorage = token => {
    token.storageFault = true;
    faultAccounting(); // Publish BEFORE returning control to callback/cleanup code.
    registry.quarantine(raw);
  };
  const operations = Object.freeze(Object.fromEntries(['run', 'get', 'all'].map(method => {
    const invoke = adapter[method].bind(adapter);
    return [method, (sql, params) => {
      if (!current || current.failed || current.storageFault) throw unavailable();
      if (!current.retained) assertAccountingHealthy(); // After param processing, before SQL.
      try { return invoke(sql, params); }
      catch { failStorage(current); throw unavailable(); }
    }];
  })));
  const scoped = createSqlOperationScope(operations, definitions);

  function execute(callback, retained) {
    const token = { failed: false, storageFault: false, retained };
    if (!registry.claim(raw, token)) {
      faultAccounting();
      throw Object.assign(unavailable(), { transactionOutcome: 'not_started', connectionQuarantined: true });
    }
    current = token;
    let outcome = 'not_started';
    let originalSync;
    let touched = false;
    let beginAttempted = false;
    let commitAttempted = false;
    let callbackStarted = false;
    let failed = false;
    let value;
    const storage = action => {
      try { return action(); }
      catch { failStorage(token); throw unavailable(); }
    };
    const active = () => storage(() => {
      const result = raw.isTransaction;
      if (typeof result !== 'boolean') throw unavailable();
      return result;
    });
    const check = () => {
      if (token.failed || token.storageFault) throw unavailable();
      if (!retained) assertAccountingHealthy();
    };
    try {
      check();
      // Never take over, alter PRAGMAs or roll back another transaction.
      if (active() || typeof callback !== 'function') throw unavailable();
      const mode = storage(() => get('PRAGMA journal_mode').journal_mode);
      originalSync = storage(() => get('PRAGMA synchronous').synchronous);
      if (mode !== 'wal' || ![1, 2].includes(originalSync)) throw unavailable();
      touched = true;
      storage(() => exec('PRAGMA synchronous = FULL'));
      if (storage(() => get('PRAGMA synchronous').synchronous) !== 2) {
        failStorage(token); throw unavailable();
      }
      check();
      beginAttempted = true;
      storage(() => exec('BEGIN IMMEDIATE'));
      if (!active()) { failStorage(token); throw unavailable(); }
      callbackStarted = true;
      value = scoped(callback);
      check();
      if (!active()) { failStorage(token); throw unavailable(); }
      commitAttempted = true;
      storage(() => exec('COMMIT'));
      // Only a normal COMMIT return AND confirmed inactive state is observed commit.
      if (active()) { failStorage(token); throw unavailable(); }
      outcome = 'commit_observed';
    } catch {
      failed = true;
      if (beginAttempted) {
        outcome = 'unknown';
        try {
          if (active()) {
            storage(() => exec('ROLLBACK'));
            if (active()) throw unavailable();
            outcome = 'rolled_back';
          } else if (!commitAttempted && !callbackStarted) {
            // BEGIN may have thrown before or after execution; no callback ran
            // if BEGIN did not return. Do not infer a committed result.
            outcome = 'not_started';
          }
        } catch { failStorage(token); outcome = 'unknown'; }
        if (outcome === 'unknown') failStorage(token);
      }
    } finally {
      // Hold identity guard through restoration. No restore while termination is
      // uncertain/active, and cleanup cannot erase the recorded commit outcome.
      if (touched) {
        try {
          if (active()) throw unavailable();
          storage(() => exec(originalSync === 1 ? 'PRAGMA synchronous = NORMAL' : 'PRAGMA synchronous = FULL'));
          if (storage(() => get('PRAGMA synchronous').synchronous) !== originalSync) throw unavailable();
        } catch { failStorage(token); failed = true; }
      }
      if (token.storageFault || token.failed) {
        registry.quarantine(raw); faultAccounting(); failed = true;
      }
      try { check(); } catch { failed = true; }
      current = null;
      registry.release(raw);
    }
    if (failed) throw Object.assign(unavailable(), {
      transactionOutcome: outcome, connectionQuarantined: token.storageFault || token.failed,
    });
    // Observed SQL outcome only. NOT an own/one-use intent ACK or dispatch right.
    return Object.freeze({ transactionOutcome: outcome, value });
  }

  const transact = callback => execute(callback, false);
  // Retain only while healthy, BEFORE an original attempt is exposed. Bind the
  // complete trusted terminal operation now: no late callback/SQL authority.
  // One use, no dispatch/ACK authority, no opening or replacing a connection.
  // A process dispatch fault does not discard already-received evidence; any
  // quarantine on this raw identity still denies the retained operation.
  Object.defineProperty(transact, 'retainTerminal', { value(callback) {
    assertAccountingHealthy();
    if (typeof callback !== 'function' || !registry.canRetain(raw)) throw unavailable();
    try {
      if (raw.isOpen !== true || raw.isTransaction !== false) throw unavailable();
    } catch {
      registry.quarantine(raw); faultAccounting(); throw unavailable();
    }
    assertAccountingHealthy();
    let used = false;
    return Object.freeze(() => {
      if (used) throw unavailable();
      used = true;
      return execute(callback, true);
    });
  } });
  return Object.freeze(transact);
}
