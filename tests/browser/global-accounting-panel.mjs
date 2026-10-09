// Rendered fixture-backed UI evidence, not actual management HTTP authority.
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
const { chromium, expect } = await import(process.env.PRICING_UI_RUNNER);
const baseURL = process.env.PRICING_UI_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseURL || '') || !process.env.PRICING_UI_SECRET) throw new Error('Disposable loopback fixture required');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PRICING_UI_CHROMIUM });
const context = await browser.newContext({ baseURL, serviceWorkers: 'block' }), page = await context.newPage();
page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(45000);
const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m').sign(new TextEncoder().encode(process.env.PRICING_UI_SECRET));
await context.addCookies([{ name: 'auth_token', value: token, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
const blocked = [], errors = [], posts = [];
page.on('pageerror', err => errors.push(err.message));
await context.route('**/*', route => { if (new URL(route.request().url()).origin !== baseURL) { blocked.push(new URL(route.request().url()).origin); return route.abort(); } return route.fallback(); });
if (process.env.PRICING_UI_TRACE) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
let maintenance = { generation: 2, startedAt: '2026-10-03T00:00:00.000Z' }, resolved = false, ackMode = 'mismatch', held = null, notifyHeld;
const storageKey = '9router:accounting-global-recovery:v1';
await page.route(url => url.origin === baseURL && url.pathname.startsWith('/api/'), async route => {
  const url = new URL(route.request().url()), method = route.request().method();
  if (url.pathname === '/api/keys') { assert.equal(method, 'GET'); return route.fulfill({ json: { keys: [{ id: 'fixture-key', name: 'Fixture', key: 'disposable-key', isActive: true }] } }); }
  if (url.pathname === '/api/settings') return route.fulfill({ json: { requireLogin: true, requireApiKey: true, hasPassword: true } });
  if (url.pathname === '/api/tunnel/status') return route.fulfill({ json: { tunnel: { enabled: false }, tailscale: { enabled: false } } });
  const state = () => ({ enforcementActive: false, generation: maintenance?.generation || 2, maintenance, gaps: [{ id: 'global-gap', scope: 'global', generation: 1, startedAt: '2026-10-03T00:00:00.000Z', ...(resolved ? { resolvedAt: '2026-10-03T00:01:00.000Z' } : {}) }] });
  if (url.pathname === '/api/accounting/gaps' && method === 'GET') return route.fulfill({ json: state() });
  if (['/api/accounting/gaps', '/api/accounting/maintenance/release'].includes(url.pathname) && method === 'POST') {
    const payload = route.request().postDataJSON(); posts.push({ url: url.pathname, payload });
    if (ackMode === 'hold') { held = route; notifyHeld?.(); return; }
    if (url.pathname.endsWith('/release')) {
      // Historical original target ACK coexists with newer active maintenance.
      maintenance = { generation: 3, startedAt: '2026-10-03T00:02:00.000Z' };
      return route.fulfill({ json: { ...state(), recoveryReceipt: { version: 1, kind: 'maintenance', action: 'maintenance_release', operationId: payload.operationId, generation: payload.expectedGeneration, releasedAt: '2026-10-03T00:01:00.000Z' } } });
    }
    const receipt = { version: 1, kind: 'gap', action: 'coverage_waiver', apiKeyId: null, targetId: ackMode === 'mismatch' ? 'wrong-gap' : payload.gapId, generation: payload.expectedGeneration, operationId: payload.operationId };
    if (ackMode !== 'mismatch') resolved = true;
    return route.fulfill({ json: { ...state(), recoveryReceipt: receipt } });
  }
  return route.fallback();
});
try {
  await page.goto('/dashboard/endpoint');
  const open = page.getByRole('button', { name: 'Global accounting recovery', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Global accounting recovery', exact: true });
  const close = () => dialog.getByRole('button', { name: 'Close', exact: true });
  const submit = () => dialog.getByRole('button', { name: 'Submit audited global recovery', exact: true });
  const fill = async () => { await dialog.getByRole('textbox', { name: 'Global recovery reason', exact: true }).fill('Reviewed scope-wide outage'); await dialog.getByRole('textbox', { name: 'Global recovery evidence', exact: true }).fill('Independent fixture evidence'); };
  const confirm = () => dialog.getByRole('checkbox');
  await open.click(); await expect(close()).toBeFocused();
  await expect(dialog.getByText('Enforcement OFF — recovery only, no protection advertised', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Review global gap', exact: true }).click(); await fill(); await expect(submit()).toBeDisabled(); await confirm().check();
  await page.evaluate(() => { window.fixtureSet = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('Fixture retention unavailable'); }; });
  await submit().click(); await expect(dialog.getByRole('alert')).toHaveText('Fixture retention unavailable'); assert.equal(posts.length, 0);
  await page.evaluate(() => { Storage.prototype.setItem = window.fixtureSet; delete window.fixtureSet; });
  await submit().click(); await expect(dialog.getByRole('alert')).toContainText('acknowledgement or retained operation is invalid');
  assert.equal(posts.length, 1); const first = structuredClone(posts[0]);
  assert.ok(await page.evaluate(key => sessionStorage.getItem(key), storageKey));
  await expect(dialog.getByRole('button', { name: 'Review maintenance release', exact: true })).toBeDisabled();
  await close().click(); await expect(open).toBeFocused(); await open.click();
  await expect(dialog.getByRole('button', { name: 'Retry unchanged global recovery', exact: true })).toBeVisible(); assert.equal(posts.length, 1, 'restore never auto-posts');
  ackMode = 'hold'; const waiting = new Promise(resolve => { notifyHeld = resolve; });
  await dialog.getByRole('button', { name: 'Retry unchanged global recovery', exact: true }).click(); await waiting;
  await expect(close()).toBeDisabled(); await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  assert.deepEqual(posts[1], first);
  await held.fulfill({ status: 503, json: { code: 'api_key_accounting_unavailable' } });
  await expect(dialog.getByRole('alert')).toContainText('acknowledgement is uncertain');
  ackMode = 'valid'; await dialog.getByRole('button', { name: 'Retry unchanged global recovery', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Original operation acknowledged' })).toContainText('Original operation acknowledged');
  assert.deepEqual(posts[2], first); assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
  await dialog.getByRole('button', { name: 'Review maintenance release', exact: true }).click(); await fill(); await confirm().check(); await submit().click();
  await expect(dialog.getByText('Active maintenance, generation 3', { exact: true })).toBeVisible();
  assert.equal(posts[3].payload.expectedGeneration, 2); assert.equal(posts[3].url, '/api/accounting/maintenance/release');
  await close().click(); await expect(open).toBeFocused(); await page.setViewportSize({ width: 390, height: 844 }); await open.click();
  await expect(close()).toBeFocused(); await expect(dialog.getByText('Active maintenance, generation 3', { exact: true })).toBeVisible();
  assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'no modal horizontal overflow');
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Review maintenance release', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close()).toBeFocused();
  if (process.env.PRICING_UI_SCREENSHOT) await page.screenshot({ path: process.env.PRICING_UI_SCREENSHOT });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(open).toBeFocused();
  assert.deepEqual(errors, []); console.log(JSON.stringify({ flows: 10, posts: posts.length, errors, attemptedBlockedOrigins: [...new Set(blocked)], scope: 'intercepted-rendered-ui-only' }));
} finally { if (process.env.PRICING_UI_TRACE) await context.tracing.stop({ path: process.env.PRICING_UI_TRACE }); await browser.close(); }
