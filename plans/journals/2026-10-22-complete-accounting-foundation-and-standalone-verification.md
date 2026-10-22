---
title: Complete accounting foundation and standalone verification
date: 2026-10-22
summary: "Delivered inactive durable accounting core; 311 related tests, lint, build and detached SQL.js/server checks passed."
---

# Complete accounting foundation and standalone verification

## Outcome

Implemented the accepted accounting foundation on `feat/accounting-foundation`, based on `2ca88257`: schema/migration, retained HMAC identities and sidecar coverage, safe configuration import/backup/delete, exact per-attempt ledger/CAS/audit, private own-ACK service, bounded coordinator and exclusive-lifetime recovery/close. No commit, push, deployment or live-data operation was performed.

Final evidence: 311 unique focused/affected tests across 22 files passed; lint over 33 JS/MJS files had zero errors/warnings. Production build/postbuild passed from a verified source mirror with read-only mounted installed dependencies. Detached standalone SQL.js initialization/query/export/reopen and HTTP 307 smoke passed; its localhost process was terminated and reaped.

## Failures and repairs

Source review repaired missing-binding rebinding, incomplete native backup definitions, incomplete schema readiness, exact evidence gaps and private registry bounds. Missing marker/bindings cannot regenerate identity while accounting history remains.

Cold import fixture setup exceeded the test-body deadline. Timing isolated 4.36 seconds of import plus 1.03 seconds of initialization; engine-scoped beforeEach now separates setup from unchanged behavioral assertions/default deadlines. No shared cached API or timeout increase was used.

Initial build hit restricted font DNS and an absent declared AWS SDK. The SDK was installed with an isolated dependency closure; project manifests were preserved. The existing lockfile still lacks that optional entry, so clean locked installation is not certified. An overly slow build and dependency copy were stopped only by their verified owned PIDs; host I/O pressure and generated-output scan hypotheses are documented without claiming a proven cause.

A successful build first omitted the required SQL.js WASM asset. Actual detached initialization proved the defect; explicit Next tracing now includes it. The rebuilt artifact passed actual initialization and a detached localhost smoke. Build-worker writer contention and the existing module-type warning remain visible in logs.

## Boundaries and handoff

Accounting, budgets/enforcement and public activation remain OFF. No ledgerStartedAt or historical debit. P3 owns actual dispatch/successor/late-sink integration; P4 policy/windows/UI; P5/R management/restore, independent full-source review and Bun/better/Windows accounting parity. Process crashes are not power-loss certification, and scoped close tests are not full Next graceful shutdown.

See [execution receipt](../reports/implementation-261022-accounting-foundation.md) and [completed plan](../261018-0214-accounting-foundation/plan.md). Original user servers and pricing artifacts were preserved. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
