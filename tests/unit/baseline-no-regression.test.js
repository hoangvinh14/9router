import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateNoRegression, baselineTestPath } from "../__baseline__/verify-no-regression.mjs";
const script = new URL("../__baseline__/verify-no-regression.mjs", import.meta.url);
const assertion = (status = "passed", fullName = "fixture test") => ({ status, fullName });
function report(assertions = [assertion()], extras = {}) {
  const count = status => assertions.filter(a => a.status === status).length;
  return { success: count("failed") === 0, numTotalTests: assertions.length, numPassedTests: count("passed"), numFailedTests: count("failed"), numPendingTests: count("pending"), numTodoTests: count("todo"), testResults: [{ name: "/home/user/project/tests/unit/fixture.test.js", status: count("failed") ? "failed" : "passed", assertionResults: assertions }], ...extras };
}
describe("no-regression report integrity and portable baseline identity", () => {
  it("current Linux and legacy/Windows paths match same known assertion, unknown failure exits1", () => {
    const known = new Set(["tests/unit/fixture.test.js :: fixture test"]);
    for (const name of ["/home/user/project/tests/unit/fixture.test.js", "/Users/Working/router4/app/tests/unit/fixture.test.js", "C:\\project\\tests\\unit\\fixture.test.js", "tests/unit/fixture.test.js"]) {
      const r = report([assertion("failed")]); r.testResults[0].name = name;
      expect(evaluateNoRegression(r, known).exitCode).toBe(0);
      expect(evaluateNoRegression(r, new Set()).exitCode).toBe(1);
    }
  });
  it("empty/collection failed/mixed collection/aborted cannot pass even when assertions known", () => {
    for (const r of [report([], { success: false }), report([assertion("pending")]), report([assertion()], { success: false }), report([assertion()], { wasInterrupted: true }), report([assertion()], { unhandledErrors: ["fixture error"] })]) expect(evaluateNoRegression(r, new Set()).exitCode).toBe(2);
    const r = report([assertion("failed")]); r.testResults.push({ name: "/root/tests/unit/collection.test.js", status: "failed", assertionResults: [] });
    expect(evaluateNoRegression(r, new Set()).exitCode).toBe(2);
    expect(evaluateNoRegression(r, new Set()).regressions).toHaveLength(1);
  });
  it("malformed/inconsistent counters/unknown statuses/duplicate or ambiguous names rejected", () => {
    expect(evaluateNoRegression(null, new Set()).exitCode).toBe(2);
    expect(evaluateNoRegression(report([assertion()], { numTotalTests: 2 }), new Set()).exitCode).toBe(2);
    expect(evaluateNoRegression(report([assertion("unknown")]), new Set()).exitCode).toBe(2);
    const r = report(); r.testResults.push(r.testResults[0]); expect(evaluateNoRegression(r, new Set()).exitCode).toBe(2);
    for (const name of ["/tests/nested/tests/unit/a.js", "/root/no-tests/a.js", "tests/../a.js"]) expect(() => baselineTestPath(name)).toThrow();
  });
  it("intended scope requires collected/executed files, rejects extras/skipped targets and badmanifest", () => {
    const fixture = report(), scope = { files: ["tests/unit/fixture.test.js"] };
    expect(evaluateNoRegression(fixture, new Set(), scope).exitCode).toBe(0);
    expect(evaluateNoRegression(fixture, new Set(), { files: [...scope.files, "tests/unit/missing.test.js"] }).errors).toContain("Intended suite not collected: tests/unit/missing.test.js");
    expect(evaluateNoRegression(fixture, new Set(), { files: ["tests/unit/other.test.js"] }).errors).toContain("Unexpected suite outside intended scope: tests/unit/fixture.test.js");
    const skipped = report([assertion("pending")]);
    expect(evaluateNoRegression(skipped, new Set(), scope).errors).toContain("Intended suite has no executed assertions: tests/unit/fixture.test.js");
    for (const manifest of [{ files: [] }, { files: ["tests/unit/fixture.test.js", "tests/unit/fixture.test.js"] }, { files: scope.files, ignored: true }]) expect(evaluateNoRegression(fixture, new Set(), manifest).exitCode).toBe(2);
    const malformed = report(); malformed.testResults.push(null); expect(evaluateNoRegression(malformed, new Set()).exitCode).toBe(2);
    const runtime = report(); runtime.testResults[0].testExecError = { message: "fixture" }; expect(evaluateNoRegression(runtime, new Set()).exitCode).toBe(2);
    const badAssertion = report(); badAssertion.testResults[0].assertionResults = [null]; expect(evaluateNoRegression(badAssertion, new Set()).exitCode).toBe(2);
  });
  it("actual committed report identifies cloud collection failure without rewriting baselines", () => {
    const fixture = JSON.parse(fs.readFileSync(new URL("../__baseline__/baseline-results.json", import.meta.url), "utf8"));
    const result = evaluateNoRegression(fixture, new Set()); expect(result.exitCode).toBe(2);
    expect(result.errors).toEqual(["Suite execution/collection failed: tests/unit/embeddings.cloud.test.js"]);
  });
  it("CLI missing/unreadable/invalidJSON/validpass/knownfailure/newfailure exit contracts and import safe", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-baseline-gate-"));
    try {
      const run = args => spawnSync(process.execPath, [fileURLToPath(script), ...args], { encoding: "utf8" });
      expect(run([]).status).toBe(2); expect(run([path.join(dir, "missing.json")]).status).toBe(2);
      const file = path.join(dir, "fixture.json"); fs.writeFileSync(file, "{"); expect(run([file]).status).toBe(2);
      fs.writeFileSync(file, JSON.stringify(report())); expect(run([file]).status).toBe(0);
      const scope = path.join(dir, "scope.json"); fs.writeFileSync(scope, JSON.stringify({ files: ["tests/unit/fixture.test.js"] })); expect(run([file, scope]).status).toBe(0);
      fs.writeFileSync(scope, JSON.stringify({ files: ["tests/unit/missing.test.js"] })); expect(run([file, scope]).status).toBe(2);
      const copied = path.join(dir, "verify-no-regression.mjs"); fs.copyFileSync(script, copied);
      const missingBaseline = spawnSync(process.execPath, [copied, file], { encoding: "utf8" }); expect(missingBaseline.status).toBe(2); expect(missingBaseline.stderr).toContain("INCOMPLETE");
      fs.writeFileSync(file, JSON.stringify(report([assertion("failed")]))); expect(run([file]).status).toBe(1);
      const known = fs.readFileSync(new URL("../__baseline__/known-fails.txt", import.meta.url), "utf8").split("\n").find(Boolean);
      const [name, fullName] = known.split(" :: "); const fixture = report([assertion("failed", fullName)]); fixture.testResults[0].name = `/project/${name}`;
      fs.writeFileSync(file, JSON.stringify(fixture)); expect(run([file]).status).toBe(0);
      const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `import ${JSON.stringify(script.href)}; console.log('imported')`], { encoding: "utf8" });
      expect(imported.status).toBe(0); expect(imported.stdout.trim()).toBe("imported");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
