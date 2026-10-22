import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const root = fs.realpathSync(process.env.DB_SAFETY_FIXTURE_ROOT);
assert.match(root, /^\/tmp\/9router-db-safety-abi127-/);
const mirror = path.join(root, 'mirror');
assert.equal(process.version, 'v22.23.2');
assert.equal(process.versions.modules, '127');
assert.equal(process.execPath, '/home/gmo/.nvm/versions/node/v22.23.2/bin/node');
for (const key of ['HOME', 'DATA_DIR', 'TMPDIR', 'XDG_CACHE_HOME']) {
  assert.equal(path.dirname(fs.realpathSync(process.env[key])), path.join(root, 'fixtures'));
}
assert.throws(() => globalThis.fetch('https://invalid.example'), /network disabled/);
const require = createRequire(path.join(mirror, 'package.json'));
const packageFile = require.resolve('better-sqlite3/package.json');
assert.equal(fs.realpathSync(packageFile), path.join(mirror, 'node_modules/better-sqlite3/package.json'));
const result = { runtime: process.version, abi: process.versions.modules, executable: process.execPath,
  platform: process.platform, arch: process.arch, packageFile, status: 'failed', stage: 'load' };
let db;
try {
  const Database = require('better-sqlite3');
  assert.equal(require('better-sqlite3/package.json').version, '12.11.1');
  const file = path.join(process.env.DATA_DIR, 'binding-preflight.sqlite');
  assert.equal(fs.existsSync(file), false);
  result.stage = 'open'; db = new Database(file);
  assert.deepEqual(db.prepare('SELECT 127 AS abi').get(), { abi: 127 });
  const addons = Object.keys(require.cache).filter(file => file.endsWith('.node'));
  assert.deepEqual(addons, [path.join(mirror, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node')]);
  result.loadedAddon = addons[0];
  result.addonSha256 = createHash('sha256').update(fs.readFileSync(addons[0])).digest('hex');
  assert.equal(result.addonSha256, 'df9fbd0d061f360d81fb51e265c53c9605020bd68219e34f33c07c85de15719a');
  for (const file of Object.keys(require.cache)) assert.ok(fs.realpathSync(file).startsWith(mirror + path.sep));
  db.close(); db = undefined;
  result.status = 'passed'; result.stage = 'complete';
} catch (error) {
  result.error = { name: error.name, code: error.code ?? null, message: error.message }; process.exitCode = 1;
} finally {
  if (db) { try { db.close(); } catch { result.cleanupFailed = true; process.exitCode = 1; } }
  fs.writeFileSync(path.join(root, 'evidence/abi127-preflight-result.json'), JSON.stringify(result, null, 2) + '\n');
}
