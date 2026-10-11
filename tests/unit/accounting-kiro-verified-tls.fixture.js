import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { X509Certificate } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { KiroExecutor } from 'open-sse/executors/kiro.js';
import { concatFixtureBytes, fixtureKiroEvent } from '../helpers/accountingKiroFrames.js';
const fixture = vi.hoisted(() => ({ url: null }));
vi.mock('../../open-sse/config/accountedKiroCandidate.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, get ACCOUNTED_KIRO_URL() { return fixture.url; } };
});
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal(); return { ...original, PROVIDERS: { ...original.PROVIDERS, get kiro() {
    return { ...original.PROVIDERS.kiro, baseUrls: [...original.PROVIDERS.kiro.baseUrls.slice(0, 2), fixture.url] };
  } } };
});
let directory, db, upstream, proxy, sockets, posts, tunnels, context, proxyUrl, failure, responder, expectedBody, expectedPending;
const previousData = process.env.DATA_DIR, model = 'claude-sonnet-4.5';
const certificateDirectory = process.env.ACCOUNTING_TLS_FIXTURE_DIR;
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const body = () => ({ conversationState: { chatTriggerType: 'MANUAL', conversationId: '12345678-1234-4123-8123-123456789abc',
  currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: model, origin: 'AI_EDITOR' } }, history: [] },
  inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 } });
