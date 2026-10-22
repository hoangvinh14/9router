---
title: Split API key budget delivery on updated master
date: 2026-10-18
summary: "Docs-only roadmap and bounded child plans; next slice reference pricing, no implementation or activation."
---

# Split API key budget delivery on updated master

## What happened
Pulled master is v0.5.104 at 87a74e1b. Old feature 3a4955a0 and WIP stash d515fb49 remain untouched. Created a roadmap and bounded plans rather than continuing the old monolithic B backlog. Only the next pricing port has detailed phases.

## Decisions and evidence
Preserved the original design contract and latest old checkpoint byte-for-byte as references. Mapped all 13 AC and old obligations to new owners. Current upstream key ACL/schema/routing must survive selective port. Old pricing has accounting/adapter dependencies, so phase 1 must resolve a minimal manifest before source edits. Fixed a draft baseline command that named an old-only test. CLI format validation passed for all 13 plan folders; this is not product evidence.

## Next
On a separate implementation request, start P1 dependency/baseline check on a feature branch. Do not apply the stash to master, continue old matrix diagnostics automatically, or activate production. No source/test changes, product test/build, DB operation, commit or push in this planning session. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
