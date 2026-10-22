import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
let manifest;
try { manifest = JSON.parse(fs.readFileSync(new URL('./baseline-manifest.json', import.meta.url))); }
catch { throw new Error('Baseline manifest missing or invalid'); }
const allowed = new Set(['passed', 'failed']);
export function collect(result, expected, repo = root) {
  if (!result || !Array.isArray(result.testResults)) throw new Error('Missing testResults');
  const files = new Map();
  for (const suite of result.testResults) {
    const name = path.isAbsolute(suite.name) ? path.relative(repo, suite.name) : suite.name;
    if (!expected.includes(name) || files.has(name)) throw new Error('Unexpected/duplicate file identity');
    if (!['passed', 'failed'].includes(suite.status) || suite.message || !suite.assertionResults?.length) throw new Error('Collection/hook/body reachability incomplete');
    const assertions = new Map();
    for (const assertion of suite.assertionResults) {
      if (!allowed.has(assertion.status) || typeof assertion.fullName !== 'string' || !assertion.fullName || assertions.has(assertion.fullName)) throw new Error('Missing/skipped/duplicate assertion');
      // Vitest attaches hook failure messages to otherwise collected assertions.
      if (assertion.status === 'failed' && (assertion.failureMessages || []).some(text => /hook timed out|beforeAll|beforeEach|afterAll|afterEach|failed to load|cannot find module/i.test(text))) throw new Error('Hook/collection failure; bodies not certified');
      assertions.set(assertion.fullName, assertion.status);
    }
    files.set(name, assertions);
  }
  if (files.size !== expected.length || expected.some(name => !files.has(name))) throw new Error('Missing selected suite');
  return files;
}
export function compare(before, after, expected, repo = root) {
  try {
    const old = collect(before, expected, repo), current = collect(after, expected, repo);
    const regressions = [];
    for (const [file, assertions] of old) {
      for (const [name, status] of assertions) {
        const now = current.get(file).get(name);
        if (!now) throw new Error('Missing baseline assertion');
        if (status === 'passed' && now === 'failed') regressions.push(`${file} :: ${name}`);
      }
    }
    return { exit: regressions.length ? 1 : 0, regressions, files: current.size };
  } catch (error) { return { exit: 2, incomplete: error.message }; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [before, after] = process.argv.slice(2).map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
    const result = compare(before, after, manifest.tests);
    console.log(JSON.stringify(result)); process.exitCode = result.exit;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
