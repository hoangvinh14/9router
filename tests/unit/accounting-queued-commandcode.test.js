import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandCodeExecutor } from 'open-sse/executors/commandcode.js';
import { BUDGET_ERROR } from 'open-sse/config/apiKeyBudgetConstants.js';
const fixture = vi.hoisted(() => ({ network: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.network(...args) }));
let db, directory, createAccounting;
const previous = process.env.DATA_DIR, model = 'deepseek/deepseek-v4-pro';
const body = () => ({ threadId: '11111111-1111-4111-8111-111111111111', memory: '',
  config: { workingDir: '/fixture/workspace', date: '2026-10-10', environment: 'linux', structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
  params: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } });
const options = accounting => ({ model, stream: true, body: body(), accountingMode: 'native-commandcode-ndjson', accounting, connectionId: 'c',
  credentials: { apiKey: 'dummy-api-key', connectionId: 'c', providerSpecificData: {} } });
const usage = () => ({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 });
const wire = () => [{ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 'text_fixture' },
  { type: 'text-delta', id: 'text_fixture', text: 'fixture text' }, { type: 'text-end', id: 'text_fixture' },
  { type: 'finish-step', finishReason: 'stop', usage: usage() }, { type: 'finish', finishReason: 'stop', totalUsage: usage() }].map(event => JSON.stringify(event) + '\n').join('');
