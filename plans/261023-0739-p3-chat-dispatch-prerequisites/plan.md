---
title: "P3 policy, persisted authority and transport prerequisites"
description: "Explicit policy and fresh persisted authority, followed by per-POST transport ownership."
status: completed
priority: P1
effort: "Not estimated"
branch: feat/durable-chat-accounting
tags: [accounting, policy, durability]
created: 2026-10-23
---

# P3 policy, persisted authority and transport prerequisites

## Overview

The user selected a narrow policy classifier and read-only persisted-authority path, then resumption of P3. Establish these technical prerequisites without introducing another configuration writer. The accepted exception requires verified owner/schema/identity/current policy and route, plus an independent durable gap ACK. ACL unrestricted never means unlimited.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Install canonical durable policy classification and fresh authority proof for conditional Linux Node SQLite/SQL.js acceptance. | P1 |

## Dependencies and boundaries

Depends on completed P2; blocks [P3 preparation](../261018-0213-durable-chat-accounting/phase-01-start.md). It does not depend on P3. One serial implementation owner owns every phase file; no parallel source edits.

Non-goals: budget editor, calendars, enforcement, new writer topology, broad transport rewrite, public activation, or setting `ledgerStartedAt`. Preserve Bun/better ordinary behavior; their accounting parity and other platform obligations remain open. This prerequisite does not certify provider support or actual P3 POST coverage.

## Phases

1. [Explicit policy and persisted authority](./phase-01-start.md).
2. [Per-POST transport boundary](./phase-02-transport-attempt-boundary.md), after phase 1 acceptance.

## Current execution

Phase 1 classification/persisted proof is accepted on Linux Node SQLite and
SQL.js with the [October 27 receipt](../reports/implementation-261027-0850-persisted-authority.md).
Historical red cycles remain in the linked earlier receipts; measured Buffer
matcher overhead was the dominant timeout cause. No deadlines or durability
checks changed. Phase 2 per-POST transport is accepted with [42 actual-flow tests and 33
affected checks](../reports/implementation-261027-0903-transport-boundary.md).
This prerequisite is complete; P3 JSON/SSE remain incomplete. App continuation still requires independent gap ACK and a
private one-use actual-POST permit.

## Success Criteria

- [x] Real Node SQLite and SQL.js demonstrate explicit null/null policy classification, preserved identity/import/tombstones, and fresh persisted authority after recording-only failure.
- [x] Dirty config, invalid owner/schema/binding/policy/maintenance, unknown transaction state, and failed gap ACK cannot produce a continuation permit.
- [x] No poisoned RAM read, failed operation acknowledged from visibility, source export/fsync/rename during proof, or second writable connection occurs.
- [x] Focused/affected gates and finite overhead evidence are recorded; P3 resumes and owns private one-use permit plus gap ACK composition, public activation OFF.

<!-- slug: p3-chat-dispatch-prerequisites -->
