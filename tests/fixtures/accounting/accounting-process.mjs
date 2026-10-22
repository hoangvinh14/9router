import fs from 'node:fs';
import { openFixture, addKey, intent, exactUsage } from './test-database.js';
import { insertAttemptSync, insertAttemptMutation, finalizeAttemptSync, finalizeAttemptMutation } from '../../../src/lib/db/repos/api-key-accounting-repo.js';
import { retireKeyBindings } from '../../../src/lib/db/helpers/api-key-bindings.js';

const [engine, file, mode] = process.argv.slice(2);
if (mode === 'after-sidecar') {
  const rename = fs.renameSync, sync = fs.fsyncSync; let sidecarRenamed = false;
  fs.renameSync = (source, destination) => {
    const result = rename(source, destination);
    if (destination.endsWith('/.accounting-coverage.json')) sidecarRenamed = true;
    return result;
  };
  fs.fsyncSync = fd => { const result = sync(fd); if (sidecarRenamed) process.kill(process.pid, 'SIGKILL'); return result; };
}
let fixture;
try {
  fixture = await openFixture(engine, file);
  if (fixture.db.driver !== (engine === 'node' ? 'node:sqlite' : 'sql.js')) throw new Error('Wrong actual accounting driver');
  addKey(fixture.db);
  if (mode.includes('terminal') || mode === 'signal') insertAttemptSync(fixture.db, intent(fixture.db));
  process.send?.({ phase: 'ready', driver: fixture.db.driver });
} catch (error) {
  process.send?.({ phase: 'error', error: error.message }, () => process.exit(2));
}
process.on('message', message => {
  if (message !== 'run' || !fixture) return;
  const { db } = fixture;
  if (mode === 'after-retirement') {
    db.durableTransaction(() => {
      retireKeyBindings(db, db.coverage, [db.get("SELECT * FROM apiKeys WHERE id='key-one'")]);
      process.kill(process.pid, 'SIGKILL');
    });
    return;
  }
  const terminal = { state: 'settled', outcome: 'success', finishedAt: new Date().toISOString(), usage: exactUsage() };
  if (mode.startsWith('before-')) { process.send?.({ phase: 'checkpoint' }); return; }
  if (mode.startsWith('inside-')) {
    db.durableTransaction(() => {
      if (mode.includes('terminal')) finalizeAttemptMutation(db, 'attempt-one', terminal);
      else insertAttemptMutation(db, intent(db));
      process.kill(process.pid, 'SIGKILL');
    });
    return;
  }
  if (mode === 'during-publication') {
    const rename = fs.renameSync;
    fs.renameSync = (source, target) => { if (target === file) process.kill(process.pid, 'SIGKILL'); return rename(source, target); };
  }
  if (mode.includes('terminal')) finalizeAttemptSync(db, 'attempt-one', terminal);
  else if (mode !== 'signal') insertAttemptSync(db, intent(db));
  // Checkpoint deliberately does not deliver an intent/terminal ACK to a caller.
  process.send?.({ phase: 'checkpoint' });
});
// Automatic adapter close must leave time for other synchronous signal owners.
process.on('SIGTERM', () => process.send?.({ phase: 'other-signal-owner' }));
