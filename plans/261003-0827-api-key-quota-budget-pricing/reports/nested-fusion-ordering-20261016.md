# Direction A — nested-fusion ACK/routing ordering, 2026-10-16

## Authority and current result

User resumed [direction A](../plan.md#approved-direction-a-20261016), limited to [B2/B3/B6 nested-fusion](./package-b-remaining-work.md#direction-a-fusion-20261016). **B alone active, bytewise/performance BLOCKED, all13AC OPEN, enforcement/public/synchronous activation OFF.** This report does not close AC5/7/8/11 or authorize production operations.

**No production repair is justified by current evidence.** The native ACK diagnostic reached two valid cases and failed the third before its intended routing mutation. Seven new deterministic controls pass, together with eleven existing boundary cases, but simulate delivery/routing and do not establish durable authority. The actual SQL.js regeneration counterpart passed4/4 with distinct own attempts/original costs/fresh price and lost-ACK/drift refusals. **Finite diagnosis STOPPED_NOT_ALL_GREEN; selected seam remains OPEN**, native inner-judge routing mutation is still unverified. No gate running at final reconciliation.

## Preflight and retained history

- Branch `feat/api-key-quota-budget-pricing`, HEAD `094e2d61ecaeb424a7dff12a9ba9b54e43da51d1`.
- All **1865 original source/test hashes** matched `.pi/fresh-hmac-candidate-20261016/preflight-inputs.json`; no changed/missing input. Existing unrelated Kimchi test, golden snapshot and two research-report hashes captured separately and preserved.
- Historical task output summaries for `b993e951e`, `b2ec4cc9e`, `b04034fb0` exist under `.pi/tasks/01a12c16-0437-7685-a725-a9145826beb1-1611726/`. Their referenced detailed `/tmp` artifacts are unavailable here. Existing reports retain their failures; current runs are not a reproduction/baseline/cause claim for those failures.
- No observed Vitest writer at preflight. No delegation, commit/push, real provider calls, production DB access, activation, restored rejected optimization or performance redesign.
- Current artifacts: `.pi/fusion-direction-a-20261016/` contains preflight, original-input dictionary, per-run before/after dictionaries, command/isolated-path receipts, full logs and Vitest JSON. Actual test fixtures assert the requested adapter and open their own disposable DB directories; isolated HOME also protects usage/log state.

## Hypothesis and source chain

**Hypothesis:** the unchanged outer 1s collector can exclude a live inner owner waiting for completion delivery. An extra POST may then be **independent peer regeneration**, not an outer judge authorized by an undelivered inner ACK. Distinguish by POST model, timing and prompt, not total count alone. This is a possible schedule, not a proven cause of the historical five-versus-four assertion.

- `open-sse/services/combo.js`: `withTimeout` stops observing a late response without cancelling its work. `collectPanel` returns an immutable collected-set copy; uncollected owners retain their completion/error closures. One collected answer regenerates that answer's model; two answers authorize judge synthesis. A late local failure aborts active downstream work, but cannot retroactively unsend an earlier valid independent attempt.
- `handleFusionChat` awaits dispatch responses before adding their prose; buffered executor responses await `completeAttempt`. It must not treat installed rows as delivery.
- `open-sse/executors/accountedBase.js`: queued intent awaits own admission; current routing is checked after ACK and again through `routingGate` at transport exposure. Raw exact usage is completed before buffered success. No edits made.
- `src/lib/apiKeyBudget/requestAccounting.js` / `service.js`: captured routing material is revalidated at admission and actual queued write; storage/identity/budget/price authority remains separate from collector selection. No edits made or observation removed.
- This inspection does not certify issued ACK identity, all transports/adapters or every late-sink race. The new controls deliberately use simulated authority and cannot prove those obligations.

## Native ACK diagnostic — failed, finite STOP

First runner `be09a754b` / `ack-native-diagnostic` failed **pre-test** because installed Vitest4.1.11 rejects `--minWorkers`. Zero test coverage; receipt retained. Verified CLI help, removed only unsupported flag, retained `--maxWorkers=1`; corrected command is not a retry of an executed failed test.

Corrected gate `be05e2c4b` / `ack-native-cli-fixed`: **2 passed / 1 failed / 20 filtered**, exit1, original1865 hashes unchanged before/after. Existing test assertions, 1s collector, quorum2/grace5ms and hook/test deadlines unchanged; existing optional `FUSION_OWNER_TIMING=diagnostic` enabled. No TLS/dispatcher prewarm. Timing instrumentation is not an uninstrumented latency benchmark.

| Case | Actually reached | Not established |
|---|---|---|
| `deliver` | Four own settled rows while inner completion delivery held; outer judge absent before release; after release full five attempts, own completion counts, original200000 costs, no fixture failure | Whole-feature, all-adapter, cold latency or historical cause |
| `lost-inner-ack` | Four own settled rows, lost delivery raises `api_key_accounting_unavailable`; no outer judge/fifth attempt; original costs and completion cardinality verified | All possible late/dropped schedules |
| `routing-drift` | Three original POSTs; outer collector logs1107ms and both panels timed out; generic all-failed response wins `Promise.race` before held inner completion entry; late original owners return1204/1228/1253ms | **Routing mutation, held inner judge ACK, contract drift error and post-mutation refusal all UNREACHED** |

The failed assertion is line273 of the existing loopback test (`expected ... to be null`), not a test/hook timeout. `beforeAttempt` timing reports3calls/1483.68ms inclusive/536.12ms max; these overlap and are **not additive wall cost or proven SQL/crypto root cause**. Current failure is a collector-versus-real-owner-readiness boundary blocker. It does not reproduce historical post-release5vs4 or justify changing product behavior to force full fusion.

## Deterministic controls — scoped pass

Added `tests/unit/fusion-nested-ordering.test.js`, seven finite fake-timer schedules using unchanged1000ms collector/quorum2/grace5ms. No production or existing-test edit.

1. Inner judge held delivery → deliver / lost ACK / routing mutation before release: dependent outer judge absent while held; valid path includes both inner/peer prose; loss or current drift prevents successor POST.
2. Failed inner panel held delivery → deliver / lost ACK / routing mutation: no inner regeneration before delivery; valid path invokes a separate inner-a generation before outer judge; refusal does not manufacture completion.
3. Advance collector to1001ms while inner ACK held: only independent peer regeneration may be selected; its simulated pre-POST routing recheck refuses drift; late inner delivery still reaches its sink exactly once. Expiration alone does not abort the inner signal.

Gate `bce925c70` / `deterministic-controls`: **18/18 passed** across new7 and existing `fusion-accounting-boundary.test.js`11. Existing test explicitly covers independent regeneration admitted before a later lost inner ACK and cancellation of that active successor; retained unchanged.

**Limits:** simulated POST objects/delivered lists are not actual HTTP requests, durable ACKs, ledger IDs, failed raw usage costs or fresh price proof. Do not combine these seven passes with actual DB counts into integrated acceptance. New-file hash recorded separately; original1865 dictionary stayed exact through the run. No broad consumer barrier warranted by a test-only addition; direct source references inventory recorded during inspection, not exhaustive transitive coverage.

Lint gate `b4915c797`: ESLint new file exit0, whitespace exit0. Earlier foreground lint invocation exceeded20s and was inconclusive, not counted as pass. Active LSP probe checked the new JS file, clean1/findings0. Neither result is a security certification.

## SQL.js actual regeneration counterpart — scoped4/4 pass

Gate `bc0e1aa2e` / `regeneration-sqljs-diagnostic`: **4 passed / 0 failed / 19 filtered**, adapter asserted `sql.js` for each disposable fixture. Original1865 hashes exact before/after. Existing diagnostics, assertions, collector/quorum/grace and deadlines unchanged. This is a different required counterpart, not a rerun of failed native ACK cases.

- `deliver`: three original pending-before-POST attempts settle200000 each, including failedHTTP400 `fixture-c` with exact usage/outcome failed. Holding its delivery prevents inner regeneration. Release reaches a second `fixture-a` with distinct attempt ID and own intent, then `fixture-judge`; five rows/completions and request identity verified, no inner-judge attempt.
- `fresh-price`: after three original terminals are installed while the failed-panel delivery remains held, update fixture-a pricing to9/9; original rows remain200000, the separate regeneration settles1350000. Actual final outer judge content, exact counts/unique completions and original costs reached.
- `lost-panel-ack`: installed original rows do not authorize regeneration; injected loss returns `api_key_accounting_unavailable`, only three POSTs/rows/completions, all original costs retained.
- `routing-drift`: mutation really executes before release. Inner regeneration dispatch entry revalidates the captured graph and returns `api_key_accounting_unavailable`; **no fourth POST/intent**. Three original rows/completions retained at200000.

These controls reached actual BaseExecutor HTTP and real SQL.js persistence, not the app entry/UI or all-adapter parity. They do not prove unknown-null-cost, duplicate/late debit, cross-key isolation, production credential mutation or full security acceptance in this run. Current scoped pass does not diagnose/repair historical `b2ec4cc9e` or native inner-judge routing failure. In particular, the SQL.js `deliver` outer collection logged995ms near the unchanged1000ms deadline; neither repeatability margin nor speedup is established.

## Security and stop conditions

- No caller-shaped simulated ACK is accepted as proof of issued product ACK identity. Durable row state and delivered completion remain distinct.
- No credential/routing authority/cache/freshness change; actual successor requires current graph/credential/budget/health authority. Logs/fixtures use dummy credentials only, and no production ledger contents were inspected.
- No raw key/prompt/credential logging was introduced in production; existing diagnostic logs remain local artifacts. Full ledger/secret audit, cross-key isolation, duplicate/late debit, managed restore and integrated admission security remain OPEN.
- Do not rerun native ACK unchanged for green, increase deadline, alter quorum/grace/cancel policy, use prewarm or optimize shared storage as an unapproved consequence of this diagnosis.
- SQL.js counterpart consumed; finite runs STOP, no active gate. Native inner-judge routing boundary remains blocked by observed collector-versus-owner readiness. Shared authority/storage cost needs further attribution before any performance proposal; the current diagnostic does not isolate a safe primitive or authorize redesign.

## Acceptance reconciliation and next action

No acceptance checkbox is closed by aggregate counts. ACK/routing and regeneration schedules now have separate current evidence; historical causality remains an explicit gap. Valid native delivery/lost-ACK and actual SQL.js regeneration/fresh-price/lost-ACK/drift are scopedverified. Native inner-judge routing mutation remains UNREACHED; full delivered-boundary parity, duplicate/late idempotency, fresh budget/health and cross-key/credential isolation across relevant consumers remain OPEN.

**Next safe action:** inspect current app-entry inner-judge routing/admission delivery fixtures and their cancellation/lifetime/authority chain read-only, using this packet to identify a genuinely different falsifiable control before launching anything. A changed control must discriminate routing admission from collector readiness without prewarm/deadline/quorum/cancel-policy changes; do not simply rerun native or SQL.js for green. If full original loopback flow requires making the inner owner faster, retain that shared-dependency blocker rather than expanding this seam into speculative performance work. No whole-G/C–E activation follows. Remaining B packets stay under the existing backlog.

Final preservation: original1865-source/test dictionary, separately recorded new control hash and four unrelated WIP hashes checked again; no production changes, source restoration, rebase/merge, commit/push, activation or DB remediation. See final local reconciliation artifact for exact checks. Markdown/optional static-analysis silence is not a clean/security result; scoped JS lint and active LSP evidence above are the verified checks.
