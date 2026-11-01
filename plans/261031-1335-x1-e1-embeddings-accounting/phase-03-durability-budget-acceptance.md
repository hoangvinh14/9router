---
phase: 3
title: "Durability, budgets và affected acceptance"
priority: P2
effort: "Chưa estimate"
dependencies: [2]
---

# Phase 3 — Durability, budgets và affected acceptance

<!-- Updated: Validation Session 1 - Embeddings activation-guard coverage and final-error acceptance -->

## Goal / prerequisites

Phase1+2 accepted only for selected isolated fixtures. Prove real process crash/reopen, exact budgets/original window và final unchanged-source focused+affected gates. Pending; không production acceptance. [E1 contract](./references/e1-contract.md) authority; B1 unchanged. No runtime edits during frozen final gate; nếu cần sửa, regenerate manifest và rerun affected gates.

## Files to create / modify

Prefix `/home/gmo/projects/9router/`.
- Create proposed `tests/fixtures/accounting/embeddings-process.mjs`, `tests/unit/embeddings-accounting-restart.test.js`, `tests/unit/embeddings-budget-loopback.test.js`.
- Extend proposed `embeddings-loopback.js` and E1 tests with process/clock/ACK controls only; loader isolated boundary reused, no escape or broadened mounts.
- Modify existing `tests/unit/budget-activation-boundary.test.js`: add proposed `associateEmbeddingsAccountingFixture` and its sole declaring module `src/sse/services/embeddings-accounting.js` to guard coverage. If implementation uses another helper name, inventory and update every reference before freeze. Cover shipping `src/` and `open-sse/`, with a negative control through the same scanner proving a forbidden shipping import/call is rejected (synthetic in-memory/sacrificial fixture, not a real production activation). Existing guard hardcodes only budget+Chat helpers; an unchanged pass cannot certify E1.
- Create at execution (not now) `plans/reports/implementation-<date>-e1-embeddings.md`, durable `plans/reports/evidence/<date>-e1-embeddings/`, child reference `references/e1-acceptance-evidence.md` and local completion journal.
- Update child/parent and `plans/261030-1827-x1-native-responses-accounting/references/x1-owner-map.md` **only after passing** to selected E1 fixture acceptance; no other owner completed. Shared runtime fix would return to owning earlier phase + fresh gates, not silently accepted as test-only phase.

## Implementation / acceptance

1. On both Node SQLite and SQL.js, run actual private upstream POST and separate process owner. IPC barriers identify durable intent before POST, terminal commit before ACK delivery, and observed valid usage before terminal durable publication. Parent SIGKILL verified process at barriers; fresh owner reopens actual file. No async transaction callback/sleep-as-proof. Compare stored own binding/snapshot/start time/cost/window; no skipped adapter.
2. Crash after intent/no POST and after volatile-only usage follows B1 nonblocking unrecorded if no recoverable evidence and owner verified dead; never invent cost. Committed exact terminal before lost ACK remains one settled row after reopen; replay can't charge twice. Durable detected publication/coverage failure remains safety, not exempted as generic crash. Usage saved recoverably remains obligation; do not erase sidecar/gaps/bindings/known cost. Competing live writer cannot mutate DB or sidecar.
3. Actual single and batch price debit through request and authenticated budget projection. `weekly`,`monthly`,both limits: block `spent>=limit`;null unlimited,0block; raising one doesn't reset spend or override exhausted other. Two-key same model/account tests no cross-charge or coverage leak. No POST/cache-hit/bypass means no fabricated attempt/debit (route OPTIONS is direct no-inference control; no new cache feature).
4. Clock `Asia/Ho_Chi_Minh`, Monday00:00 week and first00:00 month. Attempt original startedAt before boundary, late completion after rollover/rate change, reopen+projection: previous week/current month or previous month correct. New period allows when appropriate,0stillblocks; history retained. Simultaneous requests can overshoot; next request denied. Held intent on keyA must not prevent legitimate peer settlement on keyB except documented single-writer serialization, no reservation/hard-cap promise.
5. Carry valid failed predecessor cost into fallback admission and budget projections; unknown complete/malformed safety doesn't become spend-zero admission. Authenticated GET returns exact formatting/no-store on actual E1 spend; unauthenticated read and finite-production activation remain refused. Existing auth/CSRF/staleCAS tests retained; not new key-user RBAC claim. Extend the private-fixture activation guard and prove its forbidden-E1-caller negative control. Recheck selected final upstream error status/body bytes through core and exhausted fallback, `Content-Type`-only upstream headers, refusal precedence and unchanged unassociated wrapping; do not equate raw replay with client fidelity.
6. Freeze current tracked **and untracked** source/tests/config/runtime inputs before all final batches. Batches can partition suite lists to fit runner600s; no timeout increase merely to green, no rerunning selectively to omit failures. Every batch must reference same immutable hashes including R1, config/invocation/runtime/dependency versions, no source changes between batches. After any edit all invalidated gates rerun.
7. Save raw JSON from runner-reported disposable artifact paths into durable bundle, exact commands + source-before/after, suite/assertion identities and checksum manifest. Independently verify expected collection, both adapters, no duplicate/empty/missing/extra/skipped cases. Original comparator runs on **each exact raw report**, disclose `/app/` identity caveat; independently check suite collection. Baseline unmatched IDs are not historical baseline passes. Receipt per-case maps and actual socket→raw→ledger→ownACK gates, no summed historical pass-count claim.

