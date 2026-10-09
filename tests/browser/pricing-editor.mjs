// Standalone rendered smoke: supply an isolated app URL, JWT fixture secret and
// absolute @playwright/test module path. Never point at a production instance.
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import fs from "node:fs";
const { chromium, expect } = await import(process.env.PRICING_UI_RUNNER);
const baseURL = process.env.PRICING_UI_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseURL || "") || !process.env.PRICING_UI_SECRET) throw new Error("Isolated loopback URL and fixture secret required");
const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(new TextEncoder().encode(process.env.PRICING_UI_SECRET));
const browser = await chromium.launch({ headless: true, executablePath: process.env.PRICING_UI_CHROMIUM });
const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [], externalRequests = [];
page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(45000);
page.on("pageerror", error => errors.push(error.message));
await context.route("**/*", route => {
  if (new URL(route.request().url()).origin !== baseURL) { externalRequests.push(new URL(route.request().url()).origin); return route.abort(); }
  return route.fallback();
});
if (process.env.PRICING_UI_TRACE) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
console.log("BROWSER_LAUNCHED");
await context.addCookies([{ name: "auth_token", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
const source = { fixture: { one: { input: 1, output: 2, cached: 0 }, two: { input: 3, output: 4 } } };
let effective = structuredClone(source), failure = false, malformedReset = false;
const mutations = [], catalogMutations = [], catalogReads = [], coverageReads = [];
let coverageConflict = false;
const coverageRow = (model, priced = true) => ({ provider: "fixture", model, endpoint: "chat", status: priced ? "priced" : "unavailable", ...(priced ? { source: "manual", virtual: true, rates: { input: "0", output: "2.000000001" } } : { reason: "exact_reference_mapping_missing" }) });
let catalogStatus = { revision: null, lastSuccess: null, error: null, pricedCount: 0, schedulerConfigured: false, schedulerEnabled: false };
let catalogFail = true, scheduleFail = false;
let holdNext = false, heldRoute, heldResolve;
await page.route(url => url.origin === baseURL && ["/api/pricing", "/api/pricing/sync", "/api/pricing/coverage"].includes(url.pathname), async route => {
  const method = route.request().method();
  const url = new URL(route.request().url());
  if (url.pathname === "/api/pricing/coverage") {
    assert.equal(method, "GET"); coverageReads.push(Object.fromEntries(url.searchParams));
    const offset = Number(url.searchParams.get("offset"));
    if (offset > 0 && coverageConflict) return route.fulfill({ status: 409, json: { code: "pricing_coverage_revision_changed" } });
    return route.fulfill({ json: { revision: "b".repeat(64), virtualReference: true, usageCertified: false, counts: { total: 51, priced: 50, unavailable: 1 }, rows: offset === 0 ? Array.from({ length: 50 }, (_, i) => coverageRow(`model-${i}`, i !== 0)) : [coverageRow("last-model")], nextOffset: offset === 0 ? 50 : null } });
  }
  if (new URL(route.request().url()).pathname === "/api/pricing/sync") {
    if (method === "GET") { catalogReads.push(method); return route.fulfill({ json: catalogStatus }); }
    assert.ok(["PUT", "POST"].includes(method), "unexpected catalog method");
    const body = method === "PUT" ? route.request().postDataJSON() : null;
    catalogMutations.push({ method, body });
    if (method === "PUT") {
      if (scheduleFail) return route.fulfill({ status: 503, json: { error: "pricing_schedule_unavailable" } });
      catalogStatus = { ...catalogStatus, schedulerConfigured: body.schedulerEnabled, schedulerEnabled: body.schedulerEnabled };
      return route.fulfill({ json: { schedulerConfigured: body.schedulerEnabled, schedulerEnabled: body.schedulerEnabled } });
    }
    catalogStatus = { ...catalogStatus, error: catalogFail ? "pricing_sync_failed" : null, revision: catalogFail ? catalogStatus.revision : "a".repeat(64), lastSuccess: catalogFail ? null : "2026-10-04T00:00:00.000Z", pricedCount: catalogFail ? 0 : 2 };
    return route.fulfill({ status: catalogFail ? 502 : 200, json: catalogStatus });
  }
  if (method === "GET") {
    if (holdNext) { holdNext = false; heldRoute = route; heldResolve?.(); return; }
    return route.fulfill({ status: failure ? 500 : 200, json: failure ? { error: "fixture failure" } : effective });
  }
  assert.ok(["PATCH", "DELETE"].includes(method), "unexpected pricing method");
  mutations.push({ method, url: route.request().url(), body: method === "PATCH" ? route.request().postDataJSON() : null });
  if (method === "DELETE") effective = { fixture: { one: { input: 9, output: 10 } } };
  return malformedReset && method === "DELETE" ? route.fulfill({ status: 200, body: "not-json" }) : route.fulfill({ status: 200, json: effective });
});
page.on("dialog", dialog => dialog.accept());
try {
  await page.goto("/dashboard/settings/pricing");
  const open = () => page.getByRole("button", { name: "Edit Pricing", exact: true }).click();
  const errorAlert = text => page.getByRole("alert").filter({ hasText: text });
  const rate = field => page.getByRole("textbox", { name: `fixture one ${field} rate`, exact: true });
  await expect(page.getByText("Not synced", { exact: true })).toBeVisible();
  assert.ok(catalogReads.length > 0, "catalog GET intercepted");
  assert.equal(catalogMutations.length, 0, "status GET must not trigger catalog mutation");
  await page.getByRole("button", { name: "Sync reference pricing", exact: true }).click();
  await expect(page.getByText("Degraded", { exact: true })).toBeVisible();
  await expect(errorAlert("Last-known-good pricing is retained")).toHaveCount(1);
  const schedule = page.getByRole("checkbox", { name: "Enable automatic reference pricing sync every 24 hours", exact: true });
  const toggle = async enabled => {
    if (enabled) await expect(schedule).not.toBeChecked(); else await expect(schedule).toBeChecked();
    const response = page.waitForResponse(r => new URL(r.url()).origin === baseURL && new URL(r.url()).pathname === "/api/pricing/sync" && r.request().method() === "PUT");
    const [ack] = await Promise.all([response, schedule.click()]);
    assert.deepEqual(ack.request().postDataJSON(), { schedulerEnabled: enabled });
    assert.equal(ack.status(), scheduleFail ? 503 : 200);
    const result = await ack.json();
    if (!scheduleFail) assert.deepEqual(result, { schedulerConfigured: enabled, schedulerEnabled: enabled });
    else assert.equal(result.error, "pricing_schedule_unavailable");
    await expect(schedule).toBeEnabled();
  };
  await toggle(true); await expect(schedule).toBeChecked(); assert.equal(catalogStatus.schedulerConfigured, true);
  await toggle(false); await expect(schedule).not.toBeChecked(); assert.equal(catalogStatus.schedulerConfigured, false);
  assert.deepEqual(catalogMutations.slice(1), [{ method: "PUT", body: { schedulerEnabled: true } }, { method: "PUT", body: { schedulerEnabled: false } }]);
  scheduleFail = true; await toggle(true); await expect(schedule).not.toBeChecked();
  await expect(errorAlert("Schedule change denied or storage unavailable")).toHaveCount(1);
  assert.equal(catalogStatus.schedulerConfigured, false); scheduleFail = false;
  catalogFail = false;
  await page.getByRole("button", { name: "Sync reference pricing", exact: true }).click();
  await expect(page.getByText("Synced", { exact: true })).toBeVisible();
  if (process.env.PRICING_UI_COVERAGE === "1") {
    assert.equal(coverageReads.length, 0, "coverage loads only when opened");
    await page.getByRole("button", { name: "Inspect coverage", exact: true }).click();
    const section = page.getByRole("region", { name: "Reference pricing coverage", exact: true });
    await expect(section.getByText("exact_reference_mapping_missing", { exact: true })).toBeVisible();
    await expect(section.getByText("Showing 1–50 of 51", { exact: true })).toBeVisible();
    await expect(section.getByText("manual (virtual mapping)", { exact: true })).toHaveCount(49);
    await expect(section.getByText("0 / 2.000000001", { exact: true })).toHaveCount(49);
    await expect(section.getByText("A valid price does not certify exact usage", { exact: false })).toBeVisible();
    await expect(section.getByRole("rowheader", { name: "fixture / model-0", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next coverage page", exact: true }).click();
    await expect(section.getByText("Showing 51–51 of 51", { exact: true })).toBeVisible();
    await expect(section.getByRole("rowheader", { name: "fixture / last-model", exact: true })).toBeVisible();
    await expect(section.getByRole("rowheader", { name: "fixture / model-0", exact: true })).toHaveCount(0);
    assert.equal(coverageReads.at(-1).revision, "b".repeat(64));
    await page.getByRole("button", { name: "Previous coverage page", exact: true }).click();
    await expect(section.getByText("Showing 1–50 of 51", { exact: true })).toBeVisible();
    coverageConflict = true;
    await page.getByRole("button", { name: "Next coverage page", exact: true }).click();
    await expect(errorAlert("Pricing changed during pagination. Restart the report.")).toHaveCount(1);
    await page.getByRole("button", { name: "Restart coverage report", exact: true }).click();
    await expect(section.getByText("Showing 1–50 of 51", { exact: true })).toBeVisible();
    assert.equal(coverageReads.at(-1).revision, undefined);
    await expect(errorAlert("Pricing changed during pagination. Restart the report.")).toHaveCount(0);
    coverageConflict = false;
    await page.getByRole("button", { name: "Next coverage page", exact: true }).click();
    await expect(section.getByRole("rowheader", { name: "fixture / last-model", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous coverage page", exact: true }).click();
    await expect(section.getByText("Showing 1–50 of 51", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile page has no horizontal overflow");
    const scrollTable = section.getByRole("table").locator("..");
    await scrollTable.scrollIntoViewIfNeeded();
    const dimensions = await scrollTable.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
    assert.ok(dimensions.content > dimensions.width, "mobile table uses internal scrolling, not compressed/cropped rate columns");
    await scrollTable.hover(); await page.mouse.wheel(10000, 0);
    await expect.poll(() => scrollTable.evaluate(element => element.scrollLeft + element.clientWidth >= element.scrollWidth - 2)).toBe(true);
    const visibleLast = await section.getByRole("columnheader", { name: "Availability", exact: true }).evaluate(element => {
      const cell = element.getBoundingClientRect(), pane = element.closest("table").parentElement.getBoundingClientRect();
      return cell.left >= pane.left - 1 && cell.right <= pane.right + 1;
    });
    assert.equal(visibleLast, true, "actual horizontal wheel exposes rightmost column");
    if (process.env.PRICING_UI_SCREENSHOT) await page.screenshot({ path: process.env.PRICING_UI_SCREENSHOT.replace(".png", "-coverage-mobile-scrolled.png"), fullPage: true });
    await page.mouse.wheel(-10000, 0);
    await expect.poll(() => scrollTable.evaluate(element => element.scrollLeft)).toBe(0);
    if (process.env.PRICING_UI_SCREENSHOT) await page.screenshot({ path: process.env.PRICING_UI_SCREENSHOT.replace(".png", "-coverage-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: "Hide coverage", exact: true }).click();
  }
  await open(); await expect(rate("input")).toHaveValue("1");
  await expect(rate("cached")).toHaveValue("0"); await expect(rate("reasoning")).toHaveValue("");
  const panel = page.getByRole("dialog", { name: "Pricing Configuration", exact: true });
  await expect(panel).toHaveCount(1);
  const closeEditor = page.getByRole('button', { name: 'Close pricing editor', exact: true });
  await expect(closeEditor).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(closeEditor).toBeFocused();
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Pricing', exact: true })).toBeFocused();
  await open(); await expect(rate('input')).toHaveValue('1');
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
    const paint = await panel.evaluate(element => {
      const style = getComputedStyle(element);
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d"); context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1);
      return { alpha: context.getImageData(0, 0, 1, 1).data[3], opacity: style.opacity };
    });
    assert.deepEqual(paint, { alpha: 255, opacity: "1" }, `opaque ${dark ? "dark" : "light"} panel`);
    if (process.env.PRICING_UI_SCREENSHOT) await page.screenshot({ path: process.env.PRICING_UI_SCREENSHOT.replace(".png", dark ? "-dark.png" : "-light.png"), fullPage: true });
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close pricing editor" })).toHaveCount(0);
  assert.equal(mutations.length, 0, "untouched rendered save must not PATCH");
  await open(); await expect(rate("input")).toHaveValue("1");
  await rate("output").fill("2.000000001");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close pricing editor" })).toHaveCount(0);
  assert.deepEqual(mutations[0].body, { fixture: { one: { input: "1", output: "2.000000001", cached: "0" } } });
  await open(); await expect(rate("input")).toHaveValue("1");
  await rate("output").fill("1e-9"); await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  const validationMessage = "fixture/one: output requires a nonnegative decimal with at most nine decimal places";
  await expect(errorAlert(validationMessage)).toHaveCount(1);
  await expect(errorAlert(validationMessage)).toHaveText(validationMessage); assert.equal(mutations.length, 1);
  await expect(closeEditor).toBeFocused();
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Pricing', exact: true })).toBeFocused();
  await open(); await expect(rate('input')).toHaveValue('1');
  await page.getByRole("button", { name: "Inherit", exact: true }).first().click();
  await expect(rate("input")).toHaveValue("9"); await expect(rate("cached")).toHaveValue("");
  assert.equal(new URL(mutations[1].url).searchParams.get("model"), "one");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  assert.equal(mutations.length, 2, "effective reset response becomes clean baseline");
  failure = true; await open();
  const loadMessage = "Failed to load effective pricing. Editing is unavailable.";
  await expect(errorAlert(loadMessage)).toHaveCount(1);
  await expect(errorAlert(loadMessage)).toHaveText(loadMessage);
  await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove All Overrides", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close pricing editor" }).click(); failure = false;
  const held = new Promise(resolve => { heldResolve = resolve; }); holdNext = true;
  await open(); await held; await page.getByRole("button", { name: "Close pricing editor" }).click();
  effective = { fixture: { one: { input: 11, output: 12 } } };
  await open(); await expect(rate("input")).toHaveValue("11");
  try { await heldRoute.fulfill({ status: 200, json: source }); } catch { /* Expected aborted old request. */ }
  await expect(rate("input")).toHaveValue("11");
  malformedReset = true;
  await page.getByRole("button", { name: "Remove All Overrides", exact: true }).click();
  const resetMessage = "Overrides removed, but effective pricing could not be refreshed. Close and reopen the editor.";
  await expect(errorAlert(resetMessage)).toHaveCount(1);
  await expect(errorAlert(resetMessage)).toHaveText(resetMessage);
  await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeDisabled();
  assert.deepEqual(errors, [], "no browser page errors");
  assert.deepEqual(externalRequests.filter(origin => origin !== "https://www.googletagmanager.com"), [], "no unexpected external attempts; known analytics remains blocked");
  const artifact = process.env.PRICING_UI_SCREENSHOT;
  if (artifact) { await page.screenshot({ path: artifact, fullPage: true }); assert.ok(fs.statSync(artifact).size > 0); }
  console.log(JSON.stringify({ passed: ["untouched-no-PATCH", "changed-only-decimal-PATCH", "invalid-no-PATCH", "invalid-save-Escape-focus-restored", "model-inherit-effective-baseline", "load-failure-disabled", "close-reopen-stale-response", "reset-refresh-failure-disabled", "opaque-light-dark-panel", "keyboard-focus-trap-Escape-restore", "sync-read-no-mutation", "degraded-sync-ui", "schedule-toggle-ack-payload", "rejected-schedule-keeps-state", "successful-sync-ui", ...(process.env.PRICING_UI_COVERAGE === "1" ? ["coverage-opt-in-page-provenance", "coverage-revision-conflict-restart", "coverage-mobile-no-page-overflow", "coverage-mobile-wheel-column-access"] : [])], pageErrors: errors, blockedExternalOrigins: [...new Set(externalRequests)] }));
} catch (error) {
  console.error(error);
  if (process.env.PRICING_UI_SCREENSHOT) {
    try { await page.screenshot({ path: process.env.PRICING_UI_SCREENSHOT, fullPage: true, timeout: 5000 }); } catch { /* Preserve original error. */ }
  }
  throw error;
} finally {
  if (process.env.PRICING_UI_TRACE) await context.tracing.stop({ path: process.env.PRICING_UI_TRACE });
  await context.close(); await browser.close();
}
