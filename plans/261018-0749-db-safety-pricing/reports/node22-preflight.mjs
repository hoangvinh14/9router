// Authorized fixture-only availability preflight; not adapter acceptance.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = fs.realpathSync(process.env.DB_SAFETY_FIXTURE_ROOT);
assert.match(root, /^\/tmp\/9router-db-safety-node22-/);
assert.equal(process.version, 'v22.23.2');
assert.equal(process.execPath, '/home/gmo/.nvm/versions/node/v22.23.2/bin/node');
for (const key of ['HOME', 'DATA_DIR', 'TMPDIR', 'XDG_CACHE_HOME']) {
  assert.equal(path.dirname(fs.realpathSync(process.env[key])), root);
}
assert.throws(() => globalThis.fetch('https://invalid.example'), /network disabled/);
const file = path.join(process.env.DATA_DIR, 'preflight.sqlite');
assert.equal(fs.existsSync(file), false);
let db;
const result = { runtime: process.version, executable: process.execPath, abi: process.versions.modules,
  platform: process.platform, arch: process.arch, bindingVersion: require('better-sqlite3/package.json').version,
  fixtureFile: file, status: 'failed', stage: 'load' };
try {
  const Database = require('better-sqlite3');
  result.stage = 'open';
  db = new Database(file);
  result.stage = 'query';
  assert.deepEqual(db.prepare('SELECT 22 AS value').get(), { value: 22 });
  result.stage = 'close';
  db.close(); db = undefined;
  result.status = 'passed'; result.stage = 'complete';
} catch (error) {
  result.error = { name: error.name, code: error.code ?? null, message: error.message };
  process.exitCode = 1;
} finally {
  if (db) { try { db.close(); } catch { result.cleanupFailed = true; process.exitCode = 1; } }
  fs.writeFileSync(path.join(root, 'preflight-result.json'), JSON.stringify(result, null, 2) + '\n');
}
