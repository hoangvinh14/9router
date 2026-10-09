import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const network = vi.hoisted(() => vi.fn());
vi.mock('../../open-sse/config/providers.js', async importOriginal => ({ ...(await importOriginal()),
  PROVIDERS: { ...(await importOriginal()).PROVIDERS, openai: { baseUrl: 'http://fixture.invalid/chat' } } }));
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
let db, directory, BaseExecutor, context;
const previousData = process.env.DATA_DIR;
beforeEach(async () => {
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NINE_ROUTER_PROXY_MANAGED', 'NINE_ROUTER_PROXY_URL', 'NINE_ROUTER_NO_PROXY']) vi.stubEnv(key, '');
  vi.stubEnv('HTTP_PROXY', 'http://dummy-original.invalid');
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-env-proxy-')); process.env.DATA_DIR = directory; delete global._dbAdapter; vi.resetModules(); network.mockReset();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'openai', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','openai',?)", [JSON.stringify({ 'fixture-chat': { input: '1', output: '2' } })]);
  });
  ({ BaseExecutor } = await import('../../open-sse/executors/base.js'));
  context = await (await import('@/lib/apiKeyBudget/requestAccounting.js')).createRequestAccounting(new Request('http://localhost/v1/chat/completions', {
    headers: { Authorization: 'Bearer dummy-key' } }), { adapter: async () => db, queued: true });
  network.mockImplementation(async () => Response.json({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
});
afterEach(() => {
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs();
  if (previousData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousData;
});
describe('queued mutable external proxy environment authority (mock POST, dummy restored env)', () => {
  it.each(['HTTP_PROXY', 'NO_PROXY'])('%s changed during queue wait refuses original route before POST', async variable => {
    const accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      vi.stubEnv(variable, variable === 'HTTP_PROXY' ? 'http://dummy-changed.invalid' : 'fixture.invalid'); return work;
    } };
    const ex = new BaseExecutor('openai', { baseUrl: 'http://fixture.invalid/chat', retry: { 502: { attempts: 0, delayMs: 0 } } });
    await expect(ex.execute({ accounting, connectionId: 'c', model: 'fixture-chat', stream: false, credentials: { apiKey: 'dummy-provider' },
      body: { messages: [{ role: 'user', content: 'fixture' }] } })).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(network).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
