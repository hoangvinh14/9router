---
title: B1 legacy compatibility stop gate
date: 2026-10-29
summary: Disposable crash tests demonstrate the accepted B1 legacy provenance blocker; runtime implementation paused.
---

# B1 legacy compatibility stop gate

## What happened

Executed the B1 plan's compatibility preflight on branch `test/b1-legacy-provenance-gate`, base `57d82de4`. New disposable Node SQLite and SQL.js SIGKILL fixtures compare no-usage histories with exact usage lost before transaction commit. Both characterization tests pass; compared post-startup accounting evidence is indistinguishable, and an independent known charge survives.

## Decision

Honor B1 rule 8: stop compatibility acceptance and runtime implementation pending a separate user decision. This does not prove actual historical losses. No runtime/schema/activation or real-database changes. Advisor reviewed the approach and evidence limitations. Full Phase 1 and Phase 2 remain incomplete.

## Next steps

Read `plans/reports/implementation-261030-b1-legacy-provenance-gate.md` for scope and verification. Resolve ambiguous legacy policy separately before resuming B1. Do not auto-waive rows or create a recovery product. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
