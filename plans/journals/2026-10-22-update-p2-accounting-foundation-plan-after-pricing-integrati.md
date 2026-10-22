---
title: Update P2 accounting foundation plan after pricing integration
date: 2026-10-22
summary: "Record post-P1 baseline, three sequential pending phases and unresolved design gates; no implementation."
---

# Update P2 accounting foundation plan after pricing integration

## What happened

Updated the existing [P2 accounting foundation plan](../261018-0214-accounting-foundation/plan.md) after the source-backed brainstorm. P1 is integrated into develop at `2ca88257`. P2 now has three sequential pending phases for identity and schema safety, exact ledger service, and coordinator lifecycle acceptance.

## Decision

Reuse current DB safety and pricing primitives while preserving conditional acceptance limits. Record owner and restart incompatibilities, retained key identity and import safety, exact settlement and provider dependency boundaries. Keep P2 non-executable until design gates and exact file, test and command manifests are resolved. No code, database, activation, commit or deployment work was performed.

## Next steps

Resolve the bounded core API for P3, owner and restart protocol, and exact safety boundary between P2 and P5. Hydrate the first complete safe slice before implementation.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
