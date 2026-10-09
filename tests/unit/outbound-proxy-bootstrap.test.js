import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.settings }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: mocks.apply }));
let scheduled, consoleError;
beforeEach(() => {
  vi.resetModules(); mocks.settings.mockReset().mockResolvedValue({ outboundProxyEnabled: false }); mocks.apply.mockReset();
  scheduled = []; vi.stubGlobal("setImmediate", callback => { scheduled.push(callback); });
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PHASE", "");
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { consoleError.mockRestore(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const load = () => import("../../src/lib/network/initOutboundProxy.js");
describe("outbound proxy automatic initialization phase boundary", () => {
  it.each(["phase-production-build", "phase-export", "phase-static"])("does not schedule or read settings in %s", async phase => {
    vi.stubEnv("NEXT_PHASE", phase); await load();
    expect(scheduled).toHaveLength(0); expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it.each(["", "phase-production-server", "phase-development-server"])("production NODE_ENV still schedules runtime in phase %s", async phase => {
    vi.stubEnv("NEXT_PHASE", phase); const mod = await load();
    expect(scheduled).toHaveLength(1); expect(mocks.settings).not.toHaveBeenCalled();
    // Callback returns void; observe application before checking cached success.
    scheduled[0](); await vi.waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    expect(await mod.ensureOutboundProxyInitialized()).toBe(true); expect(mocks.settings).toHaveBeenCalledTimes(1);
  });
  it("explicit initializer remains callable in build phases and is idempotent after success", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build"); const mod = await load();
    expect(await mod.ensureOutboundProxyInitialized()).toBe(true); expect(await mod.ensureOutboundProxyInitialized()).toBe(true);
    expect(scheduled).toHaveLength(0); expect(mocks.settings).toHaveBeenCalledTimes(1); expect(mocks.apply).toHaveBeenCalledWith({ outboundProxyEnabled: false });
  });
  it("failure is reported and explicit retry remains available", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build"); mocks.settings.mockRejectedValueOnce(new Error("writer unavailable")); const mod = await load();
    expect(await mod.ensureOutboundProxyInitialized()).toBe(false); expect(consoleError).toHaveBeenCalledTimes(1); expect(mocks.apply).not.toHaveBeenCalled();
    expect(await mod.ensureOutboundProxyInitialized()).toBe(true); expect(mocks.settings).toHaveBeenCalledTimes(2); expect(mocks.apply).toHaveBeenCalledTimes(1);
  });
  it("automatic callback and concurrent explicit callers share one settings read/application", async () => {
    let release; mocks.settings.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const mod = await load(); scheduled[0]();
    const first = mod.ensureOutboundProxyInitialized(), second = mod.ensureOutboundProxyInitialized();
    await vi.waitFor(() => expect(mocks.settings).toHaveBeenCalledTimes(1)); expect(mocks.apply).not.toHaveBeenCalled();
    release({ outboundProxyEnabled: false }); expect(await first).toBe(true); expect(await second).toBe(true);
    expect(mocks.apply).toHaveBeenCalledTimes(1); expect(mocks.settings).toHaveBeenCalledTimes(1);
  });
  it("failed shared attempt is not cached and logs no credential-bearing exception", async () => {
    mocks.settings.mockRejectedValueOnce(new Error("http://user:secret@fixture.invalid")); const mod = await load();
    const outcomes = await Promise.all([mod.ensureOutboundProxyInitialized(), mod.ensureOutboundProxyInitialized()]);
    expect(outcomes).toEqual([false, false]); expect(mocks.settings).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls).toEqual([["[ServerInit] Outbound proxy initialization unavailable"]]);
    expect(await mod.ensureOutboundProxyInitialized()).toBe(true); expect(mocks.settings).toHaveBeenCalledTimes(2);
  });
  it("browser context schedules no DB side effect", async () => {
    vi.stubGlobal("window", {}); await load(); expect(scheduled).toHaveLength(0); expect(mocks.settings).not.toHaveBeenCalled();
  });
});
