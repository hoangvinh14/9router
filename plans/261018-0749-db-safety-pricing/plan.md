---
title: "DB-SAFETY-PRICING — ownership và durable publication"
description: "Prerequisite dùng chung để P1 pricing có durable ACK/healthy reads, không ledger."
status: completed
priority: P1
tags: [database, durability, security, pricing]
created: 2026-10-18
---

# DB-SAFETY-PRICING

## Authorization / contract
User approved **design + implementation** after the P1 dependency gate failed. Work remains on local `feat/reference-pricing-port`, base `87a74e1b`. No commit/push/activation or dependency/runtime installation. P1 resumes only after this prerequisite's gate passes.

Outcome: single writable process per DATA_DIR acquired before adapter open/migration/timers; synchronous outermost durable transaction ACK, guarded healthy reads and committed memo eligibility; SQL.js atomic publication and poison-on-uncertainty, native verified WAL/FULL. Preserve Node/better/Bun/SQL.js selection/support and upstream ACL/schema2. Ordinary analytics writes need not fsync individually.

Non-goals: ledger/coverage/key bindings/accounting/recovery UI/inference hooks, multi-writer/cluster SQL.js, automatic ambiguous-lock recovery, physical restore redesign, power-loss certification or production activation. Analytics dedup was initially excluded; user later explicitly authorized a narrow identity/idempotency repair after diagnosis (see current extension below). Historical analytics failures stay recorded, not waived as a passing run.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Design, implement and verify bounded primitives](./phase-01-start.md) | Complete — explicit conditional Linux development acceptance |

## Gate / references
- [P1 failed gate](../261018-0213-reference-pricing-port/reports/phase-01-dependency-gate-20261018.md).
- [P1 plan](../261018-0213-reference-pricing-port/plan.md).
- Exact implementation manifest, topology/security decisions and executable verification are phase-owned. Expand before edits, not after failure.
- Unavailable runtimes remain unverified; no adapter dropped and no emulated lane described as real. Runtime unavailable may block final all-adapter acceptance; cannot silently claim P1 release.

## Execution checkpoint
- R1 focused24/24; affected86pass2fail/88; R2 combined112pass2fail/114 across11files. Same2usage-count failure identities retained, no analytics repair; counts vary and cause not certified. ESLint R1/R2 each18files exit0. R2actual Node/SQL.js focused controls passed, not Bun/better/Windows acceptance.
- [R2 review and runtime gate](./reports/candidate-r2-review.md) records final-source findings and bounded R3 close-depth/partial-exec dirty repairs. R3 terminal FAILED:115pass2fail/117 assertions,11files,0pending/todo; all34focusedcontrols pass, same2baselinefailureidentities retained. Changed4filelint exit0 and unchanged14R2lint reused only after hashes verified. [Current disposition and missing-runtime gate](./reports/current-disposition.md) owns final status: current available-runtime work concluded, prerequisite acceptance BLOCKED/unaccepted WIP; no active run.
- User selected read-only isolated-runtime planning. [Runtime proposal](./reports/isolated-runtime-proposal.md) completed: existing Node22.23.2 found but not executed; Bun exact artifact unselected/no install; Windows actual fsync/ownership gate required. User approved that bounded execution; [Node22 preflight](./reports/node22-preflight-disposition.md) then FAILED exit1: installed binding ABI137 requires different runtime than actualNode22 ABI127. No DB open, harness NOTRUN; stop boundary honored, no rebuild/install/fallback. User then approved continuing that planning; [ABI127 private-binding proposal](./reports/binding-abi127-setup-proposal.md) completed with official asset448381028/SHA256 pin, private mirror/module-resolution/extraction boundaries. User approved setup+isolated verification: pinned download/extraction passed, private55filemirror prepared; [ABI127 attempt1](./reports/abi127-attempt1-disposition.md) then FAILED exit1 at blanket require.cache mirror assertion. Exact preload outside mirror is source-only likely harness conflict, actual offending entry not recorded. User approved exact harness correction; R2preflight b05fa72cc PASS with open/query/provenance/close all true. Subsequent [actual adapter attempt1](./reports/abi127-adapter-attempt1/disposition.md) FAILED:9mainpass1fail2unreached,contender1pass,reopenNOTRUN; direct ACL fixture INSERT omits required createdAt. Stop/counsel honored; all original/mirror/input hashes unchanged. User approved exact fixture-only correction+fresh run; [actual adapter attempt2](./reports/abi127-adapter-attempt2/disposition.md) b6aa50c3f PASS exit0:12main+2child named controls,0failed/unreached/skipped. Actual better factory/driver/ACL/pricing/reopen/provenance verified in byte-identical mirror/private ABI127; posthashes match/no fixture writerlocks observed. Prior reds retained, no combined pass fabrication. This bounded better lane is complete, not all-adapter acceptance. No approved support reduction or further runtime installation. All-adapter evidence remains unavailable; **P1 gate closed**, no pricing implementation resumed.

