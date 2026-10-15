# Recovery setup: bounded late-hook mechanism review

B/F remains active; enforcement/public activation OFF. No production changes or identical failed-gate rerun.

## Retained failures

- Client consumer group13 `b14836c38`:146pass/1fail, direct TLS case beforeEach10s timeout, body assertions unreached.
- Group14 `bdbc511d3`:176pass/2fail. Recovery first case beforeEach10s timeout (reported10044.325ms); third case metadata seed `UNIQUE constraint failed: _meta.key` (reported750.624ms). Both bodies unreached; logged node:sqlite in disposable fixtures, not SQL.js failure proof.
- Group16 historical named Claude assertion and group17 unchanged bytewise timeout remain separate.

Group18 `bef51bcf9`153/153 completes the finite18-group expansion. Union108impact+3gate=111distinct, no duplicate/overlap/uncovered/extra; all18 input dictionaries match frozen1860 contract. STOP, NOT all-green.

## Read-only code evidence

`tests/unit/api-key-accounting-state.test.js` uses shared module `db`, `dir`, `ledger`, `service` variables. beforeEach awaits driver acquisition, `db/index.js` importDb, ledger/service imports, then seeds through current shared `db`. No cancellation boundary is consumed. afterEach closes/removes shared fixture state. Later beforeEach reassigns the same globals.

Installed Vitest `withTimeout` rejects its wrapper at deadline and invokes timeout notification/abort. It attaches handlers to the original promise, but does not forcibly cancel an async hook that ignores cancellation. Thus later continuation can still execute. This is a code-level possibility, not evidence that it occurred in the historical run.

`importDb` captures its own adapter and preserves accounting metadata while replacing config. The failed seed uses ordinary INSERT, intentionally not upsert. Changing INSERT to ignore/replace would hide fixture contamination and is not an acceptable repair.

## Deterministic mechanism probe

`/tmp/9router-gemini-function-authority/recovery-late-hook-mechanism.mjs` evaluates the actual installed `withTimeout` function with deterministic injected timers, held promises and stub seed objects. No real adapter/network, actual failed hook, fixture timing or repository mutation.

Receipt `recovery-late-hook-mechanism.json`:3/3 checks. Installed runner source SHA256 `bf6af6d2f4469911879a67e83b8f9e7b20332cf42795032c53457b10ccc1c617`.

1. A timed-out await ignoring cancellation can resume after a shared adapter variable is reassigned and invoke a second seed on the successor stub.
2. Local capture prevents cross-fixture seed, but does not cancel old work or establish safety of closed-adapter teardown.
3. Completion before deadline clears the timer.

This demonstrates a possible mechanism, **not diagnosis of the original timeout/duplicate seed, historical baseline or regression attribution**. Actual wall-phase/event cause remains unmeasured. No fixture/product repair or cold-stability certificate follows solely from the probe.

## Next bounded fixture outcome

Recovery tests target monetary recovery, not config import/restore. A test-only fresh seed can avoid unrelated barrel setup while retaining actual adapter, migrations, coverage/key identity, ordinary INSERTs, fresh-empty checks and unchanged recovery assertions. It must avoid shared-global reads after awaits and consume cancellation before seed/publication. No deadline increase, prewarm, production driver change, upsert, pricing/accounting weakening or claim of managed restore coverage.

Implemented test-only candidate in `tests/unit/api-key-accounting-state.test.js`: local setup adapter/modules, cancellation checks after each await/before seed/publication, drain captured setup promise before teardown admits successor. New `tests/unit/fixtures/accounting-recovery-db.js` retains actual durable key bindings and ordinary fresh-checked INSERTs; no product adapter/driver change. New `tests/unit/recovery-fixture-isolation.test.js` adds3 actual SQL.js controls: complete identity/rates and duplicate seed rejection preserving rows; preabort zero transaction; durable-boundary abort zero INSERT followed by fresh valid seed. Existing3 recovery assertions/reopen/pricing API remain unchanged.

`b0422ea29` COMPLETED **6/6**, pending0, exact2files/lint3white0/1862stable+independentrehash[]. Three unchanged recovery bodies and three actual SQL.js seed/cancel controls reached/pass. Independent comparison to client contract: only `api-key-accounting-state.test.js` changed and two new test-only files added; product unchanged. Finite6 scope STOP, no source-change impact reruns/count padding. New fixture generation/contract gate, not identical green-seeking rerun of completed consumer expansion. No historical root-cause/repair/cold/all-adapter/import-restore certificate. Retain original failures, current scope limits and all13AC.
