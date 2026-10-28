---
title: Clarify P4 weekly monthly budget solution
date: 2026-10-28
summary: "Ground P4 in current P3 ledger and authority; document fixture-only enforcement, management UI and acceptance phases."
---

# Clarify P4 weekly monthly budget solution

## What happened
Reviewed the weekly/monthly budget outline against current policy schema, ledger, accounting service, persisted chat authority, management guard, endpoint UI and P3 completion evidence. No feature code changed.

## Decision
Use ledger-derived calendar spend thresholds, atomic intent admission and a synchronous final dispatch check; no counters, reset cron, reservations or hard-cap claim. Preserve immutable startedAt and terminal sinks. Finite-window rollover before POST refuses the intent; unknown historical exposure survives reset/restart. Keep production activation OFF and prove test-web harness feasibility first. Guard key CRUD as an explicit UI-composition prerequisite rather than postponing it to P5.

## Changes and verification
Expanded plans/261018-0213-weekly-monthly-budget with solution-design.md and three sequential phases; reconciled roadmap P3/P4 status. Two Advisor reviews informed clarifications. Local Markdown links checked with zero broken links; git diff --check passed. Runtime tests/build/browser were not run; proposed commands are not acceptance evidence. Existing untracked build artifacts were not modified or staged.

## Next steps
Implementation requires a separate user request, starting with the isolated harness stop gate. No commit, push, merge, deployment or production activation was authorized by this planning update.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
