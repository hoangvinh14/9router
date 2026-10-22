import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

// This path binds failure reporting even when environment assertions fail.
const root = '/tmp/9router-db-safety-abi127-mOsx0u';
const mirror = path.join(root, 'mirror');
const evidence = path.join(root, 'evidence/abi127-preflight-r2-result.json');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const result = {
  runtime: process.version, abi: process.versions.modules, executable: process.execPath,
  platform: process.platform, arch: process.arch, status: 'failed', stage: 'environment',
  milestones: { opened: false, queryPassed: false, provenancePassed: false, closed: false },
};
let db;
try {
  assert.equal(fs.realpathSync(process.env.DB_SAFETY_FIXTURE_ROOT), root);
  assert.equal(fs.realpathSync(root), root);
  assert.equal(fs.statSync(root).uid, process.getuid());
  assert.equal(fs.statSync(root).mode & 0o077, 0);
  assert.equal(process.version, 'v22.23.2');
  assert.equal(process.versions.modules, '127');
  assert.equal(process.execPath, '/home/gmo/.nvm/versions/node/v22.23.2/bin/node');
  for (const key of ['HOME', 'DATA_DIR', 'TMPDIR', 'XDG_CACHE_HOME']) {
    assert.equal(path.dirname(fs.realpathSync(process.env[key])), path.join(root, 'fixtures'));
  }
  const preload = path.join(root, 'harness/offline-preload.cjs');
  assert.equal(fs.realpathSync(preload), preload);
  assert.equal(hash(preload), 'b20eedaf166c709aa450e1f8a7df631b83160d31cc1cf3b09f77b8046a962ee4');
  assert.equal(process.env.NODE_OPTIONS, `--require=${preload}`);
  assert.throws(() => globalThis.fetch('https://invalid.example'), /network disabled/);
  const require = createRequire(path.join(mirror, 'package.json'));
  result.stage = 'load';
  result.packageFile = require.resolve('better-sqlite3/package.json');
  assert.equal(fs.realpathSync(result.packageFile), path.join(mirror, 'node_modules/better-sqlite3/package.json'));
  const Database = require('better-sqlite3');
  assert.equal(require('better-sqlite3/package.json').version, '12.11.1');
  const file = path.join(process.env.DATA_DIR, 'binding-preflight-r2.sqlite');
  result.fixtureFile = file;
  assert.equal(fs.existsSync(file), false);
  result.stage = 'open';
  db = new Database(file);
  result.milestones.opened = true;
  result.stage = 'query';
  assert.deepEqual(db.prepare('SELECT 127 AS abi').get(), { abi: 127 });
  result.milestones.queryPassed = true;
  result.stage = 'provenance';
  result.cacheEntries = Object.keys(require.cache).map(file => ({ file, realpath: fs.realpathSync(file) }));
  result.unexpectedCacheEntries = result.cacheEntries.filter(({ file, realpath }) =>
    file !== realpath || !(realpath.startsWith(mirror + path.sep) || realpath === preload));
  assert.deepEqual(result.unexpectedCacheEntries, []);
  assert.equal(result.cacheEntries.filter(({ realpath }) => realpath === preload).length, 1);
  const addons = result.cacheEntries.filter(({ realpath }) => realpath.endsWith('.node')).map(({ realpath }) => realpath);
  assert.deepEqual(addons, [path.join(mirror, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node')]);
  result.loadedAddon = addons[0];
  result.addonSha256 = hash(addons[0]);
  assert.equal(result.addonSha256, 'df9fbd0d061f360d81fb51e265c53c9605020bd68219e34f33c07c85de15719a');
  result.milestones.provenancePassed = true;
  result.stage = 'close';
  db.close();
  assert.equal(db.open, false);
  result.milestones.closed = true;
  db = undefined;
  result.status = 'passed'; result.stage = 'complete';
} catch (error) {
  result.error = { name: error.name, code: error.code ?? null, message: error.message };
  process.exitCode = 1;
} finally {
  if (db) {
    try {
      db.close();
      assert.equal(db.open, false);
      result.cleanupClosed = true;
    } catch (error) {
      result.cleanupError = { name: error.name, message: error.message };
      result.status = 'failed'; process.exitCode = 1;
    }
  }
  fs.writeFileSync(evidence, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}
