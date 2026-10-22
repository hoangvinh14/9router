# P1 phase 1 — dependency gate (2026-10-18)

## Verdict: P1 BLOCKED; do not start phases 2/3

User invocation: `ak-cook --auto plans/261018-0213-reference-pricing-port/plan.md`. This authorizes execution under the existing dependency/stop gates, not their removal. Created local branch `feat/reference-pricing-port` from `87a74e1bda3677193c6f71a7e2100c90311f0689`. Legacy reference remains `3a4955a0336f970505c325b0faf892f5397c93bb`; stash remains `d515fb4927ed45a5853104406cd0fecca549c04c`. No stash apply, source port, install, commit, push or activation.

**U1 outcome:** a pure pricing module extraction is plausible, but current shared storage cannot uphold the required durable ACK/reopen/healthy-read/single-writer invariants without a shared writer/adapter prerequisite. Per roadmap phase 1 step 3, changing writer topology/authority is a stop gate. This is not a claim that an independent pricing feature is impossible, nor permission to pull old accounting into P1. Baseline success cannot resolve this architectural prerequisite.

## Evidence and finite hypothesis

Hypothesis recorded in [storage-feasibility-probe.mjs](./storage-feasibility-probe.mjs): leaving current shared adapters/timers unchanged cannot establish durable pricing ACK and exclusion using a pricing-only wrapper. Bound: one local disposable probe, no network and no process crash/power-loss claim. Result: [storage-feasibility-result.json](./storage-feasibility-result.json).

Observed on unchanged current source:

1. `src/lib/db/adapters/sqljsAdapter.js`: `run/exec/transaction` schedule a 100ms save; `persist()` exports the **whole DB**, calls direct `writeFileSync`, has no atomic rename/fsync or health latch; timer failure logs and continues. Probe: first mutation returns before any database file exists. `durableTransaction` and `health` are absent.
2. Same probe opens two current SQL.js adapters on the same file. Writer 1 closes with price `2`; writer 2 writes an unrelated row from its stale image and closes; reopened price is `1`. This is a controlled two-adapter reproduction of the stale-whole-file overwrite mechanism, not a claim of an observed production incident or a certified multiprocess test.
3. `src/lib/db/driver.js`: no DATA_DIR ownership acquisition before open/migration/timers, no health/committed-read seam; adapter-init failures fall through to another adapter. A pricing-only lock acquired after open leaves older writable images and their timers uncontrolled.
4. `src/lib/db/schema.js`: version **2**, ACL columns `accessRestricted/accessAllow` retained; shared PRAGMA is WAL + **NORMAL**, not FULL. Probe verifies current actual Node SQLite journal `wal`, synchronous `1`, no durable transaction method. Native normal transaction success is not the required crash-durable ACK.
5. All current adapters expose writable `raw` handles. Any new safety seam must explicitly bound raw access, transaction depth, async callbacks, shutdown and fallback-after-open failure. HMR globals cannot become ownership bypasses.
6. Old `catalogSync`, `catalogSchedule`, `catalogScheduler`, repo and coverage directly depend on `durableTransaction`, `health` and/or `coverage.status().maintenance`; old driver additionally imports writer ownership, accounting coverage, retired bindings and recovery. Copying it is outside P1 and would change unrelated identity/schema behavior.

### Alternatives evaluated

| Candidate | Decision |
|---|---|
| Turn memo off when `canMemoizePricing` is absent | Safe cache default only; does not make dirty reads durable or fix publication ACK. Necessary but insufficient. |
| Call current `transaction`, wait 100ms or close/reopen per pricing call | Reject: elapsed time/close success is not atomic/fsynced ACK; other timers/instances still own whole images. |
| Add file fsync just in pricing repo | Reject: cannot prevent stale adapter overwrite, partial-write corruption or subsequent timer/shutdown writes; cannot certify native PRAGMAs/ownership. |
| Store a second pricing sidecar | Not an accepted design: overrides/raw-import/usage would have two authorities and cross-file publication without a single acknowledged transaction; also diverges from existing SQLite contract. Requires a separately reviewed contract, not an auto workaround. |
| Drop SQL.js or claim Node-only acceptance | Reject: adapter-support waiver is explicitly prohibited. Bun/better runtime evidence cannot be fabricated. |
| Port old driver/schema/coverage wholesale | Reject: imports accounting activation/recovery/key identity semantics and conflicts with upstream ACL schema. |
| Extract minimal shared ownership/durability first | **Named prerequisite below; requires operator approval before execution.** No P2 automatically opened. |

## Named prerequisite for approval

