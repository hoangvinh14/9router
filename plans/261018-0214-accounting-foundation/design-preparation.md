# Accounting foundation: adopted execution design

Prepared 2026-10-22 against `develop` at `2ca88257`. **Execution authorized.** After reviewing this proposal, the user instructed execution through completion and delegated routine technical decisions. The three choices below are adopted within the existing contract. Source/test preparation gate is closed; phase acceptance still requires implementation evidence. Existing dirty plan files are preserved.

The preparation anchors/manifests below preserve the pre-edit inspection state. Implementation and final verification are recorded in the [execution receipt](../reports/implementation-261022-accounting-foundation.md); the current callable interface is documented in [docs/ACCOUNTING.md](../../docs/ACCOUNTING.md). The component calculator requires every original priced category when no narrower immutable category contract exists, and base evidence refuses extended rates or missing original cache-tier evidence.

## Outcome and boundaries

Deliver stable key identity, durable coverage material, an exact per-attempt ledger and a bounded write coordinator for P3. Preserve ACL/pricing and valid legacy configuration imports. Accounting, enforcement and public/synchronous activation stay OFF; do not write `ledgerStartedAt`.

P2 owns safety primitives from first persisted accounting state: bindings/tombstones, artifact validation, import/delete refusal, independent gap/maintenance persistence, operation replay/CAS, pending recovery and explicit adapter close. P3 owns real dispatch hooks, protocol evidence production and checks immediately before POST/after ACK. P4 owns budgets/calendar/UI. P5 owns management routes/UI, managed physical restore tooling/runbooks and complete operational procedures. Bun/better/Windows accounting evidence remains a P5/R release blocker, not a support reduction.

No provider inventory port, new inference routes, historical debit, reservation, network serialization, generic persistence rewrite or live-data operation. Acceptance requires actual Node/SQL.js intent, terminal, crash/reopen, competing-writer and lost-ACK evidence plus preserved ACL/pricing tests.

## Adopted decisions

### 1. Core interface and dependency direction

Use a provider-independent core under `src/lib/accounting/`. The service owns admission and coordinates the repository; the repository never imports the service. P3 supplies a request-local synchronous authority capability through a private registry, not a serializable callback or SQL supplied in queued input. Registry lifetime is adapter/request bounded; remove entries on completion, cancellation and close. No request state on the process-global driver or singleton executors.

Proposed internal interface (names are new, not existing exports):

- `beginAttempt(context, candidate, { signal })`: detach bounded input, queue a private operation ID, then revalidate at application time. Generate attempt ID and `startedAt` at accepted intent mutation. Return an opaque own-ACK receipt only after the enclosing durable transaction returns successfully.
- `completeAttempt(receipt, evidence, { signal })`: settle against the stored original snapshot or record unresolved/not-dispatched from evidence. A terminal outcome is not erased by client cancellation after mutation starts. A receipt is tied to the adapter lifetime and attempt; row visibility is never a receipt.
- `resolveAttempt(attemptId, operation)`: internal audited waiver/exact correction with actor, reason, evidence, operation ID and expected resolution version. No management API in P2.
- `assertDispatchAuthority(receipt, context)`: revalidate live owner/lifetime, identity, config, coverage and candidate authority; provide the seam P3 must call at its actual POST boundary. A duplicate intent receipt is replay information, never permission for a second POST. P3 must retain a request-local one-use dispatch capability.

Fresh application validation runs synchronously inside each member savepoint immediately before intent mutation, after all queue awaits: ownership/health, verified schema and coverage, active stable key/binding, current ACL/config/policy when present, candidate and current original-price capture. P2 implements current identity/ACL/config/coverage/price checks; P3 must supply and test dispatch/routing authority, and P4 extends policy/windows without bypassing this gate. Missing required authority refuses; no permissive default for an absent callback. P2 fixture capabilities cannot enable production dispatch.

### 2. Owner, close and restart

Keep `acquireWriterOwnership(DATA_FILE)`, claim-once lease semantics and the current fallback chain. Add read-only canonical directory and instance ID metadata to the private ownership/claimed-lease boundary; do not expose release authority through the service. Attempts carry that engine lifetime's instance ID. No need to expose/adopt a previous owner's ID for normal pending recovery.

