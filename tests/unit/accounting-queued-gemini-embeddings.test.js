import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import adapter from '../../open-sse/handlers/embeddingProviders/gemini.js';
import { PROVIDER_MEDIA } from '../../open-sse/providers/index.js';
import { normalizeExactUsage } from '../../open-sse/utils/exactUsage.js';
import { FORMATS } from '../../open-sse/translator/formats.js';
import { captureAccountingProxyEnvironment } from '../../open-sse/config/accountedProxyEnvironment.js';
const network = vi.hoisted(() => vi.fn());
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => network(...args) }));
// Module transformation only. No DB/health/network/ledger warm-up.
await Promise.all([import('@/lib/apiKeyBudget/requestAccounting.js'), import('../../open-sse/handlers/embeddingsCore.js')]);
let db, directory, context, wire;
const oldData = process.env.DATA_DIR;
const meta = { provider: 'gemini', model: 'gemini-embedding-001', endpoint: 'embeddings', connectionId: 'connection-a' };
const usage = normalizeExactUsage({ promptTokenCount: 10 }, FORMATS.GEMINI, 'embeddings');
beforeEach(async () => {
  vi.resetModules(); network.mockReset(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queued-gemini-embedding-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'key-a', key: 'fixture-gateway' }, { id: 'key-b', key: 'fixture-gateway-b' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://fixture-proxy.invalid:3210', outboundNoProxy: '' },
    providerConnections: [{ id: 'connection-a', provider: 'gemini', authType: 'apikey', apiKey: 'fixture-upstream', priority: 2 }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','gemini',?)", [JSON.stringify({ 'gemini-embedding-001': { input: '1' } })]);
  });
  const { createRequestAccounting } = await import('@/lib/apiKeyBudget/requestAccounting.js');
  context = await createRequestAccounting(new Request('http://localhost/v1/embeddings', { headers: { Authorization: 'Bearer fixture-gateway' } }), { adapter: async () => db, queued: true });
  const original = { model: meta.model, input: 'fixture original', dimensions: 3 }, credentials = { apiKey: 'fixture-upstream', providerSpecificData: {} };
  const actual = adapter.buildBody(meta.model, original);
  wire = { protocol: 'native-gemini-embeddings', proxyEnvironment: captureAccountingProxyEnvironment(), geminiEmbeddingTransport: {
    model: meta.model, original, actual, credentials, mediaConfig: PROVIDER_MEDIA.gemini.embeddingConfig,
    headers: adapter.buildHeaders(credentials), url: adapter.buildUrl(meta.model, credentials, { input: original.input }), serialized: JSON.stringify(actual),
    proxyOptions: { persistedGlobalProxy: { url: 'http://fixture-proxy.invalid:3210', noProxy: '' } } } };
});
afterEach(() => { db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (oldData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldData; });
async function positive() {
  const handle = await context.beforeAttempt(meta, true, wire);
  expect(Object.isFrozen(handle)).toBe(true); expect(handle.requestId).toBe(context.requestId);
  expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [handle.attemptId])).toEqual({ state: 'pending' });
  const terminal = await context.completeAttempt(handle, { usage, outcome: 'success' });
  context.assertSuccessfulTerminal(terminal);
  expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handle.attemptId])).toEqual({ state: 'settled', costNanoUsd: 10000 });
  return handle;
}
describe('queued Gemini embedding real group service admission, mock POST not native support proof', { timeout: 20000 }, () => {
  it.each(['delivered', 'held-terminal', 'post-admission-drift'])('queued core owner own intent/completion and post-await authority: %s', async mode => {
    await positive();
    const { bindQueuedGeminiEmbeddingAccounting } = await import('@/lib/apiKeyBudget/queuedGeminiEmbeddingAccounting.js');
    const { handleEmbeddingsCore } = await import('../../open-sse/handlers/embeddingsCore.js');
    const bound = bindQueuedGeminiEmbeddingAccounting({ db, credential: 'fixture-gateway', accounting: context,
      connectionId: meta.connectionId, wire });
    let release, entered, attempt, completions = 0, returned = false;
    const held = new Promise(resolve => { release = resolve; }), enteredWork = new Promise(resolve => { entered = resolve; });
    const accounting = { ...bound, async beforeAttempt(...args) {
      attempt = await bound.beforeAttempt(...args);
      if (mode === 'post-admission-drift') db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1',
        [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://changed.invalid:3210' })]));
      return attempt;
    }, async completeAttempt(...args) {
      const terminal = await bound.completeAttempt(...args); completions++;
      if (mode === 'held-terminal') { entered(); await held; }
      return terminal;
    } };
    network.mockImplementation((_url, init, _proxy, contract) => {
      expect(contract.singlePost).toBe(true); expect(contract.geminiEmbeddingTransport).toEqual(wire.geminiEmbeddingTransport);
      expect(init.method).toBe('POST'); expect(init.redirect).toBe('error');
      expect(db.get('SELECT requestId,state FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId])).toEqual({ requestId: context.requestId, state: 'pending' });
      return Response.json({ embedding: { values: [0.1, 0.2, 0.3] }, usageMetadata: { promptTokenCount: 10 } });
    });
    const work = handleEmbeddingsCore({ body: wire.geminiEmbeddingTransport.original, modelInfo: { provider: 'gemini', model: meta.model },
      credentials: wire.geminiEmbeddingTransport.credentials, proxyOptions: wire.geminiEmbeddingTransport.proxyOptions,
      accounting, connectionId: meta.connectionId }).then(value => ({ value }), error => ({ error }));
    const observed = work.then(result => { returned = true; return result; });
    try {
      if (mode === 'held-terminal') {
        expect(await Promise.race([enteredWork.then(() => null), observed])).toBeNull(); expect(returned).toBe(false);
        expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId])).toEqual({ state: 'settled', costNanoUsd: 10000 });
      }
      release(); const result = await observed;
      if (mode === 'post-admission-drift') {
        expect(result.error).toMatchObject({ code: 'api_key_accounting_unavailable' }); expect(network).not.toHaveBeenCalled();
        expect(db.get('SELECT state,outcome FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId])).toEqual({ state: 'not_dispatched', outcome: 'routing_refused' });
      } else {
        expect(result.error).toBeUndefined(); expect(result.value.success).toBe(true); expect(network).toHaveBeenCalledTimes(1);
        expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [attempt.attemptId])).toEqual({ state: 'settled', costNanoUsd: 10000 });
      }
      expect(completions).toBe(1);
    } finally { release(); await observed; }
  });
  it('exact queued-origin bound positive retains original completion sink and issued request/key', async () => {
    await positive();
    const { bindQueuedGeminiEmbeddingAccounting } = await import('@/lib/apiKeyBudget/queuedGeminiEmbeddingAccounting.js');
    const bound = bindQueuedGeminiEmbeddingAccounting({ db, credential: 'fixture-gateway', accounting: context,
      connectionId: meta.connectionId, wire });
    expect(bound.completeAttempt).toBe(context.completeAttempt);
    const handle = await bound.beforeAttempt(meta, true, wire);
    expect(handle.requestId).toBe(context.requestId); expect(handle.apiKeyId).toBe('key-a');
    const terminal = await bound.completeAttempt(handle, { usage, outcome: 'success' }); bound.assertSuccessfulTerminal(terminal);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handle.attemptId])).toEqual({ state: 'settled', costNanoUsd: 10000 });
  });
  it.each(['copy', 'getter', 'wrong-key', 'synchronous'])('queued binding rejects %s provenance before caller method reads', async kind => {
    await positive();
    const { bindQueuedGeminiEmbeddingAccounting } = await import('@/lib/apiKeyBudget/queuedGeminiEmbeddingAccounting.js');
    const { createRequestAccounting } = await import('@/lib/apiKeyBudget/requestAccounting.js');
    let candidate = context, reads = 0;
    if (kind === 'copy') candidate = { ...context };
    if (kind === 'getter') candidate = { get requiresPreparedBaseWire() { reads++; throw new Error('fixture-private-origin'); } };
    if (kind === 'wrong-key' || kind === 'synchronous') candidate = await createRequestAccounting(new Request('http://localhost/v1/embeddings',
      { headers: { Authorization: `Bearer ${kind === 'wrong-key' ? 'fixture-gateway-b' : 'fixture-gateway'}` } }),
      { adapter: async () => db, queued: kind === 'wrong-key' });
    expect(() => bindQueuedGeminiEmbeddingAccounting({ db, credential: 'fixture-gateway', accounting: candidate,
      connectionId: meta.connectionId, wire })).toThrow('API key accounting storage unavailable');
    expect(reads).toBe(0); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 10000 }]);
  });
  it('bound complete original wire cannot be replaced before intent', async () => {
    await positive();
    const { bindQueuedGeminiEmbeddingAccounting } = await import('@/lib/apiKeyBudget/queuedGeminiEmbeddingAccounting.js');
    const bound = bindQueuedGeminiEmbeddingAccounting({ db, credential: 'fixture-gateway', accounting: context,
      connectionId: meta.connectionId, wire });
    const changed = structuredClone(wire); changed.geminiEmbeddingTransport.original.input = 'changed';
    changed.geminiEmbeddingTransport.actual = adapter.buildBody(meta.model, changed.geminiEmbeddingTransport.original);
    changed.geminiEmbeddingTransport.serialized = JSON.stringify(changed.geminiEmbeddingTransport.actual);
    await expect(Promise.resolve().then(() => bound.beforeAttempt(meta, true, changed))).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 10000 }]);
  });
  it('fresh bound terminal authority refusal never discards already dispatched original settlement', async () => {
    await positive();
    const { bindQueuedGeminiEmbeddingAccounting } = await import('@/lib/apiKeyBudget/queuedGeminiEmbeddingAccounting.js');
    const bound = bindQueuedGeminiEmbeddingAccounting({ db, credential: 'fixture-gateway', accounting: context,
      connectionId: meta.connectionId, wire });
    const handle = await bound.beforeAttempt(meta, true, wire);
    db.durableTransaction(() => db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: true,
      outboundProxyUrl: 'http://changed.invalid:3210', outboundNoProxy: '' })]));
    const terminal = await bound.completeAttempt(handle, { usage, outcome: 'success' });
    expect(() => bound.assertSuccessfulTerminal(terminal)).toThrow('API key accounting storage unavailable');
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handle.attemptId])).toEqual({ state: 'settled', costNanoUsd: 10000 });
  });
  it('own queued admission and terminal handle preserve original10000 price despite successor repricing', async () => {
    const handle = await context.beforeAttempt(meta, true, wire);
    expect(db.get('SELECT state FROM apiKeyAccounting WHERE attemptId=?', [handle.attemptId])).toEqual({ state: 'pending' });
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ 'gemini-embedding-001': { input: '9' } })]));
    const terminal = await context.completeAttempt(handle, { usage, outcome: 'success' }); context.assertSuccessfulTerminal(terminal);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [handle.attemptId])).toEqual({ state: 'settled', costNanoUsd: 10000 });
  });
  it.each(['credential', 'settings', 'selection', 'price'])('fresh %s drift at dequeue refuses intent after accepted real positive', async kind => {
    await positive(); const work = context.beforeAttempt(meta, true, wire);
    // Same turn, after enqueue but before the existing microtask coordinator.
    work.catch(() => {});
    db.durableTransaction(() => {
      if (kind === 'credential') { const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['connection-a']); db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'changed' }), 'connection-a']); }
      if (kind === 'settings') db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://changed.invalid:3210' })]);
      if (kind === 'selection') db.run('INSERT INTO providerConnections(id,provider,authType,priority,isActive,data,createdAt,updatedAt) SELECT ?,?,?,?,?,?,createdAt,updatedAt FROM providerConnections WHERE id=?', ['connection-b', 'gemini', 'apikey', 1, 1, JSON.stringify({ apiKey: 'fixture-other' }), 'connection-a']);
      if (kind === 'price') db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='gemini'", [JSON.stringify({ 'gemini-embedding-001': { input: '9' } })]);
    });
    await expect(work).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT requestId,state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ requestId: context.requestId, state: 'settled', costNanoUsd: 10000 }]);
    expect(db.coverage.status('key-a').gaps).toHaveLength(0);
  });
  it.each(['missing', 'wrong-endpoint', 'wrong-protocol'])('refuses %s without intent after real positive', async kind => {
    await positive();
    await expect(context.beforeAttempt(kind === 'wrong-endpoint' ? { ...meta, endpoint: 'chat' } : meta, true,
      kind === 'missing' ? null : kind === 'wrong-protocol' ? { ...wire, protocol: 'native-gemini' } : wire)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 10000 }]);
  });
});
