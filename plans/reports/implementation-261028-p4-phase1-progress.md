# P4 phase1 — calendar/enforcement verification checkpoint

**Phase1 complete within the selected fixture boundary.** Production remains OFF. Branch
`feat/weekly-monthly-budget`, base develop b41dca0a. Node v24.21.0/Linux;
selected `openai-chat-explicit-details` compatible-chat JSON/SSE only.

## Implemented source

- `budget-windows.js`: fixed Asia/Ho_Chi_Minh, Monday/day1, UTC half-open windows
  plus bounded previous calendar windows; canonical synchronous internal clock.
- `budget-policy.js` and accounting policy helper: full decimal-string/null
  ingress, bounds, zero, expectedVersion, durable CAS, unchanged-current no-op,
  stale conflict, no implicit initialized policy replacement.
- `budget-gate.js` + existing service: fresh policy in request authority;
  identity/config/coverage precede eligibility, eligibility precedes price;
  same serialized durable intent member reads/gates/inserts admitted startedAt.
  Final synchronous gate preserves immutable startedAt, refuses finite rollover
  and rechecks spend/unresolved before consume. Pending is not reservation.
  No second writer/cluster support or hard-cap claim.
- Ledger repo counts and `budget-projection.js`: BigInt settled/waived spend,
  lifetime/current pending/unresolved counts, exact strings, remaining clamp and
  overshoot, previous calendar summaries. No counters/job/history deletion.
- `budget-errors.js` + app handler: private error provenance, selected native
  metadata/no-store/requestId/Retry-After/CORS; missing price alone candidate-local.
  Persisted policy drift stays unavailable; unsupported profile typed explicitly.
- App accounting ticket + existing raw-stream WeakMap activity/stream handler:
  private operation terminal failure supplies native error-only bytes. ACK failure
  after content withholds finish/DONE, preserves requestId, sanitizes details.
  Ordinary upstream/transport failures retain existing terminal formatter.
- Fixture clock association remains private; no shipping request/env/header/setting
  activation added and no public ledgerStartedAt stamp.

## Verification provenance — separate invocations

All Vitest commands ran from `tests/` with isolated temporary HOME/DATA_DIR,
normal request guards/deadlines/concurrency. Node and SQL.js parameterizations
execute actual adapters; none silently skipped.

| Invocation | Result | Scope/provenance |
|---|---|---|
| Pre-feature affected baseline |488/488,24files|[summary](./verification-261028-p4-baseline.json); raw `/tmp/9router-p4-baseline.json`|
| Revised web feasibility |7checks each adapter|[receipt](./implementation-261028-p4-web-preflight.md); hybrid source AppRoute lifecycle + compiled UI, not standalone|
| Calendar/policy |75/75,3files|`/tmp/9router-p4-calendar-policy-green.log`|
| Initial gate/P3 controls |244/244,7files|`/tmp/9router-p4-gate-green.log`, earlier source snapshot|
| Actual JSON |12/12|`/tmp/9router-p4-chat-budget-json.log`, earlier source snapshot|
| Projection/ledger |8/8|`/tmp/9router-p4-projection.log`; overflow uses audited correction fixture, not actual debit|
| Trusted errors |6/6|`/tmp/9router-p4-budget-errors.log`|
| Native stream/P3 regressions |157/157,5files|`/tmp/9router-p4-native-sse.log`, before later catch repair|
| Failure boundaries |14/14|`/tmp/9router-p4-failure-controls.log`, before added final controls|
| Stream compatibility |11/11|`/tmp/9router-p4-stream-compat.log`|
| Integrity |12/12|`/tmp/9router-p4-integrity.log`|
| Adapter reopen |4/4|`/tmp/9router-p4-reopen.log`; not a process restart claim|
| Localized catch control |52/52,4files|`/tmp/9router-p4-local-catch.log`|
| Focused repeat |50/50,3files|First invocation in `/tmp/9router-p4-phase1-revalidated.log`|
| Consolidated after catch repair |386/386,21files,0skips/import failures|Second invocation uses JSON reporter: [summary](./verification-261028-p4-phase1-consolidated.json), raw `/tmp/9router-p4-phase1-revalidated.json`. Not the50-test text summary.|
| Final typed profile/monthly/both + authority/ACK controls |106/106,4files,0skips/import failures|[summary](./verification-261028-p4-phase1-final-controls.json), raw `/tmp/9router-p4-phase1-final-controls.json`; after final profile source correction.|
| Full touched-source ESLint |exit0,empty output|`/tmp/9router-p4-phase1-final-eslint.log`, after final profile change|
| Active LSP / syntax / diff |no findings for checked changed paths; node --check/git diff --check pass|Run throughout; not a build substitute.|

