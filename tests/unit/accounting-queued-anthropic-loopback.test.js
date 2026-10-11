import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultExecutor } from 'open-sse/executors/default.js';

const fixture = vi.hoisted(() => ({ url: null }));
// Standard-only fixed owned route from test modules. No production beta strip,
// arbitrary endpoint exception, registry mutation or native fetch mock.
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, get anthropic() { return { ...original.PROVIDERS.anthropic, baseUrl: fixture.url, headers: { 'anthropic-version': '2023-06-01' } }; } } };
});
vi.mock('../../open-sse/config/accountedAnthropicCandidate.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, get ACCOUNTED_ANTHROPIC_CANDIDATE_URL() { return fixture.url; },
    supportsAnthropicCandidate(executor, options, url, body, headers) {
      return url === fixture.url && original.supportsAnthropicCandidate(executor, options, original.ACCOUNTED_ANTHROPIC_CANDIDATE_URL, body, headers);
    } };
});
let db, directory, server, requests, failure, responder, createAccounting;
const old = process.env.DATA_DIR;
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const responseWire = () => event('message_start', { message: { type: 'message', id: 'msg_fixture', role: 'assistant', model: 'fixture-native', content: [],
  usage: { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0 } } } }) +
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + event('message_stop');
const liveToolWire = (mode = 'valid') => responseWire().replace('event: message_delta',
  event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tool_fixture', name: 'fixture_lookup', input: {} } }) +
  event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: mode === 'malformed' ? '{' : '{"query":"đúng🙂"}' } }) +
  event('content_block_stop', { index: 0 }) + 'event: message_delta').replace('"stop_reason":"end_turn"', '"stop_reason":"tool_use"');
