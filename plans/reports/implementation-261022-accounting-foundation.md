# Accounting foundation execution receipt — 2026-10-22

## Scope and source

Executed [P2](../261018-0214-accounting-foundation/plan.md) under `ak-cook --auto` after the user authorized continuing to completion without routine questions. The [adopted design](../261018-0214-accounting-foundation/design-preparation.md) closed the three initial decisions before source edits.

Branch `feat/accounting-foundation`, base `2ca882577859ca36206c4e8469d8a8adfafea297`. Implementation is uncommitted; no commit, push, PR, deployment or live-data operation was requested/performed. Initial dirty plan/report/journal and pricing build artifacts were retained.

The [machine receipt](./accounting-foundation-261022-receipt.json) hashes all 33 touched/new production, configuration and test files, including untracked implementation. Manifest SHA-256: `91b2d1eaff0cdf155c1ce65aad9c1142e518cc736ca9c968332b5077058aa863`. Base commit alone does not identify this working revision. Runtime: Node 24.21.0, npm 11.19.0, Vitest 4.1.11, Next 16.3.8; Linux 6.8.0-138-generic x86_64.

## Delivered behavior

- Schema version 3/migration 2, verified table/index/audit-trigger definitions; no activation timestamp or historical debit.
- Stable HMAC key identity, retained independent tombstones, protected sidecar validation before PRAGMA, configuration import/delete collision refusal, preserved ACL/pricing and valid legacy round trips.
- Required unique verified pre-schema/import backups including coverage material and native index/trigger definitions. Existing databases without metadata also require backup. Failed backup refuses mutation.
- Independent gap/global-maintenance generation/CAS, audit-before-sidecar ACK and idempotent reconciliation replay with retained history/capacity refusal.
- Provider-independent exact per-attempt ledger/service, original price snapshots, BigInt/single rounding, explicit base/cache/reasoning/category/unit evidence, unresolved/null cost and audited manual CAS recovery.
- Private request/operation/receipt ownership, bounded registry/coordinator, fresh application and post-ACK gates, one-use dispatch seam, terminal sink retention, no network serialization.
- Exclusive startup pending recovery, close ordering and retained exclusion on uncertainty; scoped process-crash/SIGTERM controls.

The existing `docs/*` ignore rule now has narrow exceptions for the two owning documents so this handoff is reviewable in Git; the root README links both contracts. Current maintainer contracts: [DB safety](../../docs/DB-SAFETY.md) and [internal service interface](../../docs/ACCOUNTING.md). These document public configuration compatibility and the remaining P3/P4/P5 owners.

## Final test commands and results

Commands below ran from `tests/`, serially with one Vitest worker. Fixtures use temporary databases and assert actual Node SQLite/SQL.js driver identity; child processes are awaited/cleaned up. No provider request or credential is used.

```sh
npx vitest run --maxWorkers=1 unit/accounting-exact-money.test.js unit/accounting-ledger.test.js unit/accounting-coordinator.test.js unit/accounting-identity.test.js unit/accounting-coverage.test.js unit/accounting-import.test.js unit/accounting-migration.test.js unit/accounting-crash.test.js unit/accounting-lifecycle.test.js
```

**9 files, 103/103 passed**, 67.84 seconds. Includes:

- Original-price duplicate/terminal/reopen and late/manual CAS conflicts; explicit zero vs missing/estimated, single half-up rounding, safe ranges, cache tier and extended tool-rate evidence.
- Queue/group count+byte bounds, detached caller data, cancellation before/during mutation, malformed group results, fresh queued authority changes and actual interleaved-key refusal/success.
- Real engine inner RELEASE failure after release executes, including caught-inner failure: entire accounting group/lane refuses and storage becomes unavailable; close retains exclusion.
- Own ACK lost after durable group return; visible/forged receipt never authorizes POST; stale post-ACK ACL refuses; one-use dispatch and retained terminal sink.
- Real child before/inside/after intent and terminal commit, SQL.js fsync-before-rename crash, missing caller ACK, same-directory competing writer with exact unchanged DB/sidecar byte assertions.
- Crash after sidecar directory fsync before DB reference, and retirement before DB delete commit. Reopen retains original sidecar identity or retired-key block.
- Missing/malformed/mismatched/insecure artifacts; binding/marker loss; missing/replaced audit protection; required-backup failure preserving schema/ACL/pricing both with and without metadata.
- Gap/global maintenance generation and scope; failure before and after sidecar rename after committed DB audit; replay keeps one audit/identical receipt.
- Explicit pending close/restart, recovery failure, release retry, SIGTERM recovery and another synchronous signal listener.

