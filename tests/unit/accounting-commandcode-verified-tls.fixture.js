import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { X509Certificate } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CommandCodeExecutor } from 'open-sse/executors/commandcode.js';
const fixture = vi.hoisted(() => ({ url: null }));
// Both replacements are required; production fixed route is unchanged.
vi.mock('../../open-sse/config/accountedCommandCodeCandidate.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, get ACCOUNTED_COMMANDCODE_URL() { return fixture.url; } };
});
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, PROVIDERS: { ...original.PROVIDERS, get commandcode() {
    return { ...original.PROVIDERS.commandcode, baseUrl: fixture.url };
  } } };
});
let directory, db, upstream, proxy, sockets, posts, tunnels, context, proxyUrl, failure, responder, assertPost;
const previousData = process.env.DATA_DIR, model = 'deepseek/deepseek-v4-pro';
const certificateDirectory = process.env.ACCOUNTING_TLS_FIXTURE_DIR;
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const body = () => ({ threadId: '11111111-1111-4111-8111-111111111111', memory: '',
  config: { workingDir: '/fixture/workspace', date: '2026-10-10', environment: 'linux', structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
  params: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } });
const usage = () => ({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 });
const wire = () => [{ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 'text_fixture' },
  { type: 'text-delta', id: 'text_fixture', text: 'fixture output' }, { type: 'text-end', id: 'text_fixture' },
  { type: 'finish-step', finishReason: 'stop', usage: usage() }, { type: 'finish', finishReason: 'stop', totalUsage: usage() }].map(event => JSON.stringify(event) + '\n').join('');
const options = (accounting, noProxy) => ({ accounting, accountingMode: 'native-commandcode-ndjson', connectionId: 'c', model, stream: true,
  credentials: { apiKey: 'dummy-provider', connectionId: 'c', providerSpecificData: {} },
  proxyOptions: { persistedGlobalProxy: { url: proxyUrl, noProxy } }, body: body() });