## Bun planning checkpoint
User agreed to continue with planning only. [Bun proposal](./reports/bun-isolated-verification-proposal.md) pins stable1.4.3/Linuxx64baseline asset626789490,42015103bytes/SHA256 verified against publisher metadata+checksum text; no Bun binary download/execution. Host SSE4.2/noAVX2 observed. Pinned docs expose possible Bun deferred `close()` vs owner-release contract mismatch; source-backed risk, not actual reproduced defect. User later approved pinned private setup+boundedtests: setup PASS, rawpreflight4PASS, [actual factory close boundary](./reports/bun-close-attempt1/disposition.md) FAILED exit1: after adapterclose and newprocessowneracquisition retained oldnativeSELECT still runs under instrumentation. This establishes tested deterministicclose mismatch, not publicescape/corruption. Stop+counsel honored, originals/mirror/harness/binaryhashes match; repeatedclose/initcleanup/closefailure and ordinary Bun suite NOTRUN. User approved bounded strictclose repair; R4 nativewrapper close-policy + Bun close(true) implemented normal/initcleanup, Node/better default unchanged. [Final R4 disposition](./reports/current-disposition.md): Bun strictclose/repeated boundary PASS,3actualengineJSfaultcontrols PASS,ordinaryBun14PASS; betterR4regression14PASS. CombinedNode/SQLjs11files R4 FAILED118pass2usagefailures/120assertions,37focusedDBcontrolsPASS. All R4source/mirror/runtimehashes/provenance receipts captured. Lintchanged3exit0; activeLSP3inconclusive/0diag notclean. Current runtime work concluded/no activejobs; Windows/independentreview/analytics/P1gates unchanged.

## Completion continuation — 2026-10-19
User requested completion and selected a [Linux-first acceptance proposal](./reports/linux-first-acceptance-proposal.md), one independent read-only DB review, and diagnosis-only investigation of the two analytics failures. No Windows waiver or analytics production repair approved. Independent [R4 review](./reports/independent-review-r4/review.md) returned changes requested: dangling DB symlink validation gap, unretryable release after successful engine close, and SQL.js flush-only signal handling. Findings are static; independent coverage is explicitly incomplete (tests/consumers/receipts not fully read), so the full-review gate remains open. Counsel taken before diagnosis. Fresh isolated usage and lifecycle diagnosis probes started against frozen R4 source; no production changes or P1 gate reopening. Existing runtime passes and overall 118/120 FAILED result remain historical input-bound evidence, not coverage of these newly identified paths.

## Approved staged scope and bounded extensions — current
User explicitly approved conditional **Linux-development/testing-only acceptance** after remaining DB/review gates pass; Windows remains unverified and a release gate, with no adapter/support removed, all-platform DONE or production activation. [Staged contract](./reports/linux-first-acceptance-proposal.md) owns the boundary. P1 has not opened merely from this approval.

Corrected usage probe b846b70d3 passed4cases on each actualNode/SQL.js lane; [diagnosis](./reports/usage-diagnosis-attempt2/disposition.md) supports timestamp/token dedup collision, not lost updates in those fixtures. User now authorizes narrow dedup repair after caller/test identity inspection, preserving legitimate explicit idempotency and original regression assertions; no inference hooks/accounting or caller-wide redesign inferred. User also approved design+limited coordinated shutdown per [shutdown contract](./reports/shutdown-contract-proposal.md), manifest before edits, application-owned termination, fail-closed persistence/ownership and child/listener-order tests, no activation. One further independent read-only review authorized for coherent new source/tests/consumers/receipts, no shell/writes/network.

