// Finite phase-1 baseline probe of CURRENT adapters, not an implementation.
// Hypothesis: pricing-only wrappers cannot establish durable ACK or single-writer
// exclusion while existing shared adapter/timer paths remain unchanged.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createSqlJsAdapter } from '../../../src/lib/db/adapters/sqljsAdapter.js';
import { createNodeSqliteAdapter } from '../../../src/lib/db/adapters/nodeSqliteAdapter.js';

const directory = process.argv[2];
if (!directory || !fs.statSync(directory).isDirectory() || !path.basename(directory).startsWith('9router-p1-baseline-')) throw new Error('Owned disposable directory required');
const file = path.join(directory, 'storage-probe.sqlite');
const nativeFile = path.join(directory, 'native-probe.sqlite');
let first, second, reopened, native;
try {
  first = await createSqlJsAdapter(file);
  first.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  first.run('INSERT INTO kv VALUES (?, ?)', ['price', '1']);
  const filePresentAtReturn = fs.existsSync(file);
  assert.equal(filePresentAtReturn, false);
  const hasDurableTransaction = typeof first.durableTransaction === 'function';
  const hasHealth = typeof first.health === 'function';
  first.close(); first = null;
  first = await createSqlJsAdapter(file);
  second = await createSqlJsAdapter(file);
  first.transaction(() => first.run('UPDATE kv SET value=? WHERE key=?', ['2', 'price']));
  first.close(); first = null;
  reopened = await createSqlJsAdapter(file);
  assert.equal(reopened.get('SELECT value FROM kv WHERE key=?', ['price']).value, '2');
  reopened.close(); reopened = null;
  second.run('INSERT INTO kv VALUES (?, ?)', ['unrelated', 'saved']);
  second.close(); second = null;
  reopened = await createSqlJsAdapter(file);
  const priceAfterUnrelatedWriter = reopened.get('SELECT value FROM kv WHERE key=?', ['price']).value;
  assert.equal(priceAfterUnrelatedWriter, '1');
  native = await createNodeSqliteAdapter(nativeFile);
  const nativeJournal = native.get('PRAGMA journal_mode').journal_mode;
  const nativeSynchronous = native.get('PRAGMA synchronous').synchronous;
  assert.equal(nativeJournal, 'wal'); assert.equal(nativeSynchronous, 1);
  console.log(JSON.stringify({ hypothesis: 'shared storage prerequisite required', observations: {
    sqljsFilePresentAtReturn: filePresentAtReturn, sqljsHasDurableTransaction: hasDurableTransaction,
    sqljsHasHealth: hasHealth, sqljsSecondWriterAccepted: true,
    priceAfterFirstWriterClose: '2', priceAfterUnrelatedWriter,
    nativeJournal, nativeSynchronous, nativeHasDurableTransaction: typeof native.durableTransaction === 'function'
  }, productImplementation: false }));
} finally {
  for (const adapter of [first, second, reopened, native]) adapter?.close();
  for (const name of [file, nativeFile, `${nativeFile}-wal`, `${nativeFile}-shm`]) fs.rmSync(name, { force: true });
}
