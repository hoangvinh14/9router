---
title: "API-key budget — audit develop against product intent"
description: "Save the agreed brainstorm first, then audit committed and pending budget work against it; recommend reuse/simplify or rebuild without runtime changes."
status: completed
priority: P1
effort: "One bounded static comparative audit; no runtime implementation estimate"
branch: develop
tags: [docs, backend, auth, tech-debt]
blockedBy: []
blocks: []
created: 2026-11-13
---

# API-key budget scope audit

> **Later owner decision / new-session entry:** use a clean integration branch from remote-synced master in the same checkout, no separate worktree, selectively port/adapt requirement-driven parts of develop. Read [brainstorm section 8](./references/brainstorm-contract.md#8-owner-selected-branch-strategy-and-context-reset-handoff) and [branch handoff](./references/branch-handoff.md) before creating a new implementation plan. The audit below is completed historical work, not the next execution queue.

## Delivery contract and authority

The user approved this order: (1) preserve the brainstorm in a durable document; (2) review develop versus master and pending work against it; (3) recommend continuing if the gap is small or rebuilding if the gap is large. Acceptance of a possible rebuild is **not** permission to reset/delete develop, migrate data or implement runtime changes.

- **Outcome:** an evidence-based decision about which existing changes are necessary for API-key budgets, which can be simplified, which are outside the fresh contract, and what is missing.
- **Constraints:** preserve dirty checkout, services and private state. No fetch/live calls, credentials/DB/private captures, runtime edits, tests/builds/deploy/activation, commit/push, reset/stash or delegated agents. Read public repository source/tests only; test assertions are not test passes.
- **Non-goals:** completing the old milestone, rewriting the inference pipeline, proving producer contracts, a whole-repository security audit, deleting existing features, or treating every historic engineering requirement as a fresh product requirement.
- **Acceptance:** the [brainstorm contract](./references/brainstorm-contract.md) exists before comparative inspection; recorded baseline distinguishes committed and pending changes; [audit report](./references/audit-report.md) maps each product requirement to actual source/callers and missing evidence, and recommends retain/simplify or rebuild with trade-offs, migration risks and future checks. Local document links and relevant source stability are checked.

## Baseline (local, not fetched)

- HEAD / develop: `08ee1a74954c5fe7a1659a6473e57b6b1ea9059b`.
- master / merge-base: `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d`.
- master-only / develop-only commits: `0 / 21`.
- User identifies master as upstream-synced; no remote freshness verification is authorized or claimed.
- Initial tracked unstaged paths: 42; staged paths: 0. Entire status has 32,838 paths, predominantly generated build/session artifacts. These totals are not a code-complexity measure.
- Compare separately: master → committed develop; develop → tracked working tree; relevant untracked source. Exclude generated artifacts, session traces and private content.

## Execution

| Step | Status | Output / mechanical exit |
|---|---|---|
| 1. Establish local baseline | complete | Refs, ancestry, dirty status and coarse counts recorded without touching state. |
| 2. Save accepted intent | complete | `references/brainstorm-contract.md` created before audit; B01–B08, confirmed needs versus proposed safeguards and unresolved decisions. |
| 3. Static comparative audit | complete | Source/provenance manifest and report cover traced activation → identity → admission → attempts/retries → settlement → API/UI, with scoped security review. |
| 4. Recommend and validate | complete | Report recommends retain/selectively simplify, not wholesale reset; 333 listed source paths unchanged, local-file links and B01–B08 mapping checked, Advisor recommendations incorporated. No runtime verification. |

## Decision rules

A mechanism is not over-engineering merely because it is complex: identify the invariant it protects, a concrete alternative, dependency and migration consequences. Conversely, an old plan/test/proof campaign alone does not establish product necessity. Unsupported evidence must remain unknown rather than zero/free. Do not mistake a helper or fixture-only integration for production activation. Existing scopes are not silently waived; recommend disposition explicitly.

**Trade-offs:** reuse assumes the core identity/ledger/gate is aligned and localized; it fails first if activation/transport ownership requires broad rewrites. Rebuild assumes equivalent correctness is cheaper from the upstream baseline; it fails first if it recreates existing persistence, security and compatibility work or strands data. Compare equivalent behavior, not a smaller replacement feature.

**Better approach found:** retain aligned core and extract a bounded feature slice rather than choosing “keep all / delete all”. Broad pricing automation/coverage/tooling and degraded-mode mechanisms require separate disposition; the native/production activation delivery gap remains substantial. No deletion/rebuild decision is executed.

## Failure / stop protocol

Missing runtime proof is a limitation of this static review, not permission to launch tests. Missing product policy is documented rather than invented. Any destructive/runtime/migration action requires a subsequent decision. Do not repeat prior producer research, stopped timing campaigns or E0 inventory. This audit is a newly requested comparison against the fresh product contract, not a continuation campaign.

## Verification

[Validation result](./references/validation.json): 333 listed source paths checked with no SHA-256 drift; HEAD/develop/master refs stable; all B01–B08 appear in contract and report; local-file links resolve (anchors not checked). Reproduce with `python3 plans/261113-1952-api-key-budget-scope-audit/references/validate-documents.py`. Supplemental paths were captured when added, not claimed frozen from the initial checkpoint. This does not establish whole-tree immutability.

Advisor final static-review guidance incorporated: design alignment is not delivery, no-shipping-caller finding is scan-bounded, simplifications require invariant-preserving alternatives, and excluded routes must still account or refuse budget keys. No full lint claim: marksman was silent on the report. No runtime tests/build/live calls or security certification. Initial missing validation-output link was resolved by creating the output and rerunning document checks.

Local [journal](../journals/2026-11-13-api-key-budget-scope-audit.md) created and validated; AgentWiki publish skipped. Runtime correctness and provider monetary semantics remain unverified. **This audit plan is complete; the budget feature and old milestone are not marked complete.** The later owner selects clean-branch/selective-port planning in the same checkout; see handoff. Earlier validation/ref stability refers to its recorded checkpoint, not a later synced master. No reset, runtime implementation or production activation is performed by the report update.
