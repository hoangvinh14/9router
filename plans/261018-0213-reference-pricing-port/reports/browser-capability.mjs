// Capability preflight only: cached Chromium + native Node WebSocket, no installs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const root = process.env.BROWSER_FIXTURE_ROOT;
if (!root) throw new Error('Missing owned browser fixture');
const browser = spawn(process.env.BROWSER_BINARY, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${path.join(root, 'profile')}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let log = '', ws;
const pending = new Map(); let sequence = 0;
const deadline = setTimeout(() => { browser.kill('SIGKILL'); process.exitCode = 1; }, 25000);
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
try {
  const endpoint = await new Promise((resolve, reject) => {
    browser.stderr.on('data', chunk => {
      log += chunk; const match = log.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);
      if (match) resolve(match[1]);
    });
    browser.once('exit', code => reject(new Error(`Owned Chromium exited before CDP: ${code}`)));
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data); const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result); }
  });
  const version = await send('Browser.getVersion');
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  const result = await send('Runtime.evaluate', { expression: 'document.body.textContent="Owned browser capability control"; document.body.textContent', returnByValue: true }, sessionId);
  if (result.result.value !== 'Owned browser capability control') throw new Error('CDP evaluation mismatch');
  const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(root, 'capability.png'), Buffer.from(screenshot.data, 'base64'));
  fs.writeFileSync(path.join(root, 'browser-result.json'), JSON.stringify({ success: true, version, sandboxDisabled: false, actualApplicationTested: false }, null, 2));
  await send('Browser.close');
} finally {
  clearTimeout(deadline); ws?.close(); browser.kill('SIGTERM');
  fs.writeFileSync(path.join(root, 'browser-stderr.log'), log);
}
