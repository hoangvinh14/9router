# Corrected usage diagnosis — bounded causal controls passed

User explicitly approved the attempt1 harness correction: literal `vitest` import, exact installed-package alias, fresh root only; same cases/assertions/timeouts. Task `b846b70d3` completed exit0: actual Node builtin and real SQL.js each4/4 diagnostic cases passed. Only pre-open native availability is mocked for the SQL.js lane. Raw artifacts, harness and hashes are preserved separately from attempt1; no installed dependencies or production changes.

| Case | Node: requested / unique input timestamps / raw rows | SQL.js: requested / unique input timestamps / raw rows |
|---|---|---|
| Fixed identical timestamp | 50 / 1 / 1 | 50 / 1 / 1 |
| Fixed unique timestamps | 100 / 100 / 100 | 100 / 100 / 100 |
| Automatic timestamps100 | 100 / 2 / 2 | 100 / 2 / 2 |
| Automatic timestamps50 | 50 / 2 / 2 | 50 / 1 / 1 |

History counts and provider requests/prompt/completion totals matched the raw persisted row counts in every case. No save error was logged. Timestamps are recorded on input objects mutated by saveRequestUsage, not an independently projected list of each stored row's timestamp; this limits the precision of the stored-timestamp claim. Counts are directly observed via raw SQL and repository APIs.

## Causal interpretation
`usageRepo.js:243–310` is byte-identical to HEAD. It generates missing timestamps using `new Date().toISOString()` and checks an existing row using timestamp/provider/model/connection/apiKey/prompt/completion. Identical independent calls in the same millisecond therefore meet this dedup predicate and skip all three writes, intentionally from that implementation's perspective. Controlled unique timestamps preserve100records; fixed collisions preserve1; automatic collisions produce counts consistent with that predicate on both tested engines, without save errors. This supports dedup collision rather than lost update as the cause in these diagnostic fixtures.

The original two concurrency tests also submit identical provider/model/connection/token fields without timestamps. Their observed varying counts are consistent with this mechanism. This is a bounded causal explanation, not proof that every original run had identical internal scheduling, nor a universal no-patch-influence certification. It identifies a product semantic issue: timestamp/token equality does not establish the identity of a request. Deciding how to distinguish legitimate duplicate reporting from independent requests requires a dedup/idempotency contract, not changing test assertions or simply making timestamps unique in production.

## Scope / next decision
Analytics production repair is **not authorized** by diagnosis-only approval and has not been performed. Original affected R4 regression remains FAILED118pass2fail/120; diagnosis success does not replace those assertions or waive them. Options require user decision: authorize a narrow request-identity/dedup repair with regression coverage, or explicitly accept these named known failures for Linux development only after reviewing impact. No accounting/ledger/inference hooks or request-callsite redesign is inferred.

Frozen R4 source and harness hashes rechecked after collection; usageRepo matches HEAD, no fixture writer locks remain. R4 source is subsequently superseded by separately scoped R5 DB path/release repairs, not by analytics changes. See receipt for exact evidence hashes.