**DB-SAFETY-PRICING: shared single-writer ownership + durable publication/healthy-read adapter primitives, without ledger/accounting.**

This is a proposed prerequisite scope, not a new executable plan or authorization:

- Own DATA_DIR exclusion before any writable adapter load, migration, maintenance, timer or close flush; deterministic owner release/recovery and ambiguous-owner refusal; process-global/HMR lifecycle. Preserve current driver runtime order and deliberate Node >=24 better-sqlite3 skip. Initialization failure after writable open must not silently downgrade to a fresh writer over uncertain state.
- Add synchronous outermost durable transaction ACK and guarded healthy reads. Native: explicitly configure/read back WAL/FULL, verify before ACK; rollback/release uncertainty poisons future use. SQL.js: same-directory temporary export, file fsync, atomic rename, directory fsync; timer/shutdown use the same coordinator; never publish/read poisoned RAM or overwrite after uncertain ACK. Reopen is a new lifetime, not retroactive success of a failed ACK.
- Preserve all four adapters; establish actual runtime lanes or report unavailable adapters as unverified, never silently remove support. Prove ordinary settings/usage/migration writes still work, no concurrent-field loss and no global fsync-per-analytics requirement accidentally introduced.
- Keep ledger tables, coverage-gap sidecars, retained key fingerprints, accounting admissions, inference hooks and ledgerStartedAt **out**. This prerequisite cannot claim P2/accounting acceptance.
- Proposed exact source boundary for that separately approved design: `src/lib/db/driver.js`; `src/lib/db/adapters/nodeSqliteAdapter.js`, `betterSqliteAdapter.js`, `bunSqliteAdapter.js`, `sqljsAdapter.js`; new `src/lib/db/writerOwnership.js`, `durableFile.js`, `adapters/nativeDurability.js`. Transaction/migration integration in `src/lib/db/migrate.js` only if required by the approved seam. No whole old-file restore. Backup/raw access impact must be resolved before execution, not assumed covered by these filenames.
- Proposed new prerequisite tests: `tests/unit/db-writer-ownership.test.js`, `db-durable-publication.test.js`, `db-sqljs-publication.test.js`; affected existing `db-driver-chain`, `db-migration-chain`, `db-sqlite-vs-lowdb`, `db-concurrent`, `key-access-migration`. Fault-before/after-rename, uncertain ACK, concurrent readers, non-owner open/timer refusal, close/reopen and real per-adapter lanes are required. Tests do not yet exist; there is no claim they ran.

**Exit before P1 resumes:** an accepted bounded prerequisite design and fresh implementation/verification receipt, followed by rechecking P1 against that exact seam. No user decision on support/authority is inferred from `--auto`.

## Extraction/consumer manifest (conditional; NOT an executable phase-2 gate)

Old bodies read through `git show`, not restored. Full current architecture, DB driver/four adapters/schema/migrate/index/pricing repo, auth helpers/wrapper/startup, UI consumers and selected baseline suites inspected. Current literal/dynamic call search includes:

- `src/app/api/pricing/route.js` → `src/lib/localDb.js` shim → DB barrel/repo.
- `src/lib/db/repos/usageRepo.js:calculateCost` dynamically imports `./pricingRepo.js:getPricingForModel`; legacy float analytics remains analytics, not exact accounting. DB parity/concurrency tests exercise this consumer.
- Raw writers: `src/lib/db/index.js:importDb` deletes/reinserts pricing; `src/lib/db/migrate.js:importLegacyMain` imports legacy pricing; repo writes via `makeKv('pricing')` and raw SQL. `getPricing` currently has module-level five-second cache.
- Page and modal use GET/PATCH/DELETE directly; `src/dashboardGuard.js` lists `/api/pricing`, but permissive outer policy is not route-level authority. No existing sync/coverage route.
- Startup `src/instrumentation.js` currently starts unrelated model catalog sync, with no serving-vs-build pricing guard; `initializeApp.js` is broad deferred app startup and is not a reliable sole API-only scheduler owner. Do not copy old instrumentation or initializeApp wholesale (old has unrelated outbound proxy/model and auto-ping deltas).

### Reuse / adapt / hold