## Tasks

- [x] P3.1 Write process fixture+restart red cases with real IPC barriers/SIGKILL for both adapters.
- [x] P3.2 Prove intent/volatile/committed terminal restart outcomes, price/key/original-window persistence and competing-writer safety.
- [x] P3.3 Prove single/batch threshold/increase/null/zero/both/two-key actual E1 debit and API projections.
- [x] P3.4 Prove HCM weekly/monthly rollover+late original-window, overshoot and next-request refusal without reservations.
- [x] P3.5 Preserve auth/CSRF/no-store/activation-off and no-POST controls with actual spend; extend E1 fixture-helper guard with forbidden-caller negative control, retain final-error fidelity/refusal gates, and keep secret payloads out of receipts.
- [x] P3.6 Freeze source and execute all focused+affected batches on identical hashes; verify exact collection/adapters/no skips.
- [x] P3.7 Run original comparator per raw report, scoped lint, active LSP, diff checks; durably preserve raw evidence/checksums/case map.
- [x] P3.8 Review full cumulative tracked+untracked changes and Advisor; reconcile tasks/receipt/owner statuses, exclusions and next owner truthfully.

## Mandatory future runtime commands

From repo root. Newly proposed E1 files must exist first. Runner fixes config+reporter internally; results path printed by each actual run. Do not pass config/root/env overrides or ordinary Vitest.

Focused E1 (split if required without source changes):

```bash
node tests/fixtures/accounting/run-isolated.mjs unit/accounting-fixture-isolation.test.js unit/embeddings-accounting-usage.test.js unit/embeddings-accounting-pricing.test.js unit/embeddings-accounting-json.test.js unit/embeddings-accounting-transport.test.js unit/embeddings-accounting-loopback.test.js unit/embeddings-accounting-late-sink.test.js unit/embeddings-accounting-final-controls.test.js unit/embeddings-accounting-restart.test.js unit/embeddings-budget-loopback.test.js
```

Affected embeddings/pricing/service minimum:

```bash
node tests/fixtures/accounting/run-isolated.mjs unit/embeddingsCore.test.js unit/embedding-usage-persistence.test.js unit/ollama-local-embeddings.test.js unit/key-access-handlers.test.js unit/pricing-validation.test.js unit/pricing-persistence-import.test.js unit/pricing-snapshot-cache.test.js unit/pricing-snapshot-sqljs.test.js unit/accounting-exact-money.test.js unit/accounting-ledger.test.js unit/accounting-coordinator.test.js unit/accounting-persisted-authority.test.js unit/accounting-request-authority.test.js unit/accounting-budget-gate.test.js unit/accounting-budget-projection.test.js unit/accounting-budget-windows.test.js unit/accounting-crash.test.js unit/accounting-transport-boundary.test.js unit/accounting-stream-terminal.test.js unit/b1-ledger-disposition.test.js unit/b1-usage-evidence.test.js unit/b1-late-chat-sink.test.js unit/b1-terminal-failure-reopen.test.js unit/budget-activation-boundary.test.js unit/key-budget-management-security.test.js unit/default-executor-accounting-compatibility.test.js
```