```sh
npx vitest run --maxWorkers=1 unit/db-durable-publication.test.js unit/db-sqljs-publication.test.js unit/db-release-sync.test.js unit/db-driver-chain.test.js unit/db-migration-chain.test.js unit/pricing-snapshot-sqljs.test.js unit/pricing-snapshot-cache.test.js unit/key-access.test.js unit/key-access-migration.test.js unit/pricing-persistence-import.test.js unit/db-writer-ownership.test.js unit/pricing-management-route.test.js
```

**12 files, 163/163 passed**, 45.24 seconds. Shared ownership/durability/fallback/migration/pricing/ACL and management-security contracts retain their checks. Only the legitimate schema backup prefix expectation changed from schema 2 to 3.

```sh
npx vitest run --maxWorkers=1 unit/key-access-handlers.test.js
```

**1 file, 45/45 passed**, 19.41 seconds, unchanged five-second test deadlines. Total final focused/affected verification: **311 passed, zero failed across 22 files**. This is not a whole-repository suite claim.

From repository root, ESLint ran over all 33 touched/new JS/MJS production/configuration/test files: **zero errors, zero warnings**. `node --check tests/fixtures/accounting/accounting-process.mjs` passed. Whitespace and all relative links across the nine edited documents pass; all 33 final implementation/configuration/test hashes match both workspace and build mirror. Documentation/plan closure metadata is updated after the build-input snapshot.

## Build

The isolated build uses `DATA_DIR=/tmp/9router-accounting-build-hafd00ny` and `NEXT_DIST_DIR=.next-accounting-foundation-261022`; it never opens the user's default database or reuses existing pricing build outputs. Initial restricted-network attempt exited 1; log `/tmp/9router-accounting-build-261022.log` records `EAI_AGAIN fonts.googleapis.com` from the unchanged Inter dependency and the missing already-declared optional `@aws-sdk/credential-providers` module. DNS resolves outside the sandbox.

The SDK was absent from the installed environment and existing lockfile despite its declaration in package.json. A root install dry run proposed unrelated upgrades, so it was not applied. Version 3.1135.0 was installed with scripts/audit disabled under `/tmp/9router-accounting-sdk-build-only`, then only the missing SDK plus its isolated nested dependency closure was copied into the project's installed SDK location. Project-root import resolves; unrelated package versions, all source hashes and tracked manifests are unchanged. This permits build verification; it does not certify a clean locked installation, whose pre-existing missing lock entry remains a reproducibility limitation outside P2.

The network-enabled retry (`/tmp/9router-accounting-build-261022-network.log`) was stopped with an owned SIGTERM (exit 143) after more than ten minutes compiling without a new source error. Existing custom pricing outputs are not ignored by the root-wide Tailwind source scan; this is a possible slowdown contributor, not a proven cause. User servers and pricing artifacts were preserved.

A clean source mirror at `/tmp/9router-accounting-source-b6muhwnh` excludes dotenv secrets and generated output. The [build-input manifest](./accounting-foundation-261022-build-inputs.json) records all copied tracked/current source inputs, new implementation/tests, the existing ignored lockfile and documents, with source hash verification. A full dependency copy was abandoned under measured host I/O pressure (full avg60 approximately 65%); the owned copier was terminated. Instead, a private `bwrap` namespace mounts the complete installed dependency tree read-only at the mirror package path, retaining nested layout/internal symlinks. A probe verified dependency writes fail with `EROFS` and mirror writes succeed. There are no external dependency symlinks or concurrent package installations. No fake font data or source bypass is used.

