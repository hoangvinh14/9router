// Invoked only by Next's Node serving instrumentation hook, never on import.
// Next's ensureInstrumentationRegistered also skips production build; keep our
// own exclusions for export/static/test workers and explicit build commands.
export function isPricingServingRuntime(env = process.env, argv = process.argv) {
  if (env.NEXT_RUNTIME !== "nodejs" || env.NODE_ENV === "test" || env.VITEST) return false;
  const phase = env.NEXT_PHASE || "";
  if (phase && !["phase-development-server", "phase-production-server"].includes(phase)) return false;
  if (argv.some(arg => ["build", "export"].includes(arg))) return false;
  return true;
}
export async function initializeServingPricing() {
  // Literal accesses preserve Next's compile-time runtime substitution.
  if (!isPricingServingRuntime({
    NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    NEXT_PHASE: process.env.NEXT_PHASE,
    NODE_ENV: process.env.NODE_ENV,
    VITEST: process.env.VITEST,
  })) return { initialized: false };
  const { configureCatalogScheduler } = await import("./catalogScheduler.js");
  try {
    const { initializeCatalogSchedule } = await import("./catalogSchedule.js");
    const status = await initializeCatalogSchedule();
    return { initialized: true, ...status };
  } catch {
    // In particular, a repeated initialization failure before reconciliation
    // must not leave a previously running global timer enabled.
    configureCatalogScheduler(false);
    console.error("[ReferencePricing] serving schedule initialization unavailable");
    return { initialized: false, error: "pricing_schedule_unavailable" };
  }
}