Chat/R1 cumulative affected minimum (no inherited733pass claim):

```bash
node tests/fixtures/accounting/run-isolated.mjs unit/chat-accounting-json.test.js unit/chat-accounting-loopback.test.js unit/chat-accounting-stream.test.js unit/chat-accounting-stream-loopback.test.js unit/chat-accounting-final-controls.test.js unit/chat-budget-loopback.test.js unit/chat-budget-process-restart.test.js unit/chat-budget-pricing-fallback.test.js
node tests/fixtures/accounting/run-isolated.mjs unit/responses-accounting-usage.test.js unit/responses-accounting-json.test.js unit/responses-accounting-json-boundary.test.js unit/responses-accounting-pricing.test.js unit/responses-accounting-late-sink.test.js unit/responses-accounting-stream.test.js unit/responses-accounting-consumers.test.js unit/responses-stream-to-json-contract.test.js unit/responses-converter-callers.test.js unit/responses-accounting-loopback.test.js unit/responses-budget-loopback.test.js unit/responses-accounting-restart.test.js unit/responses-accounting-final-controls.test.js
node tests/fixtures/accounting/run-isolated.mjs unit/openai-responses-nonstream.test.js unit/openai-responses-terminal-event.test.js unit/openai-responses-completed-usage.test.js unit/openai-responses-usage-pivot.test.js unit/openai-responses-completion-watchdog.test.js unit/responses-abort-terminal.test.js unit/github-responses-routing.test.js
```

Expand by actual changed imports/callers; missing `cloud/` suite recorded excluded, not passed. Production build/serving/platform/UI/CLI are R gates, not run as hidden child prerequisites.

Post-run original comparator: `node tests/__baseline__/verify-no-regression.mjs <exact-raw-results.json>` for every raw report. This reads reports, not real application DB. Scoped ESLint explicit changed JS files; active LSP all changed paths; `git diff --check`. Neither successful test process nor empty diagnostics cache proves collection/completion.

## Exit / limitations

All mandatory gates both adapters on unchanged source, source/evidence integrity reviewed, no unhandled gap. E1 activation-guard negative control and selected final-error response matrix are mandatory; merely rerunning the old two-helper guard or raw-boundary-only tests is insufficient. Child becomes accepted only selected fixture profile; production OFF, no release claim, legacy presentation-persistence interactions excluded and historical realDB uncertainty unresolved. Broad activation, Bun/better-sqlite3/Windows, actual provider invoices/performance need R or separate owner. E2–E4/R2–R4/C1 remain OPEN/BLOCKED. No auto dispatch next owner, no commit/deploy, no deletion of generated artifacts. If final gates fail, report reached/unreached with exact failures, do not mark phases complete.

## Execution receipt — selected fixture scope only

Completed within the child's selected Linux Node SQLite/SQL.js fixture scope. Frozen final `b22e7657f`: 1162 reported test cases across65suites,0failed/skipped; all5isolated batches and original comparators passed. Original price, own-ACK, transport/error-fidelity, durability/budget and affected gates are mapped in [E1 evidence](./references/e1-acceptance-evidence.md). Exact commands/raw reports and1693unchanged source/input hashes are preserved in `plans/reports/evidence/261031-e1-embeddings/`. Eight audited inherited title-collision groups use exact multiplicity exceptions; new E1 identities are unique. LSP20paths inconclusive despite0diagnostics; scoped ESLint passed. No independent subagent/full-code Advisor approval claimed. Production OFF; legacy presentation/historical realDB uncertainty and all broader owner/platform/release exclusions remain. Historical future-command/pending prose above records planning, not current status.
