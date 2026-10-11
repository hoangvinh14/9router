import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubExecutor } from 'open-sse/executors/github.js';
import { BUDGET_ERROR } from 'open-sse/config/apiKeyBudgetConstants.js';
const network = vi.hoisted(() => vi.fn());
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let db, directory, createAccounting;
const old = process.env.DATA_DIR, model = 'claude-sonnet-4.6';
const body = () => ({ model, messages: [{ role: 'user', content: 'fixture' }], max_tokens: 100, stream: true });
const options = accounting => ({ model, body: body(), stream: true, connectionId: 'c', accountingMode: 'chat-github-messages-sse', accounting,
  credentials: { accessToken: 'dummy-github-oauth', copilotToken: 'dummy-copilot-token', connectionId: 'c', providerSpecificData: { copilotToken: 'dummy-copilot-token' } } });
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const wire = () => event('message_start', { message: { type: 'message', id: 'msg_fixture', role: 'assistant', model, content: [],
  usage: { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0 } } } }) +
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'fixture output' } }) + event('content_block_stop', { index: 0 }) +
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + event('message_stop');
beforeEach(async () => {
  vi.resetModules(); network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-github-chat-messages-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'github', authType: 'oauth', accessToken: 'dummy-github-oauth', providerSpecificData: { copilotToken: 'dummy-copilot-token' } }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','github',?)", [JSON.stringify({ [model]: { input: '1', output: '2', cached: '0.1', cache_creation: '1.25' } })]);
  });
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });
const empty = () => { expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0); };
describe('internal GitHub Chat→Messages original+converted owner (test-first, not native-body proof/general conversion)', { timeout: 20000 }, () => {
  it('five original+converted100k pairs own ACK and sixth refuses at real admission byte ceiling', async () => {
    const context = await createAccounting(), admitted = [], works = [];
    // Translation/caller awaits are not queue occupancy proof. Hold exactly at
    // real admission, then enqueue all six frozen wires in one turn.
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('chat-github-messages');
      expect(JSON.parse(prepared.githubChatMessagesTransport.originalSerializedBody).messages[0].content).toHaveLength(100000);
      expect(JSON.parse(prepared.githubChatMessagesTransport.serializedBody).messages[0].content[0].text).toHaveLength(100000);
      return new Promise((resolve, reject) => { admitted.push({ meta, supported, prepared, resolve, reject }); });
    } };
    network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    for (let index = 0; index < 6; index++) {
      const args = options(accounting); args.body.messages[0].content = 'x'.repeat(100000);
      works.push(new GithubExecutor().execute(args).then(value => ({ value }), error => ({ error })));
    }
    expect(admitted).toHaveLength(6); empty();
    for (const entry of admitted) context.beforeAttempt(entry.meta, entry.supported, entry.prepared).then(entry.resolve, entry.reject);
    const outcomes = await Promise.all(works);
    expect(outcomes.slice(0, 5).every(result => result.value)).toBe(true);
    expect(outcomes[5].error).toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); expect(network).toHaveBeenCalledTimes(5);
    for (const { value } of outcomes.slice(0, 5)) expect(await value.response.text()).toContain('fixture output');
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 5 }, () => ({ state: 'settled', costNanoUsd: 106500 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('140k original+converted pair refuses before intent/POST/gap', async () => {
    const args = options(await createAccounting()); args.body.messages[0].content = 'x'.repeat(140000);
    await expect(new GithubExecutor().execute(args)).rejects.toThrow('Accounting Base transport unavailable'); empty();
  });
  it('frozen original and converted body drive POST after caller mutation', async () => {
    const context = await createAccounting(), args = options(context);
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('chat-github-messages');
      expect(Object.isFrozen(prepared.credentials.providerSpecificData)).toBe(true);
      expect(Reflect.set(prepared.headers, 'authorization', 'Bearer changed')).toBe(false);
      const work = context.beforeAttempt(meta, supported, prepared);
      args.body.messages[0].content = 'changed'; args.credentials.accessToken = 'changed';
      args.credentials.copilotToken = args.credentials.providerSpecificData.copilotToken = 'changed'; return work;
    } };
    network.mockImplementation((_url, init) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-copilot-token');
      expect(JSON.parse(init.body).messages[0].content[0].text).toBe('fixture');
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await new GithubExecutor().execute({ ...args, accounting });
    expect(await result.response.text()).toContain('fixture output'); expect(network).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
  });
  it.each(['copilotToken', 'githubToken', 'originalMetadata', 'actualText', 'cacheTTL', 'systemPrompt', 'request', 'headers', 'config', 'endpoint'])('original or converted %s drift refuses before enqueue/POST/intent/gap', async kind => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('chat-github-messages'); const changed = structuredClone(prepared), transport = changed.githubChatMessagesTransport;
      if (kind === 'copilotToken') changed.credentials.copilotToken = 'changed';
      if (kind === 'githubToken') changed.credentials.accessToken = 'changed';
      if (kind === 'originalMetadata') { const value = JSON.parse(transport.originalSerializedBody); value.metadata = {}; transport.originalSerializedBody = JSON.stringify(value); }
      if (['actualText', 'cacheTTL', 'systemPrompt'].includes(kind)) {
        const value = JSON.parse(transport.serializedBody);
        if (kind === 'actualText') value.messages[0].content[0].text = 'changed';
        if (kind === 'cacheTTL') value.system[0].cache_control.ttl = '5m';
        if (kind === 'systemPrompt') value.system[0].text = 'changed';
        transport.serializedBody = JSON.stringify(value);
      }
      if (kind === 'request') transport.requestId = 'changed';
      if (kind === 'headers') changed.headers.authorization = 'Bearer changed';
      if (kind === 'config') transport.githubConfig.messagesUrl = 'https://fixture.invalid/messages';
      return context.beforeAttempt(kind === 'endpoint' ? { ...meta, endpoint: 'embeddings' } : meta, supported, changed);
    } };
    await expect(new GithubExecutor().execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
  it.each(['bodyAccessor', 'bodyToJSON', 'credentialAccessor', 'proxy', 'configAccessor'])('programmable %s refuses before execution/intent/POST/gap', async kind => {
    const args = options(await createAccounting()), executor = new GithubExecutor(), touched = vi.fn(() => { throw new Error('Programmable fixture executed'); });
    if (kind === 'bodyAccessor') Object.defineProperty(args.body, 'messages', { enumerable: true, get: touched });
    if (kind === 'bodyToJSON') Object.defineProperty(args.body, 'toJSON', { value: touched });
    if (kind === 'credentialAccessor') Object.defineProperty(args.credentials, 'copilotToken', { enumerable: true, get: touched });
    if (kind === 'proxy') args.proxyOptions = new Proxy({}, { ownKeys: touched, get: touched, getPrototypeOf: touched });
    if (kind === 'configAccessor') { executor.config = structuredClone(executor.config); Object.defineProperty(executor.config, 'messagesUrl', { enumerable: true, get: touched }); }
    await expect(executor.execute(args)).rejects.toThrow('Accounting Base transport unavailable'); expect(touched).not.toHaveBeenCalled(); empty();
  });
  it.each(['accessToken', 'copilotToken'])('persisted %s drift at dequeue cannot rebuild or refresh conversion', async kind => {
    const context = await createAccounting(), executor = new GithubExecutor();
    const refresh = vi.spyOn(executor, 'refreshCredentials').mockImplementation(() => { throw new Error('Fixture disallows refresh'); });
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('chat-github-messages'); const work = context.beforeAttempt(meta, supported, prepared);
      db.durableTransaction(() => {
        const data = JSON.parse(db.get('SELECT data FROM providerConnections WHERE id=?', ['c']).data);
        if (kind === 'accessToken') data.accessToken = 'changed'; else data.providerSpecificData.copilotToken = 'changed';
        db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify(data), 'c']);
      }); return work;
    } };
    await expect(executor.execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty(); expect(refresh).not.toHaveBeenCalled();
  });
  it('converted finish and usage wait raw owner terminal ACK before clean EOF after consumer delta delivery', async () => {
    const context = await createAccounting(); let enter, release, deltaRead;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const delta = new Promise(resolve => { deltaRead = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { enter(); await held; return context.completeAttempt(attempt, completion); } };
    network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    const result = await new GithubExecutor().execute(options(accounting)); let delivered = '', ended = false;
    const consume = (async () => {
      const reader = result.response.body.getReader(), decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); if (delivered.includes('fixture output')) deltaRead(); } delivered += decoder.decode(); ended = true; }
      finally { reader.releaseLock(); }
    })();
    try {
      await entered; await delta; expect(ended).toBe(false); expect(delivered).toContain('fixture output');
      expect(delivered).not.toContain('"finish_reason":"stop"'); expect(delivered).not.toContain('"usage":');
      expect(delivered).not.toContain('[DONE]');
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    } finally { release(); await consume; }
    expect(ended).toBe(true); expect(delivered).toContain('"finish_reason":"stop"');
    const chunks = delivered.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    const terminal = chunks.filter(chunk => chunk.choices?.[0]?.finish_reason === 'stop');
    expect(terminal).toHaveLength(1);
    expect(terminal[0].usage).toMatchObject({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
    // Existing Claude→OpenAI converter emits a finish/usage chunk, not a
    // synthetic DONE for message_stop. Preserve that synchronous contract.
    expect(delivered).not.toContain('[DONE]'); expect(network).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
  });
  it('missing raw message_stop rejects converted delivery and separately awaits unresolved ACK', async () => {
    const context = await createAccounting(); let acknowledged;
    const ack = new Promise(resolve => { acknowledged = resolve; });
    const accounting = { ...context, async completeAttempt(attempt, completion) { const result = await context.completeAttempt(attempt, completion); acknowledged(); return result; } };
    network.mockImplementation(() => new Response(wire().split('event: message_stop')[0], { headers: { 'content-type': 'text/event-stream' } }));
    const result = await new GithubExecutor().execute(options(accounting));
    await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable'); await ack;
    expect(network).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('raw Claude pending/terminal owner precedes Chat conversion and preserves generated1h cache policy', async () => {
    const context = await createAccounting(), executor = new GithubExecutor(); let pinned;
    const legacy = vi.spyOn(executor, 'executeWithMessagesEndpoint').mockImplementation(() => { throw new Error('Fixture denies unowned legacy conversion'); });
    const refresh = vi.spyOn(executor, 'refreshCredentials').mockImplementation(() => { throw new Error('Fixture disallows refresh'); });
    const accounting = { ...context, beforeAttempt(meta, supported, original) {
      expect(original.protocol).toBe('chat-github-messages');
      expect(JSON.parse(original.githubChatMessagesTransport.originalSerializedBody)).toEqual(body());
      expect(Object.isFrozen(original)).toBe(true); pinned = original;
      return context.beforeAttempt(meta, supported, original);
    } };
    network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://api.githubcopilot.com/v1/messages'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-copilot-token');
      const actual = JSON.parse(init.body);
      expect(actual).toMatchObject({ model, max_tokens: 100, stream: true });
      expect(actual.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }]);
      expect(actual.system.at(-1)).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral', ttl: '1h' } });
      expect(actual.system.at(-1).text.length).toBeGreaterThan(0); expect(actual._toolNameMap).toBeUndefined();
      expect(init.body).toBe(pinned.githubChatMessagesTransport.serializedBody);
      expect(contract).toMatchObject({ singlePost: true, githubChatMessagesTransport: { model, mode: 'chat-github-messages-sse' } });
      expect(db.get('SELECT requestId,state FROM apiKeyAccounting')).toEqual({ requestId: context.requestId, state: 'pending' });
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await executor.execute(options(accounting)), converted = await result.response.text();
    expect(converted).toContain('chat.completion.chunk'); expect(converted).toContain('fixture output'); expect(converted).not.toContain('event: message_stop');
    expect(network).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
    expect(legacy).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled(); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('missing original Chat conversion wire refuses even unlimited before intent/POST/gap', async () => {
    const context = await createAccounting();
    await expect(context.beforeAttempt({ provider: 'github', model, endpoint: 'chat', connectionId: 'c' }, true)).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
  it('unsupported Chat metadata cannot be erased by conversion to obtain generation authority', async () => {
    const args = options(await createAccounting()); args.body.metadata = { fixture: 'unsupported' };
    network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    await expect(new GithubExecutor().execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); empty();
  });
});
