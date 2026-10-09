import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ adapter: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: (...args) => mocks.adapter(...args) }));
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({ getSettings: (...args) => mocks.settings(...args) }));
const events = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let initial, db;
const counts = () => events.map(event => process.listenerCount(event));
const changedCounts = n => initial.map(count => count + n);
beforeEach(() => {
  vi.useFakeTimers(); vi.resetModules(); initial = counts();
  db = { transaction: fn => fn(), run: vi.fn(), get: () => ({ c: 0 }) };
  mocks.adapter.mockReset().mockResolvedValue(db);
  mocks.settings.mockReset().mockResolvedValue({ enableObservability: true, observabilityBatchSize: 20, observabilityFlushIntervalMs: 100 });
});
afterEach(async () => { await vi.runAllTimersAsync(); vi.useRealTimers(); vi.unstubAllEnvs(); });
const load = () => import("@/lib/db/repos/requestDetailsRepo.js");
it("repeated cold imports and disabled saves do not register shutdown listeners", async () => {
  for (let n = 0; n < 12; n++) { vi.resetModules(); await load(); }
  expect(counts()).toEqual(initial);
  mocks.settings.mockResolvedValue({ enableObservability: false });
  await (await load()).saveRequestDetail({ id: "disabled" });
  expect(counts()).toEqual(initial); expect(mocks.adapter).not.toHaveBeenCalled();
});
it("old and new module copies retain their buffers until each flush, then detach only own listeners", async () => {
  const first = await load(); await first.saveRequestDetail({ id: "old", model: "fixture" });
  expect(counts()).toEqual(changedCounts(1));
  vi.resetModules(); const second = await load(); await second.saveRequestDetail({ id: "new", model: "fixture" });
  expect(counts()).toEqual(changedCounts(2));
  await vi.advanceTimersByTimeAsync(100);
  expect(db.run.mock.calls.map(([, params]) => params[0]).sort()).toEqual(["new", "old"]);
  expect(counts()).toEqual(initial); expect(vi.getTimerCount()).toBe(0);
  await second.saveRequestDetail({ id: "again" }); await second.saveRequestDetail({ id: "same-copy" });
  expect(counts()).toEqual(changedCounts(1));
  await vi.advanceTimersByTimeAsync(100); expect(counts()).toEqual(initial);
});
it("listeners remain while the spliced buffer awaits persistence and enqueue during flush loses no rows", async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const deferred = new Promise(resolve => { release = resolve; });
  mocks.adapter.mockImplementationOnce(() => { entered(); return deferred; });
  const repo = await load(); await repo.saveRequestDetail({ id: "pending" });
  await vi.advanceTimersByTimeAsync(100); await started;
  expect(counts()).toEqual(changedCounts(1));
  await repo.saveRequestDetail({ id: "during" }); expect(vi.getTimerCount()).toBe(1);
  release(db); await vi.advanceTimersByTimeAsync(0);
  expect(db.run.mock.calls.map(([, params]) => params[0])).toEqual(["pending", "during"]);
  expect(counts()).toEqual(initial); expect(vi.getTimerCount()).toBe(0);
});
it("failed best-effort persistence detaches idle listeners without suppressing failure or blocking re-enqueue", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.adapter.mockRejectedValueOnce(new Error("fixture write unavailable"));
    const repo = await load(); await repo.saveRequestDetail({ id: "failure" }); await vi.advanceTimersByTimeAsync(100);
    expect(log).toHaveBeenCalled(); expect(counts()).toEqual(initial);
    await repo.saveRequestDetail({ id: "retry-new-detail" }); expect(counts()).toEqual(changedCounts(1));
    await vi.advanceTimersByTimeAsync(100); expect(db.run).toHaveBeenCalledTimes(1); expect(counts()).toEqual(initial);
  } finally { log.mockRestore(); }
});
