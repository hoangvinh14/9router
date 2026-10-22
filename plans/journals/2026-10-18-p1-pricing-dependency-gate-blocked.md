---
title: P1 pricing dependency gate blocked
date: 2026-10-18
summary: Reports-only execution found shared storage prerequisite; no product port
---

# P1 pricing dependency gate blocked

## What happened
Executed the authorized P1 phase-1 reports-only gate on local `feat/reference-pricing-port`, base `87a74e1b`. Read current/legacy pricing, persistence, auth and UI dependencies without restoring old source. Current-adapter disposable probe confirms SQL.js returns before file publication and accepts stale writable images; an unrelated second-image flush reverts a saved price. Actual Node adapter has WAL/NORMAL, not an explicit durable ACK seam.

## Decision
P1 is BLOCKED under the existing topology/authority stop gate. Named proposed prerequisite: DB-SAFETY-PRICING, shared pre-open writer exclusion and durable-publication/healthy-read primitives, without ledger/accounting. No product/test/dependency edits, stash apply, commit, push or activation. Phases 2/3 remain unstarted. Conditional extraction/import/auth/startup manifest is in the plan-owned dependency report; it is not executable approval.

## Verification
Nine report-owned comparator integrity controls passed. Storage probe exited 0 and closed/removed its database files. Four report-owned script LSP probes clean. Compound verification beginning with ESLint timed out at 30 seconds; lint is inconclusive and subsequent compound checks were not assumed run. Standalone tracked product/index diff and whitespace checks passed, plan CLI format valid. The single isolated baseline `bde11d71a` concluded FAILED/exit1: 8 files, 86 assertions, 84 passed, 2 failed, no pending/todo. Both reds are reached usage-count assertions in `db-concurrent.test.js` (3 vs100 and1 vs50); pricing merge concurrency passed. Raw reporter JSON/log plus reconciled file/count/hash receipt retained in plan-owned reports. Source-only triage finds timestamp-based deduplication a plausible explanation, not proven root cause or the pricing stale-image mechanism. No second baseline, polling or product repair.

## Next steps
Phase-1 investigation concluded; dependency gate failed. Obtain operator decision on the named prerequisite before any shared driver/adapter change. See `plans/261018-0213-reference-pricing-port/reports/phase-01-dependency-gate-20261018.md` for authoritative blocked disposition and limitations.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