| Legacy file | Minimal P1 decision / exact target |
|---|---|
| `src/lib/pricing/catalogJson.js` | Reuse bounded parser/lexemes after tests; no evaluated payload URLs/functions. |
| `src/lib/pricing/decimalMoney.js` | Adapt import to pricing-owned `src/lib/pricing/constants.js` (MAX/rate/unit/endpoint schema only); retain nine-decimal lexical bound/explicit zero, no float money. |
| `src/lib/pricing/money.js` | **Hold** request usage/provenance/settlement functions for later accounting owner. Do not port its transitive engine graph. Decimal/rational tests may be separated from that graph; no claim exact inference cost is implemented. |
| `src/lib/pricing/catalogMapping.js` | Adapt against **current** registry/provider/model schema, preserve explicit aliases/mapping revision/exact match, virtual/free labels. No registry writes. |
| `src/lib/pricing/referenceResolver.js` | Adapt to pricing-owned constants/schema + pure decimal helper; remove `money.js` and accounting-usage imports. Preserve complete-source precedence/unsupported barrier, frozen snapshots/rates/unit/source/mapping/catalog revision; no usage certification. Typed rates remain explicit fields/units, not protocol support. |
| `src/lib/pricing/pricingValidation.js` | Adapt to current registry exact modelKind, validate complete-source rows with pricing-owned schema; preserve finite numeric legacy ingress and bounded decimal-string mutations. |
| `src/lib/pricing/snapshotMemo.js` | Hold cache eligibility until DB-SAFETY-PRICING proves committed health/depth/dirty seam; missing eligibility means bypass, not healthy-read permission. Immutable snapshots do not require caching. |
| `src/lib/db/pricingRevision.js` | Conditional reuse: transactional raw INSERT/UPDATE/DELETE triggers including old/new scope; install after kv/_meta creation, before legacy import. Revision overflow/corrupt metadata must refuse; no commit or reuse from rollback/dirty state. |
| `src/lib/pricing/catalogSync.js` | Adapt to approved DB primitive, not fake `coverage`; fixed HTTPS URL only, redirects reject, 15s/20MiB decompressed/parser bounds, stage then one durable catalog+status publication; single-flight; no overrides changed. |
| `src/lib/pricing/catalogSchedule.js`, `catalogScheduler.js` | Adapt to approved ownership/health + durable schedule ACK; default OFF, 24h, no immediate fetch, serialized enable/disable/reconcile, persisted-vs-running error distinction; no fake ledger ownership. |
| `src/lib/pricing/coverageReport.js` | Adapt current registry read-only; one synchronous committed view; coverage hash/revision409 pagination; `usageCertified:false`; units/source/staleness not accounting promise. |
| `src/lib/db/repos/pricingRepo.js` | Adapt existing file, preserve current bundled provider prices; numeric map only externally; remove stale module cache; complete model replacements/no-op writes, explicit zero/inherit; keep legacy usage resolver compatibility distinct from strict snapshot resolver. |
| `src/lib/auth/managementGuard.js` | Reuse/adapt with current dashboard session/trustedPeer helpers; no CLI/gateway admin credential. Require auth before privileged body/access/fetch and mutation Origin/CSRF. |
| `custom-server.js` | Exact narrow delta: overwrite authenticated `x-9r-socket-proto` + original-presence `x-9r-authority-forwarded` stamps before Next normalization; retain real-IP sanitization. No forwarding-header or Host-only admin authority. Test existing h2c replay too. |
| `.env.example` | Add documented optional `NINEROUTER_MANAGEMENT_ORIGIN` if reused; never insert secret values. |
| `src/app/api/pricing/route.js` | Adapt GET/PATCH/DELETE numeric map and route guard/no-store/redacted errors; no PATCH expectedRevision/CAS introduced. |
| `src/app/api/pricing/sync/route.js` | New GET status, POST empty fixed-source sync, PUT exact `{schedulerEnabled:boolean}` body (1KiB); auth first, query/payload rejection, configured/running/503+configurationSaved distinction. |
| `src/app/api/pricing/coverage/route.js` | New bounded GET/query and actual stale revision409 contract. |
| `src/instrumentation.js` | Candidate sole narrow serving Node hook with explicit build/static/export exclusions, initialize persisted timer only; do not start broad app bootstrap or touch unrelated model-catalog logic. Test API-only serving and build no-DB/no-fetch. No initializeApp change unless re-manifested. |
| `src/shared/utils/pricingDraft.js` | Adapt to pure pricing-owned schema/decimal helper; display-only numeric exponent expansion, edited lexical validation, changed rows only/untouched no-op. |
| `src/shared/components/PricingModal.js`, `PricingCoverage.js` and `src/app/dashboard/settings/pricing/page.js` | Adapt UI with effective-state load/reset, blank vs zero vs inherit, focus/keyboard/mobile region; sync GET/POST/PUT, configured/running/error, coverage409 restart; no unported accounting claim. |

