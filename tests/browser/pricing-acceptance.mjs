import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Run only against an existing artifact and a fresh, disposable database.
const artifact = process.env.PRICING_STANDALONE;
if (!artifact || !fs.existsSync(path.join(artifact, 'custom-server.js'))) throw new Error('Set PRICING_STANDALONE to the compiled standalone directory');
const base = 'http://127.0.0.1:23128';
const root = fs.mkdtempSync(path.join(os.tmpdir(), '9router-browser-'));
fs.writeFileSync(path.join(root, 'catalog-mode'), 'valid');
const preload = fileURLToPath(new URL('./pricing-catalog-fixture.cjs', import.meta.url));
const password = 'disposable-browser-password';
const passed = [], errors = [];
let server, browser, context;
const check = async (name, action) => { await action(); passed.push(name); console.log(`PASS ${name}`); };
async function stop() {
  if (!server || server.exitCode !== null) return;
  const child = server, exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); server = null; }
}
async function start() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', reject);
    probe.listen(23128, '127.0.0.1', () => probe.close(resolve));
  });
  server = spawn(process.execPath, ['--require', preload, 'custom-server.js'], {
    cwd: artifact, env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '23128',
      DATA_DIR: root, JWT_SECRET: 'disposable-browser-jwt-secret', INITIAL_PASSWORD: password,
      AUTH_COOKIE_SECURE: 'false', MODEL_CATALOG_SYNC: 'off', DISABLE_BACKGROUND_TOKEN_REFRESH: 'true', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = fs.createWriteStream(path.join(root, 'server.log'), { flags: 'a' });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  server.once('exit', () => log.end());
  await expect.poll(async () => {
    try { return (await fetch(`${base}/api/auth/status`, { signal: AbortSignal.timeout(1000) })).status; }
    catch { return 0; }
  }, { timeout: 20000 }).toBe(200);
}
try {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 20000 });
  await start();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const request = context.request;
  const mutate = (method, target, data) => request.fetch(`${base}${target}`, { method, data, headers: { Origin: base } });
  await check('unauthenticated pricing is denied', async () => { expect((await request.get(`${base}/api/pricing`)).status()).toBe(401); });
  await check('real browser login', async () => {
    await page.goto(`${base}/login`);
    await page.locator('input[type=password]').fill(password);
    await page.locator('button[type=submit]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });
  await page.goto(`${base}/dashboard/settings/pricing`);
  await expect(page.getByRole('button', { name: 'Edit Pricing', exact: true })).toBeEnabled();
  await check('exact override fixture via real API', async () => {
    expect((await mutate('PATCH', '/api/pricing', { custom: { 'browser-fixture': { input: '0.000000001', output: '7.125', cached: '0' } } })).status()).toBe(200);
  });
  const open = async () => {
    await page.getByRole('button', { name: 'Edit Pricing', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('searchbox')).toBeEnabled();
    await page.getByRole('searchbox').fill('browser-fixture');
    await expect(page.getByLabel('custom browser-fixture input rate', { exact: true })).toHaveValue('0.000000001');
  };
  let writes = 0;
  page.on('request', req => { if (new URL(req.url()).pathname === '/api/pricing' && req.method() === 'PATCH') writes++; });
  await check('unchanged modal save makes no PATCH', async () => {
    await open(); await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); expect(writes).toBe(0);
  });
  await check('invalid decimal stays in editor without write', async () => {
    await open(); await page.getByLabel('custom browser-fixture output rate', { exact: true }).fill('-1');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible(); expect(writes).toBe(0);
  });
  await check('changed row saves exact input and explicit zero', async () => {
    await page.getByLabel('custom browser-fixture output rate', { exact: true }).fill('8.125');
    const response = page.waitForResponse(r => r.url().endsWith('/api/pricing') && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click(); expect((await response).status()).toBe(200);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const data = await (await request.get(`${base}/api/pricing?view=editor`)).json();
    expect(data.exact.custom['browser-fixture']).toMatchObject({ input: '0.000000001', output: '8.125', cached: '0' });
  });
  await check('mobile horizontal keyboard scroll and focus trap', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await open();
    expect(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    const region = page.getByRole('region', { name: 'custom pricing rates; scroll horizontally for all columns', exact: true });
    await region.focus(); await page.keyboard.press('End');
    expect(await region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    const close = page.getByRole('button', { name: 'Close pricing editor' });
    await close.focus(); await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(close).toBeFocused();
    await page.screenshot({ path: path.join(root, 'mobile-editor.png') });
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit Pricing', exact: true })).toBeFocused();
  });
  await check('hostile Origin and forwarded authority are denied', async () => {
    const data = { custom: { forbidden: { input: '1', output: '2' } } };
    expect((await request.patch(`${base}/api/pricing`, { data, headers: { Origin: 'https://hostile.invalid' } })).status()).toBe(403);
    expect((await request.patch(`${base}/api/pricing`, { data, headers: { Origin: base, 'X-Forwarded-Host': 'hostile.invalid' } })).status()).toBe(403);
  });
  await check('real stale coverage 409 and browser restart', async () => {
    const coverage = page.getByRole('region', { name: 'Reference pricing coverage', exact: true });
    await page.getByRole('button', { name: 'Inspect coverage', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Next coverage page', exact: true })).toBeEnabled();
    expect((await mutate('PATCH', '/api/pricing', { custom: { drift: { input: '1', output: '2' } } })).status()).toBe(200);
    const conflict = page.waitForResponse(r => r.url().includes('/api/pricing/coverage') && r.status() === 409);
    await page.getByRole('button', { name: 'Next coverage page', exact: true }).click(); await conflict;
    await expect(coverage.getByRole('alert')).toContainText('Restart the report');
    await page.getByRole('button', { name: 'Restart coverage report', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Next coverage page', exact: true })).toBeEnabled();
    await expect(coverage.getByRole('alert')).toHaveCount(0);
  });
  await check('scheduler checkbox enables without immediate fetch', async () => {
    // This controlled checkbox reflects the persisted server response.
    const saved = page.waitForResponse(r => r.url().endsWith('/api/pricing/sync') && r.request().method() === 'PUT');
    await page.getByRole('checkbox').click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole('checkbox')).toBeChecked();
    await expect(page.getByText('Enabled and running', { exact: true })).toBeVisible();
    const status = await (await request.get(`${base}/api/pricing/sync`)).json();
    expect(status.schedulerConfigured).toBe(true); expect(status.schedulerEnabled).toBe(true); expect(status.lastAttempt).toBeNull();
  });
  await stop();
  fs.copyFileSync(path.join(root, 'db/data.sqlite'), path.join(root, 'before-restart.sqlite'));
  await start();
  await check('compiled restart preserves exact overrides and active schedule without fetch', async () => {
    const editor = await (await request.get(`${base}/api/pricing?view=editor`)).json();
    expect(editor.exact.custom['browser-fixture']).toMatchObject({ input: '0.000000001', output: '8.125', cached: '0' });
    const status = await (await request.get(`${base}/api/pricing/sync`)).json();
    expect(status.schedulerConfigured).toBe(true); expect(status.schedulerEnabled).toBe(true); expect(status.lastAttempt).toBeNull();
  });
  await check('scheduler disabled at end', async () => {
    expect((await mutate('PUT', '/api/pricing/sync', { schedulerEnabled: false })).status()).toBe(200);
    const status = await (await request.get(`${base}/api/pricing/sync`)).json(); expect(status.schedulerConfigured).toBe(false); expect(status.schedulerEnabled).toBe(false);
  });
  await check('compiled manual sync and malformed/offline last-good via server fixture', async () => {
    const valid = await mutate('POST', '/api/pricing/sync');
    expect(valid.status()).toBe(200);
    const baseline = await valid.json(); expect(baseline.revision).toMatch(/^[a-f0-9]{64}$/);
    for (const mode of ['malformed', 'offline']) {
      fs.writeFileSync(path.join(root, 'catalog-mode'), mode);
      const response = await mutate('POST', '/api/pricing/sync'); expect(response.status()).toBe(502);
      const status = await response.json(); expect(status.revision).toBe(baseline.revision);
      expect(status.lastSuccess).toBe(baseline.lastSuccess); expect(status.error).toBe('pricing_sync_failed');
      const editor = await (await request.get(`${base}/api/pricing?view=editor`)).json();
      expect(editor.exact.custom['browser-fixture']).toMatchObject({ input: '0.000000001', output: '8.125', cached: '0' });
    }
    expect(fs.readFileSync(path.join(root, 'catalog-fetches.log'), 'utf8').trim().split('\n')).toEqual(['valid', 'malformed', 'offline']);
  });
  await check('inherit removes custom row and refreshes editor', async () => {
    await page.reload(); await expect(page.getByRole('button', { name: 'Edit Pricing', exact: true })).toBeEnabled(); await open();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Inherit custom browser-fixture pricing', exact: true }).click();
    await expect(page.getByLabel('custom browser-fixture input rate', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const data = await (await request.get(`${base}/api/pricing?view=editor`)).json(); expect(data.exact.custom?.['browser-fixture']).toBeUndefined();
  });
  await check('login-disabled allowance requires direct loopback provenance', async () => {
    const anonymous = await browser.newContext();
    try {
      expect((await mutate('PATCH', '/api/settings', { requireLogin: false })).status()).toBe(200);
      expect((await anonymous.request.get(`${base}/api/pricing`)).status()).toBe(200);
      const forwarded = await anonymous.request.get(`${base}/api/pricing`, { headers: { 'X-Forwarded-For': '203.0.113.10' } });
      expect(forwarded.status()).toBe(403);
      expect((await forwarded.json()).code).toBe('management_authority_invalid');
    } finally {
      expect((await mutate('PATCH', '/api/settings', { requireLogin: true })).status()).toBe(200);
      await anonymous.close();
    }
  });
  await stop();
  await check('no accounting activation or ledger rows', async () => {
    const db = new DatabaseSync(path.join(root, 'db/data.sqlite'), { readOnly: true });
    try {
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      for (const { name } of rows.filter(r => /ledger|accounting/i.test(r.name))) expect(db.prepare(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`).get().n).toBe(0);
      expect(JSON.stringify(db.prepare('SELECT * FROM settings').all())).not.toContain('ledgerStartedAt');
      expect(db.prepare("SELECT * FROM _meta WHERE key='ledgerStartedAt'").all()).toHaveLength(0);
    } finally { db.close(); }
  });
  expect(errors).toEqual([]);
} catch (error) {
  console.error(error); process.exitCode = 1; errors.push(error.stack || String(error));
} finally {
  await context?.close(); await browser?.close(); await stop();
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ passed, errors, artifact, root }, null, 2));
  console.log(`Evidence: ${root}`);
}