R5 bounded DB path/release repairs implemented in3source+4test files; [R5manifest](./reports/candidate-r5-source.json). Unconditional DB lstat with onlyENOENT absence rejects dangling symlink; separate closed/released state permits release-only retry while SQL.js uncertain close-publication still refuses release. Invalid metadata parse errors normalized failclosed. Focused ba73888fc and lint b9d56c5d7 running against frozenR5; no shutdown/dedup source edits yet. R4 runtime passes are not certification of R5. Full review/release/platform and analytics gates remain explicit until new evidence.

## Latest user scope correction — Docker build and function, no shutdown flow
User explicitly stated they do not need a shutdown flow; they will stop/replace Docker themselves. This supersedes earlier conditional shutdown design/repair authorization for delivery: **no shutdown/entrypoint redesign, no graceful-stop certification**, no more production-vs-dev decision needed. The observed SQL.js signal/competing-handler limitation remains documented unresolved, not marked fixed. It is outside the requested acceptance flow, not silently erased or called data-loss-safe. Existing healthy close/transaction/release tests remain ordinary DB lifecycle verification, not a new signal coordinator.

Delivery target: complete in-scope pricing functionality and checks, build a separately tagged local Docker image and test with disposable data/correct runtime. Do not stop or replace the existing latest0.5.104 container, attach its live volume, alter port bindings, or run compose up/down against it. User owns later replacement. Windows remains an unverified release limitation; approved Linux development boundary remains. No new host runtime/dependency installation inferred from Docker intent.

Final in-scope R6source frozen:12fileaffected bf28d83a5, actualbetter b7b9cc9f6 and Bun b6e125ce8 freshmirrors (14main+2child controls each), and authorized independentreview d31b5177ba2b0a57633bbc25f9df075f2 running. No polling/source mutation. Review explicitly includes remaining tests/consumers/receipts and excludes demanding new shutdown implementation. Newruntimecontrols cover danglingpath/release-retry; priorR4passes not reused as final proof. Plans/source remain WIP until these gates reconcile.

## Current R7 checkpoint — explicit conditional Linux acceptance
[R7 disposition](./reports/current-disposition.md) supersedes historical pending statements above. R7full13files149/149 and focused5files60/60PASS (overlapping, not summed), lint2exit0/LSP2clean; actualbetterNode22ABI127 and Bun1.4.3 each16main+2child namedscenariosPASS. Frozen source/mirror/harness/runtime/module-provenance hashes verified; no fixture ownership files. All launched jobs finished; no active reviewer.

Third authorized missingcoverage review again stopped incomplete:3fulltestfiles+partSQLjs read, no new production defect, low native testtitle overclaim. Usage/callers/consumer/receipts/R7ordering remain independently unread. Executor followup is labelled direct review, not independent gate completion. User explicitly chose [conditionalLinuxacceptance](./reports/r7-conditional-linux-acceptance.md) of this disclosed gap, allowing P1recheck and pricingdevelopment. This is a policyreconciliation, not full independentapproval. No automatic additional delegation. Low caught-innerRELEASE coverage gap documented; no test/source drift or unproven product repair. No shutdown work, liveDocker change, new install, commit/push or activation. Windows remains unverified; DockerAlpine/musl build/function verification not yet done.

## Failure protocol
Before diagnostics state hypothesis/observation/bound/decision. Failed verification → counsel before rediagnosis/repair; retain reds. No identical green reruns, deadline tuning or assertion weakening. Repair change-induced regressions within this scope; stop for a new product/support decision.

## Acceptance
- [x] Available-engine lifecycle/durability/health/rollback/close/reopen/fallback evidence accepted under conditionalLinux boundary; notWindows/powerloss proof.
- [x] Affected tests and executor consumerreview recorded, historicalreds preserved; userexplicitlyaccepts incompleteindependentcoverage fordevelopment. No ledger/schema/identity activation.
- [x] Scope/security/lint/diagnostics and runtime limitations recorded; P1recheck permitted, no fullrelease/productionacceptance.

<!-- slug: db-safety-pricing -->
