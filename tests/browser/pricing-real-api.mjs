// Real compiled pricing API + real page/Modal. Only fixed-source catalog fetch
// is replaced by declared public fixtures in a preload; browser APIs are NOT
// intercepted. Disposable custom-entry server, dummy login, no activation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
const root = process.cwd(), build = path.resolve(process.env.PRICING_UI_BUILD || '');
if (!process.env.PRICING_UI_BUILD || !process.env.PRICING_UI_RUNNER || !process.env.PRICING_UI_CHROMIUM) throw new Error('Explicit owned build/runner/browser required');
const relative = path.relative(root, build);
if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(path.join(build, 'BUILD_ID'))) throw new Error('Owned completed build required');
const { chromium, expect } = await import(process.env.PRICING_UI_RUNNER);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-pricing-real-api-')); fs.chmodSync(directory, 0o700);
console.log(`ARTIFACT=${directory}`);
const standalone = path.join(directory, 'standalone');
fs.cpSync(path.join(build, 'standalone'), standalone, { recursive: true });
fs.cpSync(path.join(build, 'static'), path.join(standalone, relative, 'static'), { recursive: true });
fs.cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
fs.copyFileSync(path.join(root, 'custom-server.js'), path.join(standalone, 'custom-server.js'));
const control = path.join(directory, 'catalog-mode'), calls = path.join(directory, 'catalog-calls.jsonl');
const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/pricing/models-dev-minimal.json'), 'utf8');
const invalid = fs.readFileSync(path.join(root, 'tests/fixtures/pricing/models-dev-overprecision.json'), 'utf8');
const preload = path.join(directory, 'catalog-fixture.cjs');
fs.writeFileSync(control, 'valid');
fs.writeFileSync(preload, `const fs=require('node:fs');const original=global.fetch;
global.fetch=async(input,options)=>{const url=typeof input==='string'?input:input?.url||String(input);
if(url==='https://models.dev/api.json'){fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({source:url,redirect:options?.redirect,authorization:Boolean(options?.headers?.Authorization)})+'\\n');
const mode=fs.readFileSync(${JSON.stringify(control)},'utf8');if(mode==='offline')throw Error('Declared catalog offline fixture');return new Response(mode==='invalid'?${JSON.stringify(invalid)}:${JSON.stringify(fixture)},{headers:{'Content-Type':'application/json'}});}
const target=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname))throw Error('External fixture fetch denied');return original(input,options);};`);
const home = path.join(directory, 'home'), data = path.join(directory, 'data'); fs.mkdirSync(home);
const password = crypto.randomBytes(24).toString('hex'), jwt = crypto.randomBytes(32).toString('hex');
let server, exit, fd, base, context, page;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PRICING_UI_CHROMIUM });
const passed = [], mutations = [], pageErrors = [], blockedOrigins = [], pricingHttp = [], uiFocus = [];
async function start(label) {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, HOME: home, DATA_DIR: data, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production',
    JWT_SECRET: jwt, INITIAL_PASSWORD: password, NEXT_TELEMETRY_DISABLED: '1', DISABLE_BACKGROUND_TOKEN_REFRESH: '1', NODE_OPTIONS: `--require ${preload}` };
  for (const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','NINE_ROUTER_PROXY_MANAGED','NINE_ROUTER_PROXY_URL','NINE_ROUTER_NO_PROXY','NINEROUTER_MANAGEMENT_ORIGIN']) delete env[key];
  fd = fs.openSync(path.join(directory, `${label}-server.log`), 'w');
  server = spawn(process.execPath, [path.join(standalone, 'custom-server.js')], { cwd: standalone, env, detached: true, stdio: ['ignore', fd, fd] });
  exit = new Promise(resolve => server.once('exit', (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 60000; let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Owned server exited');
    try { if ((await fetch(`${base}/login`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* bounded server readiness */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Owned server readiness');
  context = await browser.newContext({ baseURL: base, serviceWorkers: 'block' });
  await context.route('**/*', route => { const origin = new URL(route.request().url()).origin;
    if (origin !== base) { blockedOrigins.push(origin); return route.abort(); } return route.continue(); });
  const login = await context.request.post('/api/auth/login', { data: { password }, headers: { Origin: base } });
  assert.equal(login.status(), 200, 'Real fixture login');
  page = await context.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(45000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', async response => {
    if (!new URL(response.url()).pathname.startsWith('/api/pricing')) return;
    const request = response.request(), headers = await request.allHeaders();
    const record = { method: request.method(), path: new URL(response.url()).pathname, status: response.status(), origin: headers.origin ?? null, site: headers['sec-fetch-site'] ?? null };
    if (!response.ok()) { try { const body = await response.json(); record.code = body.code ?? null; } catch { /* no raw error payloads */ } }
    pricingHttp.push(record);
  });
  page.on('request', req => { if (new URL(req.url()).pathname === '/api/pricing' && ['PATCH','DELETE'].includes(req.method())) mutations.push({ method: req.method(), body: req.postData() ? req.postDataJSON() : null, query: new URL(req.url()).search }); });
}
async function stop() {
  await context?.close(); context = null;
  if (!server) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already exited */ }
  const timer = setTimeout(() => { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already exited */ } }, 5000);
  await exit; clearTimeout(timer); fs.closeSync(fd); server = null;
}
async function status() { const response = await context.request.get('/api/pricing/sync'); assert.equal(response.status(), 200); return response.json(); }
async function prices() { const response = await context.request.get('/api/pricing'); assert.equal(response.status(), 200); assert.equal(response.headers()['cache-control'], 'no-store'); return response.json(); }
async function open() { await page.getByRole('button', { name: 'Edit Pricing', exact: true }).click(); await expect(rate('input')).toBeVisible(); }
const rate = field => page.getByRole('textbox', { name: `openai gpt-5 ${field} rate`, exact: true });
const dialog = () => page.getByRole('dialog', { name: 'Pricing Configuration', exact: true });
const button = name => page.getByRole('button', { name, exact: true });
const catalogCallCount = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).length : 0;
try {
  await start('initial');
  const initial = await status(); assert.equal(initial.schedulerConfigured, false); assert.equal(initial.schedulerEnabled, false); assert.equal(initial.revision, null);
  await page.goto('/dashboard/settings/pricing'); await expect(page.getByText('Not synced', { exact: true })).toBeVisible();
  assert.equal(catalogCallCount(), 0, 'GET/startup never syncs');
  await button('Edit Pricing').click();
  await expect(dialog().getByRole('textbox').first()).toBeVisible();
  await expect(button('Close pricing editor')).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(button('Save Changes')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(button('Close pricing editor')).toBeFocused();
  await button('Save Changes').click(); await expect(dialog()).toHaveCount(0); assert.equal(mutations.length, 0, 'Untouched no PATCH');
  await expect(button('Edit Pricing')).toBeFocused(); passed.push('real-default-off-no-fetch-noop-focus-trap');
  await button('Sync reference pricing').click(); await expect(page.getByText('Synced', { exact: true })).toBeVisible();
  assert.equal(catalogCallCount(), 1); const synced = await status(); assert.match(synced.revision, /^[a-f0-9]{64}$/);
  await open(); await expect(rate('input')).toHaveValue('1.25'); await expect(rate('cached')).toHaveValue('0.125');
  await rate('input').fill('0.000000001'); await rate('output').fill('2.000000001'); await rate('cached').fill('0');
  await button('Save Changes').click(); await expect(dialog()).toHaveCount(0);
  assert.deepEqual(mutations.at(-1), { method: 'PATCH', query: '', body: { openai: { 'gpt-5': { input: '0.000000001', output: '2.000000001', cached: '0' } } } });
  assert.deepEqual((await prices()).openai['gpt-5'], { input: 0.000000001, output: 2.000000001, cached: 0 });
  await open(); await expect(rate('input')).toHaveValue('0.000000001'); await expect(rate('cached')).toHaveValue('0');
  const beforeInvalid = mutations.length; await rate('input').fill('0.0000000001'); await button('Save Changes').click();
  await expect(page.getByRole('alert').filter({ hasText: 'input requires a nonnegative decimal' })).toHaveCount(1); assert.equal(mutations.length, beforeInvalid);
  await expect(button('Close pricing editor')).toBeFocused();
  uiFocus.push(await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), text: document.activeElement?.textContent?.slice(0, 100), inDialog: Boolean(document.activeElement?.closest('[role="dialog"]')) })));
  await page.keyboard.press('Escape'); await expect(dialog()).toHaveCount(0); await expect(button('Edit Pricing')).toBeFocused();
  passed.push('real-changed-only-exact-decimal-zero-persistence-invalid-no-write');
  fs.writeFileSync(control, 'invalid'); await button('Sync reference pricing').click(); await expect(page.getByText('Degraded', { exact: true })).toBeVisible();
  assert.equal((await status()).revision, synced.revision); assert.equal((await prices()).openai['gpt-5'].input, 0.000000001);
  fs.writeFileSync(control, 'offline'); await button('Sync reference pricing').click(); await expect(page.getByRole('alert').filter({ hasText: 'Last-known-good pricing is retained' })).toHaveCount(1);
  assert.equal((await status()).revision, synced.revision); passed.push('real-overprecision-offline-last-good-overrides-retained');
  page.on('dialog', prompt => prompt.accept()); await open();
  const row = rate('input').locator('xpath=ancestor::tr'); await row.getByRole('button', { name: 'Inherit', exact: true }).click();
  await expect(rate('input')).toHaveValue('1.25'); await expect(rate('cached')).toHaveValue('0.125');
  const afterReset = mutations.length; await button('Save Changes').click(); await expect(dialog()).toHaveCount(0); assert.equal(mutations.length, afterReset);
  assert.equal((await prices()).openai['gpt-5'].input, 1.25); passed.push('real-inherit-synced-effective-baseline-not-zero-noop');
  const schedule = page.getByRole('checkbox', { name: 'Enable automatic reference pricing sync every 24 hours', exact: true });
  await schedule.click(); await expect(schedule).toBeChecked(); await expect(schedule).toBeEnabled();
  const enabled = await status(); assert.equal(enabled.schedulerConfigured, true); assert.equal(enabled.schedulerEnabled, true);
  assert.equal(catalogCallCount(), 3, 'Enable does not immediately fetch');
  await page.setViewportSize({ width: 390, height: 844 }); await open(); await expect(rate('input')).toHaveValue('1.25');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile page no overflow');
  const scroll = dialog().getByRole('region', { name: 'openai pricing rates; scroll horizontally for all columns', exact: true });
  await scroll.focus(); await page.keyboard.press('End');
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft + element.clientWidth >= element.scrollWidth - 2)).toBe(true);
  await page.keyboard.press('Home'); await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBe(0);
  await page.keyboard.press('ArrowRight'); await expect.poll(() => scroll.evaluate(element => element.scrollLeft > 0)).toBe(true);
  await page.keyboard.press('End');
  const visible = await row.getByRole('button', { name: 'Inherit', exact: true }).evaluate(element => { const r = element.getBoundingClientRect(), p = element.closest('table').parentElement.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1; });
  assert.equal(visible, true, 'Keyboard scroll exposes rightmost override');
  await rate('input').focus(); await page.keyboard.press('End'); await expect(rate('input')).toBeFocused();
  await expect(rate('input')).toHaveValue('1.25');
  await scroll.focus(); await page.keyboard.press('End');
  await page.screenshot({ path: path.join(directory, 'mobile-pricing.png'), fullPage: true });
  await page.keyboard.press('Escape'); await expect(dialog()).toHaveCount(0); await expect(button('Edit Pricing')).toBeFocused(); passed.push('real-mobile-keyboard-column-access-Escape-focus');
  await stop(); await start('restart');
  const restarted = await status(); assert.equal(restarted.schedulerConfigured, true); assert.equal(restarted.revision, synced.revision);
  assert.equal(catalogCallCount(), 3, 'Restart does not immediately fetch');
  await page.goto('/dashboard/settings/pricing'); await expect(page.getByText('Degraded', { exact: true })).toBeVisible();
  await expect.poll(async () => (await status()).schedulerEnabled, { timeout: 10000 }).toBe(true);
  assert.equal(catalogCallCount(), 3, 'Deferred startup never immediately fetches');
  await expect(page.getByRole('checkbox', { name: 'Enable automatic reference pricing sync every 24 hours', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Enable automatic reference pricing sync every 24 hours', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Enable automatic reference pricing sync every 24 hours', exact: true })).not.toBeChecked();
  const disabled = await status(); assert.equal(disabled.schedulerConfigured, false); assert.equal(disabled.schedulerEnabled, false);
  assert.equal((await prices()).openai['gpt-5'].input, 1.25); passed.push('real-scheduler-ACK-restart-disable-persisted-no-immediate-fetch');
  for (const method of ['PATCH','DELETE']) {
    const denied = await context.request.fetch('/api/pricing', { method, headers: { Origin: 'https://evil.invalid' }, ...(method === 'PATCH' ? { data: { openai: { 'gpt-5': { input: '9', output: '9' } } } } : {}) });
    assert.equal(denied.status(), 403); assert.equal((await denied.json()).code, 'management_csrf_rejected');
  }
  assert.equal((await prices()).openai['gpt-5'].input, 1.25); passed.push('actual-custom-entry-CSRF-no-pricing-mutation');
  await stop();
  const { DatabaseSync } = await import('node:sqlite'); const reader = new DatabaseSync(path.join(data, 'db/data.sqlite'), { readOnly: true });
  try {
    assert.equal(reader.prepare("SELECT value FROM _meta WHERE key='ledgerStartedAt'").get(), undefined);
    assert.equal(reader.prepare('SELECT COUNT(*) AS count FROM apiKeyAccounting').get().count, 0);
    assert.equal(reader.prepare("SELECT value FROM kv WHERE scope='pricing' AND key='openai'").get(), undefined);
  } finally { reader.close(); }
  const sourceCalls = fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(sourceCalls.every(call => call.redirect === 'error' && call.authorization === false));
  assert.deepEqual(pageErrors, []); assert.deepEqual(blockedOrigins.filter(origin => origin !== 'https://www.googletagmanager.com'), []);
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ passed, build: relative, buildId: fs.readFileSync(path.join(build, 'BUILD_ID'), 'utf8').trim(), sourceCalls, pageErrors,
    blockedExternalOrigins: [...new Set(blockedOrigins)], limitations: ['fixed-source catalog fixture preload, not live models.dev', 'Node SQLite only', 'no server-wide zero-egress certificate', 'not all-browser accessibility or full product acceptance'] }, null, 2));
  console.log(JSON.stringify({ passed, artifact: directory }));
} catch (error) {
  fs.writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ passed, pricingHttp, uiFocus, error: { message: error.message, stack: error.stack }, pageErrors }, null, 2));
  console.error(`ARTIFACT=${directory}\n${error.stack}`);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await stop(); await browser.close(); }
