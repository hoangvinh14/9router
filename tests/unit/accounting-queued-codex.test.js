import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexExecutor } from 'open-sse/executors/codex.js';
const network = vi.hoisted(() => vi.fn());
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let db, directory, createAccounting;
const old = process.env.DATA_DIR;
const body = () => ({ model: 'gpt-5.5', stream: true, store: false, instructions: 'fixture instruction', input: [{ role: 'user', content: [{ type: 'input_text', text: 'fixture' }] }] });
const options = accounting => ({ model: 'gpt-5.5', stream: true, body: body(), accountingMode: 'native-codex-responses-sse', accounting,
  connectionId: 'c', credentials: { accessToken: 'dummy-codex-oauth', connectionId: 'c', providerSpecificData: { chatgptAccountId: 'dummy-account' } } });
const final = () => ({ id: 'resp_fixture', object: 'response', model: 'gpt-5.5', status: 'completed', service_tier: 'default', error: null, incomplete_details: null,
  output: [], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } });
const responseWire = () => [{ type: 'response.created', response: { ...final(), status: 'in_progress', usage: null } }, { type: 'response.completed', response: final() }]
  .map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
beforeEach(async () => {
  vi.resetModules(); network.mockReset();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-codex-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'codex', authType: 'oauth', accessToken: 'dummy-codex-oauth', providerSpecificData: { chatgptAccountId: 'dummy-account' } }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','codex',?)", [JSON.stringify({ 'gpt-5.5': { input: '1', output: '2', cached: '0.1', reasoning: '2' } })]);
  });
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/responses', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });
const emptyLedger = () => { expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0); };
describe('queued Codex OAuth original authority (mock only, no refresh/production acceptance)', { timeout: 20000 }, () => {
  it('retained original body counts toward queue ceiling five own ACKs/sixth refusal', async () => {
    const context = await createAccounting(), works = [];
    network.mockImplementation(() => new Response(responseWire(), { headers: { 'content-type': 'text/event-stream' } }));
    for (let index = 0; index < 6; index++) {
      const args = options(context); args.body.input = 'x'.repeat(200000);
      // Execution reaches admission without import awaits. Observe all outcomes
      // immediately so sixth rejection cannot become fixture unhandled noise.
      works.push(new CodexExecutor().execute(args).then(value => ({ value }), error => ({ error })));
    }
    const outcomes = await Promise.all(works);
    expect(outcomes.slice(0, 5).every(result => result.value)).toBe(true);
    expect(outcomes[5].error).toBeDefined(); expect(network).toHaveBeenCalledTimes(5);
    for (const { value } of outcomes.slice(0, 5)) expect(await value.response.text()).toBe(responseWire());
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 5 }, () => ({ state: 'settled', costNanoUsd: 104000 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('oversize original body refuses before admission without intent/POST/gap', async () => {
    const args = options(await createAccounting()); args.body.input = 'x'.repeat(300000);
    await expect(new CodexExecutor().execute(args)).rejects.toThrow('Accounting Base transport unavailable'); emptyLedger();
  });
  it('persisted OAuth token drift at dequeue cannot silently refresh/rebuild original wire', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire.protocol).toBe('native-codex'); const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']);
        db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), accessToken: 'dummy-refreshed' }), 'c']); });
      return work;
    } };
    await expect(new CodexExecutor().execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' }); emptyLedger();
  });
  it('whole frozen original wire owns actual POST after caller mutation', async () => {
    const context = await createAccounting(); let args;
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire.protocol).toBe('native-codex'); expect(Object.isFrozen(wire)).toBe(true); expect(Object.isFrozen(wire.headers)).toBe(true);
      expect(Object.isFrozen(wire.credentials.providerSpecificData)).toBe(true); expect(Object.isFrozen(wire.codexTransport.baseTransport)).toBe(true);
      expect(Reflect.set(wire.headers, 'authorization', 'Bearer changed')).toBe(false);
      args.credentials.accessToken = 'dummy-changed'; args.credentials.providerSpecificData.chatgptAccountId = 'dummy-other'; args.body.input[0].content[0].text = 'changed';
      return context.beforeAttempt(meta, supported, wire);
    } };
    args = options(accounting); network.mockImplementation((_url, init) => {
      expect(init.headers.authorization).toBe('Bearer dummy-codex-oauth'); expect(init.headers['chatgpt-account-id']).toBe('dummy-account');
      expect(JSON.parse(init.body)).toEqual(body()); return new Response(responseWire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await new CodexExecutor().execute(args); expect(await result.response.text()).toBe(responseWire()); expect(network).toHaveBeenCalledTimes(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 104000 });
  });
  it('persisted workspaceId wins over lower account aliases with original equality', async () => {
    const specific = { workspaceId: 'dummy-workspace', chatgptAccountId: 'dummy-account', accountId: 'dummy-lower' };
    db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), providerSpecificData: specific }), 'c']); });
    const args = options(await createAccounting()); args.credentials.providerSpecificData = specific;
    network.mockImplementation((_url, init) => { expect(init.headers['chatgpt-account-id']).toBe('dummy-workspace'); return new Response(responseWire(), { headers: { 'content-type': 'text/event-stream' } }); });
    const result = await new CodexExecutor().execute(args); expect(await result.response.text()).toBe(responseWire()); expect(network).toHaveBeenCalledTimes(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 104000 });
  });
  it.each(['token', 'account', 'session', 'body', 'config', 'headers', 'endpoint'])('original %s drift before enqueue refuses zeroPOST/intent/gap', async kind => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire.protocol).toBe('native-codex'); const changed = structuredClone(wire);
      if (kind === 'token') changed.credentials.accessToken = 'dummy-changed';
      if (kind === 'account') changed.credentials.providerSpecificData.chatgptAccountId = 'dummy-other';
      if (kind === 'session') changed.credentials.connectionId = 'dummy-other';
      if (kind === 'body') { const input = JSON.parse(changed.codexTransport.serializedBody); input.tools = [{ type: 'web_search' }]; changed.codexTransport.serializedBody = JSON.stringify(input); }
      if (kind === 'config') changed.codexTransport.baseTransport.headers.version = 'changed';
      if (kind === 'headers') changed.headers.authorization = 'Bearer dummy-changed';
      return context.beforeAttempt(kind === 'endpoint' ? { ...meta, endpoint: 'embeddings' } : meta, supported, changed);
    } };
    await expect(new CodexExecutor().execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' }); emptyLedger();
  });
  it.each(['bodyAccessor', 'bodyToJSON', 'credentialAccessor', 'proxy'])('programmable %s refuses without execution/POST/intent/gap', async kind => {
    const args = options(await createAccounting()), touched = vi.fn(() => { throw new Error('Fixture programmable input executed'); });
    if (kind === 'bodyAccessor') Object.defineProperty(args.body, 'input', { enumerable: true, get: touched });
    if (kind === 'bodyToJSON') Object.defineProperty(args.body, 'toJSON', { value: touched });
    if (kind === 'credentialAccessor') Object.defineProperty(args.credentials, 'accessToken', { enumerable: true, get: touched });
    if (kind === 'proxy') args.proxyOptions = new Proxy({}, { ownKeys: touched, get: touched, getPrototypeOf: touched });
    await expect(new CodexExecutor().execute(args)).rejects.toThrow('Accounting Base transport unavailable'); expect(touched).not.toHaveBeenCalled(); emptyLedger();
  });
  it('original fixed SSE POST sees own pending and settles104000 through own terminal ACK', async () => {
    const context = await createAccounting();
    network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://chatgpt.com/backend-api/codex/responses'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-codex-oauth'); expect(new Headers(init.headers).get('chatgpt-account-id')).toBe('dummy-account');
      expect(new Headers(init.headers).get('session_id')).toBe('c'); expect(JSON.parse(init.body)).toEqual(body());
      expect(contract).toMatchObject({ singlePost: true, codexTransport: { model: 'gpt-5.5' } });
      expect(db.get('SELECT requestId,state FROM apiKeyAccounting')).toEqual({ requestId: context.requestId, state: 'pending' });
      return new Response(responseWire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await new CodexExecutor().execute(options(context)); expect(await result.response.text()).toBe(responseWire());
    expect(network).toHaveBeenCalledTimes(1); expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({ state: 'settled', costNanoUsd: 104000 }); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('missing Codex original wire refuses even unlimited before intent/POST/gap', async () => {
    const context = await createAccounting();
    await expect(context.beforeAttempt({ provider: 'codex', model: 'gpt-5.5', endpoint: 'chat', connectionId: 'c' }, true)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('persisted OAuth account drift at dequeue refuses original request zeroPOST/intent/gap', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      expect(wire?.protocol).toBe('native-codex'); const work = context.beforeAttempt(meta, supported, wire);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?',
        [JSON.stringify({ ...JSON.parse(row.data), providerSpecificData: { chatgptAccountId: 'dummy-new-account' } }), 'c']); }); return work;
    } };
    await expect(new CodexExecutor().execute(options(accounting))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
