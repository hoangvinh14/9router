// Run the built real Next pricing page in a disposable loopback-only standalone server.
// Usage: PRICING_UI_RUNNER=/absolute/@playwright/test/index.mjs
//        PRICING_UI_CHROMIUM=/absolute/headless-shell node tests/browser/run-pricing-editor.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
if (!process.env.PRICING_UI_RUNNER || !process.env.PRICING_UI_CHROMIUM || !process.env.PRICING_UI_BUILD) throw new Error("Explicit isolated runner, browser binary and fresh build directory required");
const build = path.resolve(process.env.PRICING_UI_BUILD);
const buildTime = fs.statSync(path.join(build, "BUILD_ID")).mtimeMs;
for (const source of ["src/shared/components/PricingModal.js", "src/shared/utils/pricingDraft.js", "src/app/dashboard/settings/pricing/page.js", "src/app/api/pricing/sync/route.js", "src/lib/pricing/catalogSync.js", "src/lib/pricing/catalogSchedule.js", "src/lib/auth/managementGuard.js", "src/shared/services/initializeApp.js", ...(process.env.PRICING_UI_COVERAGE === "1" ? ["src/shared/components/PricingCoverage.js", "src/app/api/pricing/coverage/route.js", "src/lib/pricing/coverageReport.js", "src/lib/pricing/referenceResolver.js"] : [])]) {
  if (fs.statSync(path.join(root, source)).mtimeMs > buildTime) throw new Error("Pricing build is stale; rebuild before rendered checks");
}
if (process.env.PRICING_UI_BUDGET === "1") {
  for (const source of ["src/shared/components/ApiKeyBudgetPanel.js", "src/shared/utils/budgetManagementDraft.js", "src/shared/utils/tailscaleLoginUrl.js", "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js", "src/lib/apiKeyBudget/management.js", "src/lib/apiKeyBudget/managementHttp.js", "src/lib/apiKeyBudget/recoveryReceipt.js"]) {
    if (fs.statSync(path.join(root, source)).mtimeMs > buildTime) throw new Error("Budget panel build is stale; rebuild before rendered checks");
  }
}
if (process.env.PRICING_UI_GLOBAL === "1") {
  for (const source of ["src/shared/components/GlobalAccountingPanel.js", "src/shared/utils/globalAccountingDraft.js", "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js", "src/app/api/accounting/gaps/route.js", "src/app/api/accounting/maintenance/release/route.js", "src/lib/apiKeyBudget/globalManagement.js", "src/lib/db/accountingCoverage.js", "src/lib/db/maintenanceReleaseAcknowledgement.js"]) {
    if (fs.statSync(path.join(root, source)).mtimeMs > buildTime) throw new Error("Global recovery build is stale; rebuild before rendered checks");
  }
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pricing-rendered-"));
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const secret = crypto.randomBytes(32).toString("hex");
const baseURL = `http://127.0.0.1:${port}`;
const standalone = path.join(directory, "standalone");
fs.cpSync(path.join(build, "standalone"), standalone, { recursive: true });
// Next serializes distDir relative to the original project root in server.js.
const relativeBuild = path.relative(root, build);
if (relativeBuild.startsWith("..") || path.isAbsolute(relativeBuild)) throw new Error("Expected owned repo-relative Next build directory");
fs.cpSync(path.join(build, "static"), path.join(standalone, relativeBuild, "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
const env = { ...process.env, HOME: path.join(directory, "home"), DATA_DIR: path.join(directory, "data"), HOSTNAME: "127.0.0.1", PORT: String(port), NEXT_TELEMETRY_DISABLED: "1", JWT_SECRET: secret, INITIAL_PASSWORD: crypto.randomBytes(24).toString("hex"), NEXT_PUBLIC_BASE_URL: baseURL };
fs.mkdirSync(env.HOME);
const log = fs.openSync(path.join(directory, "server.log"), "w");
const server = spawn(process.execPath, [path.join(standalone, "server.js")], { cwd: standalone, env, detached: true, stdio: ["ignore", log, log] });
const serverExit = new Promise(resolve => server.once("exit", (code, signal) => resolve({ code, signal })));
console.log(`RENDERED_ARTIFACT_DIR=${directory}`);
try {
  const deadline = Date.now() + 150000;
  let ready = false;
  while (Date.now() < deadline && server.exitCode === null && server.signalCode === null) {
    try {
      const response = await fetch(`${baseURL}/login`, { signal: AbortSignal.timeout(10000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Bounded app readiness, not background-task polling. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error(`Isolated server unavailable; inspect ${directory}/server.log`);
  const browserLog = fs.openSync(path.join(directory, "browser.log"), "w");
  const test = spawn(process.execPath, [path.join(root, process.env.PRICING_UI_GLOBAL === "1" ? "tests/browser/global-accounting-panel.mjs" : process.env.PRICING_UI_BUDGET === "1" ? "tests/browser/budget-panel.mjs" : "tests/browser/pricing-editor.mjs")], { cwd: root, env: { ...env, PRICING_UI_URL: baseURL, PRICING_UI_SECRET: secret, PRICING_UI_SCREENSHOT: path.join(directory, "pricing-editor.png"), PRICING_UI_TRACE: path.join(directory, "browser-trace.zip") }, stdio: ["ignore", browserLog, browserLog], timeout: 150000 });
  const result = await new Promise((resolve, reject) => { test.once("error", reject); test.once("exit", (code, signal) => resolve({ code, signal })); });
  fs.closeSync(browserLog);
  console.log(`BROWSER_EXIT=${JSON.stringify(result)} BROWSER_LOG=${directory}/browser.log`);
  if (result.code !== 0 || result.signal) throw new Error(`Rendered pricing smoke failed; inspect ${directory}/browser.log`);
} finally {
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* Already stopped. */ }
  const deadline = setTimeout(() => { try { process.kill(-server.pid, "SIGKILL"); } catch { /* Already stopped. */ } }, 5000);
  await serverExit; clearTimeout(deadline); fs.closeSync(log);
}
