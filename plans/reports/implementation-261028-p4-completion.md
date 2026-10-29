# P4 — scoped implementation completion

## Outcome and boundary

Weekly/monthly API-key budgets, guarded policy/projection API, Endpoint editor and supported CLI management flow are implemented and verified within the accepted P4 scope. **Production accounting/enforcement remains OFF.** No public activation switch or activation timestamp was introduced. No commit, push, merge, deployment or production mutation was performed.

Branch `feat/weekly-monthly-budget`, base `b41dca0a791bd464070e4d65c667381613ed5c8d`. Final artifact `.next-budget-freshness/standalone`, build **`PAbPyLpr4xQerMRevrlP5`**; source/artifact evidence in [build receipt](./verification-261028-p4-freshness-build.json).

## Delivered behavior

- Exact decimal-string/null inputs and nanoUSD/BigInt ledger aggregation. Null is unlimited; zero blocks until policy changes. Atomic durable CAS, no-op preserves version, missing policy never silently initialized.
- Fixed Asia/Ho_Chi_Minh Monday/week and day1/month windows, immutable attempt `startedAt`, previous-window projection and late settlement attribution. No cron reset or monetary counter tables.
- Soft recorded-spend thresholds, not reservations/hard invoice caps: concurrent admitted attempts can overshoot without a one-request bound. All-lifetime unresolved exposure blocks finite admission across resets and restarts; null/null does not erase history.
- Existing own intent/terminal ACK and fresh pre-POST authority remain mandatory. Policy/finite-calendar drift refuses stale dispatch. Local native errors preserve safe metadata/no-store/requestId/CORS; selected SSE ACK failures cannot synthesize successful finish/DONE.
- Auth-first key CRUD/budget routes, mutation Origin/CSRF and trusted peer/authority checks, narrow no-store on proxy-generated key denials. Production finite PUT409 `accounting_not_ready`; no request/header/body/environment/setting can obtain private fixture readiness.
- Per-key editor keeps exact dirty drafts and original CAS base, explicit conflict/lost-response reconciliation, separate ACL/toggle state, unknown allowance/health after failed reads, keyboard/mobile support. Editing/local reload cannot make a cached projection current. No reset-spend/waive/recovery action is exposed.
- CLI key management uses explicit dashboard login with memory-only exact-origin cookie and refuses redirects/cross-origin targets; no inference-token exemption. Background reads never prompt or disguise authentication failure as an empty key list.

## Verification

Counts below are separate overlapping invocations and **must not be summed**.

| Gate | Result / receipt |
|---|---|
| Final affected accounting/chat/budget/security/CLI/pricing controls | **726/726, 45 files, zero skipped**, [JSON](./verification-261028-p4-final-affected.json) |
| Actual compiled UI → real Next route lifecycle → guarded API → actual selected chat/core/transport → dummy POST → durable ledger → UI → refusal | **19/19 checks on each Node SQLite/SQL.js adapter**, [Node](./verification-261028-p4-final-browser-node.json), [SQL.js](./verification-261028-p4-final-browser-sqljs.json) |
| Actual detached production package/custom-server/middleware/JWT/key CRUD/finite409/Origin/no-store/assets/WASM/hydrated inactive UI/native DB reopen | **8/8**, [receipt](./verification-261028-p4-freshness-standalone.json); no browser/first-party asset errors; no ledger rows or activation stamp |
| Same-DB independent-process restart/crash | **4/4**, [receipt](./verification-261028-p4-process-crash-budget.json): identity/policy/sidecar retained, dead-owner pending→unresolved, reset/unlimited do not clear exposure, audited fixture waiver permits successor |
| Final matched CI non-live regression | Exact base **4734 pass / 51 fail / 31 pending**, current **4942 / 51 / 31**. All201 assertions in20 new files pass without skips. One current-only failure reproduced on ordered exact base; **no newly unexplained failure observed**, not CI-clean. [Comparison](./verification-261028-p4-final-full-comparison.json), [ordered controls](./verification-261028-p4-ordered-regression.json) |
| Performance | Initial1920 requests and interleaved480 diagnostic requests passed accounting invariants. Initial large slowdowns not consistently reproduced. Diagnostic summed elapsed+6.26%; finite cells roughly+7–11%. [Review and raw evidence](./verification-261028-p4-performance-review.md) |
| Static checks | Owned changed source/runners ESLint passed; `git diff --check` and local documentation links passed. Active handoff Markdown probe passed. Existing Endpoint5 errors/2 warnings remain exact-base debt. Some LSP probes timed out: inconclusive, not clean. |

