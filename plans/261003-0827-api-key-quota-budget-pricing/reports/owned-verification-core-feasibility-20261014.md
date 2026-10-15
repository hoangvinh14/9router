# Fresh verification-core feasibility checkpoint — no implementation candidate approved

## Inputs and decision

Operator chose performance-blocker work. Evidence: [JSON CPU sampling diagnosis](./owned-audio-cpu-diagnosis-20261014.md), [rejected equality evaluation](./owned-authority-verification-core-proposal.md), [prior bytewise architecture review](./bytewise-authority-architecture-review.md). Original1864 source/test hashes are restored exactly. No gate running.

**Decision: do not implement another production optimization yet.** No examined design currently has both demonstrated pipeline leverage AND an equivalence argument satisfying the existing constraints. This is insufficient evidence/design feasibility, not proof that the requirement is impossible and not permission to mark support complete by refusing it.

## Current fresh-check invariants

1. At each existing caller boundary and each independent grant verifier, repeat original/private identity and ALL resource validation. Do not memoize validation by object identity or event-loop turn.
2. Resource read must freshly verify KV value, protected latest receipt, signature, grammar, ACTIVE/time/expiry and exact originally owned result.
3. Binding capture must freshly validate current coverage before/after actual canonical SQL, credential fingerprint, actual prior-ID/reverse/retired-binding helper, settings/ledger/connection/pool and full detached authority digest.
4. Coverage current must freshly read lock/sidecar, validate row history/generation/key/policy marker. Fingerprinting cannot reuse an earlier current frame or key object in lieu of a new current read.
5. Acquired writer inspection must retain before/after checks around synchronous callbacks; adapter health/ownership checks still occur for every fresh SQL read. No new callback/reentry window.
6. Preserve current signed byte representation, schema, durable receipt-before-DB order, WAL/FULL/fsync, poison-on-uncertain-ACK, exact original pricing and separately delivered own ACK.

## Candidate matrix

| Design | Potential leverage | Equivalence / evidence | Disposition |
|---|---|---|---|
| Snapshot-free fresh equality at two comparisons | Reduced copy/allocation only |4semantic+1000differential passed; real JSON still timeout, SSE failed |Rejected/reverted; not a platform for another patch|
| Share one coverage/binding/owner frame across grant/resource checks | Reduces repeated dominant path |Eliminates mandatory fresh reads/checks; callback/SQL/sidecar mutations could be missed |Forbidden under current contract|
| Fewer grant assertions / aggregate five flags | Reduces repeated full authority |Deletes existing independently verified fresh boundary |Forbidden, not a harmless refactor|
| Compiled SELECT reuse / canonical SQL join | Reduces prepare/round trips |Already present; actual execute/owner/coverage retained; prior bytewise goal still red |Do not repeat as a new candidate|
| Faster lock/sidecar read primitive |Targets read-heavy samples |Prior filesystem candidates rejected; fresh stat/read/identity/error semantics and matched current benefit not established |No repeat without a materially new design|
| Cache parsed sidecar / HMAC key / resource by generation |Potentially large |Requires fresh read and exact validation anyway; key/generation equivalence alone cannot replace required freshness/history checks |Not authorized|
| Specialized fresh JSON grammar/serialization |Could reduce allocations while repeating reads |No current exclusive JSON parse/serialize cost or implementation equivalence proof; signed property order/limits/duplicate fields/restore compatibility matter |Design research only; no patch justified|
| Native verification implementation |May lower per-call CPU |No measured native workload/equivalence implementation; deployment, native optional-dep, all-adapter and restore expansion |Out of current implementation scope without explicit design approval|
| Move executor imports out of body / change worker or deadline |Could change observed duration |Prewarm/lifecycle/deadline changes alter accepted gate rather than fixing it |Forbidden as a repair|

## What would justify implementation

A named candidate must identify an expensive exclusive operation within a fresh check and specify an equivalent replacement—not only that the inclusive stack is expensive. Supply:

- Exact old/new call and read sequence, all unchanged boundary/SQL/file checks and no retained authorization state.
- Primitive grammar/limits/property-order behavior and signed representation compatibility, or an explicit separately accepted migration/restore design.
- Red deterministic mutation/error/reentry tests for the replaced primitive, plus matched old/new measurement with equivalent fresh sources; no app prewarm or moved work outside deadline.
- Unchanged real JSON/SSE/bytewise, original-price, current-resource and own delivered ACK gates; a micro gain cannot justify retention alone.
- Scoped affected consumers only after contract evidence, then full remaining acceptance/security/adapter/restore obligations. Keep existing failed receipts.

Current profile does NOT supply precise call counts, syscall latency or a matched candidate baseline. It rules out treating the rejected small equality change as completion; it does not choose the next implementation automatically. Broad repeated instrumented runs without a discriminating hypothesis would add failures/overhead rather than close acceptance.

## Stop condition and next action

This feasibility checkpoint is complete, outcome **BLOCKED_NO_APPROVED_CANDIDATE**. No new test run or product patch is launched. Further performance implementation needs a concrete reviewed redesign satisfying these invariants, not another speculative micro-optimization. If the operator wants a contract change (read-sharing/check frequency/deadline), that must be an explicit separately approved scope decision; it has NOT been requested or inferred here.

The existing user request to finish remains unmet: B/F and all13AC/G→T→I→V/C–E open, original producer27fail/whole-contract timeout/bytewise and historical failures retained. Enforcement/public/synchronous activation OFF; no commit/push/delegation/live calls/production DB operations. Original audio implementation is unverified WIP, not delivered functionality.
