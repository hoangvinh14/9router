---
title: "JSON attempt lifecycle"
status: todo
---

# JSON attempt lifecycle

Prerequisite: both [dispatch prerequisite phases](../261023-0739-p3-chat-dispatch-prerequisites/plan.md)
accepted. Implementation, both-adapter functional controls, affected-consumer
checks, lint/build and combined acceptance are complete; see the
[final reconciliation](../reports/implementation-261028-1243-chat-plan-completion.md).
Use [the owner/profile/matrix contract](./design-preparation.md).

## Implementation and files

1. Add request-local stable identity and fresh authority in
   `src/sse/services/chat-accounting.js`; pass internal capability through
   `src/sse/handlers/chat.js` and `open-sse/handlers/chatCore.js`. No public
   opt-in, shared-executor state or identity inferred from nullable ACL context.
2. Add strict raw profile normalization in
   `open-sse/utils/accounting-openai-usage.js`, one bounded raw body reader and
   per-POST lifecycle in `open-sse/executors/accounted-base.js`/`base.js`.
   Protocol bounds belong in `open-sse/config/runtimeConfig.js`; shared fixture
   helpers belong in `tests/fixtures/accounting/`. Wire all existing retries and refresh/account successors to own attempts.
3. Keep accounting refusal distinct through core, app and
   `open-sse/services/combo.js`; preserve real empty-content fallback after
   predecessor settlement. Use P2 original snapshots and exact-money only.
4. Compose explicit unlimited proof with own independent gap ACK; no permit
   from a visible row or stale snapshot, and no context-disposal loss of late sink.

## Verification

- [x] `chat-accounting-json.test.js`: exact raw normalization, missing/contradictory counters and distinct/zero/fallback cache rates.
- [x] `chat-accounting-loopback.test.js`: real app/core/Base/POST/ledger on both adapters; cache matrix and reopened costs from design contract.
- [x] Held/lost intent and terminal ACK, post-await drift, failed exact usage, unknown/null, duplicates/conflicts/late, abort/restart, two-key shared executor and price drift.
- [x] Actual successful direct/proxy/continuation controls, own successor attempts, no local refusal cooldown/fallback and preserved upstream 200-empty-content behavior.
- [x] Named affected Base, proxy, key-access, account-fallback and combo gates; lint changed modules and build.

Run new suites first with `npm --prefix tests test -- unit/<named-file>` and
120-second process bounds. No prewarm, deadline increase or rerun-for-green.
Retain red receipts; invoke cook's failed-verification counsel before repair.
JSON acceptance alone does not close P3. Rollback removes internal hooks while
retaining identity/policy/ledger/coverage data and activation OFF.

## Final acceptance — October 28

Shared build and isolated standalone smoke passed. The final reconciliation
links 185 selected JSON/SSE and 126 affected-consumer controls, full measurement
and qualified baseline failures. Earlier boundary below is retained history.

## Historical verification boundary — October 27

Selected functional controls pass. The shared build did not finish within its
300-second bound. The combined measurement retained 1600/4800 completed request
evidence before its own bound. Final acceptance stays incomplete; see the
[execution receipt](../reports/implementation-261027-chat-lifecycle.md).