const wire = () => concatFixtureBytes([
  fixtureKiroEvent('assistantResponseEvent', { content: 'fixture output' }),
  fixtureKiroEvent('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 }),
  fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' }),
]);
beforeEach(async () => {
  expect(certificateDirectory).toBeTruthy(); expect(process.env.NODE_EXTRA_CA_CERTS).toBe(path.join(certificateDirectory, 'ca.pem'));
  expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe('0');
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-kiro-verified-tls-')); process.env.DATA_DIR = directory;
  delete global._dbAdapter; vi.resetModules(); sockets = new Set(); posts = 0; tunnels = 0; failure = null;
  expectedBody = () => body(); expectedPending = () => db.get('SELECT state FROM apiKeyAccounting');
  responder = response => { response.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' }); response.end(wire()); };
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'kiro', authType: 'apikey', apiKey: null, accessToken: 'dummy-provider', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','kiro',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
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
      expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(expectedBody()); expect(request.method).toBe('POST');
      expect(request.headers.authorization).toBe('Bearer dummy-provider'); expect(request.headers['x-amz-sso-bearer']).toBe('dummy-provider'); expect(request.headers.tokentype).toBe('API_KEY');
      expect(expectedPending()?.state).toBe('pending');
      responder(response);
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture assertion failed' })); }
  });
  upstream.on('connection', track); await listen(upstream);
  const target = `127.0.0.1:${upstream.address().port}`; fixture.url = `https://${target}/kiro/generate`;
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
describe('owned Kiro HTTPS CA/hostname boundary (explicit isolated runner, not legacy retry certification)', { timeout: 20000 }, () => {
  it.each([['direct', 'matching'], ['proxy', 'matching'], ['direct', 'mismatch'], ['proxy', 'mismatch']])('%s %s explicit repair mode preserves verified two-POST transport and own final completion ACK', async (mode, identity) => {
    await startFixture(identity);
    const noProxy = mode === 'direct' ? '127.0.0.1' : '';
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
      outboundProxyEnabled: true, outboundProxyUrl: proxyUrl, outboundNoProxy: noProxy })]));
    const handles = [], wires = []; let enter, release;
    const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const complete = vi.fn(async (...input) => {
      const terminal = await context.completeAttempt(...input);
      if (complete.mock.calls.length === 2) { enter(); await held; }
      return terminal;
    });
    const authorize = vi.fn(value => context.assertSuccessfulTerminal(value));
    const accounting = { ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize, async beforeAttempt(...input) {
      wires.push(input[2]); const handle = await context.beforeAttempt(...input); expect(handle.unrecorded).toBeFalsy(); handles.push(handle); return handle;
    } };
    const repaired = body(); repaired.conversationState.currentMessage.userInputMessage.content += '\n\nRetry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….';
    const output = text => concatFixtureBytes([fixtureKiroEvent('assistantResponseEvent', { content: text }),
      fixtureKiroEvent('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 }),
      fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' })]);
    expectedBody = () => posts === 1 ? body() : repaired;
    expectedPending = () => db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [handles[posts - 1].attemptId]);
    responder = response => { response.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' }); response.end(output(posts === 1 ? '...' : 'Fixture recovered TLS answer.')); };
    let returned = false;
    const work = new KiroExecutor().execute({ accounting, accountingMode: 'native-kiro-ellipsis-repair', connectionId: 'c', model, stream: true,
      credentials: { apiKey: null, accessToken: 'dummy-provider', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } },
      proxyOptions: { persistedGlobalProxy: { url: proxyUrl, noProxy } }, body: body() })
      .then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    if (identity === 'matching') {
      try {
        await installed; expect(returned).toBe(false); expect(posts).toBe(2); expect(failure).toBeNull(); expect(authorize).toHaveBeenCalledTimes(1);
        for (const handle of handles) expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handle.attemptId])).toEqual({ state: 'settled', costNanoUsd: 140000 });
      } finally { release(); }
      const result = await work; if (result.error) throw result.error;
      expect(new Uint8Array(await result.value.response.arrayBuffer())).toEqual(output('Fixture recovered TLS answer.'));
      expect(handles).toHaveLength(2); expect(handles[0].attemptId).not.toBe(handles[1].attemptId);
      expect(wires[1].kiroRepairCapture.actual).toEqual(repaired);
      expect(wires[0].headers['amz-sdk-invocation-id']).not.toBe(wires[1].headers['amz-sdk-invocation-id']);
      expect(complete).toHaveBeenCalledTimes(2); expect(authorize).toHaveBeenCalledTimes(2); expect(posts).toBe(2);
    } else {
      expect((await work).error).toMatchObject({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } });
      expect(posts).toBe(0); expect(handles).toHaveLength(1); expect(complete).toHaveBeenCalledTimes(1); expect(authorize).not.toHaveBeenCalled();
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    }
    expect(failure).toBeNull(); if (mode === 'direct') expect(tunnels).toBe(0); else expect(tunnels).toBeGreaterThan(0);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['direct', 'proxy'])('%s verified TLS abort after owned server receives POST, before headers, ACKs unresolved once', async mode => {
    await startFixture('matching');
    const noProxy = mode === 'direct' ? '127.0.0.1' : '';
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
      outboundProxyEnabled: true, outboundProxyUrl: proxyUrl, outboundNoProxy: noProxy })]));
    const signal = new AbortController(), reason = new Error('fixture verified TLS post-received abort'); let received, response;
    const entered = new Promise(resolve => { received = resolve; });
    responder = value => { response = value; received(); }; // server-side barrier, no sleep or deadline change
    const complete = vi.fn((attempt, payload) => context.completeAttempt(attempt, payload)), authorize = vi.fn();
    const work = new KiroExecutor().execute({ accounting: { ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize },
      accountingMode: 'native-kiro-eventstream', connectionId: 'c', model, stream: true, signal: signal.signal,
      credentials: { apiKey: null, accessToken: 'dummy-provider', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } },
      proxyOptions: { persistedGlobalProxy: { url: proxyUrl, noProxy } }, body: body() });
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
  it.each([['direct', 'matching'], ['proxy', 'matching'], ['direct', 'mismatch'], ['proxy', 'mismatch']])('%s %s preserves verification and independent accounting ACK', async (mode, identity) => {
    await startFixture(identity);
    const noProxy = mode === 'direct' ? '127.0.0.1' : '';
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true,
      outboundProxyEnabled: true, outboundProxyUrl: proxyUrl, outboundNoProxy: noProxy })]));
    const work = new KiroExecutor().execute({ accounting: context, accountingMode: 'native-kiro-eventstream', connectionId: 'c', model, stream: true,
      credentials: { apiKey: null, accessToken: 'dummy-provider', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } },
      proxyOptions: { persistedGlobalProxy: { url: proxyUrl, noProxy } }, body: body() });
    if (identity === 'matching') {
      const result = await work; expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(wire());
      expect(failure).toBeNull(); expect(posts).toBe(1);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
    } else {
      await expect(work).rejects.toMatchObject({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } });
      expect(posts).toBe(0); expect(failure).toBeNull();
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    }
    if (mode === 'direct') expect(tunnels).toBe(0); else expect(tunnels).toBeGreaterThan(0);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
