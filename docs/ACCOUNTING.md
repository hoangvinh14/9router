# Internal accounting core

The [accounting service](../src/lib/accounting/service.js) is a prerequisite for provider integration. No inference handler invokes it yet, no budget is enforced, and initialization never sets `ledgerStartedAt`. See [database safety](./DB-SAFETY.md) for storage, backup and identity rules.

## Call contract

Create one service per initialized adapter using `createAccountingService(db)`. Private WeakMaps bind contexts and receipts to that adapter lifetime; copying a receipt or reading a visible row cannot manufacture an acknowledgement.

1. `createContext({ apiKeyId, validateAuthoritySync })` captures stable key/ACL, configuration and coverage generation. The required synchronous callback must validate the request's current routing/access authority for the supplied candidate and return exactly `true`; async/thenable authority refuses. P3 owns that capability and its actual protocol/routing evidence.
2. `await beginAttempt(context, { provider, model, endpoint, connectionId? }, { signal? })` records intent using the current original P1 price snapshot. After queue admission, the actual mutation rechecks key/binding/ACL, configuration, coverage, price, owner and request authority. Only the successful outer durable transaction creates an own intent receipt.
3. Call `assertDispatchAuthority(receipt, context)` immediately before the actual upstream POST. This rechecks fresh authority and consumes dispatch permission once. Do not add an await between this check and POST. Each retry/fallback/panel/judge/successor POST needs its own attempt and receipt; persisted visibility and replay are never dispatch permission.
4. `await completeAttempt(receipt, terminal, { signal? })` persists an outcome using the original snapshot. Keep the receipt and sink alive for late usage/errors even after request configuration changes or context disposal. Terminal fields are `state`, `outcome`, `finishedAt` (canonical ISO timestamp), optional exact `usage`, or `notDispatchedEvidence`. Missing/estimated settlement usage becomes unresolved/null cost. A dispatched receipt cannot claim `not_dispatched`.
5. `disposeContext(context)` removes future request authority; it does not erase an acknowledged attempt's terminal sink. `stop()` permanently stops that service's lane. Adapter close also stops admission and performs pending recovery before releasing ownership.

Queue cancellation before application preserves the original abort reason and records no intent. Once application starts, cancellation cannot erase the recorded result. The coordinator bounds operation/group/queue count and bytes, yields between synchronous groups and does not run or wait for network work. Limits are exported as `WRITE_LIMITS` in [write-coordinator.js](../src/lib/accounting/write-coordinator.js). Synchronous filesystem calls cannot promise a hard wall-clock drain deadline.

Local member refusal rolls back that member while healthy peers may commit. Uncertain RELEASE/rollback/publication, a throwing group or malformed group result delivers no success and poisons the lane. A failed ACK remains failed even if reopen finds a row. P3 must handle failed intent/terminal writes, retain sinks, and explicitly latch independent coverage gaps before any permitted unlimited continuation. This core enables no continuation exception by itself.

## Exact usage and states

[exact-money.js](../src/lib/accounting/exact-money.js) uses BigInt/rational arithmetic and rounds half up once per attempt. Money is a decimal nanoUSD string; per-attempt values are bounded by the pricing safety constant. Aggregation uses BigInt rather than SQLite `SUM` or floating-point money.

Base evidence requires `exact: true`, nonnegative safe-integer `input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`, and explicit `reasoningIncludedInOutput`. Cache read/write are disjoint subsets of input; included reasoning is a subset of output. An original hourly cache-write rate requires explicit `cacheWrite5m` and `cacheWrite1h` whose sum equals cacheWrite. Optional rates use the original P1 documented input/output fallbacks.

Extended rates require `{ exact: true, provenance, components: [{ category, count, unit }] }`. Components must represent observed disjoint billable quantities. Each original required category must occur exactly once, including zero counts. Without a narrower immutable `usageSemantics.requiredCategories` contract, all categories in the original rates are required. Token units are USD/1M tokens; per-use fees require explicit original USD/1000 uses authority. Unknown/missing categories, units, tiers, unsafe values or overflow refuse exact settlement. P3/X owners must prove provider mapping and provenance; a string alone does not certify provider support.

Attempts start pending and transition to settled, unresolved or proven not_dispatched. Unknown usage remains null cost. Exact late observations may settle unresolved rows. Identical intent/terminal replay is idempotent; conflicting terminal observations are audited and refuse a second debit. `resolveAttempt(id, { operationId, expectedVersion, actor, reason, evidence, action, ... })` supports internal CAS recovery of unresolved rows with `waive`, `exact_usage` or `cost_correction`. Waiver is explicit audited zero; manual resolution wins over late conflicting callbacks. No management route or historical debit is introduced.

## Remaining owners

P3 owns actual dispatch/protocol integration, all successor/fresh gates, coverage-gap continuation eligibility and late sinks. P4 owns policy, calendars and budgets. P5 owns authenticated management/recovery UX and managed physical restore. Bun/better/Windows accounting validation remains a P5/R release blocker. Activation requires complete dispatch coverage and its own acceptance; the existence of this core does not establish that coverage.
