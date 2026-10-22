# Authorized narrow usage-count repair — implementation contract

## Evidence / policy
User authorized a narrow dedup repair after diagnosis and caller/test inspection. The original usage100/50 failures remain retained; the corrected diagnostic probe demonstrates timestamp collisions on Node/SQL.js, not universal regression certification.

Current `saveRequestUsage(entry)` accepts no documented explicit idempotency token. Inspected callers (chat requestDetail, embeddings, imageGeneration, systemone), shim, repository and usage/parity/concurrency/attribution tests supply event data, not a stable request identity. The present equality predicate uses millisecond timestamp and token fields, not proof of identity. Do not invent a persistent request-id API/schema or change inference callsites to repair the count.

**Chosen bounded policy: each saveRequestUsage call represents one usage event.** Timestamp is event time, never identity. Separate calls count independently even with the same supplied timestamp, same fields, or reused object. Do not mutate timestamps to manufacture uniqueness. No explicit idempotency contract exists in this repository path to preserve; do not claim deduplication of retry/reporter events. If a future caller needs idempotency, it requires a separate explicit identity contract and durable uniqueness design, outside this patch.

## Exact manifest / planned delta
- `src/lib/db/repos/usageRepo.js`: remove only implicit timestamp/token history lookup and its endpoint-enrichment early-return; retain timestamp/cost calculation and atomic history+daily+lifetime transaction, ring/event emission and current error behavior.
- New `tests/unit/usage-event-identity.test.js`: isolated real Node/SQL.js (only availability selection mocked for SQL.js), fixed timestamp identical calls count fully, token/daily/lifetime consistency, supplied timestamps unchanged, endpoint differences remain separate events, same-object repeated calls remain separate events, close/reopen persistence. Close adapters before fixture removal and restore environment.
- Existing `tests/unit/db-concurrent.test.js` assertions remain unchanged. Add the new identity tests to affected manifest, alongside prior DB/ACL/pricing/usage suite. Audit cached-token and attribution consumers without widening inference scope. Only close/isolation cleanup in existing tests if required and explicitly recorded; never change expected count to dedup result.

No schema bump/ledger/budget/accounting/inference hooks, callsite changes, network fetch or production activation. Implementation not yet applied while R5 focused/lint inputs are frozen.

## Verification
Fresh final-source affected run must pass original100/50 assertions as written; diagnose failures under counsel protocol rather than weaken assertions. Verify exact final source hashes and all affected runtimes. Future idempotency behavior is not claimed by these count tests. Independent follow-up review covers this bounded semantic change and potential legitimate duplicate-report tradeoff before Linux gate acceptance.
