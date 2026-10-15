import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultExecutor } from 'open-sse/executors/default.js';
import { dynamicTools, dynamicWire, dynamicPausedHistory } from './fixtures/accounting-dynamic-wire.js';
import { fetchTool, fetchWire, fetchHistory } from './fixtures/accounting-fetch-wire.js';
import anthropicRegistry from 'open-sse/providers/registry/anthropic.js';

const fixture = vi.hoisted(() => ({ url: null }));
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, get anthropic() { return { ...original.PROVIDERS.anthropic, baseUrl: fixture.url }; } } };
});
vi.mock('../../open-sse/config/accountedAnthropicCandidate.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, get ACCOUNTED_ANTHROPIC_CANDIDATE_URL() { return fixture.url; },
    supportsAnthropicCandidate(executor, options, url, body, headers) {
      return url === fixture.url && original.supportsAnthropicCandidate(executor, options, original.ACCOUNTED_ANTHROPIC_CANDIDATE_URL, body, headers);
    } };
});
vi.mock('../../src/lib/db/engineAcquisition.js', async importOriginal => {
  const original = await importOriginal();
  return process.env.ACCOUNTING_TEST_SQLJS === '1' ? { ...original, initializeAvailableAdapter: async () => null } : original;
});
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const wire = ({ count = 2, stop = 'end_turn', omit = false } = {}) => event('message_start', { message: { id: 'msg_search', type: 'message', role: 'assistant', model: 'fixture-search', content: [],
  usage: { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 } } }) +
  event('content_block_start', { index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_owned', name: 'web_search', input: {} } }) +
  event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"private fixture query"}' } }) + event('content_block_stop', { index: 0 }) +
  (stop === 'pause_turn' ? '' : event('content_block_start', { index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_owned', content: [{ type: 'web_search_result', url: 'https://example.com/source', title: 'private source title', encrypted_content: 'private opaque corpus' }] } }) + event('content_block_stop', { index: 1 })) +
  event('message_delta', { delta: { stop_reason: stop }, usage: { input_tokens: 60, output_tokens: 20, ...(omit ? {} : { server_tool_use: { web_search_requests: count } }) } }) + event('message_stop');
const rates = (rate = '10') => ({ 'fixture-search': { input: '1', output: '2', cached: '0.1', cache_creation: '1.25', ...(rate === null ? {} : { web_search_per_1000: rate }) } });
const options = accounting => ({ model: 'fixture-search', stream: true, accountingMode: 'native-claude-beta-sse', connectionId: 'c', accounting,
  body: { model: 'fixture-search', stream: true, max_tokens: 100, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }], messages: [{ role: 'user', content: 'original private prompt' }] },
  credentials: { apiKey: 'dummy-provider' }, proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
let db, directory, server, requests, failure, responder, createAccounting;
const previous = process.env.DATA_DIR;
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-paid-search-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  if (process.env.ACCOUNTING_TEST_SQLJS === '1') expect(db.driver).toBe('sql.js');
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'anthropic', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','anthropic',?)", [JSON.stringify(rates())]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ body: JSON.parse(Buffer.concat(chunks).toString()), beta: request.headers['anthropic-beta'],
        pending: db.get('SELECT state,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid DESC LIMIT 1') });
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
describe('queued API-key direct paid-search original intent/POST/raw debit/own ACK slice (owned HTTP only)', { timeout: 20000 }, () => {
  it.each(['success', 'failed-http', 'combined-fetch', 'missing-code', 'lost-ack'])('dynamic API-key %s preserves original code/search authority/raw price/own ACK', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => {
      const terminal = await context.completeAttempt(...input); enter(); if (['success', 'failed-http', 'combined-fetch'].includes(mode)) await held;
      if (mode === 'lost-ack') throw new Error('fixture dynamic ACK lost'); return terminal;
    }) };
    const args = options(accounting); args.accountingMode = 'native-claude-dynamic-sse'; args.body.tools = dynamicTools();
    if (mode === 'combined-fetch') args.body.tools.push({ type: 'web_fetch_20260318', name: 'web_fetch', citations: { enabled: true } });
    const original = structuredClone(args.body), raw = dynamicWire('fixture-search', { omit: mode === 'missing-code', fetch: mode === 'combined-fetch' });
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify(rates('200'))]));
      response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    let ended = false; const consume = new DefaultExecutor('anthropic').execute(args).then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (['success', 'failed-http', 'combined-fetch'].includes(mode)) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('ended before own ACK'); })]); expect(ended).toBe(false); } finally { release(); }
      if (mode === 'failed-http') expect(await consume).not.toContain('private opaque'); else expect(await consume).toBe(raw);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original); expect(requests[0].pending.state).toBe('pending');
    expect(JSON.parse(requests[0].pending.priceSnapshotJson).usageSemantics).toMatchObject({ codeServerToolUses: 'observed_claude_included_code_token_only', serverToolUses: 'observed_claude_server_tool_use' });
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting');
    expect(row).toMatchObject({ state: mode === 'missing-code' ? 'unresolved' : 'settled', costNanoUsd: mode === 'missing-code' ? null : 20116500 });
    if (mode !== 'missing-code') expect(JSON.parse(row.usageJson).codeToolUses).toEqual({ codeExecutionRequests: 3 });
    expect(JSON.stringify(row)).not.toMatch(/private|example.com|dummy-provider/); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['missing-token-price', 'missing-search-rate', 'erased-original', 'standalone-duration'])('dynamic admission %s is refused before intent/POST without erasing work', async mode => {
    const args = options(await createAccounting()), executor = new DefaultExecutor('anthropic'); args.accountingMode = 'native-claude-dynamic-sse'; args.body.tools = dynamicTools();
    if (mode === 'missing-token-price') db.durableTransaction(() => db.run("DELETE FROM kv WHERE scope='pricing' AND key='anthropic'"));
    if (mode === 'missing-search-rate') db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify(rates(null))]));
    if (mode === 'erased-original') vi.spyOn(executor, 'transformRequest').mockImplementation((_model, body) => { body.tools = []; return body; });
    if (mode === 'standalone-duration') args.body.tools = [{ type: 'code_execution_20260120', name: 'code_execution' }];
    await expect(executor.execute(args)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it.each(['unclean-eof', 'sink-exception'])('dynamic terminal %s cannot fabricate exact usage or durable ACK', async mode => {
    const context = await createAccounting(), accounting = { ...context, completeAttempt: vi.fn((...input) => {
      if (mode === 'sink-exception') throw new Error('fixture dynamic sink exception'); return context.completeAttempt(...input);
    }) };
    const args = options(accounting); args.accountingMode = 'native-claude-dynamic-sse'; args.body.tools = dynamicTools();
    const raw = dynamicWire('fixture-search'); responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(mode === 'unclean-eof' ? raw.replace(/event: message_stop[\s\S]*$/, '') : raw); };
    const result = await new DefaultExecutor('anthropic').execute(args); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(requests).toHaveLength(1); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: mode === 'sink-exception' ? 'pending' : 'unresolved', costNanoUsd: null }); expect(failure).toBeNull();
  });
  it('dynamic pause retains pending parent; explicit successor binds preceding original graph and fresh price/count/intent', async () => {
    const context = await createAccounting(), executor = new DefaultExecutor('anthropic'), firstArgs = options(context);
    firstArgs.accountingMode = 'native-claude-dynamic-sse'; firstArgs.body.tools = dynamicTools();
    const paused = dynamicWire('fixture-search', { pause: true, prefix: 'paused' });
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(paused); };
    expect(await (await executor.execute(firstArgs)).response.text()).toBe(paused); expect(requests).toHaveLength(1);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify(rates('20'))]));
    const next = options(context); next.accountingMode = 'native-claude-dynamic-sse'; next.body.tools = dynamicTools();
    next.body.messages.push({ role: 'assistant', content: dynamicPausedHistory('fixture-search') }, { role: 'user', content: 'Continue private original work' });
    const original = structuredClone(next.body), raw = dynamicWire('fixture-search', { resume: true, prefix: 'successor', searchCount: 1, codeCount: 1 });
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(raw); };
    expect(await (await executor.execute(next)).response.text()).toBe(raw); expect(requests).toHaveLength(2); expect(requests[1].body).toEqual(original);
    const rows = db.all('SELECT requestId,attemptId,state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid');
    expect(rows.map(value => value.costNanoUsd)).toEqual([20116500, 20116500]); expect(new Set(rows.map(value => value.attemptId)).size).toBe(2);
    expect(rows.every(value => value.requestId === context.requestId && value.state === 'settled')).toBe(true);
    expect(rows.map(value => JSON.parse(value.usageJson).codeToolUses.codeExecutionRequests)).toEqual([3, 1]);
    expect(rows.map(value => JSON.parse(value.usageJson).toolUses.webSearchRequests)).toEqual([2, 1]);
    expect(rows.map(value => JSON.parse(value.priceSnapshotJson).rates.web_search_per_1000)).toEqual(['10', '20']); expect(failure).toBeNull();
  });
  it.each(['success', 'failed-http', 'combined-search', 'missing-counter', 'lost-ack'])('direct fetch API-key %s binds original intent/counter/citation/token price and own ACK', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => {
      const terminal = await context.completeAttempt(...args); enter();
      if (['success', 'failed-http', 'combined-search'].includes(mode)) await held;
      if (mode === 'lost-ack') throw new Error('fixture fetch ACK lost'); return terminal;
    }) };
    const args = options(accounting); args.body.tools = mode === 'combined-search' ? [...args.body.tools, fetchTool()] : [fetchTool()];
    args.body.messages = [{ role: 'user', content: 'Read https://example.com/article' }]; const original = structuredClone(args.body);
    const raw = fetchWire('fixture-search', { omit: mode === 'missing-counter', search: mode === 'combined-search' });
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-search': { input: '9', output: '9', cached: '9', cache_creation: '9', web_search_per_1000: '200' } })]));
      response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    const execution = new DefaultExecutor('anthropic').execute(args); let ended = false;
    const consume = execution.then(result => result.response.text()); consume.then(() => { ended = true; }, () => { ended = true; });
    if (['success', 'failed-http', 'combined-search'].includes(mode)) {
      try { await Promise.race([entered, consume.then(() => { throw new Error('ended before held own ACK'); })]); expect(ended).toBe(false); }
      finally { release(); }
      if (mode === 'failed-http') expect(await consume).not.toContain('private fetched corpus'); else expect(await consume).toBe(raw);
    } else { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); await entered; }
    expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original); expect(requests[0].pending.state).toBe('pending');
    const snapshot = JSON.parse(requests[0].pending.priceSnapshotJson);
    expect(snapshot.usageSemantics.nonBillableServerToolUses).toBe('observed_claude_web_fetch_token_only');
    if (mode === 'combined-search') expect(snapshot.usageSemantics.serverToolUses).toBe('observed_claude_server_tool_use');
    const row = db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson FROM apiKeyAccounting');
    expect(row).toMatchObject({ state: mode === 'missing-counter' ? 'unresolved' : 'settled', costNanoUsd: mode === 'missing-counter' ? null : mode === 'combined-search' ? 20116500 : 116500 });
    if (mode !== 'missing-counter') expect(JSON.parse(row.usageJson).nonBillableToolUses).toEqual({ webFetchRequests: 3 });
    expect(JSON.stringify(row)).not.toMatch(/private|example.com|dummy-provider/); expect(args.body).toEqual(original);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['ordinary', 'erasure', 'dynamic', 'missing-token-price'])('fetch pre-intent %s cannot acquire original/raw/snapshot authority', async mode => {
    const args = options(await createAccounting()), executor = new DefaultExecutor('anthropic'); args.body.tools = [fetchTool()];
    if (mode === 'ordinary') args.accountingMode = 'native-claude-sse';
    if (mode === 'erasure') vi.spyOn(executor, 'transformRequest').mockImplementation((_model, body) => { delete body.tools; return body; });
    if (mode === 'dynamic') args.body.tools[0].type = 'web_fetch_20260209';
    if (mode === 'missing-token-price') db.durableTransaction(() => db.run("DELETE FROM kv WHERE scope='pricing' AND key='anthropic'"));
    await expect(executor.execute(args)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it.each(['error-zero', 'unclean-eof', 'sink-exception'])('fetch terminal %s does not infer count/skip clean EOF or own durable ACK', async mode => {
    const context = await createAccounting();
    const accounting = { ...context, completeAttempt: vi.fn((...input) => { if (mode === 'sink-exception') throw new Error('fixture fetch sink exception'); return context.completeAttempt(...input); }) };
    const args = options(accounting); args.body.tools = [fetchTool()];
    const raw = fetchWire('fixture-search', { error: mode === 'error-zero', count: mode === 'error-zero' ? 0 : 3 });
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(mode === 'unclean-eof' ? raw.replace(/event: message_stop[\s\S]*$/, '') : raw); };
    const result = await new DefaultExecutor('anthropic').execute(args);
    if (mode === 'error-zero') expect(await result.response.text()).toBe(raw); else await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(requests).toHaveLength(1); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    const row = db.get('SELECT state,costNanoUsd,usageJson FROM apiKeyAccounting');
    expect(row).toMatchObject({ state: mode === 'sink-exception' ? 'pending' : mode === 'unclean-eof' ? 'unresolved' : 'settled', costNanoUsd: mode === 'error-zero' ? 116500 : null });
    if (mode === 'error-zero') expect(JSON.parse(row.usageJson).nonBillableToolUses).toEqual({ webFetchRequests: 0 }); expect(failure).toBeNull();
  });
  it('fetch pause has no auto successor; explicit generation gets fresh token price and preceding fetched document index', async () => {
    const context = await createAccounting(), executor = new DefaultExecutor('anthropic'), firstArgs = options(context); firstArgs.body.tools = [fetchTool()];
    const paused = fetchWire('fixture-search', { stop: 'pause_turn' });
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(paused); };
    expect(await (await executor.execute(firstArgs)).response.text()).toBe(paused); expect(requests).toHaveLength(1);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-search': { ...rates()['fixture-search'], input: '2' } })]));
    const nextArgs = options(context); nextArgs.body.tools = [fetchTool()]; nextArgs.body.messages.push({ role: 'assistant', content: fetchHistory() }, { role: 'user', content: 'Read https://example.com/article again' });
    const original = structuredClone(nextArgs.body), raw = fetchWire('fixture-search', { id: 'srvtoolu_fetch_successor', count: 1, documentIndex: 1 });
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(raw); };
    expect(await (await executor.execute(nextArgs)).response.text()).toBe(raw); expect(requests[1].body).toEqual(original);
    const rows = db.all('SELECT attemptId,requestId,state,costNanoUsd,usageJson FROM apiKeyAccounting ORDER BY rowid');
    expect(rows.map(row => row.costNanoUsd)).toEqual([116500, 176500]); expect(new Set(rows.map(row => row.attemptId)).size).toBe(2);
    expect(rows.every(row => row.requestId === context.requestId && row.state === 'settled')).toBe(true);
    expect(rows.map(row => JSON.parse(row.usageJson).nonBillableToolUses.webFetchRequests)).toEqual([3, 1]); expect(failure).toBeNull();
  });
  it.each(['success', 'failed-http', 'pause'])('%s retains actual wire, original per-use units/count marker and own ACK; no automatic successor', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const result = await context.completeAttempt(...args); enter(); await held; return result; }) };
    const args = options(accounting), original = structuredClone(args.body), raw = wire({ stop: mode === 'pause' ? 'pause_turn' : 'end_turn' });
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify(rates('200'))]));
      response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    // Failed HTTP execution itself waits for own ACK; consume concurrently so
    // the held terminal promise does not deadlock before the ACK assertion.
    const execution = new DefaultExecutor('anthropic').execute(args); let ended = false;
    const consume = execution.then(result => result.response.text()).then(text => { ended = true; return text; });
    try {
      await entered; expect(ended).toBe(false); expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual(original); expect(requests[0].beta).toBe(anthropicRegistry.transport.headers['Anthropic-Beta']);
      expect(requests[0].pending.state).toBe('pending');
      expect(JSON.parse(requests[0].pending.priceSnapshotJson)).toMatchObject({ rates: { web_search_per_1000: '10' }, rateUnits: { web_search_per_1000: 'USD/1000 uses' }, usageSemantics: { serverToolUses: 'observed_claude_server_tool_use' } });
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 20116500 }]);
    } finally { release(); await consume; }
    if (mode === 'failed-http') expect(await consume).not.toContain('private opaque corpus'); else expect(await consume).toBe(raw);
    expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(failure).toBeNull();
    const row = db.get('SELECT usageJson,priceSnapshotJson FROM apiKeyAccounting');
    expect(JSON.parse(row.usageJson)).toMatchObject({ toolUses: { webSearchRequests: 2 }, provenance: { serverToolUses: 'observed_claude_server_tool_use' } });
    expect(JSON.stringify(row)).not.toMatch(/private|opaque|query|dummy-provider/);
  });
  it('missing per-use rate yields pricing refusal before intent/POST, including unlimited policy', async () => {
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify(rates(null))]));
    const accounting = await createAccounting();
    await expect(new DefaultExecutor('anthropic').execute(options(accounting))).rejects.toMatchObject({ code: 'model_pricing_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('explicit zero per-use rate remains priced and observed counters remain present', async () => {
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify(rates('0'))]));
    const result = await new DefaultExecutor('anthropic').execute(options(await createAccounting()));
    expect(await result.response.text()).toBe(wire());
    expect(requests).toHaveLength(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 116500 }]);
    expect(JSON.parse(db.get('SELECT usageJson FROM apiKeyAccounting').usageJson).toolUses).toEqual({ webSearchRequests: 2 });
  });
  it('combined 1h cache/tool requirement preserves both original markers and separate rate', async () => {
    const priced = { ...rates()['fixture-search'], cache_creation_1h: '2' };
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-search': priced })]));
    const args = options(await createAccounting());
    args.body.tools[0].cache_control = { type: 'ephemeral', ttl: '1h' };
    const raw = wire().replace('"cache_creation_input_tokens":10', '"cache_creation_input_tokens":10,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":10}');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(raw); };
    const result = await new DefaultExecutor('anthropic').execute(args); expect(await result.response.text()).toBe(raw);
    const row = db.get('SELECT state,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting');
    expect(row).toMatchObject({ state: 'settled', costNanoUsd: 20124000 });
    expect(JSON.parse(row.priceSnapshotJson).usageSemantics).toEqual({ cacheWriteTiers: 'observed_5m_1h', serverToolUses: 'observed_claude_server_tool_use' });
  });
  it.each(['ordinary', 'erasure', 'dynamic'])('%s does not acquire paid original intent or POST authority', async mode => {
    const args = options(await createAccounting()), executor = new DefaultExecutor('anthropic');
    if (mode === 'ordinary') args.accountingMode = 'native-claude-sse';
    if (mode === 'erasure') vi.spyOn(executor, 'transformRequest').mockImplementation((_model, body) => { delete body.tools; return body; });
    if (mode === 'dynamic') args.body.tools = [{ type: 'web_search_20260209', name: 'web_search' }];
    await expect(executor.execute(args)).rejects.toThrow();
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it('explicit pause continuation creates fresh intent and price; prior query/result history is not billed again', async () => {
    const context = await createAccounting(), args = options(context), executor = new DefaultExecutor('anthropic');
    const paused = wire({ stop: 'pause_turn' });
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(paused); };
    expect(await (await executor.execute(args)).response.text()).toBe(paused);
    expect(requests).toHaveLength(1);
    const prior = db.get('SELECT attemptId,priceSnapshotJson FROM apiKeyAccounting');
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify(rates('20'))]));
    // Operator submits continuation; no engine automatic/free retry. Deferred
    // server ID is carried only by original history, not global stream state.
    args.body.messages.push({ role: 'assistant', content: [{ type: 'server_tool_use', id: 'srvtoolu_owned', name: 'web_search', input: { query: 'private fixture query' } }] });
    const original = structuredClone(args.body);
    const resumed = event('message_start', { message: { id: 'msg_resume', type: 'message', role: 'assistant', model: 'fixture-search', content: [], usage: { input_tokens: 60, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 } } }) +
      event('content_block_start', { index: 0, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_owned', content: [] } }) + event('content_block_stop', { index: 0 }) +
      event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20, server_tool_use: { web_search_requests: 1 } } }) + event('message_stop');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(resumed); };
    expect(await (await executor.execute(args)).response.text()).toBe(resumed);
    expect(requests).toHaveLength(2); expect(requests[1].body).toEqual(original); expect(requests[1].pending.state).toBe('pending');
    const attempts = db.all('SELECT attemptId,state,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting ORDER BY rowid');
    expect(attempts.map(row => [row.state, row.costNanoUsd])).toEqual([['settled', 20116500], ['settled', 20116500]]);
    expect(attempts[0].attemptId).toBe(prior.attemptId); expect(attempts[1].attemptId).not.toBe(prior.attemptId);
    expect(attempts[0].priceSnapshotJson).toBe(prior.priceSnapshotJson);
    expect(JSON.parse(attempts[1].priceSnapshotJson).rates.web_search_per_1000).toBe('20');
    expect(failure).toBeNull();
  });
  it.each(['lost-ack', 'credential-drift', 'sink-error'])('%s blocks successful terminal without successor/duplicate debit', async mode => {
    const context = await createAccounting(); let entered;
    const sink = new Promise(resolve => { entered = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => {
      if (mode === 'sink-error') { entered(); throw new Error('fixture persistence unavailable'); }
      const terminal = await context.completeAttempt(...args);
      if (mode === 'credential-drift') db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated' })]));
      entered(); if (mode === 'lost-ack') throw new Error('fixture ACK not delivered'); return terminal;
    }) };
    const result = await new DefaultExecutor('anthropic').execute(options(accounting));
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await sink;
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: mode === 'sink-error' ? 'pending' : 'settled', costNanoUsd: mode === 'sink-error' ? null : 20116500 }]);
    expect(failure).toBeNull();
  });
  it('tool error with explicit observed zero is not inferred from error/result and still charges tokens', async () => {
    const raw = wire({ count: 0 }).replace('[{"type":"web_search_result","url":"https://example.com/source","title":"private source title","encrypted_content":"private opaque corpus"}]', '{"type":"web_search_tool_result_error","error_code":"max_uses_exceeded"}');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(raw); };
    const result = await new DefaultExecutor('anthropic').execute(options(await createAccounting())); expect(await result.response.text()).toBe(raw);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 116500 }]);
    expect(JSON.parse(db.get('SELECT usageJson FROM apiKeyAccounting').usageJson).toolUses).toEqual({ webSearchRequests: 0 });
    expect(requests).toHaveLength(1);
  });
  it('missing terminal counter leaves unresolved rather than guessing from call/result/max_uses', async () => {
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire({ omit: true })); };
    const result = await new DefaultExecutor('anthropic').execute(options(await createAccounting()));
    await expect(result.response.text()).rejects.toThrow();
    expect(requests).toHaveLength(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
  });
});
