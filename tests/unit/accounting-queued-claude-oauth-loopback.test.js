import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultExecutor } from 'open-sse/executors/default.js';
import { selectAnthropicBeta } from 'open-sse/providers/shared.js';
const fixture = vi.hoisted(() => ({ url: null }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, get claude() { return { ...original.PROVIDERS.claude, baseUrl: fixture.url }; } },
    PROVIDER_OAUTH: { ...original.PROVIDER_OAUTH, get claude() { return { ...original.PROVIDER_OAUTH.claude, tokenUrl: `${fixture.url}/oauth/token` }; } } };
});
vi.mock('../../src/lib/db/engineAcquisition.js', async importOriginal => {
  const original = await importOriginal();
  return process.env.ACCOUNTING_TEST_SQLJS === '1' ? { ...original, initializeAvailableAdapter: async () => null } : original;
});
const rates = { input: '1', output: '2', cached: '0.1', cache_creation: '1.25', cache_creation_1h: '2' };
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const wire = mode => event('message_start', { message: { id: 'msg_oauth', type: 'message', role: 'assistant', model: 'fixture-oauth', content: [], usage: {
  input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10, server_tool_use: { web_search_requests: 0 },
  ...(mode === 'missing-details' ? {} : { cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 5 } }),
} } }) + (mode === 'tool' ? event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'call_out', name: 'lookup_ide', input: {} } }) +
  event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"q":"observed🙂"}' } }) + event('content_block_stop', { index: 0 }) : '') +
  event('message_delta', { delta: { stop_reason: mode === 'tool' ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 20 } }) + (mode === 'missing-stop' ? '' : event('message_stop'));
