import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrokCliExecutor, _resetGrokCliTurnStore } from 'open-sse/executors/grok-cli.js';
import { BUDGET_ERROR } from 'open-sse/config/apiKeyBudgetConstants.js';
const fixture = vi.hoisted(() => ({ network: vi.fn(), machine: vi.fn(), refresh: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.network(...args) }));
vi.mock('open-sse/shared/machineId.js', () => ({ getConsistentMachineId: (...args) => fixture.machine(...args) }));
vi.mock('open-sse/services/oauthCredentialManager.js', () => ({ refreshProviderCredentials: (...args) => fixture.refresh(...args), shouldRefreshCredentials: () => false }));
let db, directory, createAccounting;
const previous = process.env.DATA_DIR;
const specific = () => ({ deviceId: 'dummy-grok-device', email: 'dummy@example.invalid', userId: 'dummy-grok-user' });
const body = () => ({ model: 'grok-build', stream: true, store: false, instructions: 'fixture instruction', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fixture' }] }] });
const actualBody = () => ({ ...body(), reasoning: { summary: 'concise' }, include: ['reasoning.encrypted_content'] });
const options = accounting => ({ model: 'grok-build', stream: true, body: body(), accountingMode: 'native-grok-cli-responses-sse', accounting, connectionId: 'c',
  credentials: { accessToken: 'dummy-grok-oauth', connectionId: 'c', providerSpecificData: specific() } });
const reason = () => ({ id: 'rs_fixture', type: 'reasoning', status: 'completed', summary: [{ type: 'summary_text', text: 'fixture reasoning' }], encrypted_content: 'fixture-encrypted' });
const final = () => ({ id: 'resp_fixture', object: 'response', model: 'grok-build', status: 'completed', service_tier: 'default', error: null, incomplete_details: null,
  output: [reason()], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } });
const wire = () => [
  { type: 'response.created', response: { ...final(), status: 'in_progress', output: [], usage: null } },
  { type: 'response.output_item.added', output_index: 0, item: { id: 'rs_fixture', type: 'reasoning', status: 'in_progress', summary: [] } },
  { type: 'response.reasoning_summary_part.added', output_index: 0, item_id: 'rs_fixture', summary_index: 0, part: { type: 'summary_text', text: '' } },
  { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'rs_fixture', summary_index: 0, delta: 'fixture reasoning' },
  { type: 'response.reasoning_summary_text.done', output_index: 0, item_id: 'rs_fixture', summary_index: 0, text: 'fixture reasoning' },
  { type: 'response.reasoning_summary_part.done', output_index: 0, item_id: 'rs_fixture', summary_index: 0, part: reason().summary[0] },
  { type: 'response.output_item.done', output_index: 0, item: reason() },
  { type: 'response.completed', response: final() },
].map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
beforeEach(async () => {
  vi.resetModules(); _resetGrokCliTurnStore(); fixture.network.mockReset(); fixture.machine.mockReset(); fixture.refresh.mockReset();
  fixture.machine.mockImplementation(() => { throw new Error('Fixture disallows machine identity acquisition'); }); fixture.refresh.mockImplementation(() => { throw new Error('Fixture disallows OAuth refresh'); });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-grok-cli-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'grok-cli', authType: 'oauth', accessToken: 'dummy-grok-oauth', providerSpecificData: specific() }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','grok-cli',?)", [JSON.stringify({ 'grok-build': { input: '1', output: '2', cached: '0.1', reasoning: '2' } })]);
  });
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/responses', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
const empty = () => { expect(fixture.network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0); };
describe('internal queued Grok Build original+actual OAuth owner (mock schema, not full provider acceptance)', { timeout: 20000 }, () => {
  it('retained original plus actual body counts toward queue ceiling five own ACKs/sixth refusal', async () => {
    const context = await createAccounting(), works = [];
    fixture.network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    for (let index = 0; index < 6; index++) {
      const args = options(context); args.body.input[0].content[0].text = 'x'.repeat(100000);
      // No import await before real admission; all six are enqueued same turn.
      works.push(new GrokCliExecutor().execute(args).then(value => ({ value }), error => ({ error })));
    }
    const outcomes = await Promise.all(works);
    expect(outcomes.slice(0, 5).every(result => result.value)).toBe(true);
    expect(outcomes[5].error).toBeDefined(); expect(fixture.network).toHaveBeenCalledTimes(5);
    for (const { value } of outcomes.slice(0, 5)) expect(await value.response.text()).toBe(wire());
    expect(rows()).toEqual(Array.from({ length: 5 }, () => ({ state: 'settled', costNanoUsd: 104000 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0); expect(fixture.machine).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled();
  });
  it('oversize original plus actual body refuses before admission/POST/intent/gap', async () => {
    const args = options(await createAccounting()); args.body.input[0].content[0].text = 'x'.repeat(140000);
    await expect(new GrokCliExecutor().execute(args)).rejects.toThrow('Accounting Base transport unavailable'); empty();
  });
  it('persisted token drift at dequeue cannot refresh or reconstruct original wire', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-grok-cli'); const work = context.beforeAttempt(meta, supported, prepared);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?',
        [JSON.stringify({ ...JSON.parse(row.data), accessToken: 'dummy-refreshed' }), 'c']); }); return work;
    } };
    await expect(new GrokCliExecutor().execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
    expect(fixture.machine).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled();
  });
  it('actual POST remains frozen after caller body/token/device mutation at admission', async () => {
    const context = await createAccounting(); let args;
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-grok-cli');
      expect(Object.isFrozen(prepared.headers)).toBe(true); expect(Object.isFrozen(prepared.grokCliTransport.identity)).toBe(true);
      expect(Object.isFrozen(prepared.credentials.providerSpecificData)).toBe(true);
      expect(Reflect.set(prepared.headers, 'authorization', 'Bearer changed')).toBe(false);
      args.body.input[0].content[0].text = 'changed'; args.credentials.accessToken = 'changed'; args.credentials.providerSpecificData.deviceId = 'changed';
      return context.beforeAttempt(meta, supported, prepared);
    } };
    args = options(accounting);
    fixture.network.mockImplementation((_url, init) => {
      expect(init.headers.authorization).toBe('Bearer dummy-grok-oauth'); expect(init.headers['x-grok-agent-id']).toBe('dummy-grok-device');
      expect(JSON.parse(init.body)).toEqual(actualBody()); return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await new GrokCliExecutor().execute(args); expect(await result.response.text()).toBe(wire());
    expect(fixture.network).toHaveBeenCalledTimes(1); expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 104000 }]);
  });
  it.each(['token', 'device', 'session', 'original', 'actual', 'config', 'client', 'headers', 'endpoint'])('original %s drift before enqueue refuses zeroPOST/intent/gap', async kind => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-grok-cli'); const changed = structuredClone(prepared), transport = changed.grokCliTransport;
      if (kind === 'token') changed.credentials.accessToken = 'changed';
      if (kind === 'device') changed.credentials.providerSpecificData.deviceId = 'changed';
      if (kind === 'session') transport.identity.sessionId = 'changed';
      if (kind === 'original') { const value = JSON.parse(transport.originalSerializedBody); value.metadata = {}; transport.originalSerializedBody = JSON.stringify(value); }
      if (kind === 'actual') { const value = JSON.parse(transport.serializedBody); delete value.include; transport.serializedBody = JSON.stringify(value); }
      if (kind === 'config') transport.grokConfig.baseTransport.baseUrl = 'https://fixture.invalid/responses';
      if (kind === 'client') transport.grokConfig.clientVersion = 'changed';
      if (kind === 'headers') changed.headers.authorization = 'Bearer changed';
      return context.beforeAttempt(kind === 'endpoint' ? { ...meta, endpoint: 'embeddings' } : meta, supported, changed);
    } };
    await expect(new GrokCliExecutor().execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
  it.each(['bodyAccessor', 'bodyToJSON', 'credentialAccessor', 'proxy'])('programmable %s refuses before execution/POST/intent/gap', async kind => {
    const args = options(await createAccounting()), touched = vi.fn(() => { throw new Error('Fixture programmable input executed'); });
    if (kind === 'bodyAccessor') Object.defineProperty(args.body, 'input', { enumerable: true, get: touched });
    if (kind === 'bodyToJSON') Object.defineProperty(args.body, 'toJSON', { value: touched });
    if (kind === 'credentialAccessor') Object.defineProperty(args.credentials, 'accessToken', { enumerable: true, get: touched });
    if (kind === 'proxy') args.proxyOptions = new Proxy({}, { ownKeys: touched, get: touched, getPrototypeOf: touched });
    await expect(new GrokCliExecutor().execute(args)).rejects.toThrow('Accounting Base transport unavailable');
    expect(touched).not.toHaveBeenCalled(); empty(); expect(fixture.machine).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled();
  });
  it('persisted device drift at dequeue never substitutes fresh identity', async () => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-grok-cli'); const work = context.beforeAttempt(meta, supported, prepared);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?',
        [JSON.stringify({ ...JSON.parse(row.data), providerSpecificData: { ...specific(), deviceId: 'changed' } }), 'c']); }); return work;
    } };
    await expect(new GrokCliExecutor().execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
    expect(fixture.machine).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled();
  });
  it('absent persisted device is unsupported without machine fallback', async () => {
    const args = options(await createAccounting()); delete args.credentials.providerSpecificData.deviceId;
    await expect(new GrokCliExecutor().execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); empty(); expect(fixture.machine).not.toHaveBeenCalled();
  });
  it('same executor retains request-local unique request ids and monotonic connection turns concurrently', async () => {
    const executor = new GrokCliExecutor(), first = await createAccounting(), second = await createAccounting(), identities = [];
    fixture.network.mockImplementation((_url, init) => { identities.push(new Headers(init.headers)); return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }); });
    const results = await Promise.all([executor.execute(options(first)), executor.execute(options(second))]);
    await Promise.all(results.map(result => result.response.text())); expect(identities).toHaveLength(2);
    expect(identities.map(value => value.get('x-grok-turn-idx')).sort()).toEqual(['1', '2']);
    expect(identities[0].get('x-grok-session-id')).toBe(identities[1].get('x-grok-session-id'));
    expect(identities[0].get('x-grok-req-id')).not.toBe(identities[1].get('x-grok-req-id'));
    expect(executor._currentSessionId).toBeNull(); expect(executor._currentReqId).toBeNull(); expect(executor._currentTurnIdx).toBe(1); expect(executor._agentId).toBeNull();
    expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 104000 }, { state: 'settled', costNanoUsd: 104000 }]);
  });
  it('original pending precedes strict POST retaining actual reasoning/include and settles104000', async () => {
    const context = await createAccounting(), args = options(context), original = structuredClone(args.body), executor = new GrokCliExecutor();
    const transform = vi.spyOn(executor, 'transformRequest').mockImplementation(() => { throw new Error('Shared executor transformation not request-local'); });
    const headers = vi.spyOn(executor, 'buildHeaders').mockImplementation(() => { throw new Error('Shared executor headers not request-local'); });
    fixture.network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://cli-chat-proxy.grok.com/v1/responses'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error'); expect(JSON.parse(init.body)).toEqual(actualBody());
      const built = new Headers(init.headers); expect(built.get('authorization')).toBe('Bearer dummy-grok-oauth'); expect(built.get('x-grok-agent-id')).toBe('dummy-grok-device');
      expect(built.get('x-email')).toBe('dummy@example.invalid'); expect(built.get('x-userid')).toBe('dummy-grok-user'); expect(built.get('x-grok-model-override')).toBe('grok-build');
      expect(built.get('x-grok-req-id')).toMatch(/^[a-f0-9-]{36}$/); expect(built.get('x-grok-session-id')).toBe(built.get('x-grok-conv-id')); expect(built.get('x-grok-turn-idx')).toBe('1');
      expect(contract).toMatchObject({ singlePost: true, grokCliTransport: { model: 'grok-build', originalSerializedBody: JSON.stringify(original) } });
      expect(db.get('SELECT requestId,state FROM apiKeyAccounting')).toEqual({ requestId: context.requestId, state: 'pending' });
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await executor.execute(args); expect(await result.response.text()).toBe(wire()); expect(args.body).toEqual(original);
    expect(fixture.network).toHaveBeenCalledTimes(1); expect(rows()).toEqual([{ state: 'settled', costNanoUsd: 104000 }]);
    expect(transform).not.toHaveBeenCalled(); expect(headers).not.toHaveBeenCalled(); expect(fixture.machine).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled();
    expect(executor._currentSessionId).toBeNull(); expect(executor._currentReqId).toBeNull(); expect(executor._agentId).toBeNull();
  });
  it('missing original Grok wire refuses even unlimited zeroPOST/intent/gap', async () => {
    const context = await createAccounting();
    await expect(context.beforeAttempt({ provider: 'grok-cli', model: 'grok-build', endpoint: 'chat', connectionId: 'c' }, true)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' }); empty();
  });
  it('original unsupported metadata cannot be erased by legacy transforms into supported work', async () => {
    const args = options(await createAccounting()); args.body.metadata = { fixture: 'unsupported' }; const executor = new GrokCliExecutor();
    const transform = vi.spyOn(executor, 'transformRequest');
    await expect(executor.execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED });
    expect(transform).not.toHaveBeenCalled(); empty(); expect(fixture.machine).not.toHaveBeenCalled(); expect(fixture.refresh).not.toHaveBeenCalled();
  });
});
const rows = () => db.all('SELECT state,costNanoUsd FROM apiKeyAccounting');
