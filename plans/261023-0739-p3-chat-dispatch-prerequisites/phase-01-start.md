---
title: "Explicit policy and persisted authority"
status: todo
---

# Explicit policy and persisted authority

## Overview

Implement canonical classification and a private synchronous proof capability; P3 later composes it with independent gap ACK and actual transport freshness. [Source assessment](../reports/planner-261023-1430-p3-authority-prerequisite.md) explains the deferred-write hazard. One controller owns all files serially.

## Requirements

- [x] Policy rows store `apiKeyId`, nullable weekly/monthly nanoUSD limits, monotonic version and canonical update timestamp. Null/null is unlimited; finite zero is budgeted. Missing/corrupt/unsupported rows deny, independent of ACL.
- [x] One verified first-install migration establishes legacy unlimited explicitly; new-key/import paths preserve policy and retained tombstones. Existing initialized identities never regain defaults because a row vanished. Mirror policy-format installation evidence in existing sidecar and DB metadata to distinguish old snapshot from first installation.
- [x] Do not mutate policy during inference or activate accounting. Sidecar format upgrade retains id, HMAC material, gaps, generations, retirement and receipts; interrupted upgrade denies or safely resumes, never creates clean replacement state.
- [x] All state is adapter-lifetime private or request-local. Existing service/adapter health, normal reads and own ACK semantics remain strict.

## Implementation Steps

1. Add policy schema and validation first. Existing seams are `src/lib/db/schema.js:6`, `src/lib/db/migrations/index.js:7`, `src/lib/db/migrate.js:56`, `src/lib/db/driver.js:47`, `src/lib/db/repos/apiKeysRepo.js:44`, and `src/lib/db/index.js:112`. Schema declaration and versioned migration are separate counters; derive the next registry version rather than comparing their numbers blindly. Include legacy-import ordering at `src/lib/db/migrate.js:142`.
2. Add deterministic ordered authority projection over verified schema/metadata, keys/bindings/policies, settings, provider connections/nodes, pools, combos and routing KV. Exclude attempt/audit/analytics rows; sidecar gaps/generation are checked independently. Retain its last successful durable publication digest and healthy pre-failure digest. Projection equality is exclusion evidence, never RAM permission.
3. SQL.js: immediately before publication, capture healthy authority; update acknowledged digest only after successful publication (`src/lib/db/adapters/sqljsAdapter.js:33`). After recording-only failure, cancel timers and retain poison. Read source via no-follow O_RDONLY fd with regular/single-link and installed-file checks; create/dispose transient SQL.js snapshot, validate schema and compare projection with both retained digests. Do not call source fsync/export/rename, PRAGMA setup, migration, or another writer factory. Changed authority in failed publication denies; unchanged authority can continue. Lost original ACK remains failed even if its row is visible.
4. Native: extend private transaction status to distinguish confirmed rollback, uncertain RELEASE/rollback, escaped thenable, and close failure (`src/lib/db/adapters/nativeDurability.js:8`). Capture committed baseline outside the outer accounting transaction with verified WAL/FULL, and pre-release projection while healthy. A fresh engine read-only connection under the existing lease must read WAL consistently and compare projections; never clone only the main file or use immutable mode. Node factory supplies a private reader constructor; verify supported `DatabaseSync` read-only option against runtime and fail clearly if unavailable. Other native factories retain ordinary behavior.
5. Native uncertain state is never implicitly eligible. Require a positively established quiescent/closed transaction boundary and recording-only failure classification before proof; confirmed rollback supports the positive exception. Uncertain RELEASE qualifies only if runtime evidence positively establishes that boundary; absent evidence denies and is recorded as reached/unreached, not certified support. Thenable/rollback/close uncertainty, configuration write failure, lost owner, unverified schema or missing baseline always deny. Do not unpoison the original engine or release its lease.
6. Validate fresh snapshot key secret→stable ID→active binding/retirement, explicit unlimited policy, format/schema, coverage id/key digest, no maintenance, and selected route/credential/pool. Return a frozen request-local proof, not reader functions/secrets to public APIs. Acquire the snapshot anew after awaits; P3 must still validate current environment/transport, acknowledge its own gap, then synchronously recheck proof/generation and consume a private one-use permit at actual POST. A proof is not an intent receipt or gap ACK.
7. Expose a restricted app capability without relaxing `getAdapter` (`src/lib/db/driver.js:67`), ordinary poisoned reads, or service `live` (`src/lib/accounting/service.js:21`). It must support a fresh degraded request as well as an existing context; no new writable initialization. P3 owns auth-envelope integration, gap ACK and POST tests after this prerequisite closes. Update owning docs only for implemented behavior.

## Exact file ownership

