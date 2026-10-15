import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultExecutor } from 'open-sse/executors/default.js';
import { dynamicTools, dynamicWire, dynamicPausedHistory } from './fixtures/accounting-dynamic-wire.js';
import { fetchTool, fetchWire, fetchHistory } from './fixtures/accounting-fetch-wire.js';
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
let db, directory, server, requests, refreshRequests, responder, refreshResponder, createAccounting, failure;
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
  requests = []; refreshRequests = []; failure = null;
  refreshResponder = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ access_token: 'sk-ant-oat-refreshed', refresh_token: 'dummy-rotated', expires_in: 3600 })); };
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      if (request.url === '/v1/messages/oauth/token') {
        refreshRequests.push({ body: JSON.parse(Buffer.concat(chunks).toString()), rows: db.all('SELECT state,costNanoUsd FROM apiKeyAccounting') });
        await refreshResponder(request, response); return;
      }
      const pending = db.get('SELECT requestId,state,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid DESC LIMIT 1');
      requests.push({ url: request.url, body: JSON.parse(Buffer.concat(chunks).toString()), headers: request.headers,
        row: pending && { requestId: pending.requestId, state: pending.state }, priceSnapshotJson: pending?.priceSnapshotJson });
      await responder(request, response);
    } catch (error) { failure = error; response.writeHead(500); response.end('fixture error'); }
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
  it.each(['success', 'failed-http', 'combined-fetch', 'missing-code', 'lost-ack'])('dynamic OAuth %s preserves deterministic original code/search/raw authority/price/own ACK', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => {
      const terminal = await context.completeAttempt(...input); enter(); if (['success', 'failed-http', 'combined-fetch'].includes(mode)) await held;
      if (mode === 'lost-ack') throw new Error('fixture dynamic OAuth ACK lost'); return terminal;
    }) };
    const args = options(accounting); args.accountingMode = 'native-claude-oauth-dynamic-sse'; args.body.tools.unshift(...dynamicTools());
    if (mode === 'combined-fetch') args.body.tools.unshift({ type: 'web_fetch_20260318', name: 'web_fetch', citations: { enabled: true } });
    const original = structuredClone(args.body);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, web_search_per_1000: '10' } })]));
    const raw = dynamicWire('fixture-oauth', { cacheTiers: true, omit: mode === 'missing-code', fetch: mode === 'combined-fetch' });
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, web_search_per_1000: '200' } })]));
      response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    let ended = false; const consume = new DefaultExecutor('claude').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (['success', 'failed-http', 'combined-fetch'].includes(mode)) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('ended before own ACK'); })]); expect(ended).toBe(false); } finally { release(); }
      if (mode === 'failed-http') expect(await consume).not.toContain('private opaque'); else expect(await consume).toBe(raw);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0); expect(requests[0].row.state).toBe('pending');
    expect(requests[0].body.tools.find(tool => tool.name === 'web_search')).toEqual(dynamicTools()[0]);
    expect(JSON.parse(requests[0].priceSnapshotJson).usageSemantics).toMatchObject({ cacheWriteTiers: 'observed_5m_1h', codeServerToolUses: 'observed_claude_included_code_token_only', serverToolUses: 'observed_claude_server_tool_use' });
    expect(row()).toMatchObject({ state: mode === 'missing-code' ? 'unresolved' : 'settled', costNanoUsd: mode === 'missing-code' ? null : 20120250 });
    if (mode !== 'missing-code') expect(JSON.parse(row().usageJson).codeToolUses).toEqual({ codeExecutionRequests: 3 });
    expect(JSON.stringify(row())).not.toMatch(/private|example.com|sk-ant-oat|dummy-refresh/); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['delivered-ack', 'lost-predecessor-ack', 'missing-successor-rate'])('dynamic OAuth refresh %s requires own predecessor ACK and fresh independent price/count/intent', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const priced = { ...rates, web_search_per_1000: '10' };
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': priced })]));
    const completeAttempt = vi.fn(async (...input) => { const terminal = await context.completeAttempt(...input);
      if (completeAttempt.mock.calls.length === 1) { enter(); if (mode === 'lost-predecessor-ack') throw new Error('fixture dynamic predecessor ACK lost'); await held; } return terminal;
    });
    const accounting = { ...context, completeAttempt, completeClaudeOauthRefresh(...input) {
      const next = context.completeClaudeOauthRefresh(...input);
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': mode === 'missing-successor-rate' ? rates : { ...priced, web_search_per_1000: '20' } })])); return next;
    } };
    const args = options(accounting); args.accountingMode = 'native-claude-oauth-dynamic-sse'; args.body.tools.unshift(...dynamicTools()); const original = structuredClone(args.body);
    const first = dynamicWire('fixture-oauth', { cacheTiers: true }), second = dynamicWire('fixture-oauth', { cacheTiers: true, codeCount: 1, searchCount: 1 });
    responder = (_request, response) => { response.writeHead(requests.length === 1 ? 401 : 200, { 'content-type': 'text/event-stream' }); response.end(requests.length === 1 ? first : second); };
    const work = new DefaultExecutor('claude').execute(args);
    if (mode === 'lost-predecessor-ack') await expect(work).rejects.toThrow();
    else {
      // Attach the rejection expectation before releasing the held predecessor.
      const observed = mode === 'missing-successor-rate' ? expect(work).rejects.toMatchObject({ code: 'model_pricing_unavailable' }) : null;
      try { await Promise.race([entered, work.then(() => { throw new Error('refresh before predecessor ACK'); })]); expect(refreshRequests).toHaveLength(0); expect(requests).toHaveLength(1); } finally { release(); }
      if (observed) await observed; else expect(await (await work).response.text()).toBe(second);
    }
    const success = mode === 'delivered-ack', rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid');
    expect(rows.map(value => value.costNanoUsd)).toEqual(success ? [20120250, 20120250] : [20120250]);
    expect(rows.every(value => value.state === 'settled' && value.requestId === context.requestId && JSON.parse(value.priceSnapshotJson).usageSemantics.codeServerToolUses === 'observed_claude_included_code_token_only')).toBe(true);
    expect(rows.map(value => JSON.parse(value.usageJson).codeToolUses.codeExecutionRequests)).toEqual(success ? [3, 1] : [3]);
    expect(rows.map(value => JSON.parse(value.usageJson).toolUses.webSearchRequests)).toEqual(success ? [2, 1] : [2]);
    expect(new Set(rows.map(value => value.attemptId)).size).toBe(rows.length); expect(completeAttempt).toHaveBeenCalledTimes(rows.length);
    expect(requests).toHaveLength(success ? 2 : 1); expect(refreshRequests).toHaveLength(mode === 'lost-predecessor-ack' ? 0 : 1);
    if (success) { expect(requests[1].headers.authorization).toBe('Bearer sk-ant-oat-refreshed'); expect(requests[1].body.tools).toEqual(requests[0].body.tools); expect(JSON.parse(requests[1].priceSnapshotJson).rates.web_search_per_1000).toBe('20'); }
    expect(args.body).toEqual(original); expect(failure).toBeNull();
  });
  it('dynamic OAuth pending code history survives deterministic transform and owns resumed graph without decoys', async () => {
    const args = options(await createAccounting()); args.accountingMode = 'native-claude-oauth-dynamic-sse'; args.body.tools.unshift(...dynamicTools());
    args.body.messages.push({ role: 'assistant', content: dynamicPausedHistory('fixture-oauth') }, { role: 'user', content: 'Continue private work' });
    const original = structuredClone(args.body), raw = dynamicWire('fixture-oauth', { cacheTiers: true, resume: true, prefix: 'successor' });
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, web_search_per_1000: '10' } })]));
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(raw); };
    expect(await (await new DefaultExecutor('claude').execute(args)).response.text()).toBe(raw); expect(requests[0].body.messages[2]).toEqual(original.messages[2]);
    expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 20120250 }); expect(JSON.parse(row().usageJson).codeToolUses).toEqual({ codeExecutionRequests: 3 });
    expect(args.body).toEqual(original); expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0); expect(failure).toBeNull();
  });
  it.each(['success', 'failed-http', 'combined-search', 'missing-counter', 'lost-ack'])('direct fetch OAuth %s preserves deterministic source/citation and generated cache/token/required counters/own ACK', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => {
      const terminal = await context.completeAttempt(...args); enter();
      if (['success', 'failed-http', 'combined-search'].includes(mode)) await held;
      if (mode === 'lost-ack') throw new Error('fixture fetch OAuth ACK lost'); return terminal;
    }) };
    const args = options(accounting); args.body.tools.unshift(fetchTool());
    if (mode === 'combined-search') args.body.tools.unshift({ type: 'web_search_20250305', name: 'web_search' });
    args.body.messages[1].content.push({ type: 'text', text: 'Read https://example.com/article' }); const original = structuredClone(args.body);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, ...(mode === 'combined-search' ? { web_search_per_1000: '10' } : {}) } })]));
    const raw = fetchWire('fixture-oauth', { omit: mode === 'missing-counter', search: mode === 'combined-search', cacheTiers: true });
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, input: '9', output: '9', web_search_per_1000: '200' } })]));
      response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    const execution = new DefaultExecutor('claude').execute(args); let finished = false;
    const consume = execution.then(result => result.response.text()); consume.then(() => { finished = true; }, () => { finished = true; });
    if (['success', 'failed-http', 'combined-search'].includes(mode)) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('ended before own ACK'); })]); expect(finished).toBe(false); }
      finally { release(); }
      if (mode === 'failed-http') expect(await consume).not.toContain('private fetched corpus'); else expect(await consume).toBe(raw);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0); expect(requests[0].row.state).toBe('pending');
    expect(requests[0].body.tools.find(tool => tool.name === 'web_fetch')).toEqual(fetchTool());
    expect(args.body).toEqual(original); expect(requests[0].body.messages[1].content.at(-1).text).toBe('Read https://example.com/article');
    const result = row(); expect(result).toMatchObject({ state: mode === 'missing-counter' ? 'unresolved' : 'settled', costNanoUsd: mode === 'missing-counter' ? null : mode === 'combined-search' ? 20120250 : 120250 });
    expect(JSON.parse(result.priceSnapshotJson).usageSemantics).toMatchObject({ cacheWriteTiers: 'observed_5m_1h', nonBillableServerToolUses: 'observed_claude_web_fetch_token_only' });
    if (mode !== 'missing-counter') expect(JSON.parse(result.usageJson).nonBillableToolUses).toEqual({ webFetchRequests: 3 });
    expect(JSON.stringify(result)).not.toMatch(/private|example.com|sk-ant-oat|dummy-refresh/); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it('fetch-only original history survives OAuth cache/cloak and authorizes only preceding document indices', async () => {
    const context = await createAccounting(), args = options(context); args.body.tools.unshift(fetchTool());
    args.body.messages.push({ role: 'assistant', content: fetchHistory('srvtoolu_fetch_history') }, { role: 'user', content: 'Read https://example.com/article' });
    const original = structuredClone(args.body), raw = fetchWire('fixture-oauth', { cacheTiers: true, documentIndex: 1 });
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(raw); };
    expect(await (await new DefaultExecutor('claude').execute(args)).response.text()).toBe(raw);
    expect(requests[0].body.messages[2]).toEqual(original.messages[2]); expect(args.body).toEqual(original); expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 120250 });
    expect(JSON.parse(row().usageJson).nonBillableToolUses).toEqual({ webFetchRequests: 3 }); expect(failure).toBeNull();
  });
  it.each(['delivered-ack', 'lost-predecessor-ack'])('fetch OAuth refresh %s requires predecessor own ACK and independent successor price/count', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const completeAttempt = vi.fn(async (...input) => { const terminal = await context.completeAttempt(...input);
      if (completeAttempt.mock.calls.length === 1) { enter(); if (mode === 'lost-predecessor-ack') throw new Error('fixture fetch predecessor ACK lost'); await held; } return terminal;
    });
    const accounting = { ...context, completeAttempt, completeClaudeOauthRefresh(...input) {
      const next = context.completeClaudeOauthRefresh(...input);
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, input: '2' } })])); return next;
    } };
    const args = options(accounting); args.body.tools.unshift(fetchTool());
    const first = fetchWire('fixture-oauth', { cacheTiers: true }), second = fetchWire('fixture-oauth', { cacheTiers: true, count: 1 });
    responder = (_request, response) => { response.writeHead(requests.length === 1 ? 401 : 200, { 'content-type': 'text/event-stream' }); response.end(requests.length === 1 ? first : second); };
    const work = new DefaultExecutor('claude').execute(args);
    if (mode === 'lost-predecessor-ack') await expect(work).rejects.toThrow();
    else {
      try { await Promise.race([entered, work.then(() => { throw new Error('refresh before own predecessor ACK'); })]); expect(refreshRequests).toHaveLength(0); expect(requests).toHaveLength(1); } finally { release(); }
      expect(await (await work).response.text()).toBe(second);
    }
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid');
    expect(rows.map(value => value.costNanoUsd)).toEqual(mode === 'lost-predecessor-ack' ? [120250] : [120250, 180250]);
    expect(rows.every(value => value.state === 'settled' && value.requestId === context.requestId && JSON.parse(value.priceSnapshotJson).usageSemantics.nonBillableServerToolUses === 'observed_claude_web_fetch_token_only')).toBe(true);
    expect(rows.map(value => JSON.parse(value.usageJson).nonBillableToolUses.webFetchRequests)).toEqual(mode === 'lost-predecessor-ack' ? [3] : [3, 1]);
    expect(new Set(rows.map(value => value.attemptId)).size).toBe(rows.length); expect(refreshRequests).toHaveLength(mode === 'lost-predecessor-ack' ? 0 : 1); expect(completeAttempt).toHaveBeenCalledTimes(rows.length); expect(failure).toBeNull();
  });
  it.each(['success', 'failed-http', 'missing-counter', 'lost-ack', 'mixed-client', 'decoy-client'])('paid direct search OAuth %s preserves original server history, deterministic wire and required original price/ACK', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => {
      const terminal = await context.completeAttempt(...input); enter();
      if (mode === 'success' || mode === 'failed-http') await held;
      if (mode === 'lost-ack') throw new Error('fixture paid OAuth lost ACK'); return terminal;
    }) };
    const args = options(accounting), search = { type: 'web_search_20250305', name: 'web_search', max_uses: 2 };
    args.body.tools.unshift(search);
    args.body.messages.unshift({ role: 'user', content: 'prior private search' }, { role: 'assistant', content: [
      { type: 'server_tool_use', id: 'srvtoolu_prior', name: 'web_search', input: { query: 'prior private query' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_prior', content: [] }, { type: 'text', text: 'prior answer' },
    ] }, { role: 'user', content: 'next request' });
    const original = structuredClone(args.body), priced = { ...rates, web_search_per_1000: '10' };
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': priced })]));
    let raw = wire().replace(',"server_tool_use":{"web_search_requests":0}', '').replace('event: message_delta',
      event('content_block_start', { index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_current', name: 'web_search', input: {} } }) +
      event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"current private query"}' } }) + event('content_block_stop', { index: 0 }) +
      event('content_block_start', { index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_current', content: [] } }) + event('content_block_stop', { index: 1 }) + 'event: message_delta')
      .replace('"usage":{"output_tokens":20}', `"usage":{"output_tokens":20${mode === 'missing-counter' ? '' : ',"server_tool_use":{"web_search_requests":2}'}}`);
    if (mode === 'mixed-client' || mode === 'decoy-client') raw = raw.replace('event: message_delta',
      event('content_block_start', { index: 2, content_block: { type: 'tool_use', id: 'client_current', name: mode === 'mixed-client' ? 'lookup_ide' : 'Task', input: {} } }) +
      event('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: '{"q":"client value"}' } }) + event('content_block_stop', { index: 2 }) + 'event: message_delta').replace('"stop_reason":"end_turn"', '"stop_reason":"tool_use"');
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...priced, web_search_per_1000: '200' } })]));
      response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    const execution = new DefaultExecutor('claude').execute(args); let finished = false;
    const consume = execution.then(result => result.response.text()); consume.then(() => { finished = true; }, () => { finished = true; });
    if (mode === 'success' || mode === 'failed-http') {
      // Observe admission/parse rejection as well as sink entry; never turn a
      // preintent refusal into a20s fixture timeout waiting for a foreign sink.
      try { await Promise.race([entered, consume.then(() => { throw new Error('terminal ended before held ACK'); })]); expect(finished).toBe(false); expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 20110250 }); }
      finally { release(); }
      if (mode === 'success') expect(await consume).toBe(raw); else expect(await consume).not.toContain('current private query');
    } else if (mode === 'mixed-client') {
      const output = await consume; await entered;
      expect(output).toContain('"name":"lookup"'); expect(output).not.toContain('"name":"lookup_ide"');
      expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 20110250 });
    } else {
      await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered;
      const unknown = mode === 'missing-counter' || mode === 'decoy-client';
      expect(row()).toMatchObject({ state: unknown ? 'unresolved' : 'settled', costNanoUsd: unknown ? null : 20110250 });
    }
    expect(args.body).toEqual(original); expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(requests[0].body.tools.find(tool => tool.name === 'web_search')).toEqual(search);
    expect(requests[0].body.messages[1].content.slice(0, 2)).toEqual(original.messages[1].content.slice(0, 2));
    expect(JSON.parse(row().priceSnapshotJson)).toMatchObject({ rates: priced, rateUnits: { web_search_per_1000: 'USD/1000 uses' }, usageSemantics: { cacheWriteTiers: 'observed_5m_1h', serverToolUses: 'observed_claude_server_tool_use' } });
    expect(JSON.stringify(row())).not.toMatch(/private|query|sk-ant-oat|dummy-refresh/); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['delivered', 'lost-predecessor-ack', 'missing-successor-rate'])('paid OAuth refresh %s owns independent intent, original rate and required counters', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const completeAttempt = vi.fn(async (...input) => {
      const terminal = await context.completeAttempt(...input);
      if (completeAttempt.mock.calls.length === 1) { enter(); await held; if (mode === 'lost-predecessor-ack') throw new Error('fixture predecessor ACK missing'); }
      return terminal;
    });
    const args = options({ ...context, completeAttempt });
    args.body.tools.unshift({ type: 'web_search_20250305', name: 'web_search' });
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, web_search_per_1000: '10' } })]));
    const predecessor = wire().replace('"web_search_requests":0', '"web_search_requests":2'), successor = wire().replace('"web_search_requests":0', '"web_search_requests":1');
    responder = (_request, response) => { response.writeHead(requests.length === 1 ? 401 : 200, { 'content-type': 'text/event-stream' }); response.end(requests.length === 1 ? predecessor : successor); };
    refreshResponder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, ...(mode === 'missing-successor-rate' ? {} : { web_search_per_1000: '20' }) } })]));
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ access_token: 'sk-ant-oat-refreshed', refresh_token: 'dummy-rotated', expires_in: 3600 }));
    };
    const execution = new DefaultExecutor('claude').execute(args);
    try {
      await Promise.race([entered, execution.then(() => { throw new Error('returned before predecessor ACK'); })]);
      expect(refreshRequests).toHaveLength(0); expect(requests).toHaveLength(1); expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 20110250 });
    } finally { release(); }
    if (mode === 'delivered') {
      const result = await execution; expect(await result.response.text()).toBe(successor);
      expect(requests).toHaveLength(2); expect(refreshRequests).toHaveLength(1); expect(completeAttempt).toHaveBeenCalledTimes(2);
      expect(refreshRequests[0].rows).toEqual([{ state: 'settled', costNanoUsd: 20110250 }]);
      const attempts = db.all('SELECT attemptId,costNanoUsd,priceSnapshotJson,usageJson FROM apiKeyAccounting ORDER BY rowid');
      expect(attempts[1].attemptId).not.toBe(attempts[0].attemptId);
      expect(attempts.map(attempt => attempt.costNanoUsd)).toEqual([20110250, 20110250]);
      expect(attempts.map(attempt => JSON.parse(attempt.priceSnapshotJson).rates.web_search_per_1000)).toEqual(['10', '20']);
      expect(attempts.map(attempt => JSON.parse(attempt.usageJson).toolUses.webSearchRequests)).toEqual([2, 1]);
      expect(requests[1].headers.authorization).toBe('Bearer sk-ant-oat-refreshed');
    } else {
      await expect(execution).rejects.toThrow(); expect(requests).toHaveLength(1);
      expect(refreshRequests).toHaveLength(mode === 'lost-predecessor-ack' ? 0 : 1);
      expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1); expect(completeAttempt).toHaveBeenCalledTimes(1);
    }
    expect(failure).toBeNull();
  });
  it('paid OAuth server-only original history is retained without generated cache on server blocks', async () => {
    const args = options(await createAccounting()); args.body.tools.unshift({ type: 'web_search_20250305', name: 'web_search' });
    args.body.messages.unshift({ role: 'user', content: 'prior request' }, { role: 'assistant', content: [
      { type: 'server_tool_use', id: 'srvtoolu_history', name: 'web_search', input: { query: 'history query' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_history', content: [] },
    ] }, { role: 'user', content: 'next request' });
    const original = structuredClone(args.body);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, web_search_per_1000: '10' } })]));
    const result = await new DefaultExecutor('claude').execute(args); expect(await result.response.text()).toBe(wire());
    expect(requests[0].body.messages[1]).toEqual(original.messages[1]); expect(args.body).toEqual(original);
    expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 110250 });
    expect(JSON.parse(row().usageJson).toolUses).toEqual({ webSearchRequests: 0 });
  });
  it('paid OAuth missing explicit per-use rate refuses before intent, POST or refresh even with generated 1h rate present', async () => {
    const args = options(await createAccounting()); args.body.tools.unshift({ type: 'web_search_20250305', name: 'web_search' });
    await expect(new DefaultExecutor('claude').execute(args)).rejects.toMatchObject({ code: 'model_pricing_unavailable' });
    expect(requests).toHaveLength(0); expect(refreshRequests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
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
  it.each(['success', 'failed-http'])('documented OAuth initial cumulative usage with absent conditional tools: %s', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(...input) { const result = await context.completeAttempt(...input); enter(); await held; return result; } };
    const args = options(accounting);
    const raw = wire().replace('"output_tokens":0', '"output_tokens":2').replace(',"server_tool_use":{"web_search_requests":0}', '');
    responder = (_request, response) => { response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw); };
    const work = new DefaultExecutor('claude').execute(args); let finished = false;
    const consume = work.then(result => result.response.text()); consume.then(() => { finished = true; }, () => { finished = true; });
    try { await entered; expect(finished).toBe(false); expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 110250 }); }
    finally { release(); }
    if (mode === 'success') expect(await consume).toBe(raw);
    else { expect((await work).response.status).toBe(429); expect(await consume).not.toContain('msg_oauth'); }
    expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0); expect(JSON.parse(row().usageJson)).toMatchObject({ output: 20 });
    expect(failure).toBeNull();
  });
  it.each(['text-success', 'pdf-success', 'custom-success', 'text-failed-http', 'pdf-failed-http', 'custom-failed-http', 'foreign-index', 'missing-stop', 'lost-ack', 'custom-url-success', 'custom-url-failed-http', 'custom-url-missing-stop', 'custom-url-lost-ack'])('OAuth inline document citations %s retain original/raw/terminal authority', async rawMode => {
    const url = rawMode.startsWith('custom-url-'), mode = url ? rawMode.slice('custom-url-'.length) : rawMode;
    const context = await createAccounting(); let enter, persisted, release;
    const entered = new Promise(resolve => { enter = resolve; }), durable = new Promise(resolve => { persisted = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => {
      enter(); const result = await context.completeAttempt(...input); persisted(); await held;
      if (mode === 'lost-ack') throw new Error('fixture citation ACK lost');
      return result;
    }) };
    const args = options(accounting), pdf = mode.startsWith('pdf'), custom = url || mode.startsWith('custom');
    const document = { type: 'document', source: custom ? { type: 'content', content: [{ type: 'text', text: 'original citation document' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW5saW5l' } }] } : pdf ? { type: 'base64', media_type: 'application/pdf', data: 'aW5saW5l' } : { type: 'text', media_type: 'text/plain', data: 'original citation document' }, title: 'citation title', context: 'citation context', citations: { enabled: true } };
    if (url) document.source.content[1].source = { type: 'url', url: 'https://media.example.invalid/custom%20source.png?version=1' };
    args.body.messages[1].content.push(document); const original = structuredClone(args.body);
    const citation = { type: custom ? 'content_block_location' : pdf ? 'page_location' : 'char_location', document_index: mode === 'foreign-index' ? 1 : 0, document_title: 'citation title', cited_text: 'original citation', file_id: null,
      ...(custom ? { start_block_index: 0, end_block_index: 1 } : pdf ? { start_page_number: 1, end_page_number: 2 } : { start_char_index: 0, end_char_index: 8 }) };
    const content = event('content_block_start', { index: 0, content_block: { type: 'text', text: '', citations: [] } }) +
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'cited answer' } }) + event('content_block_delta', { index: 0, delta: { type: 'citations_delta', citation } }) + event('content_block_stop', { index: 0 });
    const raw = wire(mode === 'missing-stop' ? 'missing-stop' : undefined).replace('event: message_delta', content + 'event: message_delta');
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, input: '99' } })]));
      response.writeHead(mode.endsWith('failed-http') ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    const work = new DefaultExecutor('claude').execute(args); let finished = false, captured = '';
    const consume = work.then(async result => {
      const reader = result.response.body.getReader(), decoder = new TextDecoder();
      while (true) { const chunk = await reader.read(); if (chunk.done) break; captured += decoder.decode(chunk.value, { stream: true }); }
      return captured;
    });
    consume.then(() => { finished = true; }, () => { finished = true; });
    const reached = await Promise.race([entered.then(() => true), consume.then(() => false, () => false)]);
    try {
      expect(reached).toBe(true); await durable;
      if (mode === 'foreign-index' || mode === 'missing-stop') {
        // Local failure must not wait for foreign persistence acknowledgement.
        // The original unresolved winner still writes, with no synthetic success.
        await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); expect(finished).toBe(true);
      } else expect(finished).toBe(false);
      expect(captured).not.toContain('event: message_stop');
      expect(row()).toMatchObject(mode === 'foreign-index' || mode === 'missing-stop' ? { state: 'unresolved', costNanoUsd: null } : { state: 'settled', costNanoUsd: 110250 });
    } finally { release(); }
    if (['foreign-index', 'missing-stop', 'lost-ack'].includes(mode)) {
      await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); expect(captured).not.toContain('event: message_stop');
    } else if (mode.endsWith('failed-http')) { expect((await work).response.status).toBe(429); expect(await consume).not.toContain('original citation'); }
    else expect(await consume).toBe(raw);
    expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    const { cache_control: _cache, ...sent } = requests[0].body.messages[1].content[1]; expect(sent).toEqual(document);
    expect(requests[0].body.messages[0].content[0].name).toBe('lookup_ide'); expect(args.body).toEqual(original);
    expect(JSON.stringify(row())).not.toMatch(/original citation|citation title|citation context|media.example.invalid/); expect(failure).toBeNull();
  });
  it.each(['image-success', 'pdf-success', 'tool-image', 'pdf-failed-http', 'missing-stop', 'lost-ack', 'erased-source'])('OAuth URL reference %s retains original source and raw-only debit/own ACK', async mode => {
    const context = await createAccounting(); let enter, persisted, release;
    const entered = new Promise(resolve => { enter = resolve; }), durable = new Promise(resolve => { persisted = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { enter(); const result = await context.completeAttempt(...input); persisted(); await held;
      if (mode === 'lost-ack') throw new Error('fixture URL ACK lost'); return result;
    }) };
    const args = options(accounting), image = mode.startsWith('image') || mode === 'tool-image';
    const media = { type: image ? 'image' : 'document', source: { type: 'url', url: 'https://media.example.invalid/original%20asset?version=1' },
      ...(!image ? { title: 'URL title', context: 'URL context', citations: { enabled: true } } : {}) };
    if (mode === 'tool-image') args.body.messages[1].content[0].content = [{ type: 'text', text: 'original error' }, media];
    else args.body.messages[1].content.push(media);
    const original = structuredClone(args.body), executor = new DefaultExecutor('claude');
    if (mode === 'erased-source') {
      args.accounting = { ...accounting, beforeAttempt(meta, supported, value) {
        const changed = structuredClone(value), body = JSON.parse(changed.anthropicTransport.serializedBody);
        body.messages[1].content.pop(); changed.anthropicTransport.serializedBody = JSON.stringify(body);
        return context.beforeAttempt(meta, supported, changed);
      } };
      await expect(executor.execute(args)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); return;
    }
    const content = image ? '' : event('content_block_start', { index: 0, content_block: { type: 'text', text: '', citations: [] } }) +
      event('content_block_delta', { index: 0, delta: { type: 'citations_delta', citation: { type: 'page_location', document_index: 0, document_title: 'URL title', cited_text: 'URL cited text', start_page_number: 1, end_page_number: 2 } } }) + event('content_block_stop', { index: 0 });
    const raw = wire(mode === 'missing-stop' ? 'missing-stop' : undefined).replace('event: message_delta', content + 'event: message_delta');
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, input: '99' } })]));
      response.writeHead(mode === 'pdf-failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    const work = executor.execute(args); let finished = false, captured = '';
    const consume = work.then(async result => {
      const reader = result.response.body.getReader(), decoder = new TextDecoder();
      while (true) { const chunk = await reader.read(); if (chunk.done) break; captured += decoder.decode(chunk.value, { stream: true }); }
      return captured;
    });
    consume.then(() => { finished = true; }, () => { finished = true; });
    const reached = await Promise.race([entered.then(() => true), consume.then(() => false, () => false)]);
    try {
      expect(reached).toBe(true); await durable;
      if (mode === 'missing-stop') { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); expect(finished).toBe(true); }
      else expect(finished).toBe(false);
      expect(captured).not.toContain('event: message_stop');
      expect(row()).toMatchObject(mode === 'missing-stop' ? { state: 'unresolved', costNanoUsd: null } : { state: 'settled', costNanoUsd: 110250 });
    } finally { release(); }
    if (['missing-stop', 'lost-ack'].includes(mode)) { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); expect(captured).not.toContain('event: message_stop'); }
    else if (mode === 'pdf-failed-http') { expect((await work).response.status).toBe(429); expect(await consume).not.toContain('URL cited text'); }
    else expect(await consume).toBe(raw);
    expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(args.body).toEqual(original);
    if (mode === 'tool-image') expect(requests[0].body.messages[1].content[0]).toMatchObject({ is_error: true, content: original.messages[1].content[0].content });
    else { const { cache_control: _cache, ...sent } = requests[0].body.messages[1].content[1]; expect(sent).toEqual(media); }
    expect(requests[0].body.messages[0].content[0].name).toBe('lookup_ide');
    expect(JSON.stringify(row())).not.toMatch(/media.example.invalid|URL title|URL context|URL cited text/); expect(failure).toBeNull();
  });
  it.each(['success', 'failed-http', 'missing-stop', 'lost-ack', 'erased-source'])('OAuth client RAG %s preserves original tool source and raw-only settlement', async mode => {
    const context = await createAccounting(); let enter, persisted, release;
    const entered = new Promise(resolve => { enter = resolve; }), durable = new Promise(resolve => { persisted = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { enter(); const result = await context.completeAttempt(...input); persisted(); await held;
      if (mode === 'lost-ack') throw new Error('fixture RAG ACK lost'); return result;
    }) };
    const args = options(accounting), source = { type: 'search_result', source: 'kb://original/item', title: 'RAG title', content: [{ type: 'text', text: 'original RAG chunk' }], citations: { enabled: true } };
    args.body.messages[1].content[0].content = [source]; const original = structuredClone(args.body);
    if (mode === 'erased-source') {
      args.accounting = { ...accounting, beforeAttempt(meta, supported, value) {
        const changed = structuredClone(value), body = JSON.parse(changed.anthropicTransport.serializedBody);
        body.messages[1].content[0].content[0].source = 'kb://foreign/item'; changed.anthropicTransport.serializedBody = JSON.stringify(body);
        return context.beforeAttempt(meta, supported, changed);
      } };
      await expect(new DefaultExecutor('claude').execute(args)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); return;
    }
    const citation = { type: 'search_result_location', source: source.source, title: source.title, cited_text: 'original RAG chunk', search_result_index: 0, start_block_index: 0, end_block_index: 1 };
    const raw = wire(mode === 'missing-stop' ? 'missing-stop' : undefined).replace('event: message_delta', event('content_block_start', { index: 0, content_block: { type: 'text', text: '', citations: [] } }) +
      event('content_block_delta', { index: 0, delta: { type: 'citations_delta', citation } }) + event('content_block_stop', { index: 0 }) + 'event: message_delta');
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='claude'", [JSON.stringify({ 'fixture-oauth': { ...rates, input: '99' } })]));
      response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    const work = new DefaultExecutor('claude').execute(args); let finished = false, captured = '';
    const consume = work.then(async result => { const reader = result.response.body.getReader(), decoder = new TextDecoder();
      while (true) { const chunk = await reader.read(); if (chunk.done) break; captured += decoder.decode(chunk.value, { stream: true }); } return captured;
    });
    consume.then(() => { finished = true; }, () => { finished = true; });
    const reached = await Promise.race([entered.then(() => true), consume.then(() => false, () => false)]);
    try { expect(reached).toBe(true); await durable;
      if (mode === 'missing-stop') { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); expect(finished).toBe(true); }
      else expect(finished).toBe(false);
      expect(captured).not.toContain('event: message_stop');
      expect(row()).toMatchObject(mode === 'missing-stop' ? { state: 'unresolved', costNanoUsd: null } : { state: 'settled', costNanoUsd: 110250 });
    } finally { release(); }
    if (['missing-stop', 'lost-ack'].includes(mode)) await expect(consume).rejects.toThrow('Gateway accounting stream unavailable');
    else if (mode === 'failed-http') { expect((await work).response.status).toBe(429); expect(await consume).not.toContain('original RAG chunk'); }
    else expect(await consume).toBe(raw);
    expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(args.body).toEqual(original);
    expect(requests[0].body.messages[1].content[0]).toMatchObject({ is_error: true, content: [source] }); expect(requests[0].body.messages[0].content[0].name).toBe('lookup_ide');
    expect(JSON.stringify(row())).not.toMatch(/kb:\/\/|RAG title|original RAG chunk/); expect(failure).toBeNull();
  });
  it.each(['delivered', 'erased-history'])('OAuth original citation history %s retains replay bytes and terminal authority', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { const result = await context.completeAttempt(...input); enter(); await held; return result; }) };
    const args = options(accounting), citation = { type: 'char_location', document_index: 0, document_title: 'replay title', cited_text: 'replay source', start_char_index: 0, end_char_index: 6 };
    args.body.messages = [{ role: 'user', content: [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'replay source' }, title: 'replay title', citations: { enabled: true } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'replay answer', citations: [citation] }] }, { role: 'user', content: 'continue' }];
    const original = structuredClone(args.body);
    if (mode === 'erased-history') args.accounting = { ...accounting, beforeAttempt(meta, supported, value) {
      const changed = structuredClone(value), body = JSON.parse(changed.anthropicTransport.serializedBody);
      delete body.messages[1].content[0].citations; changed.anthropicTransport.serializedBody = JSON.stringify(body);
      return context.beforeAttempt(meta, supported, changed);
    } };
    const work = new DefaultExecutor('claude').execute(args), consume = work.then(result => result.response.text());
    consume.catch(() => {});
    if (mode === 'erased-history') { await expect(consume).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); return; }
    let finished = false; consume.then(() => { finished = true; }, () => { finished = true; });
    const reached = await Promise.race([entered.then(() => true), consume.then(() => false, () => false)]);
    try { expect(reached).toBe(true); expect(finished).toBe(false); expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 110250 }); }
    finally { release(); }
    expect(await consume).toBe(wire()); expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0);
    expect(requests[0].body.messages[1].content[0].citations).toEqual([citation]); expect(args.body).toEqual(original);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(JSON.stringify(row())).not.toMatch(/replay title|replay source|replay answer/); expect(failure).toBeNull();
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
  it.each(['delivered', 'terminal-drift', 'lost-ack'])('opaque original redacted history %s keeps actual bytes and own terminal authority', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(...input) { const terminal = await context.completeAttempt(...input); enter(); await held;
      if (mode === 'lost-ack') throw new Error('fixture lost ACK'); return terminal;
    }, assertClaudeOauthTerminal(attempt, terminal) {
      if (mode === 'terminal-drift') db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ accessToken: 'sk-ant-oat-rotated' })]));
      return context.assertClaudeOauthTerminal(attempt, terminal);
    } };
    const args = options(accounting); args.body.thinking = { type: 'adaptive' };
    args.body.messages[0].content.unshift({ type: 'redacted_thinking', data: 'opaque-original🙂' }); const original = structuredClone(args.body);
    const raw = wire().replace('event: message_delta', event('content_block_start', { index: 0, content_block: { type: 'redacted_thinking', data: 'opaque-response' } }) +
      event('content_block_stop', { index: 0 }) + 'event: message_delta');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(raw); };
    const result = await new DefaultExecutor('claude').execute(args); let finished = false;
    const consume = result.response.text(); consume.then(() => { finished = true; }, () => { finished = true; });
    try { await entered; expect(finished).toBe(false); expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 110250 }); }
    finally { release(); }
    if (mode === 'delivered') expect(await consume).toBe(raw); else await expect(consume).rejects.toThrow('Gateway accounting stream unavailable');
    expect(args.body).toEqual(original); expect(requests).toHaveLength(1); expect(refreshRequests).toHaveLength(0);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
    expect(requests[0].body.messages[0].content[0]).toEqual(original.messages[0].content[0]);
    expect(JSON.stringify(row())).not.toMatch(/opaque-original|opaque-response/);
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
