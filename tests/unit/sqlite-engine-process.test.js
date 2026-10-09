import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '../..');
function runDriver(dir) {
  const child = spawnSync(process.execPath, [path.join(root, 'tests/fixtures/engine-boundary-child.mjs'), dir], { cwd: root, encoding: 'utf8', timeout: 15_000, env: { ...process.env, HOME: dir, DATA_DIR: dir } });
  expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status).toBe(0);
  const line = child.stdout.split('\n').find(line => line.startsWith('RESULT:')); expect(line).toBeTruthy();
  return { result: JSON.parse(line.slice(7)), output: child.stdout + child.stderr };
}
describe('actual process engine/file failure boundaries', () => {
  it('fresh Node owned driver startup uses native engine without activation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-process-good-'));
    try { const { result } = runDriver(dir); expect(result).toEqual({ opened: true, driver: 'node:sqlite', enforcementActive: false, emitPreserved: true }); expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(false); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('invalid target image aborts actual process without unavailable/fallback logs or migrations', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-process-bad-')); fs.mkdirSync(path.join(dir, 'db')); const file = path.join(dir, 'db/data.sqlite'); const bytes = Buffer.from('not a database'); fs.writeFileSync(file, bytes);
    try { const { result, output } = runDriver(dir); expect(result).toEqual({ opened: false, emitPreserved: true }); expect(output).not.toMatch(/engine unavailable|sql\.js unavailable|Driver:|\[DB\]\[migrate\]/); expect(fs.readFileSync(file)).toEqual(bytes); expect(fs.existsSync(path.join(dir, '.gateway-writer.lock'))).toBe(false); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('real installed better JS loader without copied binary admits fallback before target open', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-process-optional-')); const require = createRequire(import.meta.url);
    try {
      // Never load the installed native addon on Node24. Only copy JS + manifest
      // into a private tree without build/compiled/prebuild/addon directories.
      const packageRoot = path.dirname(require.resolve('better-sqlite3/package.json'));
      const target = path.join(dir, 'node_modules/better-sqlite3'); fs.mkdirSync(target, { recursive: true });
      fs.cpSync(path.join(packageRoot, 'lib'), path.join(target, 'lib'), { recursive: true }); fs.copyFileSync(path.join(packageRoot, 'package.json'), path.join(target, 'package.json'));
      for (const name of ['bindings', 'file-uri-to-path']) fs.cpSync(path.dirname(require.resolve(`${name}/package.json`)), path.join(dir, 'node_modules', name), { recursive: true });
      fs.copyFileSync(path.join(root, 'src/lib/db/engineAcquisition.js'), path.join(dir, 'engineAcquisition.mjs'));
      fs.writeFileSync(path.join(dir, 'probe.mjs'), `import { acquireSqliteEngine } from './engineAcquisition.mjs';\nconst engine = await acquireSqliteEngine('better-sqlite3', () => import('better-sqlite3'));\nconsole.log('RESULT:' + JSON.stringify({ unavailable: engine === null }));`);
      const child = spawnSync(process.execPath, [path.join(dir, 'probe.mjs')], { cwd: dir, encoding: 'utf8', timeout: 10_000, env: { ...process.env, HOME: dir } });
      expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status).toBe(0); expect(child.stdout).toContain('RESULT:{"unavailable":true}'); expect(fs.existsSync(path.join(dir, 'db'))).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
