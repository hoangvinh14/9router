import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubExecutor } from 'open-sse/executors/github.js';
import { BUDGET_ERROR } from 'open-sse/config/apiKeyBudgetConstants.js';
const network = vi.hoisted(() => vi.fn());
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let db, directory, createAccounting;
const old = process.env.DATA_DIR;
const body = () => ({ model: 'gpt-5.2-codex', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fixture' }] }], stream: true, store: false, instructions: 'fixture instruction' });
const options = accounting => ({ model: 'gpt-5.2-codex', body: body(), stream: true, connectionId: 'c', accountingMode: 'native-github-responses-sse', accounting,
  credentials: { accessToken: 'dummy-github-oauth', copilotToken: 'dummy-copilot-token', connectionId: 'c', providerSpecificData: { copilotToken: 'dummy-copilot-token' } } });
const final = () => ({ id: 'resp_fixture', object: 'response', model: 'gpt-5.2-codex', status: 'completed', service_tier: 'default', error: null, incomplete_details: null,
  output: [], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } });
const wire = () => [{ type: 'response.created', response: { ...final(), status: 'in_progress', usage: null } }, { type: 'response.completed', response: final() }]
  .map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
beforeEach(async () => {
  vi.resetModules(); network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-github-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'github', authType: 'oauth', accessToken: 'dummy-github-oauth', providerSpecificData: { copilotToken: 'dummy-copilot-token' } }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','github',?)", [JSON.stringify({ 'gpt-5.2-codex': { input: '1', output: '2', cached: '0.1', reasoning: '2' } })]);
  });
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/responses', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old; });
const empty = () => { expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0); };
describe('internal native GitHub Responses original OAuth owner (test-first, not production route/refresh acceptance)', { timeout: 20000 }, () => {
  it('retained original wire counts toward queue ceiling five own ACKs/sixth refusal', async () => {
    const context = await createAccounting(), works = [];
    network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    for (let index = 0; index < 6; index++) {
      const args = options(context); args.body.input[0].content[0].text = 'x'.repeat(200000);
      // Real admission has no import await; observe all six outcomes immediately.
      works.push(new GithubExecutor().execute(args).then(value => ({ value }), error => ({ error })));
    }
    const outcomes = await Promise.all(works);
    expect(outcomes.slice(0, 5).every(result => result.value)).toBe(true);
    expect(outcomes[5].error).toBeDefined(); expect(network).toHaveBeenCalledTimes(5);
    for (const { value } of outcomes.slice(0, 5)) expect(await value.response.text()).toBe(wire());
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual(Array.from({ length: 5 }, () => ({ state: 'settled', costNanoUsd: 104000 })));
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('oversize original wire refuses before admission/intent/POST/gap', async () => {
    const args = options(await createAccounting()); args.body.input[0].content[0].text = 'x'.repeat(300000);
    await expect(new GithubExecutor().execute(args)).rejects.toThrow('Accounting Base transport unavailable'); empty();
  });
  it('persisted GitHub accessToken drift at dequeue refuses without rebuilding selected Copilot wire', async () => {
    const context = await createAccounting(), executor = new GithubExecutor();
    const refresh = vi.spyOn(executor, 'refreshCredentials').mockImplementation(() => { throw new Error('Fixture disallows refresh'); });
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-github-responses'); const work = context.beforeAttempt(meta, supported, prepared);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?',
        [JSON.stringify({ ...JSON.parse(row.data), accessToken: 'dummy-new-github' }), 'c']); }); return work;
    } };
    await expect(executor.execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty(); expect(refresh).not.toHaveBeenCalled();
  });
  it('actual POST remains original/frozen after caller token/body mutation at admission', async () => {
    const context = await createAccounting(); let args;
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-github-responses');
      expect(Object.isFrozen(prepared.headers)).toBe(true); expect(Object.isFrozen(prepared.githubResponsesTransport.githubConfig)).toBe(true);
      expect(Object.isFrozen(prepared.credentials.providerSpecificData)).toBe(true); expect(Reflect.set(prepared.headers, 'authorization', 'Bearer changed')).toBe(false);
      args.credentials.accessToken = 'changed'; args.credentials.copilotToken = 'changed'; args.credentials.providerSpecificData.copilotToken = 'changed'; args.body.input[0].content[0].text = 'changed';
      return context.beforeAttempt(meta, supported, prepared);
    } };
    args = options(accounting); network.mockImplementation((_url, init) => {
      expect(init.headers.authorization).toBe('Bearer dummy-copilot-token'); expect(JSON.parse(init.body)).toEqual(body());
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await new GithubExecutor().execute(args); expect(await result.response.text()).toBe(wire()); expect(network).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 104000 }]);
  });
  it.each(['copilotToken', 'githubToken', 'connection', 'body', 'config', 'request', 'headers', 'endpoint'])('original %s drift before enqueue refuses zeroPOST/intent/gap', async kind => {
    const context = await createAccounting();
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-github-responses'); const changed = structuredClone(prepared);
      if (kind === 'copilotToken') changed.credentials.copilotToken = 'changed';
      if (kind === 'githubToken') changed.credentials.accessToken = 'changed';
      if (kind === 'connection') changed.credentials.connectionId = 'other';
      if (kind === 'body') { const value = JSON.parse(changed.githubResponsesTransport.serializedBody); value.tools = []; changed.githubResponsesTransport.serializedBody = JSON.stringify(value); }
      if (kind === 'config') changed.githubResponsesTransport.githubConfig.responsesUrl = 'https://fixture.invalid/responses';
      if (kind === 'request') changed.githubResponsesTransport.requestId = 'changed';
      if (kind === 'headers') changed.headers.authorization = 'Bearer changed';
      return context.beforeAttempt(kind === 'endpoint' ? { ...meta, endpoint: 'embeddings' } : meta, supported, changed);
    } };
    await expect(new GithubExecutor().execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
  it.each(['bodyAccessor', 'bodyToJSON', 'credentialAccessor', 'proxy'])('programmable %s refuses without execution/POST/intent/gap', async kind => {
    const args = options(await createAccounting()), touched = vi.fn(() => { throw new Error('Fixture programmable input executed'); });
    if (kind === 'bodyAccessor') Object.defineProperty(args.body, 'input', { enumerable: true, get: touched });
    if (kind === 'bodyToJSON') Object.defineProperty(args.body, 'toJSON', { value: touched });
    if (kind === 'credentialAccessor') Object.defineProperty(args.credentials, 'copilotToken', { enumerable: true, get: touched });
    if (kind === 'proxy') args.proxyOptions = new Proxy({}, { ownKeys: touched, get: touched, getPrototypeOf: touched });
    await expect(new GithubExecutor().execute(args)).rejects.toThrow('Accounting Base transport unavailable'); expect(touched).not.toHaveBeenCalled(); empty();
  });
  it('persisted Copilot token drift at dequeue cannot fallback to GitHub token or rebuild', async () => {
    const context = await createAccounting(), executor = new GithubExecutor();
    const refresh = vi.spyOn(executor, 'refreshCredentials').mockImplementation(() => { throw new Error('Fixture disallows refresh'); });
    const accounting = { ...context, beforeAttempt(meta, supported, prepared) {
      expect(prepared.protocol).toBe('native-github-responses'); const work = context.beforeAttempt(meta, supported, prepared);
      db.durableTransaction(() => { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']); db.run('UPDATE providerConnections SET data=? WHERE id=?',
        [JSON.stringify({ ...JSON.parse(row.data), providerSpecificData: { copilotToken: 'dummy-new' } }), 'c']); }); return work;
    } };
    await expect(executor.execute(options(accounting))).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty(); expect(refresh).not.toHaveBeenCalled();
  });
  it('missing runtime Copilot token refuses instead of falling back to GitHub accessToken', async () => {
    const args = options(await createAccounting()); delete args.credentials.copilotToken;
    await expect(new GithubExecutor().execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); empty();
  });
  it('request-local UUIDs are distinct on one concurrent executor without route cache mutation', async () => {
    const executor = new GithubExecutor(), first = await createAccounting(), second = await createAccounting(), ids = [];
    network.mockImplementation((_url, init) => { ids.push(new Headers(init.headers).get('x-request-id')); return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }); });
    const results = await Promise.all([executor.execute(options(first)), executor.execute(options(second))]); await Promise.all(results.map(result => result.response.text()));
    expect(ids).toHaveLength(2); expect(ids[0]).toMatch(/^[a-f0-9-]{36}$/); expect(ids[1]).not.toBe(ids[0]); expect(executor.knownCodexModels.size).toBe(0);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 104000 }, { state: 'settled', costNanoUsd: 104000 }]);
  });
  it('explicit raw Responses owner cannot bypass intent/terminal through cached legacy route', async () => {
    const context = await createAccounting(), executor = new GithubExecutor(); executor.knownCodexModels.add('gpt-5.2-codex');
    const refresh = vi.spyOn(executor, 'refreshCredentials').mockImplementation(() => { throw new Error('Fixture disallows refresh'); });
    network.mockImplementation((url, init, _proxy, contract) => {
      expect(url).toBe('https://api.githubcopilot.com/responses'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer dummy-copilot-token'); expect(JSON.parse(init.body)).toEqual(body());
      expect(contract).toMatchObject({ singlePost: true, githubResponsesTransport: { model: 'gpt-5.2-codex' } });
      expect(db.get('SELECT requestId,state FROM apiKeyAccounting')).toEqual({ requestId: context.requestId, state: 'pending' });
      return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await executor.execute(options(context)); expect(await result.response.text()).toBe(wire());
    expect(network).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 104000 }]);
    expect(refresh).not.toHaveBeenCalled(); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('missing original GitHub Responses wire refuses even unlimited before intent/POST/gap', async () => {
    const context = await createAccounting();
    await expect(context.beforeAttempt({ provider: 'github', model: 'gpt-5.2-codex', endpoint: 'chat', connectionId: 'c' }, true)).rejects.toMatchObject({ code: BUDGET_ERROR.UNAVAILABLE }); empty();
  });
  it('unsupported original cannot reach cached direct generation and bypass local owner', async () => {
    const executor = new GithubExecutor(); executor.knownCodexModels.add('gpt-5.2-codex');
    const args = options(await createAccounting()); args.body.metadata = { fixture: 'unsupported' };
    network.mockImplementation(() => new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }));
    await expect(executor.execute(args)).rejects.toMatchObject({ code: BUDGET_ERROR.UNSUPPORTED }); empty();
  });
});
