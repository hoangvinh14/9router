import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KiroExecutor } from 'open-sse/executors/kiro.js';
import { BUDGET_ERROR } from 'open-sse/config/apiKeyBudgetConstants.js';
import { concatFixtureBytes, fixtureKiroEvent } from '../helpers/accountingKiroFrames.js';
const fixture = vi.hoisted(() => ({ network: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.network(...args) }));
let db, directory, createAccounting;
const previous = process.env.DATA_DIR, model = 'claude-sonnet-4.5';
const body = () => ({ conversationState: { chatTriggerType: 'MANUAL', conversationId: '12345678-1234-4123-8123-123456789abc',
  currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: model, origin: 'AI_EDITOR' } }, history: [] },
  inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 } });
const options = accounting => ({ model, stream: true, body: body(), accountingMode: 'native-kiro-eventstream', accounting, connectionId: 'c',
  credentials: { apiKey: null, accessToken: 'dummy-api-key', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } } });
const wire = () => concatFixtureBytes([
  fixtureKiroEvent('assistantResponseEvent', { content: 'fixture text' }),
  fixtureKiroEvent('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 }),
  fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' }),
]);
beforeEach(async () => {
  vi.resetModules(); fixture.network.mockReset();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-kiro-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'kiro', authType: 'apikey', apiKey: null, accessToken: 'dummy-api-key', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','kiro',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
  });
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
const empty = () => { expect(fixture.network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0); };
describe('internal queued native Kiro Q API-key one-generation owner (mock, not legacy integrity/fallback certification)', { timeout: 20000 }, () => {
  it('own pending before one immutable original strict POST; raw stop/EOF settles original price', async () => {
    const context = await createAccounting(); let args;
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-kiro'); expect(Object.isFrozen(prepared.headers)).toBe(true);
      expect(Object.isFrozen(prepared.credentials.providerSpecificData)).toBe(true);
      expect(Reflect.set(prepared.headers, 'authorization', 'changed')).toBe(false);
      args.credentials.accessToken = 'changed'; args.body.conversationState.currentMessage.userInputMessage.content = 'changed';
      return context.beforeAttempt(meta, supported, prepared);
    } };
    args = options(accounting);
    fixture.network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://q.us-east-1.amazonaws.com/generateAssistantResponse'); expect(contract.singlePost).toBe(true); expect(contract.kiroTransport).toBeDefined();
      expect(init.redirect).toBe('error'); const headers = new Headers(init.headers);
      expect(headers.get('authorization')).toBe('Bearer dummy-api-key'); expect(headers.get('x-amz-sso-bearer')).toBe('dummy-api-key');
      expect(headers.get('tokentype')).toBe('API_KEY'); expect(JSON.parse(init.body)).toEqual(body());
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='kiro'", [JSON.stringify({ [model]: { input: '9', output: '9' } })]));
      return new Response(wire(), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } });
    });
    const result = await new KiroExecutor().execute(args); expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(wire());
    expect(fixture.network).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('missing Kiro original wire even unlimited refuses before intent/POST', async () => {
    const context = await createAccounting();
    await expect(context.beforeAttempt({ provider: 'kiro', model, connectionId: 'c', endpoint: 'chat' }, true)).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE });
    empty();
  });
  it('persisted API-key token drift at coordinator dequeue refuses without rebuilding/POST/gap', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-kiro'); const work = context.beforeAttempt(meta, supported, prepared);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), accessToken: 'dummy-rotated' }), 'c']); });
      return work;
    } };
    await expect(new KiroExecutor().execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
  it.each(['endpoint', 'connection', 'token', 'original', 'invocation', 'config', 'profile'])('independent %s binding refuses before intent/POST', async kind => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-kiro'); const changed = structuredClone(prepared), transport = changed.kiroTransport;
      if (kind === 'token') changed.credentials.accessToken = 'changed';
      if (kind === 'original') { const value = JSON.parse(transport.serializedBody); value.tools = []; transport.serializedBody = JSON.stringify(value); }
      if (kind === 'invocation') transport.invocationId = '33333333-3333-4333-8333-333333333333';
      if (kind === 'config') transport.kiroConfig.baseUrls[2] = 'https://fixture.invalid/generateAssistantResponse';
      if (kind === 'profile') changed.credentials.providerSpecificData.profileArn = 'arn:aws:codewhisperer:us-east-1:123456789012:profile/other';
      return context.beforeAttempt(kind === 'endpoint' ? { ...meta, endpoint: 'embeddings' } : kind === 'connection' ? { ...meta, connectionId: 'other' } : meta, supported, changed);
    } };
    await expect(new KiroExecutor().execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
  it.each(['bodyAccessor', 'bodyToJSON', 'credentialAccessor', 'proxy', 'configAccessor'])('programmable %s rejected before first read/coercion/POST', async kind => {
    const args = options(await createAccounting()), executor = new KiroExecutor(), touched = vi.fn(() => { throw new Error('Fixture programmable input executed'); });
    if (kind === 'bodyAccessor') Object.defineProperty(args.body, 'conversationState', { enumerable: true, get: touched });
    if (kind === 'bodyToJSON') Object.defineProperty(args.body, 'toJSON', { value: touched });
    if (kind === 'credentialAccessor') Object.defineProperty(args.credentials, 'accessToken', { enumerable: true, get: touched });
    if (kind === 'proxy') args.proxyOptions = new Proxy({}, { ownKeys: touched, get: touched, getPrototypeOf: touched });
    if (kind === 'configAccessor') { executor.config = structuredClone(executor.config); Object.defineProperty(executor.config, 'headers', { enumerable: true, get: touched }); }
    await expect(executor.execute(args)).rejects.toThrow('Accounting Base transport unavailable'); expect(touched).not.toHaveBeenCalled(); empty();
  });
  it.each(['missing-stop', 'raw-error'])('%s delivers text then one independent unresolved ACK without legacy regeneration', async kind => {
    const context = await createAccounting(); let acknowledge;
    const ack = new Promise(resolve => { acknowledge = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, payload) { const terminal = await context.completeAttempt(attempt, payload); acknowledge(); return terminal; } };
    const prefix = fixtureKiroEvent('assistantResponseEvent', { content: 'fixture text' });
    const bytes = concatFixtureBytes([prefix, kind === 'missing-stop'
      ? fixtureKiroEvent('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 })
      : fixtureKiroEvent('error', { message: 'fixture failure' })]);
    let upstream;
    fixture.network.mockImplementation(() => new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(prefix); } }), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    const result = await new KiroExecutor().execute(options(accounting)), reader = result.response.body.getReader();
    try {
      expect((await reader.read()).value).toEqual(prefix);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
      upstream.enqueue(bytes.slice(prefix.length)); upstream.close();
      await expect(reader.read()).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    } finally { try { upstream.close(); } catch { /* already closed */ } reader.releaseLock(); }
    expect(fixture.network).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
  });
  it('six retained native originals reach real admission together: five own ACKs and sixth queue refusal', async () => {
    const context = await createAccounting(), works = [], admitted = [];
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      // No owner import await: the original beforeAttempt is entered for each
      // of the six requests in this turn before the coordinator microtask.
      admitted.push(prepared.kiroTransport.serializedBody.length);
      return context.beforeAttempt(meta, supported, prepared);
    } };
    fixture.network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    for (let index = 0; index < 6; index++) {
      const args = options(accounting); args.body.conversationState.currentMessage.userInputMessage.content = 'x'.repeat(200000);
      works.push(new KiroExecutor().execute(args).then(value => ({ value }), error => ({ error })));
    }
    expect(admitted).toHaveLength(6); expect(admitted.every(bytes => bytes > 200000)).toBe(true);
    expect(fixture.network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    const outcomes = await Promise.all(works);
    expect(outcomes.slice(0, 5).every(result => result.value)).toBe(true); expect(outcomes[5].error).toBeDefined();
    expect(fixture.network).toHaveBeenCalledTimes(5);
    for (const { value } of outcomes.slice(0, 5)) expect(new Uint8Array(await value.response.arrayBuffer())).toEqual(wire());
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 5 }, () => ({ state: 'settled', costNanoUsd: 140000 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('oversize original refuses before admission/intent/POST', async () => {
    const args = options(await createAccounting()); args.body.conversationState.currentMessage.userInputMessage.content = 'x'.repeat(300000);
    await expect(new KiroExecutor().execute(args)).rejects.toThrow('Accounting Base transport unavailable'); empty();
  });
  it('installed settlement is not owner ACK: binary terminal/EOF waits delivered own ACK', async () => {
    const context = await createAccounting(); let upstream, deltaRead, ackInstalled, releaseAck;
    const deliveredDelta = new Promise(resolve => { deltaRead = resolve; });
    const installed = new Promise(resolve => { ackInstalled = resolve; }), ack = new Promise(resolve => { releaseAck = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, payload) {
      const terminal = await context.completeAttempt(attempt, payload); ackInstalled(); await ack; return terminal;
    } };
    fixture.network.mockImplementation(() => new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(wire()); } }), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    const result = await new KiroExecutor().execute(options(accounting)), reader = result.response.body.getReader(), chunks = [];
    const prefix = fixtureKiroEvent('assistantResponseEvent', { content: 'fixture text' }); let ended = false;
    const work = (async () => { try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; chunks.push(chunk.value); deltaRead(); }
      ended = true;
    } finally { reader.releaseLock(); } })();
    try {
      await deliveredDelta; expect(concatFixtureBytes(chunks)).toEqual(prefix);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
      upstream.close(); await installed;
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
      expect(ended).toBe(false); expect(concatFixtureBytes(chunks)).toEqual(prefix);
    } finally { releaseAck(); try { upstream.close(); } catch { /* already closed */ } await work; }
    expect(concatFixtureBytes(chunks)).toEqual(wire()); expect(ended).toBe(true); expect(fixture.network).toHaveBeenCalledTimes(1);
  });
  it('caller abort before admission refuses without intent, POST or completion', async () => {
    const context = await createAccounting(), complete = vi.fn(), signal = new AbortController(), reason = new Error('fixture pre-admission abort');
    signal.abort(reason);
    await expect(new KiroExecutor().execute({ ...options({ ...context, completeAttempt: complete }), signal: signal.signal })).rejects.toBe(reason);
    empty(); expect(complete).not.toHaveBeenCalled();
  });
  it('caller abort while own installed intent ACK is held waits for ACK then completes not-dispatched once', async () => {
    const context = await createAccounting(), signal = new AbortController(), reason = new Error('fixture intent ACK abort'); let installed, release;
    const entered = new Promise(resolve => { installed = resolve; }), held = new Promise(resolve => { release = resolve; });
    const complete = vi.fn((attempt, payload) => context.completeAttempt(attempt, payload));
    const accounting = { ...context, completeAttempt: complete, async beforeAttempt(meta, supported, prepared) {
      const attempt = await context.beforeAttempt(meta, supported, prepared); installed(); await held; return attempt;
    } };
    const work = new KiroExecutor().execute({ ...options(accounting), signal: signal.signal });
    // Observe rejection before abort so this control cannot create an unhandled promise.
    const rejected = expect(work).rejects.toBe(reason);
    try {
      await entered; expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
      signal.abort(reason); expect(complete).not.toHaveBeenCalled(); expect(fixture.network).not.toHaveBeenCalled();
    } finally { release(); await rejected; }
    expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][1]).toEqual({ notDispatched: true, outcome: 'aborted' });
    expect(fixture.network).not.toHaveBeenCalled();
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'not_dispatched', outcome: 'aborted', costNanoUsd: null }]);
  });
  it('caller abort after POST invocation owns unresolved ACK and cancels a late response without retry or terminal rewrite', async () => {
    const context = await createAccounting(), signal = new AbortController(), reason = new Error('fixture post-invocation abort'); let invoked, deliver, cancelled;
    const entered = new Promise(resolve => { invoked = resolve; }), late = new Promise(resolve => { deliver = resolve; }), cleaned = new Promise(resolve => { cancelled = resolve; });
    const complete = vi.fn((attempt, payload) => context.completeAttempt(attempt, payload));
    fixture.network.mockImplementation(() => { invoked(); return late; });
    const work = new KiroExecutor().execute({ ...options({ ...context, completeAttempt: complete }), signal: signal.signal });
    const rejected = expect(work).rejects.toBe(reason);
    await entered; expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    signal.abort(reason); await rejected;
    const cancel = vi.fn(value => { cancelled(value); });
    // Real Response body resolves after the executor has already rejected/ACKed.
    deliver(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    expect(await cleaned).toBe(reason); expect(cancel).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
    expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'aborted', costNanoUsd: null }]);
  });
  it('lost terminal-handle delivery after installed exact settlement cannot reconstruct ACK or release binary terminals', async () => {
    const context = await createAccounting(), complete = vi.fn(async (attempt, payload) => {
      await context.completeAttempt(attempt, payload);
      // Synthetic owner-delivery loss AFTER the real sink ACK; not a
      // filesystem/powerloss recovery simulation or an authorization grant.
      throw new Error('Fixture lost Kiro terminal handle');
    }), authorize = vi.fn(value => context.assertSuccessfulTerminal(value));
    fixture.network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    const result = await new KiroExecutor().execute(options({ ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize }));
    const reader = result.response.body.getReader();
    try {
      expect((await reader.read()).value).toEqual(fixtureKiroEvent('assistantResponseEvent', { content: 'fixture text' }));
      await expect(reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
    } finally { reader.releaseLock(); }
    expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][1]).toMatchObject({ outcome: 'success', usage: { exact: true, input: 100, output: 20 } });
    expect(authorize).not.toHaveBeenCalled(); expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
  });
  it('downstream cancellation before EOF owns one independent unresolved aborted ACK', async () => {
    const context = await createAccounting(); let acknowledge, upstream;
    const ack = new Promise(resolve => { acknowledge = resolve; });
    const complete = vi.fn(async (attempt, payload) => { const terminal = await context.completeAttempt(attempt, payload); acknowledge(); return terminal; });
    const authorize = vi.fn();
    const prefix = fixtureKiroEvent('assistantResponseEvent', { content: 'fixture text' });
    fixture.network.mockImplementation(() => new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(prefix); } }), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    const result = await new KiroExecutor().execute(options({ ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize })), reader = result.response.body.getReader();
    try {
      expect((await reader.read()).value).toEqual(prefix); await reader.cancel('fixture consumer cancelled'); await ack;
    } finally { try { upstream.close(); } catch { /* cancelled */ } reader.releaseLock(); }
    expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
    expect(authorize).not.toHaveBeenCalled(); expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'aborted', costNanoUsd: null }]);
  });
  it('cancel while installed exact terminal ACK is held suppresses delivery without rewriting the claimed winner', async () => {
    const context = await createAccounting(); let installed, release, observed;
    const entered = new Promise(resolve => { installed = resolve; }), held = new Promise(resolve => { release = resolve; }), done = new Promise(resolve => { observed = resolve; });
    const complete = vi.fn(async (attempt, payload) => {
      const terminal = await context.completeAttempt(attempt, payload); installed(); await held; observed(); return terminal;
    });
    const authorize = vi.fn();
    fixture.network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }));
    const result = await new KiroExecutor().execute(options({ ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize })), reader = result.response.body.getReader();
    try {
      expect((await reader.read()).value).toEqual(fixtureKiroEvent('assistantResponseEvent', { content: 'fixture text' }));
      const terminalRead = reader.read(); await entered;
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
      await reader.cancel('fixture cancel during ACK'); expect(await terminalRead).toEqual({ done: true, value: undefined });
    } finally { release(); await done; reader.releaseLock(); }
    expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0][1]).toMatchObject({ outcome: 'success', usage: { exact: true, input: 100, output: 20 } });
    expect(authorize).not.toHaveBeenCalled(); expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
  });
});
