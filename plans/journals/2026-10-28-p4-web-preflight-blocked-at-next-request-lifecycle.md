---
title: P4 web preflight blocked at Next request lifecycle
date: 2026-10-28
summary: 488 baseline tests passed; required browser seam failed source login cookies context; stop before budget implementation.
---

# P4 web preflight blocked at Next request lifecycle

## What happened

Started accepted P4 --auto on `feat/weekly-monthly-budget` from develop b41dca0a.
The isolated affected baseline passed 488/488 tests in 24 files. Added only a
test-side compiled-UI/source-handler feasibility spike. It reuses the actual
custom-server socket wrapper, but manual source login invocation returns500:
`cookies` was called outside a request scope. One observation-only diagnostic
confirmed the error after Advisor review; all failed receipts are preserved in
`plans/reports/verification-261028-p4-web-*.json`.

## Decision

Honor the phase1 STOP/review gate. Do not synthesize more framework state,
inject auth, or implement calendar/API/UI until a faithful real-Next-lifecycle
seam is reviewed and proven. Production remains OFF, no coverage stamp or Git
delivery. Baseline reporter /app/ normalization does not match this checkout.
Legacy CLI key consumers also require authenticated/Origin compatibility review
before named route guards; no CLI-token exemption.

## Next steps

Review the test-only seam; prove actual authenticated browser, private module/DB
lifetime, actual POST and durable ledger on Node/SQL.js before phase1 proceeds.
See `plans/reports/implementation-261028-p4-preflight-blocked.md`. No phase was
marked complete; broader build/security/restart/reset/performance gates remain.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
