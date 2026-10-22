import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ initialize: vi.fn(), configure: vi.fn(), capture: vi.fn(), source: vi.fn(), modelSync: vi.fn() }));
vi.mock('@/lib/pricing/catalogSchedule.js', () => ({ initializeCatalogSchedule: mocks.initialize }));
vi.mock('@/lib/pricing/catalogScheduler.js', () => ({ configureCatalogScheduler: mocks.configure }));
vi.mock('@/lib/consoleLogBuffer', () => ({ initConsoleLogCapture: mocks.capture }));
vi.mock('open-sse/providers/catalogOverride.js', () => ({ installCatalogSource: mocks.source }));
vi.mock('@/lib/modelCatalog/sync.js', () => ({ startModelCatalogSync: mocks.modelSync }));
import { isPricingServingRuntime, initializeServingPricing } from '@/lib/pricing/servingStartup.js';
import { register } from '@/instrumentation.js';
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('NEXT_RUNTIME', 'nodejs'); vi.stubEnv('NEXT_PHASE', 'phase-production-server');
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VITEST', '');
  mocks.initialize.mockResolvedValue({ schedulerConfigured: false, schedulerEnabled: false });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('serving-only pricing initialization', () => {
  it('refuses build/export/static/test/edge/unknown phases and build commands without DB initialization', async () => {
    for (const NEXT_PHASE of ['phase-production-build', 'phase-export', 'phase-static', 'unknown']) {
      vi.stubEnv('NEXT_PHASE', NEXT_PHASE); expect(await initializeServingPricing()).toEqual({ initialized: false });
    }
    expect(mocks.initialize).not.toHaveBeenCalled();
    for (const env of [{ NEXT_RUNTIME: 'edge' }, { NEXT_RUNTIME: 'nodejs', NODE_ENV: 'test' }, { NEXT_RUNTIME: 'nodejs', VITEST: 'true' }]) expect(isPricingServingRuntime(env, [])).toBe(false);
    expect(isPricingServingRuntime({ NEXT_RUNTIME: 'nodejs' }, ['node', 'next', 'build'])).toBe(false);
    expect(isPricingServingRuntime({ NEXT_RUNTIME: 'nodejs' }, ['node', 'next', 'export'])).toBe(false);
    expect(isPricingServingRuntime({ NEXT_RUNTIME: 'nodejs' }, ['node', 'custom-server.js'])).toBe(true);
  });
  it('reconciles saved enabled/disabled state without fetching or adding signal handlers', async () => {
    const signals = process.eventNames().filter(name => ['SIGINT', 'SIGTERM'].includes(name)).map(name => [name, process.listenerCount(name)]);
    expect(await initializeServingPricing()).toEqual({ initialized: true, schedulerConfigured: false, schedulerEnabled: false });
    mocks.initialize.mockResolvedValue({ schedulerConfigured: true, schedulerEnabled: true });
    expect(await initializeServingPricing()).toEqual({ initialized: true, schedulerConfigured: true, schedulerEnabled: true });
    expect(mocks.initialize).toHaveBeenCalledTimes(2); expect(mocks.configure).not.toHaveBeenCalled();
    expect(signals).toEqual(process.eventNames().filter(name => ['SIGINT', 'SIGTERM'].includes(name)).map(name => [name, process.listenerCount(name)]));
  });
  it('disables prior runtime timer and redacts initialization failure instead of unhandled rejection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); mocks.initialize.mockRejectedValue(new Error('SECRET database fault'));
    expect(await initializeServingPricing()).toEqual({ initialized: false, error: 'pricing_schedule_unavailable' });
    expect(mocks.configure).toHaveBeenCalledWith(false); expect(console.error).toHaveBeenCalledWith('[ReferencePricing] serving schedule initialization unavailable');
  });
  it('real instrumentation invocation preserves existing model startup and awaits pricing initialization', async () => {
    await register(); expect(mocks.capture).toHaveBeenCalledOnce(); expect(mocks.source).toHaveBeenCalledOnce(); expect(mocks.modelSync).toHaveBeenCalledOnce(); expect(mocks.initialize).toHaveBeenCalledOnce();
    expect(mocks.modelSync.mock.invocationCallOrder[0]).toBeLessThan(mocks.initialize.mock.invocationCallOrder[0]);
    mocks.initialize.mockClear(); vi.stubEnv('NEXT_RUNTIME', 'edge'); await register(); expect(mocks.initialize).not.toHaveBeenCalled();
  });
});
