import { snapshotPayload, unavailable } from './attempt-payload.js';

// Cooperative exclusion for the exact adapter object in ONE JS global only.
// No raw-handle/alternate-wrapper/worker fencing, DB ownership or fault recovery.
const KEY = Symbol.for('9router.accounting.sql-operation-scope.v1');
if (!Object.hasOwn(globalThis, KEY)) {
  const owners = new WeakMap();
  Object.defineProperty(globalThis, KEY, { value: Object.freeze({
    version: 1,
    owner: adapter => owners.get(adapter),
    enter: (adapter, owner) => owners.set(adapter, owner),
    leave: adapter => owners.delete(adapter),
  }), writable: false, configurable: false });
}
const descriptor = Object.getOwnPropertyDescriptor(globalThis, KEY);
const guard = descriptor?.value;
if (descriptor?.writable !== false || descriptor?.configurable !== false ||
    !Object.isFrozen(guard) || guard?.version !== 1 ||
    ['owner', 'enter', 'leave'].some(name => typeof guard[name] !== 'function')) {
  throw unavailable();
}

// Fixed SQL and methods are trusted server definitions, NEVER client SQL or a
// callback-supplied statement. No exec/raw/prepare/transaction exposed to callback.
// Params: bounded arrays of null/string/safe-integer scalars; no blobs,
// BigInt, objects, booleans or NUL. Results: bounded JSON, missing get -> null;
// unsupported SQLite values reject rather than lossy-coerce. Undefined return -> null.
function copyResult(value) {
  const copy = snapshotPayload(value);
  function check(item) {
    if (typeof item === 'number' && !Number.isSafeInteger(item)) throw unavailable();
    if (item && typeof item === 'object') Object.values(item).forEach(check);
  }
  check(copy);
  return copy;
}

export function createSqlOperationScope(adapter, definitions) {
  if (!adapter || typeof adapter !== 'object') throw unavailable();
  const specs = snapshotPayload(definitions);
  if (!specs || Array.isArray(specs) || !Object.keys(specs).length) throw unavailable();
  const operations = Object.entries(specs).map(([name, spec]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) || !spec ||
        Object.keys(spec).sort().join(',') !== 'method,sql' ||
        !['run', 'get', 'all'].includes(spec.method) ||
        typeof spec.sql !== 'string' || !spec.sql.trim() || spec.sql.includes('\0') ||
        typeof adapter[spec.method] !== 'function') throw unavailable();
    return { name, method: spec.method, sql: spec.sql, invoke: adapter[spec.method].bind(adapter) };
  });

  return function execute(callback) {
    const existing = guard.owner(adapter);
    if (existing) { existing.fail(); throw unavailable(); }
    if (typeof callback !== 'function') throw unavailable();
    let active = true;
    let failed = false;
    let calling = false;
    const rejected = [];
    const owner = Object.freeze({ fail: () => { failed = true; } });
    guard.enter(adapter, owner);
    const scope = Object.create(null);
    for (const { name, method, sql, invoke } of operations) {
      scope[name] = (params = []) => {
        if (!active || failed || calling) { failed = true; throw unavailable(); }
        calling = true;
        try {
          const values = snapshotPayload(params);
          if (!Array.isArray(values) || values.some(value => value !== null &&
              !(typeof value === 'string' && !value.includes('\0')) &&
              !(typeof value === 'number' && Number.isSafeInteger(value)))) throw unavailable();
          // Validation can execute Proxy traps. It is not a sandbox boundary.
          if (!active || failed) throw unavailable();
          const result = invoke(sql, values);
          if (result && typeof result === 'object' && typeof result.then === 'function') {
            rejected.push(result); throw unavailable();
          }
          const copy = copyResult(method === 'get' && result === undefined ? null : result);
          if (!active || failed) throw unavailable();
          return copy;
        } catch {
          failed = true;
          throw unavailable();
        } finally { calling = false; }
      };
    }
    Object.freeze(scope);
    try {
      let result;
      try { result = callback(scope); }
      finally { active = false; } // Revoke BEFORE inspecting even return-value traps.
      if (result && (typeof result === 'object' || typeof result === 'function') &&
          typeof result.then === 'function') {
        rejected.push(result); throw unavailable();
      }
      const copy = copyResult(result === undefined ? null : result);
      if (failed) throw unavailable(); // Callback cannot catch an operation failure to commit.
      return copy;
    } catch {
      throw unavailable();
    } finally {
      active = false;
      // Arbitrary thenable code may execute, but only AFTER capability revocation.
      for (const value of rejected) Promise.resolve(value).catch(() => {});
      guard.leave(adapter);
    }
  };
}

// Caller MUST let rejection escape the synchronous outer transaction callback:
// adapter.transaction(() => execute(callback)). Scope itself does not roll back
// prefix writes, create an outer durable transaction or issue any ACK. Catching
// execute's rejection INSIDE the transaction can still commit prefix writes.
// Retained independent adapter refs bypass this wrapper: repo ownership review
// remains mandatory. Trusted code, NOT an arbitrary-code security sandbox.
