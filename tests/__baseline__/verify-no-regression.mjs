// Assertion regressions: exit 1. Invalid/incomplete execution: exit 2 (takes
// precedence over regressions). Explicit suite exclusions remain scope limits.
// Usage: node tests/__baseline__/verify-no-regression.mjs <vitest-results.json> [scope.json]
// scope.json: { "files": ["tests/unit/example.test.js", ...] }, explicit exact
// selected inventory. Missing/extra/skipped-only targets block scope acceptance.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function baselineTestPath(name) {
  if (typeof name !== "string" || !name) throw new Error("Missing test filename");
  const normalized = name.replaceAll("\\", "/");
  const boundaries = [...normalized.matchAll(/(?:^|\/)tests\//g)];
  if (boundaries.length !== 1) throw new Error("Ambiguous or missing tests/ filename boundary");
  const result = normalized.slice(boundaries[0].index + (normalized[boundaries[0].index] === "/" ? 1 : 0));
  if (result.split("/").some(part => part === ".." || part === "." || !part)) throw new Error("Invalid test filename");
  return result;
}
export function evaluateNoRegression(report, knownFails, scope = null) {
  const errors = [], failures = [], identities = new Set(), executedFiles = new Set();
  let assertions = 0, passed = 0, failed = 0, pending = 0, todo = 0;
  if (!report || typeof report !== "object" || !Array.isArray(report.testResults) || typeof report.success !== "boolean") return { exitCode: 2, errors: ["Invalid Vitest report shape"], regressions: [], failures: [] };
  for (const suite of report.testResults) {
    if (!suite || typeof suite !== "object") { errors.push("Invalid suite record"); continue; }
    let name;
    try { name = baselineTestPath(suite.name); } catch (error) { errors.push(error.message); continue; }
    if (identities.has(name)) errors.push(`Duplicate suite identity: ${name}`); identities.add(name);
    if (!Array.isArray(suite.assertionResults) || !["passed", "failed", "pending", "skipped", "todo"].includes(suite.status)) { errors.push(`Invalid suite: ${name}`); continue; }
    let suiteFailed = 0;
    if (suite.testExecError || suite.failureMessage && suite.assertionResults.length === 0) errors.push(`Suite runtime error: ${name}`);
    for (const assertion of suite.assertionResults) {
      assertions++;
      if (!assertion || typeof assertion.fullName !== "string" || !assertion.fullName) { errors.push(`Missing assertion identity: ${name}`); continue; }
      switch (assertion.status) {
        case "passed": passed++; executedFiles.add(name); break;
        case "failed": failed++; suiteFailed++; executedFiles.add(name); failures.push(`${name} :: ${assertion.fullName}`); break;
        case "pending": case "skipped": pending++; break;
        case "todo": todo++; break;
        default: errors.push(`Unknown assertion status: ${name}`);
      }
    }
    if (suite.status === "failed" && suiteFailed === 0) errors.push(`Suite execution/collection failed: ${name}`);
    if (suite.status !== "failed" && suiteFailed > 0) errors.push(`Inconsistent suite status: ${name}`);
  }
  if (scope !== null) {
    try {
      if (!scope || !Array.isArray(scope.files) || !scope.files.length || Object.keys(scope).some(key => key !== "files")) throw new Error("Invalid intended-scope manifest");
      const selected = scope.files.map(baselineTestPath), expected = new Set(selected);
      if (selected.length !== expected.size) throw new Error("Duplicate intended-scope target");
      for (const name of expected) {
        if (!identities.has(name)) errors.push(`Intended suite not collected: ${name}`);
        else if (!executedFiles.has(name)) errors.push(`Intended suite has no executed assertions: ${name}`);
      }
      for (const name of identities) if (!expected.has(name)) errors.push(`Unexpected suite outside intended scope: ${name}`);
    } catch (error) { errors.push(error.message); }
  }
  if (!assertions || !passed && !failed) errors.push("No executed assertions; execution is inconclusive");
  // Vitest's suite counters count nested describe blocks, not report file rows.
  // Test counters do count assertion records in supported JSON reporters.
  for (const [key, actual] of Object.entries({ numTotalTests: assertions, numPassedTests: passed, numFailedTests: failed, numPendingTests: pending, numTodoTests: todo })) {
    if (!Number.isSafeInteger(report[key]) || report[key] < 0 || report[key] !== actual) errors.push(`Inconsistent ${key}`);
  }
  if (report.numRuntimeErrorTestSuites || report.unhandledErrors?.length || report.testExecError || report.wasInterrupted === true) errors.push("Reported runtime error or interrupted execution");
  if (report.success && (failed || errors.length)) errors.push("Report success conflicts with failures");
  if (!report.success && failed === 0) errors.push("Unexplained unsuccessful execution");
  const regressions = failures.filter(failure => !knownFails.has(failure));
  return { exitCode: errors.length ? 2 : regressions.length ? 1 : 0, errors, regressions, failures };
}
export function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length < 1 || argv.length > 2) throw new Error("Expected results.json and optional scope.json paths");
    const known = new Set(readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8").split("\n").map(line => line.trim()).filter(Boolean));
    const report = JSON.parse(readFileSync(argv[0], "utf8"));
    const scope = argv.length === 2 ? JSON.parse(readFileSync(argv[1], "utf8")) : null;
    const result = evaluateNoRegression(report, known, scope);
    for (const error of result.errors) console.error(`INCOMPLETE: ${error}`);
    for (const regression of result.regressions) console.error(`REGRESSION: ${regression}`);
    if (result.exitCode === 0) console.log(`No assertion regression within supplied run (known failures=${result.failures.length}, baseline=${known.size}). ${scope ? "Intended file scope verified; assertion-level skips remain limitations." : "No scope manifest supplied; omitted suites are not certified."}`);
    return result.exitCode;
  } catch (error) { console.error(`INCOMPLETE: ${error.message}`); return 2; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
