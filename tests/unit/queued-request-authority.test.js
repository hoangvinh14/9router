import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { captureQueuedRequestAuthoritySync } from '@/lib/apiKeyBudget/queuedRequestAuthority.js';

let db, dir;
const original = process.env.DATA_DIR;
const input = { credential: 'dummy-authority', apiKeyId: 'a', provider: 'fixture', model: 'fixture', connectionId: 'c' };
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-queue-authority-')); process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: input.credential }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'fixture', authType: 'apikey', apiKey: 'dummy-provider', providerSpecificData: { proxyPoolId: 'p' } }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO proxyPools(id,isActive,data,createdAt,updatedAt) VALUES('p',1,?, ?, ?)", [JSON.stringify({ proxyUrl: 'http://dummy.invalid' }), '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);
  });
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(dir, { recursive: true, force: true }); if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original; });
const capture = () => captureQueuedRequestAuthoritySync(db, input);
describe('healthy queued request equality material (not supported transport authority)', () => {
  it('unchanged view is detached/frozen, no writes or mutation authority', () => {
    const run = vi.spyOn(db, 'run'), durable = vi.spyOn(db, 'durableTransaction');
    const a = capture(), b = capture(); expect(a).toEqual(b); expect(a).not.toBe(b);
    expect(Object.isFrozen(a)).toBe(true); expect(Object.isFrozen(a.connection)).toBe(true);
    expect(a).toMatchObject({ apiKeyId: 'a', connectionId: 'c', proxyPool: { id: 'p' } });
    expect(run).not.toHaveBeenCalled(); expect(durable).not.toHaveBeenCalled();
  });
  it.each(['settings', 'credentials', 'pool'])('%s mutation changes exact equality material', change => {
    const before = capture();
    db.durableTransaction(() => {
      if (change === 'settings') db.run("UPDATE settings SET data='{}' WHERE id=1");
      if (change === 'credentials') db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated', providerSpecificData: { proxyPoolId: 'p' } })]);
      if (change === 'pool') db.run("UPDATE proxyPools SET data=? WHERE id='p'", [JSON.stringify({ proxyUrl: 'http://dummy-changed.invalid' })]);
    });
    expect(capture()).not.toEqual(before);
  });
  it.each(['key', 'binding', 'missing-binding', 'connection', 'pool', 'settings'])('missing/invalid %s never manufactures queued exemption', change => {
    db.durableTransaction(() => {
      if (change === 'key') db.run("UPDATE apiKeys SET key='rotated' WHERE id='a'");
      if (change === 'binding') db.run("UPDATE apiKeyBindings SET fingerprint='broken' WHERE apiKeyId='a'");
      if (change === 'missing-binding') db.run("DELETE FROM apiKeyBindings WHERE apiKeyId='a'");
      if (change === 'connection') db.run("UPDATE providerConnections SET isActive=0 WHERE id='c'");
      if (change === 'pool') db.run("DELETE FROM proxyPools WHERE id='p'");
      if (change === 'settings') db.run("UPDATE settings SET data='[]' WHERE id=1");
    });
    expect(capture).toThrow();
  });
  it('poisoned/closed/maintenance authority never reads normal RAM as persisted exception', () => {
    vi.spyOn(db, 'health').mockReturnValue({ healthy: false, poisoned: true, closed: false });
    const get = vi.spyOn(db, 'get'); expect(capture).toThrow(); expect(get).not.toHaveBeenCalled();
    vi.restoreAllMocks(); const status = db.coverage.status.bind(db.coverage);
    vi.spyOn(db.coverage, 'status').mockImplementation(key => ({ ...status(key), maintenance: {} })); expect(capture).toThrow();
  });
});
