import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDataDir = process.env.DATA_DIR;
const fixture = fs.readFileSync(new URL('../fixtures/pricing/models-dev-minimal.json', import.meta.url), 'utf8');
let root, db, sync, schedule, scheduler;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-schedule-'));
  process.env.DATA_DIR = root; delete global._dbAdapter; vi.resetModules();
  db = await (await import('../../src/lib/db/driver.js')).getAdapter();
  sync = await import('../../src/lib/pricing/catalogSync.js');
  schedule = await import('../../src/lib/pricing/catalogSchedule.js');
  scheduler = await import('../../src/lib/pricing/catalogScheduler.js');
  scheduler.configureCatalogScheduler(false);
});
afterEach(() => {
  scheduler?.configureCatalogScheduler(false); vi.restoreAllMocks(); vi.useRealTimers();
  db?.close(); delete global._dbAdapter;
  fs.rmSync(root, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
});
describe('serialized reference schedule and catalog lifecycle', () => {
  it('status GET is side effect free for scheduler; default off, no immediate fetch or new signal handlers', async () => {
    const counts = ['SIGINT', 'SIGTERM', 'exit'].map(signal => process.listenerCount(signal));
    expect((await sync.getCatalogStatus()).schedulerConfigured).toBe(false);
    expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
    expect(await schedule.initializeCatalogSchedule()).toEqual({ schedulerConfigured: false, schedulerEnabled: false });
    expect(['SIGINT', 'SIGTERM', 'exit'].map(signal => process.listenerCount(signal))).toEqual(counts);
  });
  it('persists enable/disable serially, reopens configuration, and never fetches on configure', async () => {
    await Promise.all([schedule.setCatalogSchedule(true), schedule.setCatalogSchedule(false)]);
    expect(schedule.readCatalogScheduleSync(db)).toBe(false);
    expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
    await schedule.setCatalogSchedule(true);
    expect((await sync.getCatalogStatus()).schedulerEnabled).toBe(true);
    scheduler.configureCatalogScheduler(false); db.close();
    db = await (await import('../../src/lib/db/driver.js')).getAdapter();
    expect(schedule.readCatalogScheduleSync(db)).toBe(true);
    expect((await schedule.initializeCatalogSchedule()).schedulerEnabled).toBe(true);
  });
  it('single-flight catalog publication leaves overrides and in-flight disable unchanged', async () => {
    await schedule.setCatalogSchedule(true);
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','fixture','{}')"));
    let finish, admitted;
    const gate = new Promise(resolve => { finish = resolve; });
    const started = new Promise(resolve => { admitted = resolve; });
    const fetchImpl = vi.fn(async () => { admitted(); await gate; return new Response(fixture); });
    const first = sync.syncCatalog({ fetchImpl }), second = sync.syncCatalog({ fetchImpl });
    await started;
    await schedule.setCatalogSchedule(false);
    finish(); await Promise.all([first, second]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await sync.getStoredCatalog()).entries['openai/gpt-5'].rates.input).toBe('1.25');
    expect(schedule.readCatalogScheduleSync(db)).toBe(false);
    expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
    expect(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='fixture'").value).toBe('{}');
  });
  it('offline failure preserves last-good and reports only redacted status', async () => {
    await sync.syncCatalog({ fetchImpl: async () => new Response(fixture) });
    const previous = await sync.getStoredCatalog();
    await expect(sync.syncCatalog({ fetchImpl: async () => { throw new Error('sensitive offline trace'); } })).rejects.toThrow();
    expect(await sync.getStoredCatalog()).toEqual(previous);
    expect((await sync.getCatalogStatus()).error).toBe('pricing_sync_failed');
  });
  it('24h timer stays single; unhealthy/no-owner adapter never admits fetch and disable stops future calls', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {}), adapter = vi.fn(async () => ({ health: () => ({ healthy: true }) }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scheduler.configureCatalogScheduler(true, { sync: run, adapter });
    scheduler.configureCatalogScheduler(true, { sync: run, adapter });
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); expect(run).toHaveBeenCalledTimes(1);
    adapter.mockResolvedValue({ health: () => ({ healthy: false }) });
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); expect(run).toHaveBeenCalledTimes(1);
    adapter.mockRejectedValue(new Error('not owner'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); expect(warning).toHaveBeenCalled();
    scheduler.configureCatalogScheduler(false);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); expect(run).toHaveBeenCalledTimes(1);
  });
});
