import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
const root = fileURLToPath(new URL('../../', import.meta.url)), directories = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function decode(run, prefix) {
  const line = run.stdout.split('\n').find(line => line.startsWith(prefix));
  expect(line, run.stdout + '\n' + run.stderr).toBeTruthy(); return JSON.parse(line.slice(prefix.length));
}
describe('actual managed bundle publication death; no archived intent adoption', () => {
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => ['before-marker', 'marker-installed', 'manifest-installed', 'database-installed'].map(boundary => [engine, boundary])))('%s death at %s remains in maintenance and requires explicit valid operation', (engine, boundary) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-bundle-death-')); directories.push(directory);
    const run = mode => spawnSync(process.execPath, ['tests/fixtures/restore-bundle-crash-child.mjs', directory, engine, mode, boundary], { cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, HOME: directory, DATA_DIR: directory } });
    const death = run('crash'); expect(death.signal, death.stdout + '\n' + death.stderr).toBe('SIGKILL');
    const observed = decode(death, 'BOUNDARY:'); expect(observed.boundary).toBe(boundary);
    const next = run('recover'); expect(next.status, next.stdout + '\n' + next.stderr).toBe(0);
    const result = decode(next, 'RESULT:'); expect(result.recoveredOwner).toBe(observed.owner);
    expect(result.intentUnchanged).toBe(true); expect(result.maintenancePresent).toBe(true); expect(result.globalGapPresent).toBe(true);
    expect(result.audits).toBe(1); expect(result.active).toBe(false);
    expect(result.offlineInspectionUnchanged).toBe(true); expect(result.gateCode).toBe('api_key_accounting_unavailable');
    if (boundary === 'before-marker' || boundary === 'marker-installed') {
      expect(result.missingManifestDenied).toBe(true); expect(result.generations).toBe(2);
    } else { expect(result.generations).toBe(1); expect(result.coverageUnchangedOnReplay).toBe(true); }
  }, 30000);
});
