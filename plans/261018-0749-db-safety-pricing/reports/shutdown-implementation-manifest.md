# Bounded shutdown design — entrypoint ownership decision required before implementation

## Inspection outcome
Installed Next production `start-server.js` registers its SIGINT/SIGTERM cleanup before loading app handlers. It drains its server then closes framework state and exits130/143. Independent app signal callbacks are not awaited. Production has no established public app-accessible awaited cleanup hook in the inspected source; the dev cleanup listener passed to request-handler initialization is not a proven production hook.

`custom-server.js` owns interception of HTTP creation and launches standalone `server.js` or in-process `next start`. It can capture and drain its own server(s), but current `next dev` scripts do not load this wrapper. Setting NEXT_MANUAL_SIG_HANDLE globally would disable framework lifecycle without a replacement in dev; prohibited.

## Candidate limited manifest (not source-edited)
- New `src/lib/lifecycle/shutdown.js`: shared global ordered coordinator, one promise, stopping state, callbacks for producers/drain/final persistence, explicit error propagation and fixed deadline; no implicit process signals on import.
- `custom-server.js`: only when executed as main, select custom-entrypoint lifecycle owner before requiring Next. Capture owned HTTP servers/upgraded sockets; stop new admissions, drain requests with explicit bound, invoke coordinator, then signal-specific/non-success exit. Preserve all trusted-peer/header authority code unchanged. NEXT_MANUAL_SIG_HANDLE applies only to this owned launch, not globally or from adapter imports. Exact server/framework teardown limitations must be resolved and tested before accepting this option.
- `src/shared/services/initializeApp.js`: register existing DNS/bridge/tunnel cleanup with coordinator rather than independent process.exit; clear deferred startup/watchdog/network timers so no new producers appear during shutdown. No normal startup or inference behavior change.
- `src/lib/db/driver.js`: coordinator participant closes only initialized adapter, never initializes storage during teardown; stopping state prevents new acquisition after shutdown starts.
- Native/SQL.js adapter files: remove independent process.exit/signal ownership, preserve explicit close and synchronous last-resort handling only if contractually defined. Standalone executable opts into lifecycle handling rather than import side effects.
- `src/lib/db/repos/requestDetailsRepo.js`: drain shared active flush promise and queued buffer before DB close; propagate shutdown failures, preserve normal logging policy; remove async exit listener as durability claim. Prevent accepting work after final drain. This is cleanup-boundary work, not inference hooks.
- Standalone/entrypoint fixture and new lifecycle test files: persistent children, actual engines, repeat signals, both registration orders, failure/lock and flush-in-flight cases. Real custom-server isolated integration must suppress provider/tunnel/DNS/download work explicitly without pretending a stub is a real Next run.

## Unresolved launch-mode decision
This manifest touches an explicit serving entrypoint, not just an adapter. Choose between:
1. Authorize custom-server production/standalone ownership plus separate framework-owned dev contract (dev not claimed graceful-product-release evidence; retain safe synchronous final DB teardown without falsely guaranteeing buffered async work), or
2. Expand to a managed dev entrypoint too, inspecting the dev parent/child signaling/draining model before edits, or
3. Keep signal coordination blocked and complete only bounded DB/dedup work first.

No option may be implemented by monkeypatching process.exit, removing unknown signal listeners, trusting async exit hooks, or silently dropping dev/runtime support. Actual Windows remains unverified release gate. No production activation, runtime download, CI push or unrelated network work.

This document records the concrete boundary for the already authorized design work; additional entrypoint ownership decision is still needed because Next's existing coordinator cannot simply await another signal listener.
