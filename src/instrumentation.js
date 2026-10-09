export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Root-layout imports may never run for API-only clients or static pages.
    // Await the settings-only initialization in the serving Node runtime; build
    // workers must not acquire the DB writer. Do not start broad app bootstrap.
    const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build"
      || process.env.NEXT_PHASE === "phase-export"
      || process.env.NEXT_PHASE === "phase-static";
    if (!isBuildPhase) {
      const { ensureOutboundProxyInitialized } = await import("@/lib/network/initOutboundProxy.js");
      await ensureOutboundProxyInitialized();
      // This retains the initializer's false-on-failure compatibility. A failed
      // read is NOT proof of proxy readiness or safe direct outbound fallback.

      // Static layouts and API-only clients may never execute app bootstrap.
      // Restore only the persisted opt-in pricing timer in the serving runtime;
      // the coordinator checks ownership/health and never immediately fetches.
      try {
        const { initializeCatalogSchedule } = await import('@/lib/pricing/catalogSchedule.js');
        await initializeCatalogSchedule();
      } catch { console.warn('[ReferencePricing] scheduler startup unavailable'); }
    }

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();
  }
}
