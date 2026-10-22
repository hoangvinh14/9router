---
title: Prepare accounting foundation execution design
date: 2026-10-22
summary: Prepared P2 architecture choices and source/test manifest; explicit architecture gate remains open.
---

# Prepare accounting foundation execution design

## What happened

The ak-cook auto request targeted plans/261018-0214-accounting-foundation. Its existing phase files explicitly prohibit source edits and product tests until the architecture and complete identity/import/delete boundary are settled. Inspected current develop at 2ca88257, relevant DB/pricing source, legacy selective-reuse files at 3a4955a0, current tests and the immutable accounting contract. Preserved existing dirty plans and unrelated artifacts.

## Result

Added design-preparation.md and linked it from the existing phases. Proposed a provider-independent core with own ACK capabilities, exclusive-lifetime pending recovery and explicit close, and an adapted independent coverage sidecar with complete binding/tombstone/import safety. Recorded pre-PRAGMA validation, required pre-change backup, exact monetary/state/CAS invariants, coordinator bounds, sequential source ownership and current/new test commands. No source edits, DB access, product tests, commits, activation or publication occurred.

Plan format validation and 18 local links passed. Existing test paths in commands were checked against files; planned accounting tests remain explicitly new. Direct review is not independent approval. Existing best-effort backup and shutdown limitations are recorded without claiming accepted fixes.

## Next step

Resolve the three explicit architecture choices in the proposal before crossing the plan's source/test gate. Then implement phases sequentially with actual Node/SQL.js controls. The plan and all phase statuses remain pending. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