const liveToolOptions = accounting => {
  const args = options(accounting); args.body.stream = true; args.accountingMode = 'native-claude-sse';
  args.body.tools = [{ name: 'fixture_lookup', input_schema: { type: 'object', properties: { query: { type: 'string' } } } }];
  args.body.tool_choice = { type: 'auto' }; return args;
};
const historyOptions = accounting => {
  const args = liveToolOptions(accounting);
  args.body.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'lookup' },
    { type: 'tool_use', id: 'tool_fixture', name: 'fixture_lookup', input: { query: 'đúng🙂' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_fixture', is_error: true,
    content: [{ type: 'text', text: 'fixture error text🙂' }] }, { type: 'text', text: 'continue' }] });
  return args;
};
const options = accounting => ({ model: 'fixture-native', stream: true, body: { model: 'fixture-native', stream: false, messages: [{ role: 'user', content: 'fixture' }], max_tokens: 100 },
  credentials: { apiKey: 'dummy-provider' }, connectionId: 'c', accountingMode: 'buffered-claude-sse', accounting,
  proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-native-messages-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'anthropic', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','anthropic',?)", [JSON.stringify({ 'fixture-native': { input: '1', output: '2', cached: '0.1', cache_creation: '1.25' } })]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(responseWire()); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ method: request.method, key: request.headers['x-api-key'], accept: request.headers.accept, version: request.headers['anthropic-version'], beta: request.headers['anthropic-beta'], url: request.url,
        body: JSON.parse(Buffer.concat(chunks).toString()), row: db.get('SELECT requestId,state FROM apiKeyAccounting ORDER BY rowid DESC LIMIT 1') });
      await responder(request, response);
    } catch (error) { failure = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture failure' })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.url = `http://127.0.0.1:${server.address().port}/v1/messages`;
  // Executor module collection precedes owned DB/listener setup. Do not leave
  // a cold import continuing past a timed-out hook into the next fixture.
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/messages', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); vi.unstubAllEnvs(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
});
describe('native HTTP Messages standard fixture (not production beta/OAuth/TLS acceptance)', { timeout: 20000 }, () => {
  it('actual original POST owns pending and original106500 price after upstream pricing edit', async () => {
    const context = await createAccounting(), args = options(context);
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(Reflect.set(wire.headers, 'x-api-key', 'dummy-changed')).toBe(false);
      const work = context.beforeAttempt(meta, supported, wire); args.credentials.apiKey = 'dummy-changed'; args.body.messages[0].content = 'changed'; return work;
    } };
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-native': { input: '9', output: '9', cached: '9', cache_creation: '9' } })]));
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(responseWire());
    };
    const result = await new DefaultExecutor('anthropic').execute({ ...args, accounting });
    expect(await result.response.text()).toBe(responseWire()); expect(failure).toBeNull(); expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ method: 'POST', key: 'dummy-provider', accept: 'text/event-stream', version: '2023-06-01', beta: undefined, url: '/v1/messages',
      body: { model: 'fixture-native', stream: true, messages: [{ role: 'user', content: 'fixture' }], max_tokens: 100 }, row: { requestId: context.requestId, state: 'pending' } });
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('buffered native result cannot return before own queued terminal ACK', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    let returned = false; const work = new DefaultExecutor('anthropic').execute(options(accounting)).then(value => { returned = true; return value; });
    try { await entered; expect(returned).toBe(false); expect(requests).toHaveLength(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]); }
    finally { release(); }
    expect((await work).response.ok).toBe(true); expect(failure).toBeNull();
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
  });
  it('persisted credential drift at dequeue refuses native POST/intent', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-new' }), 'c']); }); return work;
    } };
    await expect(new DefaultExecutor('anthropic').execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('live Messages terminal delta/stop waits for own queued ACK while initial event passes', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    const args = options(accounting); args.body.stream = true; args.accountingMode = 'native-claude-sse';
    const result = await new DefaultExecutor('anthropic').execute(args);
    let delivered = '', ended = false;
    const consume = (async () => { const reader = result.response.body.getReader(), decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); } delivered += decoder.decode(); ended = true; }
      finally { reader.releaseLock(); }
    })();
    try {
      await entered; expect(ended).toBe(false); expect(delivered).toContain('event: message_start');
      expect(delivered).not.toContain('event: message_delta'); expect(delivered).not.toContain('event: message_stop');
      expect(requests).toHaveLength(1); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' }); expect(requests[0].body.stream).toBe(true);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } finally { release(); }
    await consume; expect(delivered).toBe(responseWire()); expect(failure).toBeNull();
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('live Messages EOF without stop errors delivery then separately observes own unresolved ACK', async () => {
    const context = await createAccounting(); let acknowledged;
    const ack = new Promise(resolve => { acknowledged = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { const terminal = await context.completeAttempt(attempt, completion); acknowledged(); return terminal; } };
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(responseWire().split('event: message_stop')[0]); };
    const args = options(accounting); args.body.stream = true; args.accountingMode = 'native-claude-sse';
    const result = await new DefaultExecutor('anthropic').execute(args);
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' });
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['delivered', 'live-failure', 'held-ack', 'lost-ack'])('failed HTTP with complete native usage retains original price and own terminal: %s', async mode => {
    db.durableTransaction(() => db.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,?,?,?,?)',
      ['a', 10000000, null, 1, '2026-10-03T00:00:00.000Z']));
    const context = await createAccounting(); let enter, release, ended = false;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const lost = new Error('fixture completion delivery unavailable');
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => {
      const terminal = await context.completeAttempt(...args); enter();
      if (mode === 'held-ack' || mode === 'lost-ack') await held;
      if (mode === 'lost-ack') throw lost;
      return terminal;
    }), assertSuccessfulTerminal: vi.fn((...args) => context.assertSuccessfulTerminal(...args)) };
    const args = options(accounting);
    if (mode === 'live-failure') { args.body.stream = true; args.accountingMode = 'native-claude-sse'; }
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-native': { input: '9', output: '9', cached: '9', cache_creation: '9' } })]));
      response.writeHead(mode === 'live-failure' ? 500 : 429, { 'content-type': 'text/event-stream' }); response.end(responseWire());
    };
    const work = new DefaultExecutor('anthropic').execute(args).then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    try {
      await entered;
      expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' });
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', outcome: 'failed', costNanoUsd: 106500 }]);
      if (mode === 'held-ack' || mode === 'lost-ack') expect(ended).toBe(false);
    } finally { release(); await work; }
    const result = await work;
    if (mode === 'lost-ack') expect(result.error).toBe(lost);
    else {
      expect(result.error).toBeUndefined(); expect(result.value.response.status).toBe(mode === 'live-failure' ? 500 : 429);
      // The fully inspected raw response is money evidence, never a provider
      // error payload to leak through core logs/client envelopes.
      expect(result.value.response.headers.get('content-type')).toContain('application/json');
      expect(await result.value.response.json()).toMatchObject({ error: { message: mode === 'live-failure' ? 'Internal server error' : 'Rate limit exceeded' } });
      expect(result.value.accountingLive).toBeUndefined(); expect(result.value.accountingMessage).toBeNull();
    }
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('exact failed HTTP may cross budget after dispatch; only successor admission is blocked', async () => {
    db.durableTransaction(() => db.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,?,?,?,?)',
      ['a', 100000, null, 1, '2026-10-03T00:00:00.000Z']));
    const context = await createAccounting();
    responder = (_request, response) => { response.writeHead(429, { 'content-type': 'text/event-stream' }); response.end(responseWire()); };
    const result = await new DefaultExecutor('anthropic').execute(options(context));
    expect(result.response.status).toBe(429); expect(await result.response.json()).toMatchObject({ error: { message: 'Rate limit exceeded' } });
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', outcome: 'failed', costNanoUsd: 106500 }]);
    await expect(new DefaultExecutor('anthropic').execute(options(await createAccounting()))).rejects.toMatchObject({ code: 'api_key_budget_exceeded' });
    expect(requests).toHaveLength(1); expect(failure).toBeNull(); expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(1);
  });
  it.each(['credential', 'settings', 'environment', 'copied-handle', 'wrong-terminal', 'missing-hook'])('failed terminal %s refusal preserves acknowledged debit and never replays', async mode => {
    const context = await createAccounting();
    const accounting = { ...context, completeAttempt: vi.fn((...args) => context.completeAttempt(...args)), assertSuccessfulTerminal: vi.fn(),
      assertFailedTerminal: mode === 'missing-hook' ? undefined : (attempt, terminal) => {
        if (mode === 'credential') db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated' })]));
        if (mode === 'settings') db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true })]));
        if (mode === 'environment') vi.stubEnv('HTTP_PROXY', 'http://fixture-changed.invalid:1');
        return context.assertFailedTerminal(mode === 'copied-handle' ? { ...attempt } : attempt,
          mode === 'wrong-terminal' ? { ...terminal, requestId: 'wrong-request' } : terminal);
      } };
    responder = (_request, response) => { response.writeHead(429, { 'content-type': 'text/event-stream' }); response.end(responseWire()); };
    await expect(new DefaultExecutor('anthropic').execute(options(accounting))).rejects.toMatchObject({ code: mode === 'missing-hook' ? 'model_accounting_unsupported' : 'api_key_accounting_unavailable' });
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', outcome: 'failed', costNanoUsd: 106500 }]);
    expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it.each(['missing-stop', 'trailing-error', 'non-sse-error', 'json-counter-lookalike', 'malformed-tool-json'])('failed HTTP %s cannot fabricate exact usage or retry', async mode => {
    db.durableTransaction(() => db.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,?,?,?,?)',
      ['a', 10000000, null, 1, '2026-10-03T00:00:00.000Z']));
    const context = await createAccounting();
    responder = (_request, response) => {
      response.writeHead(429, { 'content-type': mode === 'non-sse-error' || mode === 'json-counter-lookalike' ? 'application/json' : 'text/event-stream' });
      response.end(mode === 'missing-stop' ? responseWire().split('event: message_stop')[0] :
        mode === 'trailing-error' ? responseWire() + event('error', { error: { type: 'overloaded_error' } }) :
        mode === 'malformed-tool-json' ? responseWire().replace('event: message_delta',
          event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tool_fixture', name: 'fixture', input: {} } }) +
          event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{' } }) +
          event('content_block_stop', { index: 0 }) + 'event: message_delta') :
        mode === 'json-counter-lookalike' ? JSON.stringify({ usage: { input_tokens: 50, output_tokens: 20, server_tool_use: { web_search_requests: 0 } } }) : JSON.stringify({ error: { type: 'rate_limit_error' } }));
    };
    await expect(new DefaultExecutor('anthropic').execute(options(context))).rejects.toMatchObject({ code: 'api_key_accounting_unresolved' });
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' });
    expect(db.all('SELECT state,costNanoUsd,usageJson FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null, usageJson: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('live clienttool actual original POST retains pending, price and EOF/ownACK/authorization barriers', async () => {
    const context = await createAccounting(); let enterAck, releaseAck, enterAuth, releaseAuth, enterTool;
    const ackEntered = new Promise(resolve => { enterAck = resolve; }), ackHeld = new Promise(resolve => { releaseAck = resolve; });
    const authEntered = new Promise(resolve => { enterAuth = resolve; }), authHeld = new Promise(resolve => { releaseAuth = resolve; });
    const toolDelivered = new Promise(resolve => { enterTool = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const terminal = await context.completeAttempt(...args); enterAck(); await ackHeld; return terminal; }),
      assertSuccessfulTerminal: vi.fn(async terminal => { enterAuth(); await authHeld; return context.assertSuccessfulTerminal(terminal); }) };
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-native': { input: '9', output: '9', cached: '9', cache_creation: '9' } })]));
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(liveToolWire());
    };
    const args = liveToolOptions(accounting), original = structuredClone(args.body);
    const result = await new DefaultExecutor('anthropic').execute(args); let delivered = '';
    const reader = result.response.body.getReader();
    const consume = (async () => { const decoder = new TextDecoder(); for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); if (delivered.includes('event: content_block_stop')) enterTool(); } delivered += decoder.decode(); })();
    try {
      await Promise.race([toolDelivered, consume]); await ackEntered;
      expect(delivered).toContain('"type":"input_json_delta"'); expect(delivered).not.toContain('event: message_delta');
      expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' });
      expect(requests[0].key).toBe('dummy-provider'); expect(requests[0].beta).toBeUndefined();
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', outcome: 'success', costNanoUsd: 106500 }]);
      releaseAck(); await authEntered; expect(delivered).not.toContain('event: message_stop'); releaseAuth(); await consume;
      expect(delivered).toBe(liveToolWire());
    } finally { releaseAck(); releaseAuth(); await reader.cancel().catch(() => {}); await consume.catch(() => {}); reader.releaseLock(); }
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.assertSuccessfulTerminal).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1); expect(failure).toBeNull(); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['malformed', 'missing-stop', 'trailing-error'])('live clienttool %s retains sole unresolved ACK without terminal/replay', async mode => {
    const context = await createAccounting(); let ackDone;
    const ack = new Promise(resolve => { ackDone = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const terminal = await context.completeAttempt(...args); ackDone(); return terminal; }), assertSuccessfulTerminal: vi.fn() };
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(mode === 'missing-stop' ? liveToolWire().split('event: message_stop')[0] : liveToolWire(mode) + (mode === 'trailing-error' ? event('error', { error: { type: 'overloaded_error' } }) : '')); };
    const result = await new DefaultExecutor('anthropic').execute(liveToolOptions(accounting));
    const reader = result.response.body.getReader(); let delivered = '';
    await expect((async () => { try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += new TextDecoder().decode(chunk.value); } } finally { reader.releaseLock(); } })()).rejects.toThrow('Gateway accounting stream unavailable');
    await ack; expect(delivered).not.toContain('event: message_delta'); expect(delivered).not.toContain('event: message_stop');
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
    expect(db.all('SELECT state,costNanoUsd,usageJson FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null, usageJson: null }]);
    expect(requests).toHaveLength(1); expect(requests[0].row).toMatchObject({ requestId: context.requestId, state: 'pending' }); expect(failure).toBeNull();
  });
  it('live clienttool lost delivered completion cannot release terminal despite installed exact debit', async () => {
    const context = await createAccounting(); let observed;
    const completed = new Promise(resolve => { observed = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { await context.completeAttempt(...args); observed(); throw new Error('fixture delivery unavailable'); }), assertSuccessfulTerminal: vi.fn() };
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(liveToolWire()); };
    const result = await new DefaultExecutor('anthropic').execute(liveToolOptions(accounting));
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await completed;
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it('live clienttool original drift at dequeue refuses before intent/POST without rebuilding', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated' })])); return work;
    } };
    await expect(new DefaultExecutor('anthropic').execute(liveToolOptions(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('two-turn history preserves actual wire and distinct attempts, original price and own delivered ACK', async () => {
    const first = await createAccounting();
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(liveToolWire()); };
    const firstWire = await (await new DefaultExecutor('anthropic').execute(liveToolOptions(first))).response.text();
    expect(firstWire).toBe(liveToolWire());
    const frames = firstWire.split('\n\n').filter(Boolean).map(frame => JSON.parse(frame.split('\ndata: ')[1]));
    const tool = frames.find(frame => frame.type === 'content_block_start').content_block;
    const toolInput = JSON.parse(frames.filter(frame => frame.type === 'content_block_delta').map(frame => frame.delta.partial_json).join(''));
    const second = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...second, completeAttempt: vi.fn(async (...args) => { const terminal = await second.completeAttempt(...args); enter(); await held; return terminal; }) };
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-native': { input: '9', output: '9', cached: '9', cache_creation: '9' } })]));
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(responseWire());
    };
    const args = historyOptions(accounting);
    args.body.messages[1].content[1] = { ...tool, input: toolInput };
    args.body.messages[2].content[0].tool_use_id = tool.id;
    const original = structuredClone(args.body);
    const result = await new DefaultExecutor('anthropic').execute(args); let finished = false;
    const consume = result.response.text().then(text => { finished = true; return text; });
    try {
      await entered; expect(finished).toBe(false); expect(requests).toHaveLength(2); expect(requests[1].body).toEqual(original);
      expect(requests[1].row).toEqual({ requestId: second.requestId, state: 'pending' });
      expect(db.all('SELECT requestId,state,costNanoUsd FROM apiKeyAccounting ORDER BY rowid')).toEqual([
        { requestId: first.requestId, state: 'settled', costNanoUsd: 106500 }, { requestId: second.requestId, state: 'settled', costNanoUsd: 106500 }]);
    } finally { release(); await consume; }
    expect(await consume).toBe(responseWire()); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(new Set(db.all('SELECT attemptId FROM apiKeyAccounting').map(row => row.attemptId)).size).toBe(2);
    expect(failure).toBeNull(); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['missing-stop', 'lost-ack', 'credential-drift', 'wire-drift', 'erased-media', 'malformed-history'])('history native boundary %s never replays or invents usage', async mode => {
    const context = await createAccounting(); let observed;
    const completed = new Promise(resolve => { observed = resolve; });
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      if (mode === 'wire-drift') { const changed = structuredClone(wire), body = JSON.parse(changed.anthropicTransport.serializedBody);
        body.messages[2].content[0].is_error = false; changed.anthropicTransport.serializedBody = JSON.stringify(body); return context.beforeAttempt(meta, supported, changed); }
      const work = context.beforeAttempt(meta, supported, wire);
      if (mode === 'credential-drift') db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated' })]));
      return work;
    }, completeAttempt: vi.fn(async (...args) => { const terminal = await context.completeAttempt(...args); observed(); if (mode === 'lost-ack') throw new Error('fixture delivery unavailable'); return terminal; }) };
    const args = historyOptions(accounting), executor = new DefaultExecutor('anthropic');
    if (mode === 'malformed-history') args.body.messages[2].content[0].tool_use_id = 'unknown';
    if (mode === 'erased-media') {
      args.body.messages[2].content[0].content.push({ type: 'image', source: { type: 'url', url: 'https://fixture.invalid' } });
      executor.transformRequest = (_model, body) => { body.messages[2].content[0].content.pop(); return body; };
    }
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(mode === 'missing-stop' ? responseWire().split('event: message_stop')[0] : responseWire()); };
    if (['missing-stop', 'lost-ack'].includes(mode)) {
      const result = await executor.execute(args); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await completed;
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: mode === 'lost-ack' ? 'settled' : 'unresolved', costNanoUsd: mode === 'lost-ack' ? 106500 : null }]);
      expect(requests).toHaveLength(1); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    } else {
      await expect(executor.execute(args)).rejects.toMatchObject({ code: ['malformed-history', 'erased-media'].includes(mode) ? 'model_accounting_unsupported' : 'api_key_accounting_unavailable' });
      expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(accounting.completeAttempt).not.toHaveBeenCalled();
    }
    expect(failure).toBeNull(); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('307 cannot replay Messages generation; one POST and sole unresolved', async () => {
    responder = (_request, response) => { response.writeHead(307, { location: fixture.url }); response.end(); };
    await expect(new DefaultExecutor('anthropic').execute(options(await createAccounting()))).rejects.toThrow();
    expect(failure).toBeNull(); expect(requests).toHaveLength(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
