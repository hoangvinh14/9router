---
title: DB safety candidate blocked on runtime evidence
date: 2026-10-18
summary: "R3 115pass2fail retained; available-runtime safety controls pass, cross-runtime acceptance and P1 gate remain closed"
---

# DB safety candidate blocked on runtime evidence

## What happened
User approved DB-SAFETY-PRICING shared prerequisite after pricing-only persistence investigation failed. Implemented pre-open canonical-parent writer exclusion/private ownership leases, synchronous managed outer durable transactions, native WAL/FULL verification, SQL.js atomic fsync publication/poison and guarded reads/fallback/close/backup. No ledger, schema/ACL, analytics dedup or inference changes.

## Verification and failures
R1 focused24/24; affected86pass2fail/88. R2 combined112pass2fail/114. R3 combined115pass2fail/117 across11files,0pending/todo; all34focused safety controls passed. Same usage-count assertion names remain red:100expected/4actual,50expected/1actual; matching names do not prove same cause. All raw results and frozen-hash receipts retained under plans/261018-0749-db-safety-pricing/reports/. Driver tests intentionally replaced arbitrary-fallback expectations with explicit pre-open policy controls; no blanket no-regression claim.

Direct source review found read methods could bypass SQL.js dirty tracking, trigger guard compatibility, retained-owner release, close-failure poison, then active-transaction close/partial-exec failure tracking; bounded R2/R3 repairs and exact controls added. Advisor consulted before failed-verification diagnosis, not independent full-source review. R3 four changed files lint exit0, unchanged14 reuse R2 exit0 verified by hashes; active LSP R2 clean. Final source hashes/count/identity comparisons/whitespace/plan format pass. No unchanged green retries or timeout tuning.

## Decision / next step
Current available-runtime work concluded, candidate unaccepted WIP. Actual Node24/Linux and SQL.js evidence does not prove Bun, compatible better-sqlite3 or Windows/fsync behavior. No runtime/dependency install, support narrowing, commit/push or activation authorized. P1 remains BLOCKED, pricing API/UI unstarted. Need explicit decision for isolated compatible-runtime setup or handoff to existing suitable CI/environment; do not silently waive missing lanes or analytics failures. Current authority: plans/261018-0749-db-safety-pricing/reports/current-disposition.md. AgentWiki publish skipped.

## Later bounded better-runtime continuation
User separately approved Node22 preflight, then an exact pinned publisher ABI127 download/private-mirror setup and bounded checks. Original binding preflight failed ABI137 vs127; first private preflight failed overbroad module-cache guard; corrected preflight passed. Actual adapter attempt1 then failed because my direct-SQL fixture omitted required createdAt. Counsel and explicit correction approvals preceded each changed-input run; all reds retained, no production schema/default relaxation or timeout expansion.

After the approved fixed-ISO fixture correction, task b6aa50c3f passed12main+2child named scenario controls (not Vitest assertion counts). Actual better factory/driver, ownership/transactions/SQL guards/schema2/ACL/pricing numeric zero and normal-close fresh-process reopen passed. ESM/CJS provenance, all55mirror/source/input hashes and unchanged original ABI137 binding checked after run; no fixture writer locks observed. Exact receipts: plans/261018-0749-db-safety-pricing/reports/abi127-adapter-attempt2/. No new installs/rebuild/root dependency mutation; private publisher binary only. Bun/Windows and independent full-source review remain missing; analytics reds unchanged, P1 still BLOCKED. No additional runtime setup inferred. AgentWiki publish skipped.

## Later Bun R4 continuation
User separately approved Bun1.4.3 pinned private download and bounded verification, then exact strictclose repair after actual lifetime boundary failure. Retained-statement instrumentation showed public close/ownerhandoff while oldnativeSELECT remained executable; no publicescape/concurrentwrite/corruption claimed. Rawdefaultclose/strictclose controls supported a Bun-specific policy, not universal replacement.

R4 sharedwrapper closepolicy normal/initcleanup defaults to existingNode/betterclose; Bunfactory passesclose(true). Three policy unitcontrols added, no schema/ACL/analytics/inference change. Changed3filelintexit0; activeLSP3paths0diag but3inconclusive, notclean. Actual repaired boundary PASS includingallretainedinvalid/repeatedclose/publicrefusal. Three realBunengine controls with explicitJSfaults passedinitcleanup/closefaultpoisonlockretry/persistence/uncertainlockretention. OrdinaryunfaultedBun12main+2child and betterR4regression12main+2child passed with perprocessmoduletraces and frozenhashes. Affected11fileverification remainsFAILED118pass2usagefailures/120assertions;37focusedDBcontrols pass. Allredsretained, no counts merged into syntheticgreen.

Receipts/currentauthority under prerequisite reports/current-disposition.md, bun-r4-lifecycle/, bun-r4-ordinary/, better-r4-regression/ and candidate-r4-*. Available-runtime round concluded; Windows actualfilesystem and independentfullsourcereview stillmissing, twoanalyticsfailuresunresolved, P1closed. Noactivejobs/CI/supportwaiver/activation/commitpush. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
