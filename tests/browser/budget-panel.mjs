// Fixture-backed real Endpoint panel interaction. Isolated loopback build only.
import assert from "node:assert/strict";
import { SignJWT } from "jose";
const { chromium, expect } = await import(process.env.PRICING_UI_RUNNER);
const baseURL = process.env.PRICING_UI_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseURL || "") || !process.env.PRICING_UI_SECRET) throw new Error("Isolated loopback fixture required");
const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(new TextEncoder().encode(process.env.PRICING_UI_SECRET));
const browser = await chromium.launch({ headless: true, executablePath: process.env.PRICING_UI_CHROMIUM });
const context = await browser.newContext({ baseURL, serviceWorkers: "block" }); const page = await context.newPage();
page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(45000);
const errors = [], blocked = [], mutations = [];
page.on("pageerror", error => errors.push(error.message));
await context.route("**/*", route => { const origin = new URL(route.request().url()).origin; if (origin !== baseURL) { blocked.push(origin); return route.abort(); } return route.fallback(); });
await context.addCookies([{ name: "auth_token", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
if (process.env.PRICING_UI_TRACE) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
const keys = ["a", "b"].map(id => ({ id: `key-${id}`, name: `Fixture ${id.toUpperCase()}`, key: `fixture-secret-${id}`, isActive: true, createdAt: "2026-10-01T00:00:00.000Z" }));
const window = { startAt: "2026-10-01T00:00:00.000Z", resetAt: "2026-10-31T17:00:00.000Z", spentUsd: "1.000000001", limitUsd: null, remainingUsd: null, overshootUsd: "0", exhausted: false };
const status = id => ({ apiKeyId: id, active: true, retired: false, version: 0, updatedAt: null, timezone: "Asia/Ho_Chi_Minh", scope: ["chat", "embeddings"], virtualReference: true, ledgerStartedAt: null, enforcementActive: false, status: "inactive", weekly: { ...window }, monthly: { ...window }, counts: { unresolved: resolved ? 0 : 1, pending: 0 }, coverage: { generation: 2, maintenance: null, gaps: [{ id: "global-gap", apiKeyId: null, generation: 2, startedAt: "2026-10-03T00:00:00.000Z" }] } });
const attempt = { attemptId: "attempt-a", requestId: "request-a", apiKeyId: "key-a", provider: "fixture", model: "fixture", endpoint: "chat", startedAt: "2026-10-03T00:00:00.000Z", state: "unresolved", costUsd: null, resolutionVersion: 1 };
let resolved = false, heldRecovery, heldResolve, readFailure = false, failAck = true, holdRead = false, heldRead, heldReadResolve;
await page.route(url => url.origin === baseURL && url.pathname.startsWith("/api/"), async route => {
  const url = new URL(route.request().url()), method = route.request().method();
  if (url.pathname === "/api/keys") { assert.equal(method, "GET", "no default-key auto-provision fixture"); return route.fulfill({ json: { keys } }); }
  if (url.pathname === "/api/settings") return route.fulfill({ json: { requireLogin: true, hasPassword: true, requireApiKey: true } });
  if (url.pathname === "/api/tunnel/status") return route.fulfill({ json: { tunnel: { enabled: false }, tailscale: { enabled: false } } });
  if (url.pathname.startsWith("/api/keys/key-")) {
    const id = url.pathname.split("/")[3];
    if (method === "POST") {
      mutations.push({ url: url.pathname, body: route.request().postDataJSON() });
      heldRecovery = route; heldResolve?.(); return;
    }
    if (method === "PUT") { mutations.push({ url: url.pathname, body: route.request().postDataJSON() }); return route.fulfill({ status: 409, json: { code: "api_key_accounting_conflict" } }); }
    assert.equal(method, "GET");
    if (holdRead && url.pathname.endsWith("/budget")) { holdRead = false; heldRead = route; heldReadResolve?.(); return; }
    if (readFailure) return route.fulfill({ status: 503, json: { code: "api_key_accounting_unavailable" } });
    if (url.pathname.endsWith("/budget")) return route.fulfill({ json: status(id) });
    if (url.pathname.endsWith("/accounting")) return route.fulfill({ json: { attempts: id === "key-a" && !resolved ? [attempt] : [], nextCursor: null } });
    if (url.pathname.endsWith("/usage")) return route.fulfill({ json: { aggregateScope: "page", attempts: [], nextCursor: null, breakdown: [{ provider: "fixture", model: "fixture", endpoint: "chat", attempts: 1, knownCostUsd: "0", totalCostUsd: null }] } });
  }
  return route.fallback();
});
try {
  await page.goto("/dashboard/endpoint");
  const openA = page.getByRole("button", { name: "Budget and accounting for Fixture A", exact: true });
  await openA.click();
  const dialog = page.getByRole("dialog", { name: "Budget and accounting — Fixture A", exact: true });
  const close = dialog.getByRole("button", { name: "Close budget and accounting", exact: true });
  await expect(dialog.getByText("Enforcement: OFF — no protection advertised; state: inactive", { exact: true })).toBeVisible();
  await expect(close).toBeFocused();
  await expect(dialog.getByText("Unknown", { exact: true })).toBeVisible();
  const globalState = dialog.getByText("Global gap — Unreconciled; generation 2", { exact: true });
  await expect(globalState).toHaveCount(1); await expect(globalState).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Review key gap", exact: true })).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "weekly unlimited", exact: true }).uncheck();
  await dialog.getByRole("textbox", { name: "weekly limit USD", exact: true }).fill("0");
  await expect(dialog.getByRole("button", { name: "Save budget policy", exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "weekly unlimited", exact: true }).check();
  await dialog.getByRole("button", { name: "Save budget policy", exact: true }).click();
  await expect(dialog.locator('p[role="alert"]')).toHaveText("Policy state changed or enforcement is not ready. Refresh before editing.");
  assert.deepEqual(mutations[0].body, { weeklyLimitUsd: null, monthlyLimitUsd: null, expectedVersion: 0 });
  await dialog.getByRole("button", { name: "Review attempt", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Recovery action", exact: true }).selectOption("exact_usage");
  await expect(dialog.getByRole("textbox", { name: "Exact usage JSON", exact: true })).toHaveValue("");
  await dialog.getByRole("combobox", { name: "Recovery action", exact: true }).selectOption("waive");
  await dialog.getByRole("textbox", { name: "Recovery reason", exact: true }).fill("Reviewed provider evidence");
  await dialog.getByRole("textbox", { name: "Recovery evidence", exact: true }).fill("Explicit unknown-usage waiver approved");
  const beforeStorageFailure = mutations.length;
  await page.evaluate(() => { window.fixtureStorageSet = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error("Fixture storage unavailable"); }; });
  await dialog.getByRole("button", { name: "Submit audited recovery", exact: true }).click();
  await expect(dialog.locator('p[role="alert"]')).toHaveText("Fixture storage unavailable");
  assert.equal(mutations.length, beforeStorageFailure, "storage retention failure forbids recovery dispatch");
  await page.evaluate(() => { Storage.prototype.setItem = window.fixtureStorageSet; delete window.fixtureStorageSet; });
  const first = new Promise(resolve => { heldResolve = resolve; });
  await dialog.getByRole("button", { name: "Submit audited recovery", exact: true }).click(); await first;
  await expect(close).toBeDisabled(); await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2); await expect(dialog).toBeVisible();
  const original = structuredClone(mutations.at(-1));
  assert.equal(original.body.expectedVersion, 1); assert.equal(original.body.action, "waive"); assert.ok(original.body.operationId);
  assert.equal(await page.evaluate(() => Boolean(sessionStorage.getItem("9router:accounting-recovery:key-a"))), true);
  await heldRecovery.fulfill({ status: 503, json: { code: "api_key_accounting_unavailable" } });
  await expect(dialog.locator('p[role="alert"]')).toHaveText("Recovery not acknowledged. Retry the unchanged operation; do not assume rollback.");
  await close.click(); await expect(openA).toBeFocused(); await openA.click();
  await expect(dialog.getByRole("button", { name: "Retry unchanged recovery", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Review attempt", exact: true })).toBeDisabled();
  const retry = new Promise(resolve => { heldResolve = resolve; });
  await dialog.getByRole("button", { name: "Retry unchanged recovery", exact: true }).click(); await retry;
  assert.deepEqual(mutations.at(-1), original, "identical operation/payload/version survives close/reopen");
  await heldRecovery.fulfill({ status: 200, contentType: "application/json", body: "{" });
  await expect(dialog.getByRole("button", { name: "Retry unchanged recovery", exact: true })).toBeEnabled();
  await expect(dialog.locator('p[role="alert"]')).toBeVisible();
  assert.equal(await page.evaluate(() => Boolean(sessionStorage.getItem("9router:accounting-recovery:key-a"))), true, "malformed success acknowledgement retains identity");
  const acknowledged = new Promise(resolve => { heldResolve = resolve; });
  await dialog.getByRole("button", { name: "Retry unchanged recovery", exact: true }).click(); await acknowledged;
  assert.deepEqual(mutations.at(-1), original, "malformed acknowledgement never generates a new correction");
  const committed = { version: 1, operationId: original.body.operationId, apiKeyId: "key-a", kind: "attempt", targetId: "attempt-a", action: "waive", resolutionVersion: 2, state: "waived", costUsd: "0" };
  for (const invalid of [{}, { recoveryReceipt: { ...committed, operationId: "wrong-operation" } }, { recoveryReceipt: { ...committed, apiKeyId: "key-b" } }]) {
    await heldRecovery.fulfill({ json: invalid });
    await expect(dialog.locator('p[role="alert"]')).toHaveText("Recovery acknowledgement is incomplete or mismatched. Retry the unchanged operation; do not assume rollback.");
    assert.equal(await page.evaluate(() => Boolean(sessionStorage.getItem("9router:accounting-recovery:key-a"))), true);
    const next = new Promise(resolve => { heldResolve = resolve; });
    await dialog.getByRole("button", { name: "Retry unchanged recovery", exact: true }).click(); await next;
    assert.deepEqual(mutations.at(-1), original, "invalid parseable receipt preserves exact operation");
  }
  resolved = true; readFailure = true; failAck = false;
  await heldRecovery.fulfill({ json: { ...attempt, state: "waived", costUsd: "0", resolutionVersion: 2, recoveryReceipt: committed } });
  await expect(dialog.locator('p[role="alert"]')).toHaveText("Accounting data unavailable or access denied. No allowance is inferred.");
  await expect(dialog.getByText("Recovery saved. Refreshing status; a refresh failure does not undo recovery.", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => sessionStorage.getItem("9router:accounting-recovery:key-a")), null);
  readFailure = false; await dialog.getByRole("button", { name: "Refresh accounting", exact: true }).click();
  await expect(dialog.getByText("No unresolved attempts in this page.", { exact: true })).toBeVisible();
  await close.focus(); await page.keyboard.press("Shift+Tab");
  const last = await page.evaluate(() => document.activeElement?.textContent); assert.equal(last, "Save budget policy");
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.PRICING_UI_SCREENSHOT) await page.screenshot({ path: process.env.PRICING_UI_SCREENSHOT.replace(".png", "-budget-mobile.png"), fullPage: true });
  await close.click();
  const oldRead = new Promise(resolve => { heldReadResolve = resolve; });
  holdRead = true; await openA.click(); await oldRead;
  await page.getByRole("button", { name: "Close budget and accounting", exact: true }).click();
  await page.getByRole("button", { name: "Budget and accounting for Fixture B", exact: true }).click();
  const other = page.getByRole("dialog", { name: "Budget and accounting — Fixture B", exact: true });
  await expect(other.getByText("Enforcement: OFF — no protection advertised; state: inactive", { exact: true })).toBeVisible();
  if (heldRead) { try { await heldRead.fulfill({ json: status("key-a") }); } catch { /* Aborted old read. */ } }
  await expect(other).toBeVisible(); await expect(page.getByRole("dialog", { name: "Budget and accounting — Fixture A", exact: true })).toHaveCount(0);
  assert.equal(failAck, false); assert.deepEqual(errors, []);
  assert.deepEqual(blocked.filter(origin => origin !== "https://www.googletagmanager.com"), []);
  console.log(JSON.stringify({ passed: ["off-policy-null-zero-CAS", "exact-usage-starts-blank", "storage-failure-no-recovery-dispatch", "unknown-and-global-gap-visible", "recovery-busy-close-guards", "ambiguous-ack-retained-idempotent-retry", "malformed-success-retains-retry", "empty-or-wrong-receipt-retains-retry", "saved-recovery-refresh-failure", "dialog-focus-trap-restoration", "key-switch-cancelled-read", "budget-mobile-overflow"], pageErrors: errors, blockedExternalOrigins: [...new Set(blocked)] }));
} catch (error) { console.error(error); if (process.env.PRICING_UI_SCREENSHOT) { try { await page.screenshot({ path: process.env.PRICING_UI_SCREENSHOT, fullPage: true }); } catch { /* Original failure retained. */ } } throw error; }
finally { if (process.env.PRICING_UI_TRACE) await context.tracing.stop({ path: process.env.PRICING_UI_TRACE }); await context.close(); await browser.close(); }
