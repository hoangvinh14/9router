import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultExecutor } from 'open-sse/executors/default.js';
import anthropicRegistry from 'open-sse/providers/registry/anthropic.js';
const fixture = vi.hoisted(() => ({ url: null }));
// Owned HTTP URL only; production beta/config/header semantics stay intact.
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
const rates = { input: '1', output: '2', cached: '0.1', cache_creation: '1.25', cache_creation_1h: '2' };
const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const wire = (five = 5, hour = 5, mode = '') => {
  const usage = { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: five + hour,
    cache_creation: { ephemeral_5m_input_tokens: five, ephemeral_1h_input_tokens: hour }, server_tool_use: { web_search_requests: 0 } };
  if (mode === 'missing-details') delete usage.cache_creation;
  if (mode === 'unknown') usage.cache_creation.future_tier = 0;
  if (mode === 'sum') usage.cache_creation_input_tokens++;
  return event('message_start', { message: { id: 'msg_tier', type: 'message', role: 'assistant', model: 'fixture-tier', content: [], usage } }) +
    event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + (mode === 'missing-stop' ? '' : event('message_stop'));
};
const options = accounting => ({ model: 'fixture-tier', stream: true, accountingMode: 'native-claude-beta-sse', connectionId: 'c', accounting,
  body: { model: 'fixture-tier', stream: true, max_tokens: 100,
    system: [{ type: 'text', text: 'hour prefix', cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'five suffix', cache_control: { type: 'ephemeral', ttl: '5m' } }] }] },
  credentials: { apiKey: 'dummy-provider' }, proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