After exclusive acquisition and artifact/schema validation, recover **all** persisted pending rows from earlier lifetimes to unresolved/network_unknown in a durable startup transaction before publishing the adapter. A proven-dead process and a successful prior engine close are both safe boundaries; a live/ambiguous writer still fails acquisition. Never treat pending as free or recover a current live request on a timer. If startup finds a pending row claiming its newly generated lifetime, refuse corruption instead of adopting it.

Explicit accounting close first stops admission and cancels queued, unapplied entries with a storage-closing reason. Active synchronous writes finish before close can interleave. Durably mark current pending attempts unresolved, invalidate request/receipt authority, then close the engine and release its claimed lease. A late callback after close is refused by the old lifetime and cannot mutate a successor adapter. If recovery/close is uncertain, retain exclusion and refuse; never release by calling the original pre-claim owner token. Reopen only through a new lifetime and persisted-file recovery.

Scope any adapter shutdown-hook changes separately in phase 3. Route adapter-owned automatic close through the same accounting lifecycle rather than installing competing driver signal handlers. SQL.js flush-only hooks do not certify drain/close. `custom-server.js:38`–`:39` also registers signals; actual process signal behavior needs a dedicated child control before any graceful-stop claim. Earlier DB acceptance expressly excluded shutdown. Failure of this control blocks lifecycle completion; do not inherit or advertise graceful-stop assurance.

### 3. Identity, artifacts and minimum maintenance

Retain one-to-one `apiKeyId` ↔ HMAC-SHA256(secret) bindings and permanent retired bindings. Never put raw keys, binding material or prompts in ledger, audit, receipts or reports. Reject changed ID/secret, duplicate IDs/secrets, cross-ID reuse and resurrection of a retired binding. Delete retains accounting/audit/history; reimport of a retired ID/secret is refused. Unchanged active IDs/secrets and legacy ACL omission retain current valid semantics.