Existing files: `src/lib/db/{schema.js,migrate.js,driver.js,index.js,accounting-coverage.js}`, `src/lib/db/migrations/index.js`, `src/lib/db/helpers/api-key-bindings.js`, `src/lib/db/repos/apiKeysRepo.js`, `src/lib/db/adapters/{sqljsAdapter.js,nativeAdapter.js,nativeDurability.js,nodeSqliteAdapter.js}`, `docs/{ACCOUNTING.md,DB-SAFETY.md}`. New files: `src/lib/db/helpers/accounting-policy.js`, `src/lib/db/persisted-accounting-authority.js`, `src/lib/db/migrations/003-accounting-policy.js`. Do not modify writerOwnership or Bun/better factories unless a demonstrated ordinary-behavior regression requires it; then update manifest first. Do not modify P3/roadmap files concurrently.

The request-proof boundary is implemented in new
`src/lib/accounting/persisted-request-authority.js`, with real-adapter controls
in `tests/unit/accounting-request-authority.test.js`. The driver exposes its
restricted capability for an already initialized lifetime; it never returns a
poisoned adapter or initializes a replacement writer.

Tests: new `tests/unit/accounting-policy-classification.test.js`, `tests/unit/accounting-persisted-authority.test.js`; extend existing `tests/unit/{accounting-migration,accounting-identity,accounting-import,accounting-coverage,accounting-ledger,accounting-coordinator,accounting-lifecycle}.test.js` and existing `tests/fixtures/accounting/test-database.js` only where shared setup requires policy initialization. New paths are proposed, not existing symbols.

## Data flow and tests

Healthy DB→canonical authority digests; failed recording→private fresh persisted snapshot→owner/schema/identity/policy/route validation→proof. P3 composes proof→independent gap durable ACK→fresh synchronous exposure check→one POST. Unknown previous ACK remains unknown; late sink retains original attempt/price.

Unit matrix: null/null, finite/zero, restricted unlimited/unrestricted budgeted; malformed/missing rows/version; first-install versus initialized corruption; create/delete/reimport/tombstone; interrupted sidecar format upgrade and older DB snapshot.

Integration matrix on disposable actual Node SQLite and SQL.js: before-rename/after-rename/lost-ACK accounting failures; policy/settings/credential/node/pool/alias/combo drift before failure and across held await; schema corruption/owner loss/maintenance/retirement; new degraded request; native committed WAL differing from main file, rollback success versus uncertain RELEASE/rollback/thenable/close; no extra writer, source publication, poisoned read or leaked reader. Positive unchanged-authority proof and every negative refusal are mandatory. P3's later loopback matrix must hold/fail gap ACK and count intended/successor POSTs; no gap ACK means zero successor POSTs.

## Finite gates

Run the two new focused suites first with the repository's existing test command and actual-adapter fixture environment; inspect `package.json` and fixture instructions before choosing flags. Each run has a 120-second process bound, no automatic retries. Then run the listed affected accounting suites once (300-second bound), and narrow driver/native durability tests selected from current repository scripts. Record exact commands, revision, adapter/runtime, reached/unreached and cleanup; existing baseline failures stay explicit. Do not apply stash, use live DB/inference, or run old diagnostic harnesses.

Measure 100 sequential proof operations per actual adapter with fixed authority fixtures, one healthy baseline and one recording-only failure fixture; record p50/p95/max and projection size within 120 seconds per adapter. No timeout increases, guard removal, or reruns for green. A failure gets one cause-aligned repair and focused verification; otherwise report the remaining technical blocker. No subjective performance acceptance or all-platform claim.

## Todo

October 27: classification/persisted-proof acceptance is now verified. The
historical timeout was localized to recursive Buffer assertions and repaired
with exact `Buffer.equals`, preserving deadlines and guards. Restricted driver
and request-local proof, actual WAL, interrupted marker upgrade, drift and
uncertainty controls passed. See the [current receipt](../reports/implementation-261027-0850-persisted-authority.md)
for focused/affected/lint gates and 400 measured fresh proofs. App ACL/route,
gap ACK composition and actual POST permission remain the next phases.

- [x] Install/classify policies and prove migration/import/identity preservation.
- [x] Implement adapter-owned fresh proof and failure classification; pass positive/negative actual-adapter controls.
- [x] Record affected/performance evidence and hand the capability to P3; retain activation OFF.

## Success Criteria

Positive proof after recording-only failure on actual Node SQLite and SQL.js; every unsafe authority control denies; no ordinary contract regression; explicit unreached native-uncertainty cases remain denied without broadening support claims. This prerequisite closes only classification/proof, not P3 unlimited POST acceptance.

## Risks and rollback

High likelihood × High impact: deferred newer config or omitted authority table permits stale POST; mitigate explicit projection inventory and mutations for every table. Medium × High: policy re-default, sidecar upgrade loss or WAL omission; mitigate retained format evidence, atomic upgrade failure controls and real WAL reader. Medium × Medium: hashing cost; measure finite workload without weakening validation. If runtime lacks a trustworthy transaction/read-only boundary, stop that case and report it before claiming support.

Rollback disables injected proof capability while retaining policies/bindings/gaps/markers/ledger. Never clear gap or poison, recreate coverage, or reopen writer to roll back. Schema remains additive. Binary downgrade requires stopped writer and the existing managed recovery procedure; no legacy inference. No unresolved product choice: the user selected this path.
