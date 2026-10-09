import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
const root = fileURLToPath(new URL('../../', import.meta.url));
const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function output(run, prefix) {
  const line = run.stdout.split('\n').find(line => line.startsWith(prefix));
  expect(line, run.stderr + '\n' + run.stdout).toBeTruthy(); return JSON.parse(line.slice(prefix.length));
}
describe('actual process ACK failure death and owned driver recovery', () => {
  it.each([['node:sqlite', false], ['node:sqlite', true], ['sql.js', false], ['sql.js', true]])('%s installed=%s keeps ambiguity and audited replay one debit', (engine, installed) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-chat-ack-crash-')); directories.push(directory);
    const run = mode => spawnSync(process.execPath, ['tests/fixtures/chat-ack-crash-child.mjs', directory, engine, mode, String(installed)], { cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, HOME: directory, DATA_DIR: directory } });
    const first = run('crash'); expect(first.signal, first.stderr + '\n' + first.stdout).toBe('SIGKILL');
    const fault = output(first, 'FAULT:'); expect(fault).toMatchObject({ code: 'api_key_accounting_unavailable', calls: 1, completions: 1, faultReached: true });
    const inspect = run('inspect'); expect(inspect.status, inspect.stderr + '\n' + inspect.stdout).toBe(0);
    const state = output(inspect, 'RESULT:');
    // This runtime's actual driver is Node. SQL.js writer -> Node restart is
    // interoperability evidence, not SQL.js fallback or Bun certification.
    expect(state.driver).toBe('node:sqlite'); expect(state.recoveredOwnerInstanceId).toBe(fault.ownerInstanceId);
    expect(state.attempt).toMatchObject({ state: installed ? 'settled' : 'unresolved', costNanoUsd: installed ? '200000' : null, resolutionVersion: 1, ownerInstanceId: fault.ownerInstanceId });
    expect(state.attempts).toBe(1); expect(state.usageRows).toBe(0); expect(state.receipts).toBe(0); expect(state.audits).toBe(0);
    expect(state.spend).toBe(installed ? '200000' : '0');
    const recovered = run('recover'); expect(recovered.status, recovered.stderr + '\n' + recovered.stdout).toBe(0);
    const final = output(recovered, 'RESULT:');
    expect(final.attempt).toMatchObject({ attemptId: state.attempt.attemptId, requestId: state.attempt.requestId, state: 'settled', costNanoUsd: '200000', resolutionVersion: installed ? 1 : 2 });
    expect(final.attempt.priceSnapshot.rates.input).toBe('1'); expect(final.spend).toBe('200000');
    expect(final.attempts).toBe(1); expect(final.audits).toBe(installed ? 0 : 1); expect(final.usageRows).toBe(1); expect(final.receipts).toBe(1);
    const repeated = run('recover'); expect(repeated.status, repeated.stderr + '\n' + repeated.stdout).toBe(0);
    const replay = output(repeated, 'RESULT:');
    expect(replay.attempt).toEqual(final.attempt); expect(replay.spend).toBe('200000'); expect(replay.audits).toBe(final.audits); expect(replay.usageRows).toBe(1); expect(replay.receipts).toBe(1);
  }, 60000);
});