New actual durable-spend controls `chat-budget-failure-controls.test.js` assert
monthly exhaustion with weekly available, simultaneous exhaustion, both windows,
latest reset,429/native code, no successor POST/charge. Unsupported compatible
profile asserts503/model_accounting_unsupported before POST/no ledger intent.
New actual stream test asserts HTTP200 remains committed after content, exactly
one safe error with matching response requestId, no finish/DONE on terminalACK
failure. Prestream429 has native metadata/no-store/Retry-After/exposed headers.

## Failed evidence retained / repair

Pre-feature service gate20/20 red (valid missing behavior), earlier calendar red
included a test syntax error (not valid policy-behavior evidence), and initial
SSE terminalACK2fail/4pass before callback. Logs retained under `/tmp/9router-p4-*`.

The first consolidated run366/368 exposed the original P3 heldACK test failing
on both adapters. Structural trace found separately delivered1B framing, **not**
success finish/DONE/EOF. Returning original Response did not fix and was reverted.
The extra async wrapper added for missing-price catch was replaced with a local
catch around existing core await. Unchanged original assertions pass in52-test
control,50-test repeat and386-test consolidation. Structural after traces are
[Node](./verification-261028-p4-held-ack-node.json) and
[SQL.js](./verification-261028-p4-held-ack-sqljs.json); pre-repair failure
[summary](./verification-261028-p4-held-ack-regression.json). This establishes
restored tested delivery behavior; transport chunks are not SSE event boundaries.
No assertion/deadline/guard/concurrency weakened to pass.

## Independent process restart and scoped closure

[Current-code process restart](./verification-261028-p4-process-restart.json)
passed2/2 on Node SQLite/SQL.js. Executable source:
`tests/unit/chat-budget-process-restart.test.js` spawns
`tests/fixtures/accounting/budget-restart-process.mjs` twice per adapter with the
same file, DB/sidecar/key fingerprint/coverage ID and policy version. The parent
owns the actual dummy upstream and asserts1POST after first writer and2 only
after the new calendar request in second writer; the intermediate exhausted429
has no extra POST/intent. Historical startedAt/cost rows remain exact. No
reseed/clean DB is used by the reader process. Each child has a45s finite bound;
separate test invocation `cd tests && npx vitest run unit/chat-budget-process-restart.test.js --reporter=json --outputFile=/tmp/9router-p4-process-restart.json`
passed; child files and tests passed syntax, active LSP and ESLint checks.

Advisor reviewed closure with these controls and no demonstrated remaining
phase1 blocker, conditional on truthful receipt/scope. This receipt and phase
files were reconciled. Single writer per DATA_DIR remains mandatory; sequential
restart does not certify concurrent writer/cluster admission. Full build,
production standalone, combined budget UI, full-suite and measurement remain
phase3; phase2 may now start. No production activation follows from closure.

## Later owners / security boundary

Phase2 management API/UI and auth-first key CRUD prerequisite are not implemented.
[Consumer inventory](./implementation-261028-p4-consumer-inventory.md) identifies
legacy CLI token-only and Origin omissions; no exemptions permitted. Phase3 owns
combined real budget UI→API→inference→ledger, production standalone/build,
full-suite same-base normalization and finite performance measurement. Existing
regression reporter `/app/` normalization mismatches this checkout; use verified
repository-relative failure comparison. Prior generated `.next-*`, `.pi/`,
`.unipi/` artifacts are not P4 deliverables. P5/X/R and other protocols/adapters
remain open; no production activation or Git publication authorized.