Use the legacy sidecar format deliberately adapted to current lease paths, at `${DATA_DIR}/db/.accounting-coverage.json` (the lease's canonical directory), not a second uncoordinated directory. Keep HMAC material in the protected local artifact with file mode 0600. Keep DB reference and binding-key digest in `_meta`. Validate regular single-link bounded files and strict contents; never export HMAC material in config.

Order: writer acquisition → engine open for read-only artifact inspection → validate existing references/artifacts **before PRAGMA/timers/migration** → verified pre-change backup → additive schema → initialize pristine artifact atomically/fsynced → durable DB references and bindings → pending recovery → publish adapter. Native engine-open behavior itself is subject to the actual boundary controls; no claim of zero filesystem effects merely from placing checks before PRAGMA.

Only a genuinely new preactivation pair may initialize. An unreferenced pristine generation-zero sidecar left by interrupted initialization can be reused unchanged if there are no ledger/binding/activation artifacts. Missing required material, mismatch, non-pristine orphan, uncertain publication or invalid schema fails closed before mutation. Never regenerate to make an old DB fit. No migration or startup stamps coverage start.

Key deletion/import removal writes retained tombstones to the sidecar before deleting/replacing key rows. Prevalidate the entire proposed import, ACL and pricing under the actual transaction before any destructive write. A collision or malformed input produces no DB or sidecar mutation. A later storage failure after a tombstone ACK can conservatively leave the key retired/blocked; it cannot promise rollback of an already durable independent artifact. Reopen merges retirement and disables stale restored key rows before publishing authority.

Config import keeps ledger, audit, activation, binding and coverage material; it cannot overwrite them with payload fields. Export adds versioned non-secret coverage metadata and clearly identifies config-only export; legacy omission remains allowed subject to retained local identity checks. Map identity conflict to HTTP 409 at the existing database import route without adding a new management authorization bypass. Full physical restore remains P5.

P2 includes independent durable gap latch, global maintenance entry, generation CAS and audit-before-sidecar acknowledgement for reconciliation/release, including operation-ID replay and persisted release receipts. Check receipt capacity before writing the DB audit; never prune history to admit a new release. A failed DB audit leaves the sidecar unchanged; failed sidecar ACK retains blocking state. Per-key reconciliation cannot clear global maintenance. No inference continuation from unhealthy SQL.js RAM. P3 owns the separately verified identity/config conditions for unlimited gap-authorized continuation; P2 does not enable that exception.

Existing pre-schema backup is best-effort (`migrate.js:234`–`:245`), and lightweight backup is not a complete restore bundle. The P2 migration must require and verify its pre-change backup before any schema/data change, include preexisting coverage material, and stop on backup failure. Do not label generic `backupDbLite` sufficient without actual restored-content checks. Preserve failed fixtures and receipts. No live DB is opened by this preparation.

## Ledger and exact money contract

Retain contract tables `apiKeyAccounting`, `apiKeyAccountingAudit` and `apiKeyBindings` with indexes and additive schema version 3, unless the baseline changes before implementation. Versioned migration and required-index verification must fail closed; additive sync's swallowed index errors cannot prove accounting readiness. Policies remain P4-owned; retain any policy data if encountered rather than importing old policy initialization wholesale.

Store pending/settled/unresolved/not_dispatched/waived, owner lifetime, original immutable snapshot, canonical intent/terminal payload, nullable cost and resolution version. Audit is append-only with globally unique operation ID. Settled requires exact evidence and bounded nonnegative nanoUSD; unresolved/not-dispatched have null cost; waived has explicit audited zero. Pending → settled/unresolved/proven-not-dispatched; unresolved → exact settlement or audited waiver/correction. Manual resolution wins via CAS; later conflicting callbacks append observation evidence and refuse without a second debit. Identical replay is idempotent, changed payload conflicts. Replay acknowledgement is a new own operation ACK, never evidence that a prior ACK was delivered.

Pure money input uses explicit exact, nonnegative safe integer quantities, inclusion/subset provenance and original typed rate/unit authority. Base token adapter must distinguish total input, cache read/write, output and included/separate reasoning; reject overlaps or missing required counts. Core calculation can consume validated disjoint components with integer quantity, decimal rate and denominator (1M tokens or 1000 uses); P3/X owners must prove protocol-to-component mapping and original required categories. Unknown categories/rates/units refuse exact settlement. Do not silently drop tool/media/tier categories to fit the base shape.

Reuse `decimalMoney.js`, P1 snapshot/rate schema and range `9_000_000_000_000_000` nanoUSD. Sum rational/BigInt components with a common denominator and round half up exactly once per attempt. Reject per-attempt overflow; aggregate spend with BigInt without SQLite SUM overflow or Number loss. Explicit zero is priced; missing/estimated usage becomes unresolved/null cost. Preserve original rates across subsequent pricing changes. Historical usage is not backfilled into monetary rows.

## Coordinator bounds and failure ordering

Proposed initial bounds: group ≤32 operations/256 KiB, queue ≤256 operations/2 MiB, single operation ≤32 KiB, structured payload depth ≤12 and ≤100 fields per object. Validate and snapshot before retaining input; include private-registry retained data in byte/count accounting. Reject overflow rather than waiting without bound. These are proposed limits, not measured throughput guarantees.

Coalesce within a turn, apply one bounded synchronous group per scheduled turn, and yield before another group. Network, request parsing and streaming never execute in this lane. Each member has a savepoint; local validated refusal permits other members only while adapter health remains proven. Uncertain SAVEPOINT/RELEASE/rollback/commit/publication poisons the adapter lane; throw for every group member and refuse new work. Only return member success after the outer durable ACK; throwing/malformed/lost group result delivers no success even if rows are present.

Cancellation before application removes the operation and preserves the original abort reason. After application starts, return the recorded outcome; cancellation cannot erase it. Stop rejects new/queued work and drains at most the currently executing group, without waiting for network owners. JavaScript cannot preempt synchronous filesystem/SQLite calls: bound retained work, assert finite SQLite busy timeout, and test child-process deadline/termination; do not promise a hard wall-clock drain bound under a hung filesystem.

## Source manifest and ownership

Paths below are current at `2ca88257`; **new** entries do not exist yet. Changes are sequential. Phase 1 must ship its complete identity/artifact/import/delete boundary together, not schema-only.

| Phase | File and current anchor | Proposed change / affected callers |
|---|---|---|
| 1 | `src/lib/db/writerOwnership.js:32,87` | Private immutable directory/lifetime metadata; preserve claim/release and contender refusal. |
| 1 | `src/lib/db/adapters/nativeAdapter.js:6,56`; `sqljsAdapter.js:11,17` | Pre-mutation artifact validation using raw synchronous read capability. No service dependency. |
| 1 | `src/lib/db/adapters/nodeSqliteAdapter.js:4`; `betterSqliteAdapter.js:4`; `bunSqliteAdapter.js:4` | Trace factory→claimed lease→wrapper; pass only required immutable context if wrapper cannot obtain it. Revalidate factory cleanup. |
| 1 | `src/lib/db/schema.js:7`; `migrations/index.js:3`; **new** `migrations/002-accounting-foundation.js` | Add tables/constraints/indexes; versioned migration number 2 is distinct from declarative schema version 3. |
| 1 | `src/lib/db/migrate.js:114,218`; `backup.js:39` | Required backup/verification, identity-safe legacy import, strict post-migration readiness. Preserve ACL and pricing. |
| 1 | **new** `src/lib/db/accounting-coverage.js`; **new** `helpers/api-key-bindings.js` | Sidecar/read/initialize/gap/maintenance/tombstone primitives and binding validation. Adapt old code selectively. |
| 1 | `src/lib/db/driver.js:34` | Initialize artifact/bindings under existing lease before publishing. No previous-driver checkout. |
| 1 | `src/lib/db/repos/apiKeysRepo.js:39,61,78,84` | Durable create/update/delete, immutable binding, validated reads; preserve `rowToKey` ACL/public shape. |
| 1 | `src/lib/db/index.js:77,109,121`; `src/app/api/settings/database/route.js:27` | Config metadata and atomic prevalidation; preserve pricing lock/reconciliation and map collision 409. |
| 1, read-only | `src/app/api/keys/route.js:2`; `keys/[id]/route.js:2`; `src/lib/localDb.js:3`; `src/models/index.js:2` | Existing CRUD callers/re-export contracts; no new inference or privileged management surface. |
| 2 | **new** `src/lib/accounting/{service,exact-money,attempt-payload}.js`; **new** `src/lib/db/repos/api-key-accounting-repo.js` | Bounded core, pure monetary evidence validation, state/CAS/audit/replay. No repo→service import. |
| 2, read-only | `src/lib/pricing/{decimalMoney,referenceResolver,constants,rateValidation}.js` | Reuse exact ingress, snapshot/units and rates; preserve pricing API. |
| 3 | **new** `src/lib/accounting/write-coordinator.js`; phase-2 service/repo | Private fresh-apply capability, bounds, cancellation and ACK fanout. |
| 3 | `src/lib/db/driver.js:46`; `adapters/nativeAdapter.js:21,40`; `adapters/sqljsAdapter.js:72,115` | Explicit close/startup recovery and scoped automatic-close lifecycle. Preserve uncertain-publication exclusion. |
| 3, inspect before edits | `custom-server.js:38`; `src/lib/pricing/servingStartup.js`; `catalogScheduler.js` | Existing signal/scheduler lifetime consumers. If entrypoint delta is necessary, add an exact scoped design/manifest before editing. |
| Final | `docs/DB-SAFETY.md`; owning phase/plan files | Document tested contracts, config compatibility and actual limitations only after implementation evidence. No architecture-doc churn now. |

## Test manifest and executable commands after approval

Current test runner is `tests/vitest.config.js` / Vitest 4; runtime observed is Node `v24.21.0`. No product tests were run during preparation. Run commands from repo root; the tests generate only disposable `DATA_DIR` fixtures. Back up fixtures before intentional schema/data transitions and retain failed artifacts. No credentials/live provider requests. Track child PIDs and await termination before cleanup.

1. Existing narrow baseline, then again after phase 1:

   ```sh
   cd tests && npx vitest run unit/key-access-migration.test.js unit/pricing-persistence-import.test.js unit/db-writer-ownership.test.js
   ```

   Update only the legitimate schema-2 backup expectation to schema 3; do not relax ACL/row/round-trip assertions. Pricing tests already assert actual Node/SQL.js driver identity. Do not install runtimes or use live DB to make a lane available.

2. **New** phase-1 files: `tests/unit/accounting-identity.test.js`, `accounting-coverage.test.js`, `accounting-import.test.js`; new child `tests/fixtures/accounting/accounting-process.mjs`.

   ```sh
   cd tests && npx vitest run unit/accounting-identity.test.js unit/accounting-coverage.test.js unit/accounting-import.test.js
   ```

   Cover all ID/secret/retired/duplicate collisions; unchanged ACL/pricing/legacy import; sidecar malformed/missing/key mismatch; crash sidecar-before-reference; startup before-PRAGMA refusal; failed backup before schema; import refusal before DELETE; tombstone-before-delete crash; gap/maintenance scope, generation/replay/lost ACK. Assert persisted hashes/rows, not only error text.

3. **New** phase-2 files: `tests/unit/accounting-exact-money.test.js`, `accounting-ledger.test.js`.

   ```sh
   cd tests && npx vitest run unit/accounting-exact-money.test.js unit/accounting-ledger.test.js
   ```

   Cover half-nano ties/single rounding, zero/missing/estimated, invalid quantities/subsets/units/category/range, old snapshot after pricing edit, every transition, duplicate equality/conflict, late/manual CAS race, audit replay and no historical debit. Both actual Node/SQL.js storage lanes reopen from disk.

4. **New** phase-3 files: `tests/unit/accounting-coordinator.test.js`, `accounting-lifecycle.test.js`, `accounting-crash.test.js`; extend the new child with strict driver selection and IPC checkpoints.

   ```sh
   cd tests && npx vitest run unit/accounting-coordinator.test.js unit/accounting-lifecycle.test.js unit/accounting-crash.test.js
   ```

   Inject before/inside/after intent and terminal commit, failure after publication but before own ACK delivery, malformed group result, caught-inner RELEASE/rollback uncertainty, queued fresh-authority change, queue bytes/count and cancellation reason. Child SIGKILL/reopen distinguishes process crash from power loss. Require same-DATA_DIR contender no-mutation, explicit close with pending/late callbacks, failed release and signal behavior; no silent adapter skips.

5. Broaden shared-boundary regressions after source changes:

   ```sh
   cd tests && npx vitest run unit/db-durable-publication.test.js unit/db-sqljs-publication.test.js unit/db-release-sync.test.js unit/db-driver-chain.test.js unit/db-migration-chain.test.js unit/pricing-snapshot-sqljs.test.js unit/pricing-snapshot-cache.test.js unit/key-access.test.js unit/key-access-handlers.test.js
   ```

   Run ESLint on the exact changed JavaScript files and build if barrel/Next route imports change. Before a build, inspect existing project processes and output directories; do not duplicate servers or reuse another session's build directory. Run affected pricing route/security tests if database route changes affect them. No whole-suite pass claim from these focused commands.

## Reuse, alternatives and review

Reuse current single-writer/health/durable transaction and P1 pricing primitives. Adapt old coverage/binding ordering, state/CAS, exact arithmetic and bounded coordinator after removing policy/provider imports. Reject wholesale old driver/service/repo, repo→service cycle, old signal handlers, old test receipts and saved WIP `d515fb49`.

Trade-offs: a DB-only identity/coverage design is smaller but fails independent-gap and managed older-DB-restore obligations first. The adapted sidecar design depends on strict two-store ordering and fails closed on partial publication, at the cost of conservative operator recovery. Recovering only the previous lock ID depends on lock retention and fails after a clean close; recovering all pending before publishing a new exclusive lifetime also covers clean close/reopen. Recommended direction is the adapted sidecar plus lifetime recovery. Better approaches: none beyond the requested selective port; current claimed leases make the old driver unsafe to copy.

Before source edits, review the chosen architecture and phase manifests against the frozen contract. After each phase, run its focused/actual-boundary controls and review failures before advancing. No independent review has occurred in this preparation; direct source review is not independent approval. If review or implementation discovers a changed authority boundary, update this proposal before crossing it.

Rollback remains preactivation only: stop owned fixture processes, retain uncertainty receipts, restore a verified compatible DB plus all identity/coverage material as one bundle. Never delete just the sidecar/tombstones/lock or downgrade away ledger history. No automatic physical restore feature is introduced.

## Execution authorization

The user authorized continuing through completion on 2026-10-22. Adopt the private core authority/own-ACK interface, exclusive-lifetime pending recovery and close protocol, and adapted sidecar plus complete identity/import/delete/minimum-maintenance boundary. New APIs/tests still require actual implementation and receipts; authorization is not evidence that a check passed.