The full `npm run build`/postbuild runs with normal network, default `.next`, unset `NEXT_DIST_DIR`/`NEXT_TRACING_ROOT_MODE`, isolated `DATA_DIR` (final `/tmp/9router-accounting-mirror-data-8k53_te6`), and isolated writable temporary files. The first mirror build/postbuild passed (exit 0; `/tmp/9router-accounting-mirror-build-261022.log`): compilation in 5.4 minutes, TypeScript and all 152 static pages passed. Parallel build workers logged fail-closed writer contention in their shared temporary data directory; no user database was opened. A detached artifact check then proved a real packaging defect: SQL.js default initialization requires `sql-wasm.wasm`, which tracing omitted. Failure counsel reproduced actual initialization success in the workspace and ENOENT in the detached artifact. `next.config.mjs` now explicitly includes this required asset in tracing; no one-off artifact patch is used. The final full rebuild/postbuild passed (exit 0; `/tmp/9router-accounting-final-build-261022.log`), including compilation in 3.6 minutes, TypeScript, 152 static pages, tracing and asset copying. The new artifact was moved outside the source mirror and namespace to `/tmp/9router-accounting-artifact-_11aeoqm/standalone`. Artifact-local dependencies (Next, SQL.js/WASM and AWS SDK) resolve inside that tree; no external symlink is present. Actual SQL.js initialization, SELECT, export and reopen passed. The unmodified custom server bound only `127.0.0.1:30127` with fresh temporary data, returned HTTP 307 for `/`, then received owned SIGTERM and was reaped (exit 143). [Standalone receipt](./accounting-foundation-261022-standalone.json); check log `/tmp/9router-accounting-final-standalone-check-261022.log`, server log `/tmp/9router-accounting-standalone-smoke-261022.log`. The existing typeless-package warning for backgroundTokenRefresh is retained; module-type behavior was not changed. This is a scoped artifact smoke, not full server graceful-shutdown certification. This verifies source against the installed dependency tree, not a clean dependency installation. Manifest SHA-256 before/after dependency setup: package.json `eee409b146c9b7077559c3d6a37ff43856594ba76c1a50fbc4e5e42949b60993`; package-lock.json `6650112afe7893dbc980eb4f7245e71738c06bc2cc6b374bb7a837716111c667`.

## Review and failed histories

Inline review covered all changed tracked diff and new accounting modules, schema, adapter/lease ordering, import/key callers, exact arithmetic and tests. This is not an independent full-source approval. Failure counsel (`kongming`) provided read-only diagnosis; a scoped simplifier made behavior-preserving readability edits in exact-money/coordinator, validated by subsequent tests. No numeric score substitutes for verification.

Confirmed findings repaired:

1. Same-second backup names collided. Unique directories plus parent-directory fsync prevent overwrite; both engines now have same-second preservation controls.
2. Lost existing key binding could pass generic new-key validation in update/import. Existing identities now require retained binding; only first initialization can bind legacy keys.
3. Native lightweight backups omitted explicit indexes/audit triggers. Backup now copies them; both backup engines pass schema verification against a raw reopened host copy.
4. Readiness only checked columns/indexes. It now checks original table definitions and append-only audit triggers, including incompatible replacement refusal.
5. Base exact usage could silently ignore original extended rates/hourly cache evidence. It now refuses incomplete evidence; component mode requires all original priced categories unless an explicit narrower immutable contract exists.
6. Private registry could temporarily retain rejected queue work until promise cleanup. Its count/byte admission is now bounded independently.
7. Standalone tracing omitted the SQL.js WASM asset required by default initialization. An explicit tracing inclusion preserves the actual fallback engine in generated artifacts.
8. Loss of both the binding marker and binding rows must not permit reinitialization while attempts or audit history remain. Initialization now refuses this state; both engines have direct regression controls.

Observed verification failures and their resolution remain part of this record:

- Initial existing ACL cold import test and later handler full-catalog tests reached the five-second deadline under combined cold loads; isolated runs passed without changing timeout/assertions. The final affected commands above all passed.
- Initial new service fixture missed P1 `installPricingRevision`; real pricing installation outside durable transactions fixed the harness. Independent fresh-authority cases replaced a loop whose first inactive-key mutation masked later cases.
- Crash contender/import/coverage tests timed out on Vitest deep comparison of large database Buffers. In-harness timing located approximately 4.28 seconds in equality, while contender refusal was approximately 54 ms. Native `Buffer.equals` preserves exact byte checking and the original deadlines; final crash/import/coverage runs passed.
- A newly added SQL.js sidecar-replay fault initially hit the earlier DB audit rename and correctly poisoned the adapter (56 pass/1 fail in that run). Counsel confirmed targeting error. The final test targets the sidecar destination, separately covers pre/post-publication failure, checks healthy DB + unavailable old coverage handle, then verifies replay/one audit/identical receipt.
- The final 103-test rerun initially reached 101 pass/2 import timeouts during filesystem work (`/tmp/9router-accounting-final-tests-261022.log`). An isolated fresh run still timed out on the first Node case. Temporary instrumentation measured 4,357 ms in dynamic import and 1,029 ms in `initDb`, versus approximately 717 ms for the subsequent configuration/backup/key operations; SQL.js completed in 1,736 ms. The instrumented run repeated the first-case timeout (one fail/one pass). Engine-scoped `beforeEach` now owns fixture creation/module reset/mock/import/init, preserving per-engine isolation and all behavioral assertions/default deadlines. No shared cached import or timeout increase was used; instrumentation was removed. Both engines passed isolated in 9.74 seconds, then the complete 103-test suite passed. Diagnostic timing remains at `/tmp/9router-accounting-import-timings-261022.jsonl`.
- ESLint initially reported one anonymous-default-export warning; naming the migration resolved it.
- Initial AgentKit plan lookup used a directory basename rather than indexed ID; reindex and `9router/261018-0214` resolved it. Phase status is derived from checkboxes; the duplicate static phase-status table was replaced by phase links/dependencies.
- First build failed on restricted-network Google Fonts DNS and a missing declared AWS SDK dependency. Failure counsel supported an unchanged network-enabled retry with scoped dependency setup; the root dry run's unrelated upgrades were rejected. The initial network retry was interrupted; final mirror build and the required WASM packaging repair/standalone acceptance are recorded separately above.

## Acceptance boundary and handoff

Accounting/enforcement/public activation remain **OFF**. No `ledgerStartedAt` is written. No provider hooks/parsers, actual upstream POST integration, budget/calendar/UI, reservation, historical backfill, live DB mutation or physical-restore UI is added.

P3 must integrate every actual dispatch/successor with the own-ACK/fresh one-use seam, prove provider/raw usage/category mapping, retain late sinks and handle failed recording/independent gap eligibility. P4 owns policy/windows/budgets. P5 owns management authentication/routes/UI and managed stop-writer physical restore/reconciliation. Full independent source review and Bun/better/Windows accounting parity remain P5/R release blockers; primitive receipts do not certify these new accounting paths and support is not silently reduced.

Process crash/reopen controls do not certify power-loss behavior. Scoped DB SIGTERM controls do not certify full Next/network graceful shutdown. Trusted same-host local filesystem/PID assumptions and no out-of-band DB+sidecar anti-rollback promise remain unchanged. Existing analytics concurrency-count baseline failures are not claimed repaired.

## Closure

AgentKit reports completed, 3/3 phases and 22/22 tasks; plan and implementation journal validate. [Local journal](../journals/2026-10-22-complete-accounting-foundation-and-standalone-verification.md) persisted; AgentWiki publish skipped. Final process reconciliation found no owned running build/server, released port 30127, and preserved user servers 20333/20453 and all initial pricing artifacts. The task-owned abandoned workspace build output was removed. Final detached artifact and temporary logs remain available for inspection. No commit/push/deploy performed.
