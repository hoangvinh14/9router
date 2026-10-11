import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
let db, directory, api;
const previous = process.env.DATA_DIR;
await import('@/lib/db/driver.js');
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-routing-material-')); process.env.DATA_DIR = directory;
  delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ settings: { requireApiKey: true },
    combos: [{ id: 'outer-id', name: 'outer', models: ['openai/a', 'openai/b'] }], modelAliases: { alias: 'openai/a' } });
  api = await import('@/lib/apiKeyBudget/persistedRoutingGraph.js');
});
afterEach(() => { db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
const leaf = token => ({ id: token, kind: 'leaf', provider: 'openai', model: token, evidence: {} });
describe('owned persisted routing material binds across graph resolver awaits, UNWIRED dispatch', () => {
  it('captures actual DB material and keeps unchanged graph current', async () => {
    const resolve = vi.fn(async token => token === 'outer' ? { id: 'outer-id', kind: 'fusion', models: ['a', 'b'], judge: 'j', evidence: {} } : leaf(token));
    const proof = await api.capturePersistedRoutingGraph(db, 'outer', { resolve, gate() {} });
    expect(proof.graph.count).toBe(6); expect(proof.material.combos[0].name).toBe('outer');
    expect(Object.isFrozen(proof.material)).toBe(true);
    expect(() => api.assertPersistedRoutingMaterialCurrent(db, proof.material, () => {})).not.toThrow();
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it.each(['settings', 'combo', 'alias', 'provider-node'])('refuses %s mutation inside resolver before capturing successor', async kind => {
    const resolve = vi.fn(async token => {
      if (kind === 'settings') db.run('UPDATE settings SET data=? WHERE id=1', [JSON.stringify({ requireApiKey: false })]);
      if (kind === 'combo') db.run('UPDATE combos SET models=? WHERE id=?', ['["openai/c"]', 'outer-id']);
      if (kind === 'alias') db.run("UPDATE kv SET value=? WHERE scope='modelAliases' AND key='alias'", ['"openai/c"']);
      if (kind === 'provider-node') await (await import('@/lib/db/repos/nodesRepo.js')).createProviderNode({ id: 'n', type: 'openai-compatible', name: 'fixture node', prefix: 'custom', baseUrl: 'http://fixture.invalid/chat' });
      return leaf(token);
    });
    await expect(api.capturePersistedRoutingGraph(db, 'a', { resolve, gate() {} })).rejects.toThrow('Persisted accounting routing graph unavailable');
    expect(resolve).toHaveBeenCalledTimes(1); expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('later drift refuses retained material, never rebuilds it', async () => {
    const material = api.capturePersistedRoutingMaterialSync(db);
    db.run('UPDATE combos SET models=? WHERE id=?', ['["openai/new"]', 'outer-id']);
    expect(() => api.assertPersistedRoutingMaterialCurrent(db, material, () => {})).toThrow('Persisted accounting routing graph unavailable');
    expect(material.combos[0].models).toBe('["openai/a","openai/b"]');
  });
  it('rejects malformed persisted JSON before resolver invocation', async () => {
    db.run("UPDATE kv SET value='{' WHERE scope='modelAliases' AND key='alias'");
    const resolve = vi.fn(async token => leaf(token));
    await expect(api.capturePersistedRoutingGraph(db, 'a', { resolve, gate() {} })).rejects.toThrow('Persisted accounting routing graph unavailable');
    expect(resolve).not.toHaveBeenCalled();
  });
  it('owned retained snapshot still reads current DB and invokes every fresh gate', () => {
    const material = api.capturePersistedRoutingMaterialSync(db);
    const get = vi.spyOn(db, 'get'), all = vi.spyOn(db, 'all'), gate = vi.fn();
    api.assertPersistedRoutingMaterialCurrent(db, material, gate);
    api.assertPersistedRoutingMaterialCurrent(db, material, gate);
    expect(gate).toHaveBeenCalledTimes(2);
    expect(get.mock.calls.filter(([sql]) => sql === 'SELECT data FROM settings WHERE id=1')).toHaveLength(2);
    expect(all.mock.calls.filter(([sql]) => sql === 'SELECT * FROM combos ORDER BY id')).toHaveLength(2);
    expect(all.mock.calls.filter(([sql]) => sql.includes("scope='modelAliases'"))).toHaveLength(2);
    expect(all.mock.calls.filter(([sql]) => sql === 'SELECT * FROM providerNodes ORDER BY id')).toHaveLength(2);
    const reason = new Error('fixture owned retained gate refused');
    expect(() => api.assertPersistedRoutingMaterialCurrent(db, material, () => { throw reason; })).toThrow(reason);
  });
  it('snapshot appearance alone never bypasses plain-data guards', () => {
    const material = api.capturePersistedRoutingMaterialSync(db), getter = vi.fn(() => material.settings);
    const hostile = Object.freeze({ ...material, get settings() { return getter(); } });
    expect(() => api.assertPersistedRoutingMaterialCurrent(db, hostile, () => {})).toThrow('Accounting group payload unavailable');
    expect(getter).not.toHaveBeenCalled();
    const trap = vi.fn(); const proxy = new Proxy(material, { get: trap });
    expect(() => api.assertPersistedRoutingMaterialCurrent(db, proxy, () => {})).toThrow('Accounting group payload unavailable');
    expect(trap).not.toHaveBeenCalled();
    const forged = structuredClone(material); forged.extra = 'x'.repeat(262144);
    expect(() => api.assertPersistedRoutingMaterialCurrent(db, forged, () => {})).toThrow('Accounting group payload unavailable');
  });
  it('owned retained snapshot never hides current read or coverage failure', () => {
    const material = api.capturePersistedRoutingMaterialSync(db), get = db.get.bind(db);
    vi.spyOn(db, 'get').mockImplementation((sql, ...args) => {
      if (sql === 'SELECT data FROM settings WHERE id=1') throw new Error('fixture current routing read unavailable');
      return get(sql, ...args);
    });
    expect(() => api.assertPersistedRoutingMaterialCurrent(db, material, () => {})).toThrow('fixture current routing read unavailable');
    vi.restoreAllMocks();
    vi.spyOn(db.coverage, 'status').mockImplementation(() => { throw new Error('fixture coverage unavailable'); });
    expect(() => api.assertPersistedRoutingMaterialCurrent(db, material, () => {})).toThrow('fixture coverage unavailable');
    vi.restoreAllMocks();
  });
  it('fresh gate failure never becomes cached routing authority', async () => {
    const reason = new Error('fixture fresh gate refused'); let calls = 0;
    const resolve = vi.fn(async token => leaf(token));
    await expect(api.capturePersistedRoutingGraph(db, 'a', { resolve, gate() { if (++calls === 3) throw reason; } })).rejects.toBe(reason);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
