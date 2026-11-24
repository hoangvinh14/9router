import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
const worker = '/app/tests/fixtures/budget/wal-sync-worker.mjs';
function run(cwd, args) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8', timeout: 15000 });
  assert.ifError(p.error);
  assert.equal(p.status, 0, p.stderr);
}
for (const phase of ['intent', 'terminal', 'checkpoint-write', 'checkpoint-sync']) {
  test('SQLite EIO at ' + phase + ' blocks dispatch and preserves acknowledged spend', () => {
    const root = fs.mkdtempSync('/tmp/budget-sync-');
    try {
      run(root, [process.execPath, worker, 'seed']);
      let injection;
      for (const mode of ['control', 'fault']) {
        const cwd = root + '/' + mode;
        fs.mkdirSync(cwd);
        fs.copyFileSync(root + '/baseline.sqlite', cwd + '/ledger.sqlite');
        const args = ['/usr/bin/strace', '-qq', '-y', '-o', 'trace', '-e', 'trace=pwrite64,fsync,fdatasync,mkdir,rename,renameat,renameat2'];
        if (mode === 'fault') args.push('-e', injection);
        run(cwd, [...args, process.execPath, worker, mode, phase]);
        const trace = fs.readFileSync(cwd + '/trace', 'utf8').split('\n');
        const start = trace.findIndex(line => line.startsWith('mkdir("sync-start"'));
        const end = trace.findIndex(line => line.startsWith('mkdir("sync-end"'));
        assert.ok(start >= 0 && end > start);
        const measured = trace.slice(start + 1, end);
        assert.equal(measured.some(line => /^rename(?:at2?)?\(/.test(line)), false);
        const target = phase === 'checkpoint-write' ? /^pwrite64\(.*\/ledger\.sqlite>/
          : phase === 'checkpoint-sync' ? /^(fsync|fdatasync)\(.*\/ledger\.sqlite>/
          : /^(fsync|fdatasync)\(.*\/ledger\.sqlite-wal>/;
        const sync = measured.find(line => target.test(line));
        assert.ok(sync, 'expected a native WAL synchronization inside the measured operation');
        if (mode === 'control') {
          assert.match(sync, phase === 'checkpoint-write' ? /= [1-9]\d*$/ : /= 0$/);
          const name = sync.split('(')[0];
          const ordinal = trace.slice(0, trace.indexOf(sync, start) + 1).filter(line => line.startsWith(name + '(')).length;
          injection = 'inject=' + name + ':error=EIO:when=' + ordinal;
        } else {
          assert.match(sync, /EIO .*INJECTED/);
          run(cwd, [process.execPath, worker, 'verify', phase]);
        }
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