let db, directory, server, requests, failure, responder, createAccounting;
const previous = process.env.DATA_DIR;
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-cache-tier-native-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'anthropic', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','anthropic',?)", [JSON.stringify({ 'fixture-tier': rates })]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ body: JSON.parse(Buffer.concat(chunks).toString()), beta: request.headers['anthropic-beta'],
        row: db.get('SELECT requestId,state FROM apiKeyAccounting ORDER BY rowid DESC LIMIT 1') });
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
const changeRates = value => db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-tier': value })]));
const row = () => db.get('SELECT state,costNanoUsd,usageJson,priceSnapshotJson,attemptId FROM apiKeyAccounting');
describe('queued beta 1h original-price raw/SQL/ACK boundary (owned HTTP only)', { timeout: 20000 }, () => {
  it('retains original mixed TTL and rate after edit, own delivered ACK before eligible terminal', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const terminal = await context.completeAttempt(...args); enter(); await held; return terminal; }) };
    const args = options(accounting), original = structuredClone(args.body);
    responder = (_request, response) => { changeRates({ input: '9', output: '9', cached: '9', cache_creation: '9', cache_creation_1h: '9' }); response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
    const result = await new DefaultExecutor('anthropic').execute(args); let ended = false;
    const consume = result.response.text().then(text => { ended = true; return text; });
    try {
      await entered; expect(ended).toBe(false);
      expect(requests).toEqual([{ body: original, beta: anthropicRegistry.transport.headers['Anthropic-Beta'], row: { requestId: context.requestId, state: 'pending' } }]);
      expect(row()).toMatchObject({ state: 'settled', costNanoUsd: 110250 });
      expect(JSON.parse(row().priceSnapshotJson)).toMatchObject({ source: 'manual', rates, fallbackSemantics: { cache_creation_1h: 'explicit' }, usageSemantics: { cacheWriteTiers: 'observed_5m_1h' } });
      expect(JSON.parse(row().usageJson)).toMatchObject({ input: 100, cacheWrite: 10, cacheWrite5m: 5, cacheWrite1h: 5 });
    } finally { release(); await consume; }
    expect(await consume).toBe(wire()); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
    const { listAccountingManagement } = await import('@/lib/apiKeyBudget/management.js');
    expect((await listAccountingManagement('a')).attempts[0].usage).toMatchObject({ cacheWrite5m: 5, cacheWrite1h: 5 });
    expect(JSON.parse(db.get('SELECT tokens FROM usageHistory WHERE attemptId=?', [row().attemptId]).tokens)).toMatchObject({
      cache_creation_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 5 },
    });
  });
  it('installed 1h intent is not delivered ACK permission to POST', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...input) { const attempt = await context.beforeAttempt(...input); enter(); await held; return attempt; } };
    const work = new DefaultExecutor('anthropic').execute(options(accounting));
    try { await entered; expect(requests).toHaveLength(0); expect(row().state).toBe('pending'); }
    finally { release(); }
    expect(await (await work).response.text()).toBe(wire()); expect(requests).toHaveLength(1); expect(row().costNanoUsd).toBe(110250); expect(failure).toBeNull();
  });
  it.each(['missing-rate', 'null-rate', 'overprecision', 'ordinary-mode', 'reverse-order', 'price-dequeue'])('invalid original price/request refuses before intent and POST: %s', async mode => {
    const context = await createAccounting(), args = options(context);
    if (mode === 'missing-rate') { const { cache_creation_1h: _hour, ...flat } = rates; changeRates(flat); }
    if (mode === 'null-rate') changeRates({ ...rates, cache_creation_1h: null });
    if (mode === 'overprecision') changeRates({ ...rates, cache_creation_1h: '0.0000000001' });
    if (mode === 'ordinary-mode') args.accountingMode = 'native-claude-sse';
    if (mode === 'reverse-order') { args.body.system[0].cache_control.ttl = '5m'; args.body.messages[0].content[0].cache_control.ttl = '1h'; }
    if (mode === 'price-dequeue') args.accounting = { ...context, beforeAttempt(...input) { const work = context.beforeAttempt(...input); changeRates({ ...rates, cache_creation_1h: '3' }); return work; } };
    await expect(new DefaultExecutor('anthropic').execute(args)).rejects.toThrow();
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['zero-rate', 'zero-count', 'budget-crossing', 'failed-http', 'lost-ack'])('observed debit stays exact and one-owner: %s', async mode => {
    const context = await createAccounting(); let observed;
    const acknowledged = new Promise(resolve => { observed = resolve; });
    if (mode === 'zero-rate') changeRates({ ...rates, cache_creation_1h: '0' });
    if (mode === 'budget-crossing') db.durableTransaction(() => db.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,?,?,?,?)', ['a', 100000, null, 1, '2026-10-03T00:00:00.000Z']));
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { const result = await context.completeAttempt(...input); observed(); if (mode === 'lost-ack') throw new Error('fixture lost ACK'); return result; }) };
    responder = (_request, response) => { response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(mode === 'zero-count' ? wire(0, 0) : wire()); };
    const result = await new DefaultExecutor('anthropic').execute(options(accounting));
    if (mode === 'lost-ack') await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    else if (mode === 'failed-http') { expect(result.response.status).toBe(429); expect(await result.response.json()).toMatchObject({ error: { message: 'Rate limit exceeded' } }); }
    else expect(await result.response.text()).toBe(mode === 'zero-count' ? wire(0, 0) : wire());
    await acknowledged; expect(row()).toMatchObject({ state: 'settled', costNanoUsd: mode === 'zero-rate' ? 100250 : mode === 'zero-count' ? 94000 : 110250 });
    expect(requests).toHaveLength(1); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
    if (mode === 'budget-crossing') { await expect(new DefaultExecutor('anthropic').execute(options(await createAccounting()))).rejects.toMatchObject({ code: 'api_key_budget_exceeded' }); expect(requests).toHaveLength(1); }
  });
  it.each(['missing-details', 'unknown', 'sum', 'missing-stop'])('missing/invalid raw observation remains unresolved, no terminal replay: %s', async mode => {
    const context = await createAccounting(); let observed;
    const acknowledged = new Promise(resolve => { observed = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { const terminal = await context.completeAttempt(...input); observed(); return terminal; }) };
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire(5, 5, mode)); };
    const result = await new DefaultExecutor('anthropic').execute(options(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    await acknowledged; expect(row()).toMatchObject({ state: 'unresolved', costNanoUsd: null }); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it('exact recovery uses original 1h rate after edit/reopen, rejects flat correction and replays same operation', async () => {
    const context = await createAccounting(); let observed;
    const acknowledged = new Promise(resolve => { observed = resolve; });
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire(5, 5, 'missing-stop')); };
    const accounting = { ...context, async completeAttempt(...input) { const result = await context.completeAttempt(...input); observed(); return result; } };
    const result = await new DefaultExecutor('anthropic').execute(options(accounting)); await expect(result.response.text()).rejects.toThrow(); await acknowledged;
    const attemptId = row().attemptId; changeRates({ ...rates, cache_creation_1h: '9' }); db.close(); delete global._dbAdapter;
    db = await (await import('@/lib/db/driver.js')).getAdapter();
    const { resolveAccountingManagement } = await import('@/lib/apiKeyBudget/management.js');
    const usage = { exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 10, reasoning: 0, reasoningIncludedInOutput: true };
    const expectedVersion = db.get('SELECT resolutionVersion FROM apiKeyAccounting WHERE attemptId=?', [attemptId]).resolutionVersion;
    expect(expectedVersion).toBe(1);
    const input = { action: 'exact_usage', operationId: 'tier-recovery', reason: 'fixture recovery', evidence: 'owned raw fixture', expectedVersion, usage };
    await expect(resolveAccountingManagement('a', attemptId, input, 'fixture-admin')).rejects.toMatchObject({ code: 'invalid_accounting_recovery' });
    expect(row().state).toBe('unresolved'); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(0);
    input.usage = { ...usage, cacheWrite5m: 5, cacheWrite1h: 5 };
    const repaired = await resolveAccountingManagement('a', attemptId, input, 'fixture-admin');
    expect(repaired).toMatchObject({ state: 'settled', costUsd: '0.00011025', usage: { cacheWrite5m: 5, cacheWrite1h: 5 }, resolutionVersion: expectedVersion + 1 });
    expect(await resolveAccountingManagement('a', attemptId, input, 'fixture-admin')).toEqual(repaired);
    expect(requests).toHaveLength(1); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(1);
  });
});
