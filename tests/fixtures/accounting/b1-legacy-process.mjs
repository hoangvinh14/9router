import fs from 'node:fs';
import { openFixture, addKey, intent, exactUsage } from './test-database.js';
import { insertAttemptSync, finalizeAttemptSync, finalizeAttemptMutation } from '../../../src/lib/db/repos/api-key-accounting-repo.js';

const [engine, file, history] = process.argv.slice(2);
const { db } = await openFixture(engine, file);
addKey(db);
const terminal = { state: 'settled', outcome: 'success', finishedAt: '2026-10-22T00:01:00.000Z', usage: exactUsage() };
insertAttemptSync(db, intent(db, 'known-charge'));
finalizeAttemptSync(db, 'known-charge', terminal);
insertAttemptSync(db, intent(db, 'ambiguous-attempt'));
process.send({ phase: 'ready', driver: db.driver });
process.on('message', message => {
  if (message !== 'run') return;
  if (history === 'absent') {
    // No terminal evidence was received. Die without clean-close recovery.
    process.kill(process.pid, 'SIGKILL');
  } else {
    db.durableTransaction(() => {
      const row = finalizeAttemptMutation(db, 'ambiguous-attempt', terminal);
      if (row.state !== 'settled' || row.costNanoUsd !== '1200000') throw new Error('Terminal fault boundary not reached');
      // Exact usage was available and the actual terminal mutation ran, but
      // the process dies before the outer durable transaction can commit.
      // Test-only external witness, never a compatibility input or DB sidecar.
      fs.writeFileSync(`${file}.fault-witness`, JSON.stringify({ phase: 'terminal-mutated', cost: row.costNanoUsd }));
      process.kill(process.pid, 'SIGKILL');
    });
  }
});
