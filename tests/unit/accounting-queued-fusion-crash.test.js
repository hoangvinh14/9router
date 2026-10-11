import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
const root = fileURLToPath(new URL('../../', import.meta.url));
const directories = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function output(run, prefix) {
  const line = run.stdout.split('\n').find(line => line.startsWith(prefix));
  expect(line, run.stderr + '\n' + run.stdout).toBeTruthy(); return JSON.parse(line.slice(prefix.length));
}
describe('actual fusion fixture process death → owned production-driver restart, NOT power loss or ACK reconstruction', () => {
  it.each(['node:sqlite', 'sql.js'].flatMap(engine => ['pending', 'installed-panel', 'judge-intent', 'judge-completion'].map(stage => [engine, stage])))('%s %s preserves own request/attempt identity and no automatic judge', (engine, stage) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-fusion-death-')); directories.push(dir);
    const run = mode => {
      const result = spawnSync(process.execPath, ['tests/fixtures/fusion-queued-crash-child.mjs', dir, engine, mode, stage], {
        cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: dir, DATA_DIR: dir } });
      if (process.env.FUSION_CRASH_ARTIFACT_DIR) {
        const name = engine.replace(/[:.]/g, '_') + '-' + stage + '-' + mode;
        fs.writeFileSync(path.join(process.env.FUSION_CRASH_ARTIFACT_DIR, name + '.log'), result.stdout + '\nSTDERR:\n' + result.stderr);
      }
      return result;
    };
    const first = run('crash'); expect(first.signal, first.stderr + '\n' + first.stdout).toBe('SIGKILL');
    const count = stage.startsWith('judge-') ? 3 : 2;
    const fault = output(first, 'FAULT:'); expect(fault).toMatchObject({ posted: stage === 'judge-completion' ? 3 : 2,
      completions: stage === 'pending' ? 0 : stage === 'judge-completion' ? 3 : 2, returned: false });
    expect(fault.rows).toHaveLength(count); expect(new Set(fault.rows.map(r => r.requestId)).size).toBe(1); expect(new Set(fault.rows.map(r => r.attemptId)).size).toBe(count);
    const inspect = run('inspect'); expect(inspect.status, inspect.stderr + '\n' + inspect.stdout).toBe(0);
    const result = output(inspect, 'RESULT:'); expect(result.driver).toBe('node:sqlite');
    expect(result.recoveredOwnerInstanceId).toBe(fault.ownerInstanceId); expect(result.rows).toHaveLength(count); expect(result.posted).toBe(0);
    expect(result.audits).toBe(0); expect(result.spend).toBe(stage === 'pending' ? '0' : stage === 'judge-completion' ? '600000' : '400000');
    for (const previous of fault.rows) {
      const recovered = result.rows.find(r => r.attemptId === previous.attemptId);
      expect(recovered).toMatchObject({ requestId: previous.requestId, model: previous.model, ownerInstanceId: fault.ownerInstanceId,
        state: previous.state === 'pending' ? 'unresolved' : 'settled', costNanoUsd: previous.state === 'pending' ? null : '200000' });
      expect(recovered.priceSnapshot.rates).toMatchObject({ input: '1', output: '2' });
    }
    const repeat = run('inspect'); expect(repeat.status, repeat.stderr + '\n' + repeat.stdout).toBe(0);
    const again = output(repeat, 'RESULT:'); expect(again.rows).toEqual(result.rows); expect(again.spend).toBe(result.spend); expect(again.posted).toBe(0); expect(again.audits).toBe(0);
  }, 100000);
});