beforeEach(async () => {
  expect(certificateDirectory).toBeTruthy(); expect(process.env.NODE_EXTRA_CA_CERTS).toBe(path.join(certificateDirectory, 'ca.pem'));
  expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe('0');
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-commandcode-verified-tls-')); process.env.DATA_DIR = directory;
  delete global._dbAdapter; vi.resetModules(); sockets = new Set(); posts = 0; tunnels = 0; failure = null;
  responder = response => { response.writeHead(200, { 'content-type': 'application/x-ndjson' }); response.end(wire()); };
  assertPost = (actual, request) => {
    expect(actual).toEqual(body()); expect(request.method).toBe('POST');
    expect(request.headers.authorization).toBe('Bearer dummy-provider'); expect(request.headers['x-session-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(request.headers['x-command-code-version']).toBe('0.25.7'); expect(request.headers['x-cli-environment']).toBe('cli');
    expect(db.get('SELECT state FROM apiKeyAccounting')?.state).toBe('pending');
  };
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'commandcode', authType: 'apikey', apiKey: 'dummy-provider', providerSpecificData: {} }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','commandcode',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
  });
  context = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: 'Bearer dummy-key' } }), { adapter: async () => db, queued: true });
});
afterEach(async () => {
  for (const socket of sockets || []) socket.destroy();
  for (const server of [proxy, upstream]) { server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve)); }
  upstream = proxy = null; vi.restoreAllMocks(); db?.close(); delete global._dbAdapter;
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  if (previousData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousData;
});
async function startFixture(identity) {
  const cert = fs.readFileSync(path.join(certificateDirectory, `${identity}.pem`));
  const ca = new X509Certificate(fs.readFileSync(path.join(certificateDirectory, 'ca.pem'))), leaf = new X509Certificate(cert);
  expect(leaf.verify(ca.publicKey)).toBe(true);
  if (identity === 'matching') expect(leaf.checkIP('127.0.0.1')).toBe('127.0.0.1'); else expect(leaf.checkIP('127.0.0.1')).toBeUndefined();
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); };
  upstream = https.createServer({ cert, key: fs.readFileSync(path.join(certificateDirectory, `${identity}.key`)) }, async (request, response) => {
    posts++;
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      assertPost(JSON.parse(Buffer.concat(chunks).toString()), request); responder(response);
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture assertion failed' })); }
  });
  upstream.on('connection', track); await listen(upstream);
  const target = `127.0.0.1:${upstream.address().port}`; fixture.url = `https://${target}/commandcode/generate`;
  proxy = http.createServer((_request, response) => { failure = new Error('Unexpected non-CONNECT proxy request'); response.writeHead(405); response.end(); });
  proxy.on('connection', track); proxy.on('connect', (request, socket, head) => {
    if (request.url !== target) { failure = new Error('Unexpected proxy target'); socket.destroy(); return; }
    tunnels++;
    const remote = net.connect(upstream.address().port, '127.0.0.1'); track(remote);
    remote.once('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head); socket.pipe(remote); remote.pipe(socket); });
    socket.once('close', () => remote.destroy()); remote.once('close', () => socket.destroy());
  });
  await listen(proxy); proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
}
function saveRoute(mode) {
  const noProxy = mode === 'direct' ? '127.0.0.1' : '';
  db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
    outboundProxyEnabled: true, outboundProxyUrl: proxyUrl, outboundNoProxy: noProxy })]));
  return noProxy;
}
describe('owned CommandCode HTTPS CA/hostname and abort boundary (explicit runner, not legacy retry certification)', { timeout: 20000 }, () => {
  it.each(['direct', 'proxy'])('%s Chat retry verified TLS POST2 requires successor own intent ACK', async mode => {
    await startFixture('matching'); const noProxy = saveRoute(mode), attempts = [], prepared = [], received = [];
    let enter, release; const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const before = vi.fn(async (...args) => {
      prepared.push(args[2]); const attempt = await context.beforeAttempt(...args); attempts.push(attempt);
      if (attempts.length === 2) { enter(); await held; } return attempt;
    });
    const complete = vi.fn((...args) => context.completeAttempt(...args));
    assertPost = (actual, request) => {
      const index = posts - 1; received.push({ actual, headers: request.headers });
      expect(actual).toEqual(prepared[index].commandCodeChatCapture.actual); expect(request.method).toBe('POST');
      expect(request.headers).toMatchObject(prepared[index].headers);
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempts[index].attemptId])).toEqual({ state: 'pending' });
    };
    responder = response => {
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.end(posts === 1 ? JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture TLS raw initial error' } }) + '\n' : wire());
    };
    const args = { ...options({ ...context, beforeAttempt: before, completeAttempt: complete }, noProxy), accountingMode: 'chat-commandcode-ndjson-retry',
      body: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] } };
    let returned = false;
    const work = new CommandCodeExecutor().execute(args).then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(posts).toBe(1); expect(failure).toBeNull(); expect(complete).toHaveBeenCalledTimes(1);
      expect(db.get('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempts[0].attemptId])).toEqual({ state: 'unresolved', outcome: 'failed', costNanoUsd: null });
      expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [attempts[1].attemptId])).toEqual({ state: 'pending' });
      args.body.messages[0].content = 'caller changed'; args.credentials.apiKey = 'caller changed';
    } finally { release(); }
    const result = await work; expect(result.error).toBeUndefined(); expect(await result.value.response.text()).toBe(wire());
    expect(posts).toBe(2); expect(failure).toBeNull(); expect(before).toHaveBeenCalledTimes(2); expect(complete).toHaveBeenCalledTimes(2);
    expect(received[1].actual).toEqual(received[0].actual); expect(received[1].headers.authorization).toBe('Bearer dummy-provider');
    expect(received[1].headers['x-session-id']).not.toBe(received[0].headers['x-session-id']);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempts[1].attemptId])).toEqual({ state: 'settled', costNanoUsd: 140000 });
    if (mode === 'direct') expect(tunnels).toBe(0); else expect(tunnels).toBeGreaterThan(0);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['direct', 'proxy'])('%s Chat hostname mismatch owns one unresolved completion, zero upstream POST, no successor', async mode => {
    await startFixture('mismatch'); const noProxy = saveRoute(mode);
    const before = vi.fn((...args) => context.beforeAttempt(...args)), complete = vi.fn((...args) => context.completeAttempt(...args));
    await expect(new CommandCodeExecutor().execute({ ...options({ ...context, beforeAttempt: before, completeAttempt: complete }, noProxy), accountingMode: 'chat-commandcode-ndjson-retry',
      body: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] } })).rejects.toMatchObject({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } });
    expect(posts).toBe(0); expect(failure).toBeNull(); expect(before).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'network_unknown', costNanoUsd: null }]);
    if (mode === 'direct') expect(tunnels).toBe(0); else expect(tunnels).toBeGreaterThan(0);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['direct', 'proxy'])('%s verified TLS post-received abort owns one unresolved ACK without retry', async mode => {
    await startFixture('matching'); const noProxy = saveRoute(mode);
    const signal = new AbortController(), reason = new Error('fixture CommandCode verified TLS abort'); let received, response;
    const entered = new Promise(resolve => { received = resolve; }); responder = value => { response = value; received(); };
    const complete = vi.fn((attempt, payload) => context.completeAttempt(attempt, payload)), authorize = vi.fn();
    const work = new CommandCodeExecutor().execute({ ...options({ ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize }, noProxy), signal: signal.signal });
    const rejected = expect(work).rejects.toBe(reason);
    try {
      await entered; expect(failure).toBeNull(); expect(posts).toBe(1);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
      signal.abort(reason); await rejected;
      expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
      expect(authorize).not.toHaveBeenCalled(); expect(posts).toBe(1); expect(failure).toBeNull();
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'aborted', costNanoUsd: null }]);
      if (mode === 'direct') expect(tunnels).toBe(0); else expect(tunnels).toBeGreaterThan(0);
      expect(db.coverage.status('a').gaps).toHaveLength(0);
    } finally { signal.abort(reason); response?.destroy(); }
  });
  it.each([['direct', 'matching'], ['proxy', 'matching'], ['direct', 'mismatch'], ['proxy', 'mismatch']])('%s %s retains certificate verification and independent ACK', async (mode, identity) => {
    await startFixture(identity); const work = new CommandCodeExecutor().execute(options(context, saveRoute(mode)));
    if (identity === 'matching') {
      const result = await work; expect(await result.response.text()).toBe(wire()); expect(failure).toBeNull(); expect(posts).toBe(1);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
    } else {
      await expect(work).rejects.toMatchObject({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }); expect(posts).toBe(0); expect(failure).toBeNull();
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    }
    if (mode === 'direct') expect(tunnels).toBe(0); else expect(tunnels).toBeGreaterThan(0);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
