import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
let directory, db, schedule, scheduler, sync;
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pricing-schedule-"));
  vi.stubEnv("DATA_DIR", directory); delete global._dbAdapter; vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  schedule = await import("@/lib/pricing/catalogSchedule.js"); scheduler = await import("@/lib/pricing/catalogScheduler.js"); sync = await import("@/lib/pricing/catalogSync.js");
  scheduler.configureCatalogScheduler(false);
});
afterEach(() => {
  scheduler.configureCatalogScheduler(false); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close(); delete global._dbAdapter; vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true });
});
const day = 24 * 60 * 60 * 1000;
const fixture = fs.readFileSync(new URL("../fixtures/pricing/models-dev-minimal.json", import.meta.url), "utf8");
describe("durable opt-in pricing scheduler", () => {
  it("default off observational status, explicit startup no immediate fetch and duplicate no extra timer", async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(async () => new Response(fixture)); vi.stubGlobal("fetch", fetcher);
    expect((await sync.getCatalogStatus()).schedulerConfigured).toBe(false);
    await schedule.initializeCatalogSchedule(); expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
    await schedule.setCatalogSchedule(true); await schedule.initializeCatalogSchedule(); await schedule.initializeCatalogSchedule();
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(day);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await schedule.setCatalogSchedule(false); await vi.advanceTimersByTimeAsync(day);
    expect(fetcher).toHaveBeenCalledTimes(1); expect((await sync.getCatalogStatus()).schedulerConfigured).toBe(false);
  });
  it("serialized concurrent enable/disable applies latest durable state", async () => {
    vi.useFakeTimers();
    await Promise.all([schedule.setCatalogSchedule(true), schedule.setCatalogSchedule(false)]);
    expect(schedule.readCatalogScheduleSync(db)).toBe(false); expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
  });
  it("durable failure never enables timer; acknowledged configuration failure is explicit", async () => {
    const durable = vi.spyOn(db, "durableTransaction").mockImplementation(() => { throw new Error("durability failed"); });
    await expect(schedule.setCatalogSchedule(true)).rejects.toThrow(); expect(scheduler.isCatalogSchedulerEnabled()).toBe(false); durable.mockRestore();
    vi.spyOn(global, "setInterval").mockImplementation(() => { throw new Error("timer unavailable"); });
    await expect(schedule.setCatalogSchedule(true)).rejects.toMatchObject({ configurationSaved: true });
    expect(schedule.readCatalogScheduleSync(db)).toBe(true); expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
    vi.restoreAllMocks(); await schedule.setCatalogSchedule(true); expect(scheduler.isCatalogSchedulerEnabled()).toBe(true);
  });
  it("stored schedule survives reopen, explicit startup only; malformed state blocks", async () => {
    await schedule.setCatalogSchedule(true); scheduler.configureCatalogScheduler(false);
    db.close(); delete global._dbAdapter;
    db = await (await import("@/lib/db/driver.js")).getAdapter();
    expect((await sync.getCatalogStatus()).schedulerConfigured).toBe(true); expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
    await schedule.initializeCatalogSchedule(); expect(scheduler.isCatalogSchedulerEnabled()).toBe(true); scheduler.configureCatalogScheduler(false);
    db.durableTransaction(() => db.run("UPDATE kv SET value='malformed' WHERE scope='referencePricing' AND key='schedule'"));
    await expect(schedule.initializeCatalogSchedule()).rejects.toThrow(); expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
  });
  it("maintenance and unhealthy state skip fetch without destroying retry timer", async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(async () => new Response(fixture)); vi.stubGlobal("fetch", fetcher);
    await schedule.setCatalogSchedule(true);
    const status = vi.spyOn(db.coverage, "status").mockReturnValue({ maintenance: { reason: "fixture" } });
    await vi.advanceTimersByTimeAsync(day); expect(fetcher).not.toHaveBeenCalled(); expect(scheduler.isCatalogSchedulerEnabled()).toBe(true); status.mockRestore();
    const health = vi.spyOn(db, "health").mockReturnValue({ healthy: false });
    await vi.advanceTimersByTimeAsync(day); expect(fetcher).not.toHaveBeenCalled(); health.mockRestore();
    await vi.advanceTimersByTimeAsync(day); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("manual/scheduled singleflight and disable during fetch prevent new work, allow in-flight publish", async () => {
    vi.useFakeTimers(); let finish;
    const fetcher = vi.fn(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetcher);
    await schedule.setCatalogSchedule(true); await vi.advanceTimersByTimeAsync(day);
    const manual = sync.syncCatalog(); expect(fetcher).toHaveBeenCalledTimes(1);
    await schedule.setCatalogSchedule(false); finish(new Response(fixture)); await manual;
    expect((await sync.getStoredCatalog()).revision).toMatch(/^[a-f0-9]{64}$/);
    await vi.advanceTimersByTimeAsync(day); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
