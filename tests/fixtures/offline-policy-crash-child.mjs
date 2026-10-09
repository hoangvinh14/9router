// Disposable child boundary instrumentation only; no production fault switches.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializePoliciesOffline, POLICY_INTENT_FILE } from '../../src/lib/db/offlinePolicyInitialization.js';
const [directory, engine, mode, boundary] = process.argv.slice(2);
const intentFile = path.join(directory, POLICY_INTENT_FILE), coverage = path.join(directory, '.accounting-coverage.json'), file = path.join(directory, 'db/data.sqlite');
function kill(stage) { fs.writeSync(1, `BOUNDARY:${stage}\n`); process.kill(process.pid, 'SIGKILL'); }
let linked = false;
const link = fs.linkSync, rename = fs.renameSync, sync = fs.fsyncSync;
fs.linkSync = (...args) => {
  if (args[1] === intentFile && boundary === 'before-intent-install') kill(boundary);
  const result = link(...args);
  if (args[1] === intentFile) { linked = true; if (boundary === 'intent-installed') kill(boundary); }
  return result;
};
fs.fsyncSync = fd => {
  const result = sync(fd);
  if (linked && boundary === 'intent-directory-ack' && fs.fstatSync(fd).isDirectory()) kill(boundary);
  return result;
};
fs.renameSync = (...args) => {
  const result = rename(...args);
  if (args[1] === coverage && boundary === 'sidecar-installed') kill(boundary);
  if (engine === 'sql.js' && args[1] === file && boundary === 'db-published') kill(boundary);
  return result;
};
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function(sql) {
  const result = exec.call(this, sql);
  if (engine === 'node:sqlite' && sql === 'COMMIT' && boundary === 'db-published') kill(boundary);
  return result;
};
let cleanupInjected = false;
if (boundary === 'cleanup-uncertain') {
  if (engine === 'node:sqlite') {
    const close = DatabaseSync.prototype.close;
    DatabaseSync.prototype.close = function () { close.call(this); if (!cleanupInjected) { cleanupInjected = true; throw new Error('uncertain cleanup fixture'); } };
  } else {
    const open = fs.openSync, close = fs.closeSync; let held;
    fs.openSync = (name, ...args) => { const fd = open(name, ...args); if (name === file && held === undefined) held = fd; return fd; };
    fs.closeSync = fd => { close(fd); if (!cleanupInjected && fd === held) { cleanupInjected = true; throw new Error('uncertain cleanup fixture'); } };
  }
}
try {
  const result = await initializePoliciesOffline({ directory, engine, actor: 'crash-fixture', reason: 'explicit pristine policy fixture', recover: mode === 'recover' });
  if (boundary === 'success-ack') kill(boundary);
  console.log('RESULT:' + JSON.stringify(result));
} catch {
  console.log('DENIED');
  if (boundary === 'cleanup-uncertain' && cleanupInjected) {
    let blocked = false;
    try { await initializePoliciesOffline({ directory, engine, recover: true }); }
    catch (error) { blocked = error.message.includes('writer already active'); }
    if (blocked) { fs.writeSync(1, 'LIVE_OWNER_DENIED\n'); kill(boundary); }
  }
  process.exitCode = 2;
}
