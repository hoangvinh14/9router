import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ console: vi.fn(), install: vi.fn(), sync: vi.fn(), proxy: vi.fn(), pricing: vi.fn() }));
vi.mock("@/lib/consoleLogBuffer", () => ({ initConsoleLogCapture: mocks.console }));
vi.mock("open-sse/providers/catalogOverride.js", () => ({ installCatalogSource: mocks.install }));
vi.mock("@/lib/modelCatalog/sync.js", () => ({ startModelCatalogSync: mocks.sync }));
vi.mock("@/lib/network/initOutboundProxy.js", () => ({ ensureOutboundProxyInitialized: mocks.proxy }));
vi.mock('@/lib/pricing/catalogSchedule.js', () => ({ initializeCatalogSchedule: mocks.pricing }));
beforeEach(() => { vi.resetModules(); for (const mock of Object.values(mocks)) mock.mockReset(); mocks.proxy.mockResolvedValue(true); mocks.install.mockResolvedValue(undefined); vi.stubEnv("NEXT_RUNTIME", "nodejs"); vi.stubEnv("NEXT_PHASE", "phase-production-server"); });
afterEach(() => vi.unstubAllEnvs());
const load = () => import("../../src/instrumentation.js");
describe("settings-only proxy readiness in existing Next register", () => {
  it.each(["phase-production-build", "phase-export", "phase-static"])("build phase %s does not call proxy initializer and preserves existing hooks", async phase => {
    vi.stubEnv("NEXT_PHASE", phase); const { register } = await load(); await register();
    expect(mocks.proxy).not.toHaveBeenCalled(); expect(mocks.pricing).not.toHaveBeenCalled(); expect(mocks.console).toHaveBeenCalledTimes(1); expect(mocks.install).toHaveBeenCalledTimes(1); expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
  it.each(["edge", ""])("runtime %s does not invoke any Node hooks", async runtime => {
    vi.stubEnv("NEXT_RUNTIME", runtime); const { register } = await load(); await register();
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });
  it("serving Node register awaits completion before subsequent hooks", async () => {
    let release; mocks.proxy.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const { register } = await load(); let returned = false; const work = register().then(() => { returned = true; });
    await vi.waitFor(() => expect(mocks.proxy).toHaveBeenCalledTimes(1)); expect(returned).toBe(false); expect(mocks.install).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.pricing).not.toHaveBeenCalled();
    release(true); await work; expect(returned).toBe(true); expect(mocks.pricing).toHaveBeenCalledTimes(1); expect(mocks.install).toHaveBeenCalledTimes(1); expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
  it('pricing startup failure is redacted and does not block serving diagnostics', async () => {
    mocks.pricing.mockRejectedValue(new Error('fixture storage secret'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { register } = await load(); await register();
      expect(mocks.pricing).toHaveBeenCalledTimes(1);
      expect(mocks.install).toHaveBeenCalledTimes(1);
      expect(mocks.sync).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledWith('[ReferencePricing] scheduler startup unavailable');
    } finally { warning.mockRestore(); }
  });
  it("false-on-failure compatibility does not falsely establish proxy readiness or block diagnostics", async () => {
    mocks.proxy.mockResolvedValue(false); const { register } = await load(); await register();
    expect(mocks.proxy).toHaveBeenCalledTimes(1); expect(mocks.install).toHaveBeenCalledTimes(1); expect(mocks.sync).toHaveBeenCalledTimes(1);
    // No fail-closed outbound claim: request guards must be a separate decision.
  });
});