### Raw import/export/migration policy proposal

Requires review after the prerequisite, not inherited from old implementation (old export omits `referencePricing`):

- Keep pricing overrides in SQLite `kv` with exact strings internally, numeric legacy map externally. Validate whole import and canonical complete-source policy **before DELETE**, then one durable import transaction. Never downgrade ACL v2 or overwrite its export/import mapping.
- Configuration export adds a versioned `referencePricing` projection of validated catalog/status/schedule, without secrets. Import including the projection validates exact allowed fields, catalog bounds/source/unit/hash semantics and schedule, then atomically replaces it with overrides. Legacy config without the projection **preserves current catalog/status/schedule**; omission must not erase last-good or scheduler preference. Physical DB backup remains a different contract.
- After durable import, reconcile timer from the final stored preference, serialized with PUT; runtime failure must not claim rollback of saved configuration. Projection import must not execute a URL or fetch catalog. Need tests for this new import↔schedule interaction.
- Legacy JSON migration validates legacy pricing before writes and installs transactional revision invalidation before raw imports; invalid decimal precision/prototype/schema must not be silently rounded or dropped. A legacy sparse override normalization policy must be checked against actual fixtures before execution; if incompatible, block rather than invent source merging. No new schema version lower than 2; if schema definitions change, additive migration/version bump must be manifested first.
- Future approved implementation must verify exact export/import round-trip of upstream `accessRestricted/accessAllow`, no unintended catalog model registration and no ledgerStartedAt/accounting rows.

### Conditional test/file ownership

Production/test files above are **not modified** by phase 1. Proposed port candidates (read again before edit):

- `tests/unit/pricing-validation.test.js`, `pricing-catalog-sync.test.js`, `pricing-route.test.js`, `pricing-schedule.test.js`, `pricing-snapshot-cache.test.js`, `pricing-snapshot-sqljs.test.js`.
- `tests/unit/pricing-management-route.test.js`, `pricing-crud-management.test.js`, `pricing-management-integration.test.js`, `pricing-management-peer.test.js`.
- `tests/unit/pricing-coverage-report.test.js`, `pricing-coverage-registry.test.js`, `pricing-draft.test.js`.
- New pricing-only `tests/unit/pricing-decimal-money.test.js`, `pricing-persistence-import.test.js`, `pricing-serving-startup.test.js`; do not drag `api-key-money.test.js` accounting service imports into P1 merely to preserve its filename.
- `tests/fixtures/pricing/models-dev-minimal.json`, `models-dev-overprecision.json`; inspect old browser launcher/body/cleanup before any later port of `tests/browser/pricing-editor.mjs`, `pricing-real-api.mjs`, `run-pricing-editor.mjs`. No browser script was run in this phase.
- Comparator source fix is unnecessary for phase-1 capture: report-owned identity/reachability wrapper below. No `tests/__baseline__` or known-fails edits authorized here.
- Current affected baseline exact eight-file list is [baseline-manifest.json](./baseline-manifest.json). Expand after shared prerequisite review; it is not the exhaustive final affected barrier.

## Baseline / comparator