Final browser assertions include weekly/monthly/both/zero, JSON/SSE, two-key isolation, actual concurrent pending/overshoot, missing-usage null unresolved/refusal across reset, dirty ACL/save interleaving, stale CAS, actual committed PUT with lost browser reply, held PUT/reopen, loading/injected GET503→edit→still unknown→real retry, keyboard order, late key-A response after actual unmount without key-B mutation, and actual CLI CRUD. The injected GET503 is labelled display fault testing; money/spend acceptance is never seeded or mocked.

Hybrid source-route/browser proof is **not** full standalone/middleware equivalence. The detached smoke is separate. Screenshots were visually inspected for mobile width/focus, exact overshoot and unresolved warnings. Historical failed seams, selectors, proxy-cache and stale-display receipts remain preserved in [phase2 history](./implementation-261028-p4-phase2-progress.md).

## Performance disposition

The accepted plan set no new fixed performance budget but required material-regression review. We stopped for review after the initial signal, retained all raw results and ran identical instrumented A–B–B–A diagnostics with no concurrent task-owned build/test/browser activity. Added policy/cost reads are real and documented. The repeat supports retaining ledger-derived gates for this fixture-only, production-OFF slice; it does **not** establish an upper bound, statistical equivalence, steady-state capacity, production SLO or activation approval. Baseline finite policy is configured but unenforced, so finite comparisons include new functionality. No cache/counter architecture, relaxed deadline, weaker guard or serialized network workaround was introduced. Unassociated production chat requests return before accounting session/service/gate creation.

## Security and remaining limitations

- Selected `openai-chat-explicit-details` only, Linux Node SQLite/SQL.js. Broader provider/protocol/fusion and Bun/better/Windows acceptance remain open owners.
- **P5 recovery/restore, X1–X6 and whole-product R remain open.** No whole-product AC2/3/12 or all-protocol claim. Private fixtures do not certify public readiness.
- Five pre-existing Endpoint hook lint errors and two warnings reproduce on exact base. They are documented/session-deferred, not fixed or suppressed in source. No whole-file clean-lint claim.
- Full suite remains red, including missing dependency/import suites and unstable existing tests. No known-fails or golden expectations were changed to obtain a pass. Automatic snapshot additions were identical on base/current, preserved separately and restored; final CI snapshot bytes stayed unchanged.
- Build logs retain existing lazyRuntime tracing and worker writer-exclusion diagnostics; actual detached runtime proof passed independently. Generated `.next-*`, `.pi/`, `.unipi/` artifacts are not deliverables and were not staged or deleted.
- Advisor final requests received summary/filename payloads rather than source bodies; **no independent full-source audit is claimed**. Parent inspected source, tests and receipts; advisory conclusions do not replace execution.
- CLI `connect --password` preserves its existing argv/history exposure trade-off. Prefer interactive password prompt; never persist passwords/cookies or forward them across origins.

## Handoff

- [Acceptance trace](./verification-261028-p4-acceptance-trace.md)
- [P5 constraints and handoff](./handoff-261028-p4-budget-to-p5.md)
- [Current accounting contract](../../docs/ACCOUNTING.md)
- [Local journal](../journals/2026-10-28-p4-guarded-budget-ui-verified-and-performance-reviewed.md) — AgentWiki publish skipped.

P4 scope is complete subject to these explicit boundaries; production activation and Git publication require separate authorization.
