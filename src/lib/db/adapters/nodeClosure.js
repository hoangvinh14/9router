import fs from 'node:fs';

// Closure observation only: never overrides a thrown native close, checkpoint
// failure, or accounting fault. Missing/unreadable runtime state is not evidence.
export function nodeClosureConfirmed(db) {
  try { return sqliteIsOpen(db) === false; } catch { return false; }
}

const stateKey = Symbol.for('9router.sqlite.connection-state.v1');
if (!Object.hasOwn(globalThis, stateKey)) {
  Object.defineProperty(globalThis, stateKey, { value: new WeakMap() });
}
const nativeStates = globalThis[stateKey];

export function registerNativeSqliteState(db, state) {
  nativeStates.set(db, state);
}

export function hasNativeSqliteState(adapter) {
  return adapter.driver === 'node:sqlite' || nativeStates.has(adapter.raw);
}

export function sqliteIsOpen(db) {
  const state = nativeStates.get(db);
  try { return state ? state.open(db) : db?.isOpen; }
  catch { return undefined; }
}

export function sqliteInTransaction(db) {
  const state = nativeStates.get(db);
  return state ? state.inTransaction(db) : db.isTransaction;
}

export function sqliteImageTransactions(db) {
  return nativeStates.get(db)?.imageTransactions;
}
export function sqlJsWriterPath(filePath) {
  return filePath + '.sqljs-writer';
}

export function assertNoSqlJsWriter(filePath) {
  const files = [filePath];
  if (fs.lstatSync(filePath, { throwIfNoEntry: false })?.isSymbolicLink()) files.push(fs.realpathSync(filePath));
  for (const file of files) {
    const owner = sqlJsWriterPath(file);
    if (fs.lstatSync(owner, { throwIfNoEntry: false }) ||
        fs.lstatSync(owner + '.guard', { throwIfNoEntry: false })) {
      throw new Error('SQL.js owns this database image');
    }
  }
}
