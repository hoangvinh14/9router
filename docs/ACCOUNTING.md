# Internal accounting core

The [accounting service](../src/lib/accounting/service.js) supports an internal disposable-fixture chat integration. Production accounting and budget enforcement remain OFF, and initialization never sets `ledgerStartedAt`. See [database safety](./DB-SAFETY.md) for storage, backup and identity rules.

Explicit `apiKeyBudgetPolicies` store nullable weekly/monthly limits and a
version. Only null/null means unlimited, independently of ACL. Missing or
invalid policy denies; retained installation markers prevent silent defaults
when a previously initialized policy disappears.

Node SQLite and SQL.js provide adapter-private
`withPersistedAccountingAuthority(work)`: a fresh read-only persisted snapshot
with verified schema/owner and unchanged authority projection, including WAL.
The restricted driver capability `getPersistedRequestAuthority()` wraps only
an already initialized lifetime and returns request-local identity/selection
proofs with fresh assertions. Secrets and reader functions stay private.
Recording-only failure can retain this proof; dirty configuration, uncertain
open transactions, invalid sidecar/owner/schema or maintenance deny. Ordinary
poisoned reads remain blocked. These are identity/selection proofs, not intent
or gap ACKs or POST permission. P3 still owns app ACL/route and continuation
composition. [Verification and finite overhead](../plans/reports/implementation-261027-0850-persisted-authority.md)
cover Linux Node SQLite/SQL.js only; activation remains OFF.

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

## Selected chat integration

The app chat handler captures a request-local capability before parsing the
body. Only the private disposable-fixture association activates it; no header,
body field, setting or environment flag enables production accounting. The
selected path uses a persisted OpenAI-compatible **chat** node and the Default
executor, with existing auth, ACL, account/model selection, direct transport
and saved HTTP proxy behavior.

Every native generation POST, including transport retries, needs its own intent
ACK and a fresh persisted identity/selection proof immediately before exposure.
Local accounting refusal bypasses ordinary retry, cooldown and combo fallback.
Recording failure permits continuation only for verified explicit unlimited
policy with an independent delivered coverage-gap ACK. It never reopens a
writer or relaxes ordinary poisoned reads.

The strict `openai-chat-explicit-details` profile requires complete raw prompt,
completion, total, cached and reasoning counters. Cached tokens are included in
prompt tokens; reasoning is included in completion tokens. Cache writes and
write tiers are explicitly zero for this selected profile; declarations of
those unsupported categories invalidate exact evidence. This does not certify
all compatible providers. Prices come from the original P2 snapshot, including
explicit zero cached rates and input-rate fallback for absent cached rates.

JSON owns and bounds the raw body before translation, awaits its own exact or
unresolved terminal ACK, then replays native bytes. SSE uses one incremental
UTF-8/event reader: deltas may pass, while meaningful finish and DONE await
complete usage, protocol completion and the attempt's own terminal ACK. A mixed
delta/finish frame is split. DONE defines the selected protocol boundary;
already-read trailing evidence is refused and the raw reader is cancelled.
Missing/conflicting usage, premature EOF, stall, cancellation or failed ACK
cannot become a successful translator flush. Existing native error-terminal
formatting handles failures after headers. Raw byte activity feeds the existing
stall watchdog, including fragmented frames; upstream completion clears that
watchdog while the terminal ACK is pending.

Raw JSON, frame and retained terminal bounds are owned by
[runtimeConfig.js](../open-sse/config/runtimeConfig.js). Receipt sinks survive
request disposal for late evidence; duplicate/conflicting observations use the
existing ledger rules. Tests and finite measurement evidence belong to the
[P3 execution record](../plans/261018-0213-durable-chat-accounting/plan.md), not
production activation authority.

## Remaining owners

P3 owns acceptance of the selected dispatch/protocol integration, all successor/fresh gates, coverage-gap continuation eligibility and late sinks. Broader provider and transport inventory remains separate. P4 owns policy, calendars and budgets. P5 owns authenticated management/recovery UX and managed physical restore. Bun/better/Windows accounting validation remains a P5/R release blocker. Activation requires complete dispatch coverage and its own acceptance; the existence of this core does not establish that coverage.
