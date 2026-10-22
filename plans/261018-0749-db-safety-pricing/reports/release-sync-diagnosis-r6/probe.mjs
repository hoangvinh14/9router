import fs from 'node:fs';
import path from 'node:path';
import { createNodeSqliteAdapter } from '/home/gmo/projects/9router/src/lib/db/adapters/nodeSqliteAdapter.js';
import { createSqlJsAdapter } from '/home/gmo/projects/9router/src/lib/db/adapters/sqljsAdapter.js';
const root = process.env.DIAG_ROOT;
const results = { runtime: process.version, purpose: 'diagnosis-only post-unlink/final-arbitration directory fsync', cases: [] };
for (const [engine, create] of [['node', createNodeSqliteAdapter], ['sqljs', createSqlJsAdapter]]) {
  for (const phase of ['after-unlink', 'after-gate-cleanup']) {
    for (const replacement of [false, true]) {
      const dir = path.join(root, engine, phase, String(replacement)); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'data.sqlite'), lock = path.join(dir, '.gateway-writer.lock'), gate = path.join(dir, '.gateway-writer-acquisition');
      const db = await create(file);
      db.durableTransaction(() => db.exec('CREATE TABLE diagnostic(id INTEGER)'));
      const originals = { unlink: fs.unlinkSync, rmdir: fs.rmdirSync, sync: fs.fsyncSync };
      let removed = false, gateRemoved = false, injected = false;
      const row = { engine, phase, replacement };
      fs.unlinkSync = function(target, ...args) { const value = originals.unlink(target, ...args); if (target === lock) removed = true; return value; };
      fs.rmdirSync = function(target, ...args) { const value = originals.rmdir(target, ...args); if (target === gate && removed) gateRemoved = true; return value; };
      fs.fsyncSync = function(fd) {
        if (fs.fstatSync(fd).isDirectory() && fs.readlinkSync(`/proc/self/fd/${fd}`) === dir && removed && !injected && (phase === 'after-unlink' ? !gateRemoved : gateRemoved)) {
          injected = true; throw new Error(`injected ${phase} directory sync`);
        }
        return originals.sync(fd);
      };
      try { db.close(); row.firstReturned = true; } catch (error) { row.firstError = error.message; }
      finally { fs.unlinkSync = originals.unlink; fs.rmdirSync = originals.rmdir; fs.fsyncSync = originals.sync; }
      row.injected = injected; row.ownLockRemoved = removed; row.gateRemoved = gateRemoved;
      row.lockAfterFirst = fs.existsSync(lock); row.health = db.health();
      let next, replacementBytes;
      if (replacement) { next = await create(file); replacementBytes = fs.readFileSync(lock); row.replacementUsableBefore = next.get('SELECT COUNT(*) AS n FROM diagnostic').n === 0; }
      try { db.close(); row.retryReturned = true; } catch (error) { row.retryError = error.message; }
      if (next) { row.replacementLockUnchanged = fs.readFileSync(lock).equals(replacementBytes); row.replacementUsableAfter = next.get('SELECT COUNT(*) AS n FROM diagnostic').n === 0; next.close(); }
      row.fixtureLockRemains = fs.existsSync(lock);
      results.cases.push(row); fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
    }
  }
}
console.log(JSON.stringify(results, null, 2));