beforeEach(async () => {
  vi.resetModules(); fixture.network.mockReset();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-commandcode-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'commandcode', authType: 'apikey', apiKey: 'dummy-api-key', providerSpecificData: {} }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','commandcode',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
  });
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
const empty = () => { expect(fixture.network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0); };
describe('internal queued CommandCode native no-retry owner (mock POST, not full legacy/native HTTP acceptance)', { timeout: 20000 }, () => {
  it('own pending intent before exactly one original strict POST; raw completed EOF settles original price', async () => {
    const context = await createAccounting();
    fixture.network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://api.commandcode.ai/alpha/generate'); expect(contract.singlePost).toBe(true); expect(contract.commandCodeTransport).toBeDefined();
      expect(init.redirect).toBe('error'); expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-api-key'); expect(JSON.parse(init.body)).toEqual(body());
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='commandcode'", [JSON.stringify({ [model]: { input: '9', output: '9' } })]));
      return new Response(wire(), { headers: { 'content-type': 'application/x-ndjson' } });
    });
    const result = await new CommandCodeExecutor().execute(options(context)); expect(await result.response.text()).toBe(wire());
    expect(fixture.network).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('six large native originals enter real admission together: five own ACKs, sixth retained queue refusal', async () => {
    const context = await createAccounting(), works = [];
    fixture.network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'application/x-ndjson' } }));
    for (let index = 0; index < 6; index++) {
      const args = options(context); args.body.params.messages[0].content[0].text = 'x'.repeat(200000);
      // Native owner has no import await before admission: all six are actually
      // admitted in this turn, not inferred from concurrent execute promises.
      works.push(new CommandCodeExecutor().execute(args).then(value => ({ value }), error => ({ error })));
    }
    const outcomes = await Promise.all(works);
    expect(outcomes.slice(0, 5).every(result => result.value)).toBe(true); expect(outcomes[5].error).toBeDefined();
    expect(fixture.network).toHaveBeenCalledTimes(5);
    for (const { value } of outcomes.slice(0, 5)) expect(await value.response.text()).toBe(wire());
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 5 }, () => ({ state: 'settled', costNanoUsd: 140000 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('oversize native original refuses before queue/intent/POST', async () => {
    const args = options(await createAccounting()); args.body.params.messages[0].content[0].text = 'x'.repeat(300000);
    await expect(new CommandCodeExecutor().execute(args)).rejects.toThrow('Accounting Base transport unavailable'); empty();
  });
  it('installed settlement is not owner ACK: consumer delta precedes terminal bytes, own ACK authorizes release', async () => {
    const context = await createAccounting(); let upstream, deltaRead, ackInstalled, releaseAck;
    const deliveredDelta = new Promise(resolve => { deltaRead = resolve; });
    const installed = new Promise(resolve => { ackInstalled = resolve; }), ack = new Promise(resolve => { releaseAck = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, payload) {
      const terminal = await context.completeAttempt(attempt, payload); ackInstalled(); await ack; return terminal;
    } };
    fixture.network.mockImplementation(() => new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(new TextEncoder().encode(wire())); } }), { headers: { 'content-type': 'application/x-ndjson' } }));
    const result = await new CommandCodeExecutor().execute(options(accounting)), reader = result.response.body.getReader();
    let delivered = '', ended = false;
    const work = (async () => { const decoder = new TextDecoder(); try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); if (delivered.includes('text-delta')) deltaRead(); }
      delivered += decoder.decode(); ended = true;
    } finally { reader.releaseLock(); } })();
    try {
      await deliveredDelta; expect(delivered).toContain('fixture text'); expect(delivered).not.toContain('finish-step');
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
      upstream.close(); await installed;
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
      expect(ended).toBe(false); expect(delivered).not.toContain('finish-step');
    } finally { releaseAck(); try { upstream.close(); } catch { /* already closed */ } await work; }
    expect(delivered).toBe(wire()); expect(ended).toBe(true); expect(fixture.network).toHaveBeenCalledTimes(1);
  });
  it('actual POST remains original immutable work after caller mutation at admission', async () => {
    const context = await createAccounting(); let args;
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-commandcode'); expect(Object.isFrozen(prepared.headers)).toBe(true);
      expect(Object.isFrozen(prepared.credentials.providerSpecificData)).toBe(true); expect(Reflect.set(prepared.headers, 'authorization', 'changed')).toBe(false);
      args.credentials.apiKey = 'changed'; args.body.config.workingDir = '/changed'; args.body.params.messages[0].content[0].text = 'changed';
      return context.beforeAttempt(meta, supported, prepared);
    } };
    args = options(accounting);
    fixture.network.mockImplementation((_url, init) => { expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-api-key'); expect(JSON.parse(init.body)).toEqual(body()); return new Response(wire(), { headers: { 'content-type': 'application/x-ndjson' } }); });
    const result = await new CommandCodeExecutor().execute(args); expect(await result.response.text()).toBe(wire());
    expect(fixture.network).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
  });
  it('persisted API-key drift at real coordinator dequeue refuses without rebuilding or POST', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-commandcode'); const work = context.beforeAttempt(meta, supported, prepared);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-rotated' }), 'c']); }); return work;
    } };
    await expect(new CommandCodeExecutor().execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
  it.each(['endpoint', 'connection', 'token', 'original', 'session', 'config'])('independent %s binding refuses before intent/POST', async kind => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-commandcode'); const changed = structuredClone(prepared), transport = changed.commandCodeTransport;
      if (kind === 'token') changed.credentials.apiKey = 'changed';
      if (kind === 'original') { const value = JSON.parse(transport.serializedBody); value.metadata = {}; transport.serializedBody = JSON.stringify(value); }
      if (kind === 'session') transport.sessionId = '33333333-3333-4333-8333-333333333333';
      if (kind === 'config') transport.commandCodeConfig.baseTransport.baseUrl = 'https://fixture.invalid/generate';
      return context.beforeAttempt(kind === 'endpoint' ? { ...meta, endpoint: 'embeddings' } : kind === 'connection' ? { ...meta, connectionId: 'other' } : meta, supported, changed);
    } };
    await expect(new CommandCodeExecutor().execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
  it.each(['bodyAccessor', 'bodyToJSON', 'credentialAccessor', 'proxy', 'configAccessor'])('programmable %s rejected before first read/coercion/POST', async kind => {
    const args = options(await createAccounting()), executor = new CommandCodeExecutor(), touched = vi.fn(() => { throw new Error('Fixture programmable input executed'); });
    if (kind === 'bodyAccessor') Object.defineProperty(args.body, 'params', { enumerable: true, get: touched });
    if (kind === 'bodyToJSON') Object.defineProperty(args.body, 'toJSON', { value: touched });
    if (kind === 'credentialAccessor') Object.defineProperty(args.credentials, 'apiKey', { enumerable: true, get: touched });
    if (kind === 'proxy') args.proxyOptions = new Proxy({}, { ownKeys: touched, get: touched, getPrototypeOf: touched });
    if (kind === 'configAccessor') { executor.config = structuredClone(executor.config); Object.defineProperty(executor.config, 'headers', { enumerable: true, get: touched }); }
    await expect(executor.execute(args)).rejects.toThrow('Accounting Base transport unavailable'); expect(touched).not.toHaveBeenCalled(); empty();
  });
  it.each(['missing-finish', 'raw-error'])('%s yields one unresolved ACK and never enters legacy generation retry', async kind => {
    const context = await createAccounting(); let acknowledge;
    const ack = new Promise(resolve => { acknowledge = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, payload) { const terminal = await context.completeAttempt(attempt, payload); acknowledge(); return terminal; } };
    const text = kind === 'missing-finish' ? wire().split('\n').slice(0, -2).join('\n') + '\n' : JSON.stringify({ type: 'error', error: 'overloaded' }) + '\n';
    fixture.network.mockImplementation(() => new Response(text, { headers: { 'content-type': 'application/x-ndjson' } }));
    const result = await new CommandCodeExecutor().execute(options(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    expect(fixture.network).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
  });
  it('lost terminal-handle delivery after real settlement ACK withholds finish bytes/EOF without retry or authorization', async () => {
    const context = await createAccounting();
    const complete = vi.fn(async (attempt, payload) => { await context.completeAttempt(attempt, payload); throw new Error('Fixture lost CommandCode terminal handle'); });
    const authorize = vi.fn(value => context.assertSuccessfulTerminal(value));
    fixture.network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'application/x-ndjson' } }));
    const result = await new CommandCodeExecutor().execute(options({ ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize }));
    const reader = result.response.body.getReader(), decoder = new TextDecoder(); let delivered = '';
    try {
      await expect((async () => { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); } })()).rejects.toThrow('Gateway accounting stream unavailable');
    } finally { reader.releaseLock(); }
    expect(delivered).toContain('fixture text'); expect(delivered).not.toContain('finish-step'); expect(delivered).not.toContain('"type":"finish"');
    expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][1]).toMatchObject({ outcome: 'success', usage: { exact: true, input: 100, output: 20 } });
    expect(authorize).not.toHaveBeenCalled(); expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
  });
  it('caller abort before admission refuses without intent, POST or completion', async () => {
    const context = await createAccounting(), complete = vi.fn(), signal = new AbortController(), reason = new Error('fixture CommandCode pre-admission abort');
    signal.abort(reason);
    await expect(new CommandCodeExecutor().execute({ ...options({ ...context, completeAttempt: complete }), signal: signal.signal })).rejects.toBe(reason);
    empty(); expect(complete).not.toHaveBeenCalled();
  });
  it('caller abort while own installed intent ACK is held waits for ACK then completes not-dispatched once', async () => {
    const context = await createAccounting(), signal = new AbortController(), reason = new Error('fixture CommandCode intent ACK abort'); let installed, release;
    const entered = new Promise(resolve => { installed = resolve; }), held = new Promise(resolve => { release = resolve; });
    const complete = vi.fn((attempt, payload) => context.completeAttempt(attempt, payload));
    const accounting = { ...context, completeAttempt: complete, async beforeAttempt(meta, supported, prepared) {
      const attempt = await context.beforeAttempt(meta, supported, prepared); installed(); await held; return attempt;
    } };
    const work = new CommandCodeExecutor().execute({ ...options(accounting), signal: signal.signal });
    const rejected = expect(work).rejects.toBe(reason);
    try {
      await entered; expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
      signal.abort(reason); expect(complete).not.toHaveBeenCalled(); expect(fixture.network).not.toHaveBeenCalled();
    } finally { release(); await rejected; }
    expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][1]).toEqual({ notDispatched: true, outcome: 'aborted' });
    expect(fixture.network).not.toHaveBeenCalled();
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'not_dispatched', outcome: 'aborted', costNanoUsd: null }]);
  });
  it('caller abort after POST invocation owns unresolved ACK and cancels a late response without legacy retry', async () => {
    const context = await createAccounting(), signal = new AbortController(), reason = new Error('fixture CommandCode post-invocation abort'); let invoked, deliver, cancelled;
    const entered = new Promise(resolve => { invoked = resolve; }), late = new Promise(resolve => { deliver = resolve; }), cleaned = new Promise(resolve => { cancelled = resolve; });
    const complete = vi.fn((attempt, payload) => context.completeAttempt(attempt, payload));
    fixture.network.mockImplementation(() => { invoked(); return late; });
    const work = new CommandCodeExecutor().execute({ ...options({ ...context, completeAttempt: complete }), signal: signal.signal });
    const rejected = expect(work).rejects.toBe(reason);
    await entered; expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    signal.abort(reason); await rejected;
    const cancel = vi.fn(value => { cancelled(value); });
    deliver(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/x-ndjson' } }));
    expect(await cleaned).toBe(reason); expect(cancel).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
    expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'aborted', costNanoUsd: null }]);
  });
  it('unsupported original metadata refuses without intent/gap or legacy translation/POST', async () => {
    const args = options(await createAccounting()); args.body.metadata = {};
    fixture.network.mockImplementation(() => { throw new Error('Fixture denies legacy CommandCode dispatch'); });
    await expect(new CommandCodeExecutor().execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); empty();
  });
  it('missing family wire refuses before intent/gap even for otherwise supported original work', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported) { return context.beforeAttempt(meta, supported); } };
    fixture.network.mockImplementation(() => { throw new Error('Fixture denies missing-wire CommandCode dispatch'); });
    await expect(new CommandCodeExecutor().execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
});
