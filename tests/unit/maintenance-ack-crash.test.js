import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect } from 'vitest';
const root = fileURLToPath(new URL('../../', import.meta.url)), directories = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const decode = (run, prefix) => {
  const line = run.stdout.split('\n').find(line => line.startsWith(prefix)); expect(line, run.stderr + '\n' + run.stdout).toBeTruthy(); return JSON.parse(line.slice(prefix.length));
};
describe('actual process maintenance target acknowledgement', () => {
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => ['audit', 'sidecar'].flatMap(boundary => ['inspect', 'newer'].map(mode => [engine, boundary, mode]))))('%s death after %s then %s never clears wrong target', (engine, boundary, mode) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-maintenance-crash-')); directories.push(directory);
    const run = action => spawnSync(process.execPath, ['tests/fixtures/maintenance-ack-child.mjs', directory, engine, action, boundary], { cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, HOME: directory, DATA_DIR: directory } });
    const first = run('crash'); expect(first.signal, first.stderr + '\n' + first.stdout).toBe('SIGKILL'); const dead = decode(first, 'BOUNDARY:');
    const next = run(mode); expect(next.status, next.stderr + '\n' + next.stdout).toBe(0); const result = decode(next, 'RESULT:');
    expect(result.recoveredOwner).toBe(dead.owner); expect(result.audits).toBe(1); expect(result.active).toBe(false);
    expect(result.beforeMaintenance === null).toBe(boundary === 'sidecar');
    if (mode === 'newer') {
      expect(result.afterMaintenance).toEqual(result.preserved); expect(result.unchanged).toBe(true);
      expect(result.conflict).toBe(boundary === 'audit');
      expect(Boolean(result.receipt)).toBe(boundary === 'sidecar');
    } else { expect(result.conflict).toBe(false); expect(result.afterMaintenance).toBeNull(); expect(result.receipt).toMatchObject({ kind: 'maintenance', generation: dead.generation, operationId: 'process-maintenance-release' }); }
  }, 30000);
});
