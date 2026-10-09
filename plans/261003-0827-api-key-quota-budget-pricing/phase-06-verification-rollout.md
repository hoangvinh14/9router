---
title: "Phase 6: Regression, security và rollout"
status: in-progress
priority: P1
effort: 12h
depends_on: [1, 2, 3, 4, 5]
---

# Phase 6: Regression, security và rollout

> **Technical reference, không phải backlog song song.** [Roadmap Gói A–E](./plan.md#current-delivery-roadmap) là execution authority: mỗi gói đóng với relevant verification/security; D sở hữu adapter/restore procedure, E sở hữu full regression/security/13AC/runbook acceptance. Historical running statements không live jobs; focused green không release approval. Không production activation/commit/push/publish tự động.

<!-- Updated: Validation Session 1 - collection-error baseline gate, scoped test completeness, restore/gap/security rollout -->

## Outcome

Đủ evidence nghiệm thu 13 acceptance criteria của brainstorm, runbook recovery/rollout và không có regression ngoài baseline được giải thích. Không tuyên bố hard cap hoặc exact upstream bill.

## Approved I/O/cache acceptance addition — D/E

[Finite matrix](./reports/io-group-commit-cache-design.md): group ACK/crash/replay on actual supported adapters, one SQL.js persist/group, queue boundedness/low-load latency/policy-reset-authority races, exact cache read/write and local hit/miss/revalidation POST/debit controls. Matched group-vs-per-operation benchmarks include commit/persist counts, throughput, p50/p95/p99, event-loop delay/memory/queue on low/burst/sustained load and ledger sizes; declare workload/targets trước run. Không fixed fsync-count/gain claim, no deadlines/PRAGMA/SSRF weakening. No performance evidence yet; preserve older scoped receipts and only rerun affected gates after implementation, not docs update.

## Current delivery state và verification cadence

Comparator negative-fixture preparation, selected regression, builds, runtime/UI checkpoints và runbook draft đã có evidence; **whole-feature acceptance/rollout chưa xong**. Historical505/53/1,414inputbuildpassed, later775/2exact74/1,449inputmilestone remainsred comparatorREGRESSION despite same-sourcebuildpass. New `bc7e8c20a` exact79 **850pass/2fail,0pending/todo**, onlysame2autoswitch, comparator1/no waiver; lint0/stability0/whitespace0. SameinputdiagnosticbuildPASS build/stability/artifact/whitespace0, 1,465inputs unchangedsweep+build, Next153pages artifact1791154945. Currentbuildpassed; integratedtestgateremainsred. [Acceptance closure matrix](./reports/acceptance-closure-matrix.md) nowmapsall13AC to scopedobservedevidence+remaininggates; userrenewedcompleteplan request changesexecutioncommitment notscope/guards. Globalroutes/UIcontracts andmaintenanceACK/crash/Node-restore prerequisite gates greenonlytheirscopes. `b04b30a3e` actualrawHTTPglobalfixture+interceptedrenderedUI nowRUNNING onfreshsameartifact; noresultyet inputsheldthroughruntime. No productionactivation/publish.

Mỗi patch vẫn cần focused tests + changed-file lint. Broad sweep/build ở integrated milestone, shared lifecycle/startup boundary hoặc impact-based regression; không lặp sau từng helper độc lập. Comparator focused repair/negative fixtures **đã completed** như checked item/TODO comparator; prerequisite này vẫn phải giữ trước no-regression claim, không làm lại hoặc suy full-suite certification. Full-suite classification và assertion-level limitations còn ở rollout; không waive collection/cloud/static provider/adapter gaps bằng selected green hoặc mở rộng known-fails. Remaining full matrix/AC/security/restore/runtime/runbook gates giữ nguyên bên dưới. Theo [current roadmap](./plan.md#current-delivery-roadmap), ưu tiên khép kín implementation rồi integrated acceptance; không production activation/publish tự động.

## File ownership

Paths expand từ `/home/gmo/projects/9router/`.

| Action | Path | Change |
|---|---|---|
| Create | `docs/API_KEY_BUDGETS.md` | Usage/limits/scope/TZ/pricing/recovery/topology/rollout guide. |
| Modify | `docs/ARCHITECTURE.md` | Chỉ cập nhật persistence/flow liên quan ledger, không broad docs rewrite. |
| Modify | `CHANGELOG.md` | Feature behavior và compatibility/security notes. |
| Modify if new env used | `.env.example` | Strict config contract, no secret values; no mutable timezone introduced. |
| Modify | `tests/__baseline__/verify-no-regression.mjs` | Confirmed defect: suite-level collection failure with zero assertions exits 0. Reject unclassified failed suites/collection/runtime errors/malformed reports; normalize portable paths và verify intended scope was collected. |
| Create (implemented name) | `tests/unit/baseline-no-regression.test.js` | `/app/` + local paths + Windows fixture; new assertion failure, zero-assertion failed suite, malformed/truncated/empty report must fail; legitimate known-red suites explicitly classified. |
| Create | `tests/fixtures/budget/` | Sanitized failed/abort/retry/native format usage fixtures. |

## Checklist

- [ ] Run all phase focused tests + changed-file lint; collect fixture inventory and acceptance matrix. Những tests mới luôn phải green ngay cả full suite known-red.
- [ ] On temp DATA_DIR: budget+ledger migrate from v1, exact attribution backfill, unmatched history, deleted key, restart trước/sau reset; kill-before/after-dispatch, durable acknowledgement, log deletion, backup/restore recovery, pricing sync offline.
- [ ] Adapter matrix: Bun sqlite, better-sqlite3, Node sqlite, sql.js. Explicit driver assertion; CI/runtime gaps documented and closed before release claims. SQL.js second writer fails safely; tests không đọc/sửa production DB.
- [ ] Verify dispatch inventory from phase 04 covers all billable supported seams, terminal local refusal zero cooldown, failed usage charged when known, unknown usage never zero; repeated callback/late admin resolution idempotent.
- [ ] Run UI + native error contract tests including stream already-started failures, double exhausted-window Retry-After, CORS/header behavior. No extra live provider calls without credentials/authorization.
- [ ] Audit security: auth/CSRF/key isolation, raw-secret leakage in JSON object keys/values/errors/logs, catalog SSRF/redirect/payload/prototype protection, privileged immutable recovery audit, peer-header handling untouched.
- [ ] Confirm phase 01 pre-edit suite/report baseline exists; capture after-change results. Comparator repair + all negative fixtures **prerequisite before trusting ANY regression/no-regression result**, not merely eventual release cleanup. Capture pre-change full-suite/report baseline before implementation and after-change results; compare exact suite+assertion failure identities. Fix confirmed comparator false-green for collection failure (synthetic probe recorded in validation report), portable paths, report schema/status/counter consistency và intended test scope completeness. Do not require static assertion total that rejects legitimate new tests; ensure selected files collected, explicit skips/not-run reasons và report from current run. Failed suite with no assertions/runner import error không disappear; known cloud/live/xAI collection failures need narrow evidence-backed suite classification, không broad expected-red/known-fails expansion.
- [x] Focused comparator preparation fixtures: new assertion failure, zero-assertion failed collection, interrupted/reported runtime error, malformed/truncated/empty report, skipped/not-collected/extra/duplicate intended file và valid known-red report; current6/0onefile+lint/whitespaceclean `b3ec24a7b`. Portable Linux/Windows/legacy boundary, counters/statuses and missingbaseline CLI failclosed. [Evidence](./reports/comparator-evidence.md). This certifies supported fixture/report integrity only, not full regression, all intended assertions, every runtime error channel or wholePhase06. Broad31file run pending; baseline missingcloud remains incompleteexit2. Baseline path normalization alone không đủ.
- [ ] Write runbook: backup DATA_DIR + coverage sidecar, pre-open writer exclusion, migrate + health check, catalog coverage/overrides, enable test key, exact/unknown + durable gap reconciliation demo, restart/log-clear, enable production limits. Managed restore sets maintenance latch before file replacement, budgeted blocked until audited reconciliation; out-of-band DB/sidecar rollback not automatically detectable in v1. Config import giữ accounting + rejects identity rebinding. Preserve current sidecar generation/tombstones/fingerprint key across physical restore; missing/corrupt/mismatched artifacts stay maintenance-blocked, old snapshot không reactivate retired key. Validate freeze -> DB audit ack -> sidecar CAS ack crash points; gap ack không clear maintenance. Downgrade binary management/export only, không inference; nếu operator dùng old inference thì reconcile coverage gap trước re-enable. No refunds by deletion.
- [ ] Update docs/changelog; trace all 13 brainstorm AC to evidence. Ask Advisor completion review with actual evidence; resolve blockers before mark phase done.

## Verification commands

From `/home/gmo/projects/9router`, dependencies installed per root instructions, long commands use background tool:

```bash
# Focused new tests must be 0-fail before considering known-red suite.
(cd tests && npx vitest run unit/api-key-*.test.js unit/pricing-catalog-sync.test.js unit/baseline-no-regression.test.js)
# Save outside committed baseline file; never overwrite known-fails/current.json.
(cd tests && npx vitest run --reporter=json --outputFile=/tmp/9router-budget-results.json)
# Before launch capture exact selected file inventory as {"files":["tests/..."]}.
# Do not generate scope from output: that would hide missing collection.
node tests/__baseline__/verify-no-regression.mjs /tmp/9router-budget-results.json /tmp/9router-budget-scope.json
node tests/__baseline__/verify-providers.mjs
node tests/__baseline__/verify-alias.mjs
node tests/__baseline__/verify-oauth-urls.mjs
npx eslint .
npm run build
```

Literal shell glob for new tests phải kiểm tra nó expand đúng sau implementation; absent files không là passing coverage. Inspect baseline scripts before run; verify artifacts belong to current commit/change, not stale JSON. Build requires environment per repo; use no real credentials in fixtures/report.

## Acceptance mapping (brainstorm numbering)

| AC | Evidence owner |
|---|---|
| 1 identity isolation | Phase 01/03 ID tests + redacted stats output. |
| 2 simultaneous weekly/monthly | Phase 03 gate matrix + phase 05 UI. |
| 3 calendar/timezone/restart | Phase 03 clock tests + phase 01/06 restart tests. |
| 4 unlimited/no-key compatibility | Phase 04 mocks + phase 05 warnings/docs. |
| 5 all chat/embedding/fusion/fallback modes | Phase 04 dispatch inventory/format fixture matrix. |
| 6 idempotency/cache/reasoning | Phase 02 money + phase 03 state + phase 04 callback tests. |
| 7 concurrency/overshoot | Phase 03 simultaneous admissions + judge recheck tests. |
| 8 abort/unknown/storage | Phase 01 crash/disk + phase 03 recovery + phase 04 abort/error. |
| 9 sync/snapshot/mapping | Phase 02 fixtures + phase 05 sync UI. |
| 10 migration/retention/adapters | Phase 01/06 isolated adapter/subprocess evidence. |
| 11 auth/no leaks/no cooldown | Phase 04 cooldown spy + phase 05 auth/redaction + security audit. |
| 12 dashboard completeness | Phase 05 desktop/mobile UI captures + assertions. |
| 13 tests/lint/regression | Current JSON results + trustworthy baseline comparison + build. |

## Pass/fail và residual risks

Done chỉ khi evidence đầy đủ, không chỉ plan checkboxes. Existing known failures classified per baseline; unknown failures investigated, no blanket expected-red. Record latency overhead of durable intent/settlement (small DB transactions, not serialized requests) và indexed window query under realistic ledger size. No new per-request catalog fetch.

Accepted limits remain: in-flight spend overshoot; catalog virtual/stale; strict unknown usage blocks key until recovery; crash ambiguity remains unresolved, not magically exact. Unlimited availability during recording failure requires durable gap latch (failed latch denies identified dispatch); gaps block budget activation until audited reconciliation. Single writer excludes all non-owner writes, no-key không exemption cho DB ownership. Physical rollback guarantee is managed procedure only, không automatic anti-rollback detection. Fusion quorum/grace stays; live stragglers tracked through late terminal sink và single-answer regeneration is another attempt. Missing-price/unsupported providers need explicit mapping/override/exact usage support. No image/audio/video/search/fetch enforcement.

If any security, durability, accounting or ownership test fails: stop release, capture exact result, fix within contract or obtain scoped user decision. Do not loosen fail-closed, change timezone, add reservation or reprice history silently.