const thinkingWire = mode => {
  const content = event('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }) +
    event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'observed🙂' } }) +
    (mode === 'missing-signature' ? '' : event('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'opaque-signature' } })) + event('content_block_stop', { index: 0 });
  const raw = wire(mode); return raw.replace('event: message_delta', content + 'event: message_delta');
};
const options = (accounting, credentials = { accessToken: 'sk-ant-oat-dummy' }) => ({ model: 'fixture-oauth', stream: true,
  accountingMode: 'native-claude-oauth-sse', connectionId: 'c', accounting, credentials,
  body: { model: 'fixture-oauth', stream: true, max_tokens: 100, system: [{ type: 'text', text: 'original system' }],
    tools: [{ name: 'lookup', input_schema: { type: 'object' } }],
    messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'use1', name: 'lookup', input: { q: 'original' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'use1', is_error: true, content: 'original error' }] }] },
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
let db, directory, server, requests, refreshRequests, responder, refreshResponder, createAccounting;
const previous = process.env.DATA_DIR;
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-claude-oauth-native-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  if (process.env.ACCOUNTING_TEST_SQLJS === '1') expect(db.driver).toBe('sql.js');
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'claude', authType: 'oauth', accessToken: 'sk-ant-oat-dummy', refreshToken: 'dummy-refresh' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','claude',?)", [JSON.stringify({ 'fixture-oauth': rates })]);
  });
  requests = []; refreshRequests = [];
  refreshResponder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ access_token: 'sk-ant-oat-refreshed', refresh_token: 'dummy-rotated', expires_in: 3600 })); };
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
  server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    if (request.url === '/v1/messages/oauth/token') {
      refreshRequests.push({ body: JSON.parse(Buffer.concat(chunks).toString()), rows: db.all('SELECT state,costNanoUsd FROM apiKeyAccounting') });
      await refreshResponder(request, response); return;
    }
    requests.push({ url: request.url, body: JSON.parse(Buffer.concat(chunks).toString()), headers: request.headers,
      row: db.get('SELECT requestId,state FROM apiKeyAccounting ORDER BY rowid DESC LIMIT 1') });
    await responder(request, response);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.url = `http://127.0.0.1:${server.address().port}/v1/messages`;
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/messages', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
});
const row = () => db.get('SELECT state,costNanoUsd,priceSnapshotJson,usageJson FROM apiKeyAccounting');
describe('queued Claude OAuth original/actual wire authority (owned HTTP only)', { timeout: 20000 }, () => {
  it('preserves original history, generated 1h, cloaking and production OAuth URL/headers with original price', async () => {
    const context = await createAccounting(), args = options(context), original = structuredClone(args.body);
    responder = (_request, response) => { db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, cache_creation_1h: '9' } })])); response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
    const result = await new DefaultExecutor('claude').execute(args);
    expect(await result.response.text()).toBe(wire()); expect(args.body).toEqual(original);
    expect(requests).toHaveLength(1); const request = requests[0];
    expect(request.url).toBe('/v1/messages?beta=true'); expect(request.headers.authorization).toBe('Bearer sk-ant-oat-dummy'); expect(request.headers['x-api-key']).toBeUndefined();
    expect(request.headers['anthropic-beta']).toBe(selectAnthropicBeta('fixture-oauth'));
    expect(request.row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(request.body.system[0].text).toMatch(/^x-anthropic-billing-header:/);
    expect(request.body.system.at(-1).cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(request.body.tools.find(tool => tool.name === 'lookup_ide')).toBeTruthy();
    expect(request.body.tools.at(-1).cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(request.body.messages[0].content[0]).toMatchObject({ type: 'tool_use', id: 'use1', name: 'lookup_ide', input: { q: 'original' } });
    expect(request.body.messages[1].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'use1', is_error: true, content: 'original error' });
    expect(JSON.parse(request.body.metadata.user_id).session_id).toBe(request.headers['x-claude-code-session-id']);
    expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 110250 });
    expect(JSON.parse(row().priceSnapshotJson)).toMatchObject({ rates, usageSemantics: { cacheWriteTiers: 'observed_5m_1h' } });
  });
  it.each(['image', 'document', 'tool-image'])('native inline %s survives actual POST and holds own terminal ACK at original price', async mode => {
    const context = await createAccounting(); let enter, release;
    const reached = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(...input) { const result = await context.completeAttempt(...input); enter(); await held; return result; } };
    const args = options(accounting);
    const media = mode === 'document' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'aW5saW5l' }, title: 'original title', context: 'original context' }
      : { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW5saW5l' } };
    if (mode === 'tool-image') args.body.messages[1].content[0].content = [{ type: 'text', text: 'original error' }, media];
    else args.body.messages = [{ role: 'user', content: [media] }];
    const original = structuredClone(args.body);
    responder = (_request, response) => { db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, input: '99' } })])); response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
    const result = await new DefaultExecutor('claude').execute(args); let finished = false;
    const consume = result.response.text().then(text => { finished = true; return text; });
    try { await reached; expect(finished).toBe(false); expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 110250 }); } finally { release(); }
    expect(await consume).toBe(wire()); expect(args.body).toEqual(original); expect(requests).toHaveLength(1);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    const sent = mode === 'tool-image' ? requests[0].body.messages[1].content[0].content[1] : requests[0].body.messages[0].content[0];
    expect(sent.source).toEqual(media.source);
    if (mode === 'document') expect(sent).toMatchObject({ title: media.title, context: media.context });
    if (mode === 'tool-image') expect(requests[0].body.messages[1].content[0].is_error).toBe(true);
    expect(JSON.parse(row().usageJson)).toMatchObject({ exact: true, input: 100, output: 20 });
    expect(row().usageJson).not.toContain('aW5saW5l'); expect(row().priceSnapshotJson).not.toContain('original context');
  });
  it.each(['wire-drift', 'url', 'source-getter'])('inline media %s refuses before intent/POST without coercion', async mode => {
    const context = await createAccounting(), args = options(context); let invoked = 0;
    args.body.messages = [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW5saW5l' } }] }];
    if (mode === 'url') args.body.messages[0].content[0].source = { type: 'url', url: 'http://127.0.0.1/private' };
    if (mode === 'source-getter') Object.defineProperty(args.body.messages[0].content[0].source, 'data', { enumerable: true, get() { invoked++; return 'aW5saW5l'; } });
    if (mode === 'wire-drift') args.accounting = { ...context, beforeAttempt(meta, supported, value) {
      const changed = structuredClone(value), body = JSON.parse(changed.anthropicTransport.serializedBody);
      body.messages[0].content[0].source.data = 'ZHJpZnQ='; changed.anthropicTransport.serializedBody = JSON.stringify(body); return context.beforeAttempt(meta, supported, changed);
    } };
    await expect(new DefaultExecutor('claude').execute(args)).rejects.toThrow(); expect(invoked).toBe(0); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('native thinking preserves signed history, summarized beta and original price; terminal waits own ACK', async () => {
    const context = await createAccounting(); let entered, release;
    const reached = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(...input) { const value = await context.completeAttempt(...input); entered(); await hold; return value; } };
    const args = options(accounting); args.body.max_tokens = 4096; args.body.thinking = { type: 'enabled', budget_tokens: 1024, display: 'summarized' };
    args.body.messages[0].content.unshift({ type: 'thinking', thinking: 'original history', signature: 'EgAB' }); const original = structuredClone(args.body);
    responder = (_request, response) => { db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, output: '99' } })])); response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(thinkingWire()); };
    const result = await new DefaultExecutor('claude').execute(args); let finished = false;
    const consume = result.response.text().then(text => { finished = true; return text; });
    try { await reached; expect(finished).toBe(false); expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 110250 }); } finally { release(); }
    expect(await consume).toBe(thinkingWire()); expect(args.body).toEqual(original); expect(requests).toHaveLength(1);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(requests[0].body.thinking).toEqual(original.thinking); expect(requests[0].body.messages[0].content[0]).toEqual(original.messages[0].content[0]);
    expect(requests[0].headers['anthropic-beta']).toBe(selectAnthropicBeta('fixture-oauth', original));
    expect(requests[0].headers['anthropic-beta']).not.toContain('redact-thinking');
  });
  it.each(['missing-signature', 'missing-stop'])('native thinking %s cannot authorize terminal/refresh', async mode => {
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(thinkingWire(mode)); };
    const args = options(await createAccounting()); args.body.thinking = { type: 'adaptive' };
    const result = await new DefaultExecutor('claude').execute(args); await expect(result.response.text()).rejects.toThrow();
    expect(row()).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0);
  });
  it('missing signed tool history cannot be replaced with a generated thinking placeholder', async () => {
    const args = options(await createAccounting()); args.body.max_tokens = 4096; args.body.thinking = { type: 'enabled', budget_tokens: 1024 };
    await expect(new DefaultExecutor('claude').execute(args)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it.each([false, true])('failed HTTP thinking shares strict lifecycle; missing-signature=%s', async missing => {
    responder = (_request, response) => { response.writeHead(429, { 'content-type': 'text/event-stream' }); response.end(thinkingWire(missing ? 'missing-signature' : null)); };
    const args = options(await createAccounting()); args.body.thinking = { type: 'adaptive' };
    if (missing) { await expect(new DefaultExecutor('claude').execute(args)).rejects.toThrow(); expect(row()).toMatchObject({ state: 'unresolved', costNanoUsd: null }); }
    else { const result = await new DefaultExecutor('claude').execute(args); expect(result.response.status).toBe(429); expect(await result.response.text()).not.toContain('opaque-signature'); expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 110250 }); }
    expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0);
  });
  it.each(['missing-details', 'missing-stop'])('unobserved usage/EOF never becomes zero or successful terminal: %s', async mode => {
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire(mode)); };
    const result = await new DefaultExecutor('claude').execute(options(await createAccounting()));
    await expect(result.response.text()).rejects.toThrow(); expect(row()).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(requests).toHaveLength(1);
  });
  it.each(['foreign-token', 'missing-rate', 'erased-history', 'foreign-beta', 'credential-dequeue', 'wire-drift'])('refuses before intent/POST: %s', async mode => {
    const context = await createAccounting(), args = options(context);
    if (mode === 'foreign-token') args.credentials.accessToken = 'sk-ant-oat-other';
    if (mode === 'foreign-beta') args.credentials.rawHeaders = { 'anthropic-beta': 'fixture-unknown' };
    if (mode === 'missing-rate') db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { input: '1', output: '2' } })]));
    if (mode === 'erased-history') args.body.messages[0].content.push({ type: 'text', text: 'do not erase after tool use' });
    if (mode === 'credential-dequeue') args.accounting = { ...context, beforeAttempt(...input) {
      const work = context.beforeAttempt(...input), saved = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']);
      db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(saved.data), accessToken: 'sk-ant-oat-changed' }), 'c'])); return work;
    } };
    if (mode === 'wire-drift') args.accounting = { ...context, beforeAttempt(meta, supported, value) {
      const changed = structuredClone(value), body = JSON.parse(changed.anthropicTransport.serializedBody);
      body.messages[1].content[0].is_error = false; changed.anthropicTransport.serializedBody = JSON.stringify(body);
      return context.beforeAttempt(meta, supported, changed);
    } };
    await expect(new DefaultExecutor('claude').execute(args)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('unrecorded gap handle is not own durable intent permission to POST', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt: vi.fn(async () => ({ unrecorded: true, attemptId: 'fixture-gap' })), completeAttempt: vi.fn(context.completeAttempt) };
    await expect(new DefaultExecutor('claude').execute(options(accounting))).rejects.toThrow();
    expect(requests).toHaveLength(0); expect(accounting.completeAttempt).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('decloaks only validated client tool names while terminal waits own ACK', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire('tool')); };
    const accounting = { ...context, async completeAttempt(...input) { const result = await context.completeAttempt(...input); enter(); await held; return result; } };
    const result = await new DefaultExecutor('claude').execute(options(accounting)); let ended = false;
    const consume = result.response.text().then(text => { ended = true; return text; });
    try { await entered; expect(ended).toBe(false); expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 110250 }); } finally { release(); }
    const text = await consume; expect(text).toContain('"name":"lookup"'); expect(text).not.toContain('"name":"lookup_ide"'); expect(text).toContain('observed🙂'); expect(text).toContain('event: message_stop');
  });
  it('records a failed HTTP debit with separate fresh authority and redacted error', async () => {
    const context = await createAccounting();
    responder = (_request, response) => { response.writeHead(429, { 'content-type': 'text/event-stream' }); response.end(wire()); };
    const result = await new DefaultExecutor('claude').execute(options(context));
    expect(result.response.status).toBe(429); expect(await result.response.json()).toMatchObject({ error: { message: 'Rate limit exceeded' } });
    expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 110250 }); expect(requests).toHaveLength(1);
  });
  it('a completed generation uses original price; the next original generation requires fresh persisted credentials', async () => {
    const context = await createAccounting(), completeAttempt = vi.fn((...input) => context.completeAttempt(...input));
    const accounting = { ...context, completeAttempt };
    const first = await new DefaultExecutor('claude').execute(options(accounting)); expect(await first.response.text()).toBe(wire());
    expect(completeAttempt).toHaveBeenCalledTimes(1);
    const saved = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']);
    db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(saved.data), accessToken: 'sk-ant-oat-refreshed' }), 'c']));
    const second = await new DefaultExecutor('claude').execute(options(accounting, { accessToken: 'sk-ant-oat-refreshed' }));
    expect(await second.response.text()).toBe(wire()); expect(completeAttempt).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(2); expect(requests.map(r => r.headers.authorization)).toEqual(['Bearer sk-ant-oat-dummy', 'Bearer sk-ant-oat-refreshed']);
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd FROM apiKeyAccounting');
    expect(rows).toHaveLength(2); expect(new Set(rows.map(r => r.attemptId)).size).toBe(2);
    expect(rows.every(r => r.requestId === context.requestId && r.state === 'settled' && r.costNanoUsd === 110250)).toBe(true);
  });
  it('refresh successor captures fresh rate but caller mutation cannot replace original model/context', async () => {
    const context = await createAccounting(); let args;
    const accounting = { ...context, completeClaudeOauthRefresh(...input) {
      const next = context.completeClaudeOauthRefresh(...input); args.model = 'foreign'; args.accounting = { beforeAttempt() { throw new Error('foreign context'); } };
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, cache_creation_1h: '9' } })])); return next;
    } };
    responder = (_request, response) => { response.writeHead(requests.length === 1 ? 401 : 200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
    args = options(accounting); const result = await new DefaultExecutor('claude').execute(args);
    expect(await result.response.text()).toBe(wire()); expect(requests).toHaveLength(2); expect(requests.every(r => r.body.model === 'fixture-oauth')).toBe(true);
    const rows = db.all('SELECT costNanoUsd,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid');
    expect(rows.map(r => r.costNanoUsd)).toEqual([110250, 145250]); expect(JSON.parse(rows[0].priceSnapshotJson).rates.cache_creation_1h).toBe('2'); expect(JSON.parse(rows[1].priceSnapshotJson).rates.cache_creation_1h).toBe('9');
  });
  it('refresh POST waits predecessor delivered terminal ACK, persists rotating credentials before successor own intent', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const completeAttempt = vi.fn(async (...input) => { const result = await context.completeAttempt(...input); if (completeAttempt.mock.calls.length === 1) { enter(); await held; } return result; });
    responder = (_request, response) => { response.writeHead(requests.length === 1 ? 401 : 200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
    const work = new DefaultExecutor('claude').execute(options({ ...context, completeAttempt }));
    try { await Promise.race([entered, work.then(() => { throw new Error('returned before terminal ACK'); })]); expect(refreshRequests).toHaveLength(0); expect(requests).toHaveLength(1); }
    finally { release(); }
    const result = await work; expect(result.response.status).toBe(200); expect(await result.response.text()).toBe(wire());
    expect(refreshRequests).toHaveLength(1); expect(refreshRequests[0]).toMatchObject({ body: { grant_type: 'refresh_token', refresh_token: 'dummy-refresh' }, rows: [{ state: 'settled', costNanoUsd: 110250 }] });
    expect(requests.map(r => r.headers.authorization)).toEqual(['Bearer sk-ant-oat-dummy', 'Bearer sk-ant-oat-refreshed']);
    expect(completeAttempt).toHaveBeenCalledTimes(2); const rows = db.all('SELECT requestId,attemptId,state FROM apiKeyAccounting');
    expect(rows).toHaveLength(2); expect(new Set(rows.map(r => r.attemptId)).size).toBe(2); expect(rows.every(r => r.state === 'settled' && r.requestId === context.requestId)).toBe(true);
    expect(JSON.parse(db.get('SELECT data FROM providerConnections WHERE id=?', ['c']).data)).toMatchObject({ accessToken: 'sk-ant-oat-refreshed', refreshToken: 'dummy-rotated' });
  });
  it.each(['unknown-predecessor', 'lost-terminal-ack', 'token-drift', 'budget-crossing', 'copied-attempt'])('cannot refresh/succeed around predecessor or current authority: %s', async mode => {
    const context = await createAccounting();
    if (mode === 'budget-crossing') db.durableTransaction(() => db.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,?,?,?,?)', ['a', 100000, null, 1, '2026-10-03T00:00:00.000Z']));
    const accounting = { ...context,
      prepareClaudeOauthRefresh(attempt, terminal) { return context.prepareClaudeOauthRefresh(mode === 'copied-attempt' ? { ...attempt } : attempt, terminal); },
      async completeAttempt(...input) { const result = await context.completeAttempt(...input);
      if (mode === 'lost-terminal-ack') throw new Error('lost terminal ACK');
      if (mode === 'token-drift') { const saved = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(saved.data), accessToken: 'sk-ant-oat-foreign' }), 'c'])); }
      return result;
    } };
    responder = (_request, response) => { response.writeHead(401, { 'content-type': mode === 'unknown-predecessor' ? 'application/json' : 'text/event-stream' }); response.end(mode === 'unknown-predecessor' ? '{"error":"no usage"}' : wire()); };
    try { const result = await new DefaultExecutor('claude').execute(options(accounting)); expect(result.response.status).toBe(401); } catch (error) { expect(error).toBeInstanceOf(Error); }
    expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    expect(row().state).toBe(mode === 'unknown-predecessor' ? 'unresolved' : 'settled');
  });
  it.each(['redirect', 'credential-race', 'lost-persist-ack', 'abort', 'invalid-token'])('refresh does not replay/overwrite/dispatch around failure: %s', async mode => {
    const context = await createAccounting(), controller = new AbortController();
    responder = (_request, response) => { response.writeHead(401, { 'content-type': 'text/event-stream' }); response.end(wire()); };
    refreshResponder = (_request, response) => {
      if (mode === 'redirect') { response.writeHead(307, { Location: fixture.url }); response.end(); return; }
      if (mode === 'credential-race') { const saved = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(saved.data), accessToken: 'sk-ant-oat-other-writer' }), 'c'])); }
      if (mode === 'abort') controller.abort(new Error('fixture cancel refresh'));
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ access_token: mode === 'invalid-token' ? 'foreign' : 'sk-ant-oat-refreshed', refresh_token: 'dummy-rotated', expires_in: 3600 }));
    };
    const accounting = { ...context, completeClaudeOauthRefresh(...input) { const credentials = context.completeClaudeOauthRefresh(...input); if (mode === 'lost-persist-ack') throw new Error('lost persist ACK'); return credentials; } };
    await expect(new DefaultExecutor('claude').execute({ ...options(accounting), signal: controller.signal })).rejects.toThrow();
    expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(1); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1); expect(row().state).toBe('settled');
    const saved = JSON.parse(db.get('SELECT data FROM providerConnections WHERE id=?', ['c']).data);
    expect(saved.accessToken).toBe(mode === 'credential-race' ? 'sk-ant-oat-other-writer' : mode === 'lost-persist-ack' ? 'sk-ant-oat-refreshed' : 'sk-ant-oat-dummy');
  });
  it('OAuth token stored in apiKey preserves production x-api-key branch and original wire', async () => {
    const saved = JSON.parse(db.get('SELECT data FROM providerConnections WHERE id=?', ['c']).data); delete saved.accessToken;
    db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...saved, apiKey: 'sk-ant-oat-api-key' }), 'c']));
    const result = await new DefaultExecutor('claude').execute(options(await createAccounting(), { apiKey: 'sk-ant-oat-api-key' }));
    expect(await result.response.text()).toBe(wire()); expect(requests[0].headers['x-api-key']).toBe('sk-ant-oat-api-key'); expect(requests[0].headers.authorization).toBeUndefined(); expect(row().state).toBe('settled');
  });
  it.each(['getter', 'toJSON'])('rejects programmable original before transform: %s', async mode => {
    const args = options(await createAccounting()), invoke = vi.fn();
    if (mode === 'getter') Object.defineProperty(args.body, 'metadata', { enumerable: true, get() { invoke(); return {}; } });
    else args.body.toJSON = () => { invoke(); return {}; };
    await expect(new DefaultExecutor('claude').execute(args)).rejects.toThrow(); expect(invoke).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('held durable intent ACK cannot POST, held terminal ACK cannot end', async () => {
    const context = await createAccounting(); let intentEnter, intentRelease, terminalEnter, terminalRelease;
    const intentEntered = new Promise(resolve => { intentEnter = resolve; }), intentHeld = new Promise(resolve => { intentRelease = resolve; });
    const terminalEntered = new Promise(resolve => { terminalEnter = resolve; }), terminalHeld = new Promise(resolve => { terminalRelease = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); intentEnter(); await intentHeld; return attempt; },
      async completeAttempt(...input) { const result = await context.completeAttempt(...input); terminalEnter(); await terminalHeld; return result; } };
    const work = new DefaultExecutor('claude').execute(options(accounting));
    try { await Promise.race([intentEntered, work.then(() => { throw new Error('POST before intent ACK'); })]); expect(requests).toHaveLength(0); expect(row().state).toBe('pending'); } finally { intentRelease(); }
    const result = await work; let ended = false; const consume = result.response.text().then(text => { ended = true; return text; });
    try { await terminalEntered; expect(ended).toBe(false); expect(row().state).toBe('settled'); } finally { terminalRelease(); }
    expect(await consume).toBe(wire()); expect(requests).toHaveLength(1);
  });
});
