import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultExecutor } from 'open-sse/executors/default.js';
import { PROVIDERS } from 'open-sse/config/providers.js';
import anthropicRegistry from 'open-sse/providers/registry/anthropic.js';

const fixture = vi.hoisted(() => ({ url: null, registryDrift: false }));
// Only fixed owned URL substituted. Production registry beta/header semantics
// retained verbatim, never removed to manufacture standard-only admission.
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, get anthropic() { return { ...original.PROVIDERS.anthropic,
    baseUrl: fixture.url, headers: fixture.registryDrift ? { ...original.PROVIDERS.anthropic.headers, 'Anthropic-Beta': 'fixture-foreign' } : original.PROVIDERS.anthropic.headers }; } } };
});
vi.mock('../../open-sse/config/accountedAnthropicCandidate.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, get ACCOUNTED_ANTHROPIC_CANDIDATE_URL() { return fixture.url; },
    supportsAnthropicCandidate(executor, options, url, body, headers) {
      return url === fixture.url && original.supportsAnthropicCandidate(executor, options, original.ACCOUNTED_ANTHROPIC_CANDIDATE_URL, body, headers);
    } };
});
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const wire = () => event('message_start', { message: { id: 'msg_beta', type: 'message', role: 'assistant', model: 'fixture-beta', content: [],
  usage: { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0 } } } }) +
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + event('message_stop');
const options = accounting => ({ model: 'fixture-beta', stream: true, accountingMode: 'native-claude-beta-sse', connectionId: 'c', accounting,
  body: { model: 'fixture-beta', stream: true, max_tokens: 100, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture', cache_control: { type: 'ephemeral', ttl: '5m' } }] }] },
  credentials: { apiKey: 'dummy-provider' }, proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
let db, directory, server, requests, failure, responder, createAccounting;
const previous = process.env.DATA_DIR;
beforeEach(async () => {
  vi.resetModules(); fixture.registryDrift = false; directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-beta-messages-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'anthropic', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','anthropic',?)", [JSON.stringify({ 'fixture-beta': { input: '1', output: '2', cached: '0.1', cache_creation: '1.25' } })]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ body: JSON.parse(Buffer.concat(chunks).toString()), beta: request.headers['anthropic-beta'], key: request.headers['x-api-key'],
        version: request.headers['anthropic-version'], row: db.get('SELECT requestId,state FROM apiKeyAccounting ORDER BY rowid DESC LIMIT 1') });
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
  fixture.registryDrift = false; if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
});
describe('explicit queued API-key production-registry beta (owned HTTP, not OAuth/general beta/TLS approval)', { timeout: 20000 }, () => {
  it('retains exact production beta and original wire at POST, original-price debit and own ACK before terminal', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const result = await context.completeAttempt(...args); enter(); await held; return result; }) };
    const args = options(accounting), original = structuredClone(args.body);
    expect(PROVIDERS.anthropic.headers).toEqual(anthropicRegistry.transport.headers);
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-beta': { input: '9', output: '9', cached: '9', cache_creation: '9' } })]));
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire());
    };
    const result = await new DefaultExecutor('anthropic').execute(args); let ended = false;
    const consume = result.response.text().then(text => { ended = true; return text; });
    try {
      await entered; expect(ended).toBe(false); expect(result.accountingLive).toBe(true);
      expect(requests).toEqual([{ body: original, beta: anthropicRegistry.transport.headers['Anthropic-Beta'], key: 'dummy-provider', version: '2023-06-01', row: { requestId: context.requestId, state: 'pending' } }]);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
    } finally { release(); await consume; }
    expect(await consume).toBe(wire()); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it('installed intent is not delivered ACK permission for beta POST', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...args) { const attempt = await context.beforeAttempt(...args); enter(); await held; return attempt; } };
    const work = new DefaultExecutor('anthropic').execute(options(accounting));
    try { await entered; expect(requests).toHaveLength(0); expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([{ state: 'pending' }]); }
    finally { release(); }
    expect(await (await work).response.text()).toBe(wire()); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it.each(['delivered', 'terminal-credential-drift', 'terminal-registry-drift', 'copied-attempt', 'wrong-terminal', 'budget-crossing'])('beta client-tool history keeps original blocks and sole debit: %s', async mode => {
    const context = await createAccounting(); let observed;
    const acknowledged = new Promise(resolve => { observed = resolve; });
    if (mode === 'budget-crossing') db.durableTransaction(() => db.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,?,?,?,?)',
      ['a', 100000, null, 1, '2026-10-03T00:00:00.000Z']));
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const terminal = await context.completeAttempt(...args); observed(); return terminal; }),
      assertAnthropicBetaTerminal(attempt, terminal) {
        if (mode === 'terminal-credential-drift') db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated' })]));
        if (mode === 'terminal-registry-drift') fixture.registryDrift = true;
        return context.assertAnthropicBetaTerminal(mode === 'copied-attempt' ? { ...attempt } : attempt,
          mode === 'wrong-terminal' ? { ...terminal, requestId: 'wrong' } : terminal);
      } };
    const args = options(accounting);
    args.body.tools = [{ name: 'fixture_lookup', input_schema: { type: 'object' } }];
    args.body.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'tool_beta', name: 'fixture_lookup', input: { query: 'fixture🙂' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_beta', is_error: true, content: 'fixture error🙂' }] });
    const original = structuredClone(args.body), result = await new DefaultExecutor('anthropic').execute(args);
    if (['delivered', 'budget-crossing'].includes(mode)) expect(await result.response.text()).toBe(wire());
    else await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    await acknowledged; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original);
    expect(requests[0].beta).toBe(anthropicRegistry.transport.headers['Anthropic-Beta']);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]); expect(failure).toBeNull();
    if (mode === 'budget-crossing') {
      await expect(new DefaultExecutor('anthropic').execute(options(await createAccounting()))).rejects.toMatchObject({ code: 'api_key_budget_exceeded' });
      expect(requests).toHaveLength(1); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    }
  });
  it.each(['strip-beta', 'foreign-beta', 'client-beta', 'registry-drift', 'OAuth', '1h', 'thinking', 'ordinary-mode', 'bare-prepared', 'credential-dequeue'])('unsupported %s refuses before POST/intent', async mode => {
    const context = await createAccounting(), args = options(context), executor = new DefaultExecutor('anthropic');
    if (mode === 'strip-beta') executor.buildHeaders = (...args) => { const headers = DefaultExecutor.prototype.buildHeaders.apply(executor, args); delete headers['Anthropic-Beta']; return headers; };
    if (mode === 'foreign-beta') args.providerOverrides = { headers: { 'Anthropic-Beta': 'fixture-foreign' } };
    if (mode === 'client-beta') args.credentials.rawHeaders = { 'anthropic-beta': 'fixture-foreign' };
    if (mode === 'registry-drift' || mode === 'credential-dequeue') args.accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      if (mode === 'registry-drift') fixture.registryDrift = true;
      else db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated' })]));
      return work;
    } };
    if (mode === 'OAuth') args.credentials = { accessToken: 'dummy-oauth', apiKey: 'sk-ant-oat-dummy' };
    if (mode === '1h') args.body.messages[0].content[0].cache_control.ttl = '1h';
    if (mode === 'thinking') args.body.thinking = { type: 'enabled', budget_tokens: 1024 };
    if (mode === 'ordinary-mode') args.accountingMode = 'native-claude-sse';
    if (mode === 'bare-prepared') args.accounting = { ...context, requiresPreparedBaseWire: false };
    await expect(executor.execute(args)).rejects.toThrow();
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['missing-stop', 'lost-ack', 'failed-http', '1h-raw'])('beta raw/terminal %s keeps sole sink and never replays', async mode => {
    const context = await createAccounting(); let observed;
    const ack = new Promise(resolve => { observed = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const terminal = await context.completeAttempt(...args); observed(); if (mode === 'lost-ack') throw new Error('fixture lost ACK'); return terminal; }) };
    responder = (_request, response) => { response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' });
      response.end(mode === 'missing-stop' ? wire().split('event: message_stop')[0] : mode === '1h-raw' ? wire().replace('"ephemeral_5m_input_tokens":10,"ephemeral_1h_input_tokens":0', '"ephemeral_5m_input_tokens":5,"ephemeral_1h_input_tokens":5') : wire()); };
    if (mode === 'failed-http') {
      const result = await new DefaultExecutor('anthropic').execute(options(accounting)); expect(result.response.status).toBe(429);
      expect(await result.response.json()).toMatchObject({ error: { message: 'Rate limit exceeded' } });
    } else {
      const result = await new DefaultExecutor('anthropic').execute(options(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    }
    await ack; expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(failure).toBeNull();
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: ['missing-stop', '1h-raw'].includes(mode) ? 'unresolved' : 'settled', costNanoUsd: ['missing-stop', '1h-raw'].includes(mode) ? null : 106500 }]);
  });
});
