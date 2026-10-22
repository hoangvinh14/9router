# Shutdown coordination — proposal only, not an approved implementation change

## Why this needs an explicit boundary
The independent R4 review and isolated persistent-child probe found SQL.js installs flush-only signal listeners and does not terminate within a fixed1s deadline. The write was persisted; this is not observed data loss. Native adapters already call process.exit from their signal handler. Application `initializeApp()` also registers cleanup + process.exit, while custom-server registers token-refresh stop handlers. Depending on listener order, a process.exit listener can prevent later persistence or application cleanup. Thus adding another unconditional adapter exit is not a safe local fix and not whole-application shutdown verification.

## Proposed invariant
The serving application owns termination. On SIGINT/SIGTERM it stops new work, drains or explicitly refuses pending work within a documented deadline, stops background producers, invokes database close synchronously, then terminates with an accurately reported outcome. Adapters expose close/health and do not preempt application cleanup by independently calling process.exit. Failed/uncertain publication remains an error, never a durable ACK; ownership is not forcibly released on uncertainty. Process death leaves an operator/stale-owner recovery obligation under the existing platform policy.

Standalone adapter consumers need a documented lifecycle: explicit close, or an opt-in standalone shutdown coordinator. Removing current automatic signal persistence without replacing/documenting that lifecycle is a compatibility change, not a harmless cleanup.

## Required scope decision and design work
Before implementation, agree whether to include serving-entrypoint and standalone lifecycle coordination in this prerequisite, or leave it as an explicit blocker for separate work. Inspect real Next/custom-server startup and signal registration order, request-details shutdown flushing, background producers and both clean/failed startup paths. Do not activate real services, download runtimes, mutate a real DATA_DIR or change inference/request semantics as part of inspection. Broad stop-serving/drain changes require a bounded file manifest and tests before edits.

## Verification contract if approved
- Owned child with persistent loop: SIGINT and SIGTERM, clean and dirty SQL.js plus each affected native runtime.
- Both listener-registration orders; shared coordinator invoked once under repeated signals, no premature exit bypassing database or application cleanup.
- Healthy close persists/reopens acknowledged state and releases ownership; close/release/publication failures preserve fail-closed semantics and produce non-success status, not false ACK.
- Explicit handling for active managed transaction (synchronous signal dispatch occurs outside JS transaction stack normally; test intentional dispatch separately), startup failure, already-closed adapter and multiple cleanup consumers.
- Serving-entrypoint proof with disposable data and external networking disabled, no tunnel/provider startup. Distinguish mocked coordinator unit proof from actual entrypoint integration.
- Do not claim Windows signal/filesystem behavior from Linux runs, or crash/power-loss guarantees from graceful-close tests.

Decision pending. This proposal does not silently authorize application lifecycle redesign or mark the review finding resolved.
