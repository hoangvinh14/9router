import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNodeSqliteAdapter } from '/home/gmo/projects/9router/src/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '/home/gmo/projects/9router/src/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '/home/gmo/projects/9router/src/lib/db/writerOwnership.js';

const root = process.env.DIAG_ROOT;
const self = fileURLToPath(import.meta.url);
if (process.argv[2] === 'signal-child') {
  const db = await createSqlJsAdapter(process.argv[3]);
  db.durableTransaction(() => db.exec('CREATE TABLE diagnostic (id INTEGER)'));
  db.run('INSERT INTO diagnostic VALUES (73)');
  // Keep the child alive: a flush-only signal listener must not appear to exit naturally.
  setInterval(() => {}, 60_000);
  process.send({ ready: true, pid: process.pid, driver: db.driver, dirty: db.health().dirty });
} else {
  const receipt = { node: process.version, platform: process.platform, purpose: 'Static-review diagnosis; no production change', paths: [], releases: [], signals: [] };
  const save = () => fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(receipt, null, 2));
  for (const [engine, factory] of [['node', createNodeSqliteAdapter], ['sqljs', createSqlJsAdapter]]) {
    for (const kind of ['regular', 'existing-symlink', 'dangling-symlink']) {
      const dir = path.join(root, 'paths', engine, kind);
      const targetDir = path.join(root, 'targets', engine, kind);
      fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(targetDir, { recursive: true });
      const file = path.join(dir, 'data.sqlite'), target = path.join(targetDir, 'target.sqlite');
      if (kind === 'regular') fs.writeFileSync(file, Buffer.alloc(0));
      else {
        if (kind === 'existing-symlink') fs.writeFileSync(target, Buffer.alloc(0));
        fs.symlinkSync(target, file);
      }
      let db, targetLease;
      const row = { engine, kind, existsBefore: fs.existsSync(file), lstatSymlink: fs.lstatSync(file).isSymbolicLink() };
      try {
        db = await factory(file); row.opened = true;
        row.targetCreatedAfterOpen = fs.existsSync(target);
        if (kind === 'dangling-symlink') {
          // Only acquire a second directory lease, never open or mutate a competing engine.
          targetLease = acquireWriterOwnership(target); row.targetDirectoryLeaseAcquired = true;
        }
      } catch (error) { row.error = error.message; }
      finally {
        targetLease?.release();
        if (db) { try { db.close(); row.closed = true; } catch (error) { row.closeError = error.message; } }
        row.lockRemains = fs.existsSync(path.join(dir, '.gateway-writer.lock'));
        row.targetExistsAfter = fs.existsSync(target);
        receipt.paths.push(row); save();
      }
    }
    const dir = path.join(root, 'release', engine); fs.mkdirSync(dir, { recursive: true });
    const db = await factory(path.join(dir, 'data.sqlite'));
    db.durableTransaction(() => db.exec('CREATE TABLE release_probe (id INTEGER)'));
    const gate = path.join(dir, '.gateway-writer-acquisition');
    fs.mkdirSync(gate);
    const row = { engine, fixtureGateHeld: true };
    try { db.close(); row.firstCloseReturned = true; } catch (error) { row.firstCloseError = error.message; }
    row.healthAfterFirstClose = db.health();
    fs.rmdirSync(gate);
    try { db.close(); row.retryReturned = true; } catch (error) { row.retryError = error.message; }
    row.lockAfterRetry = fs.existsSync(path.join(dir, '.gateway-writer.lock'));
    let next;
    try { next = acquireWriterOwnership(path.join(dir, 'data.sqlite')); row.nextOwnerAcquired = true; }
    catch (error) { row.nextOwnerError = error.message; }
    finally { next?.release(); }
    // Deliberately retain lock if the failed lifecycle cannot release; no manual cleanup masquerading as close.
    receipt.releases.push(row); save();
  }
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const dir = path.join(root, 'signals', signal); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'data.sqlite');
    const stdout = fs.openSync(path.join(dir, 'child.log'), 'wx');
    const child = fork(self, ['signal-child', file], { stdio: ['ignore', stdout, stdout, 'ipc'] });
    let timer;
    const row = { signal };
    const exit = new Promise(resolve => child.once('exit', (code, sig) => resolve({ code, signal: sig })));
    try {
      row.handshake = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('ready timeout')), 5000);
        child.once('message', resolve); child.once('error', reject);
        child.once('exit', () => reject(new Error('child exited before ready')));
      });
      clearTimeout(timer);
      child.kill(signal);
      const outcome = await Promise.race([exit, new Promise(resolve => { timer = setTimeout(() => resolve(null), 1000); })]);
      clearTimeout(timer);
      row.exitedWithinSignalDeadline = outcome !== null;
      if (outcome === null) { row.parentForcedTeardown = true; child.kill('SIGKILL'); }
      row.exit = outcome ?? await exit;
      row.lockAfterExit = fs.existsSync(path.join(dir, '.gateway-writer.lock'));
      const reopened = await createSqlJsAdapter(file);
      try { row.persistedRows = reopened.all('SELECT id FROM diagnostic'); }
      finally { reopened.close(); }
      row.lockAfterVerifiedRecoveryClose = fs.existsSync(path.join(dir, '.gateway-writer.lock'));
      receipt.signals.push(row); save();
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      fs.closeSync(stdout);
    }
  }
  console.log(JSON.stringify(receipt, null, 2));
}