- Source/input runtime: Node `v24.21.0`, npm `11.19.0`; installed Next `16.3.8`, SQL.js `1.14.2`, Vitest `4.1.11`, ESLint `9.39.5`. Root package is `0.5.104`; versions are installed observations, not a clean install/lock-parity assertion. Existing deps/environment left in place, no installation/runtime switch.
- One eight-file Vitest command from `tests/`, installed binary only, `--maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=<disposable>/results.json`. Files cover pricing seed, ACL, raw import/export, DB migration/fallback/concurrency and cache-inclusive legacy cost semantics. Concurrency suite intentionally retained because it directly tests existing `updatePricing` merge and usage consumers.
- Disposable run root `/tmp/9router-p1-baseline-nShNcc`, separate `home/data/tmp/cache`, network-denying [offline-preload.cjs](./offline-preload.cjs), no live/catalog/provider call authorized. Preload denies standard HTTP/HTTPS/net/TLS/fetch paths; this is selected-suite containment, not an OS sandbox or a whole-server zero-egress certificate.
- Baseline terminal receipt **FAILED**, task `bde11d71a`, exit 1: **8 files, 86 assertions, 84 passed, 2 failed, 0 pending/todo**. Reporter `numTotalTestSuites=29` counts nested suites, not files. Durable [raw JSON](./current-baseline-results.json), [runner log](./current-baseline-output.log) and [identity/count/hash receipt](./baseline-receipt.json) retained. All eight expected file identities and assertion totals reconciled, no duplicate/missing/empty/skipped results, no explicit hook/collection failure reported. This is a complete selected baseline with two reds, not a passing baseline or no-regression result.
- Both reds are `tests/unit/db-concurrent.test.js`: `100 parallel saveRequestUsage → no count loss` at line40 expected100/got3; `daily summary aggregates correctly under parallel writes` at line167 expected50/got1. Assertion stacks establish bodies reached. Pricing concurrent model merge passed, as did the other seven files. These failures were observed on unchanged current product source **under this isolated harness**; neither root cause nor absence of harness influence is certified.
- Bounded source-only triage: the failing tests create many identical usage rows without explicit unique timestamps. Current `usageRepo.js:saveRequestUsage` assigns millisecond ISO timestamps, then its synchronous transaction deliberately suppresses rows matching timestamp/provider/model/connection/key/token counts. Timestamp collisions are therefore a plausible explanation for undercounting; no runtime instrumentation/rerun was performed to prove that attribution. Fixture uses disposable DATA_DIR/resetModules, worker file isolation and a single worker; network preload does not alter Date or SQL methods. It blocks networking only; no network-denial error appears in these two assertion messages. Do not present these failures as evidence of stale-image overwrite or silently modify analytics deduplication within reports-only scope.
- One run only, no product/test repairs or rerun-for-green. Original `/tmp/9router-p1-baseline-nShNcc` artifacts retained; probe-only databases were removed, fixture suites perform their own cleanup, and the baseline process has exited. No serving process or scheduler was started.
- [compare-baseline.mjs](./compare-baseline.mjs) keys files relative to the actual checkout, rejects unknown/duplicate files/assertions, missing/empty suites, skipped bodies and explicit hook/collection failures. Nine synthetic controls passed in [comparator-controls-result.json](./comparator-controls-result.json): identity, unchanged, pass→fail, missing suite, empty collection, skipped body, hook-unreached, foreign identity and missing assertion. No comparison can prove arbitrary body execution from malformed reporter data; this wrapper treats identifiable hook failure as incomplete, not a known test failure.
- Original comparator's `/app/` split is not used as evidence. No post-port run exists, so there is **no current-vs-port no-regression claim**; successful baseline self-validation establishes shape/identity completeness only.

## Verification checkpoint

- `node reports/comparator-controls.mjs`: 9/9 synthetic integrity controls passed (actual invocation uses the full plan-owned path).
- `node reports/storage-feasibility-probe.mjs <owned-disposable-root>`: exit 0; observations recorded above; probe SQLite/WAL/SHM files removed by `finally` and adapters closed.
- Active LSP probe of four report-owned JS/MJS/CJS files: 4 clean, 0 diagnostics; this is not a product-code or security scan.
- Compound shell verification beginning with ESLint over those same four files timed out at 30 seconds, no output. **Lint inconclusive**, not pass. Later commands in that compound invocation were not assumed executed; standalone `git diff --check` and status were then run successfully. No timeout/config tuning or rerun-for-green. Advisor failed-verification counsel supported preserving this gap and the explicit dependency stop; it did not independently inspect the probe or source.
- Plan CLI validation: `valid=true` (format only). [Source checkpoint](./source-checkpoint.json) records revision, stash and selected source/lockfile hashes; full tracked product/test diff and staged-index diff against HEAD were empty. Markdown runner coverage was at least once inconclusive (`marksman silent`), not blanket clean.

## Rollback / review / limits

No product edit to roll back. Feature branch is local, index remains untouched; prior stash/old branch/source revision retained. New artifacts are plan-owned reports plus automatic local journal and harness-managed `.pi/tasks` metadata. Do not delete unowned plans/environment/deps or use git reset/stash over them.

Direct review found a **required storage/authority blocker**, not a security clearance: serving without exclusion can lose pricing state; SQL.js RAM-success must not be advertised as durable last-good. Current pricing API's outer dashboard guard is not the accepted new in-route management boundary. No auth hardening has been deployed. Proposed fixed-source/auth stamps/CSRF protections still need implementation and real compiled-wrapper verification after prerequisite approval.

No independent delegate review claimed. No build/browser/power-loss/real multiprocess/all-adapter acceptance, live sync, inference accounting or all13AC evidence. P1 remains BLOCKED; P2 and historical diagnostic matrix remain unopened. Next action is operator decision on DB-SAFETY-PRICING, not automatic phase-2 implementation. Phase-1 **investigation concluded; dependency gate failed**, not implementation acceptance. Baseline reds and lint-inconclusive remain explicit limitations.
