import { getSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";

let initialized = false;
let initialization = null;

export async function ensureOutboundProxyInitialized() {
  if (initialized) return true;
  if (initialization) return initialization;
  // Import-time scheduling and awaited Node registration can overlap. All
  // callers share one read/application; failed reads never latch success.
  const pending = Promise.resolve().then(async () => {
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
      initialized = true;
    } catch {
      // Do not include credential-bearing settings/proxy URLs or storage paths.
      console.error("[ServerInit] Outbound proxy initialization unavailable");
    }
    return initialized;
  });
  initialization = pending;
  try { return await pending; }
  finally { if (initialization === pending) initialization = null; }
}

// Build workers import the root layout, but must not acquire the runtime DB
// writer merely to render pages. Explicit calls retain their existing behavior.
// Do not use NODE_ENV=production here: real production servers need proxy init.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build"
  || process.env.NEXT_PHASE === "phase-export"
  || process.env.NEXT_PHASE === "phase-static";
// Runtime remains deferred; requests before this finishes are not protected by
// an initialization barrier. This guard only removes build-time side effects.
if (typeof window === "undefined" && !isBuildPhase) {
  setImmediate(() => {
    ensureOutboundProxyInitialized().catch(console.log);
  });
}

export default ensureOutboundProxyInitialized;
