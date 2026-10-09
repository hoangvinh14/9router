# API key quota/budget/pricing — compaction handoff

## Mission and current status

Continue the authorized `ak-cook --auto` implementation of `plans/261003-0827-api-key-quota-budget-pricing/plan.md`. Deliver all six accepted phases, verified/reviewed, without widening scope. This is a partial checkpoint, NOT completion. Phase01 storage foundation is implemented on available Node/SQL.js runtimes with focused passing evidence, but release/runtime/integration gates remain open. Phase02 inactive pricing is substantially started, with a repaired projection regression and passing focused evidence. Phases03–06 remain unimplemented except scouting/doc preparation. No phase-level success criteria are checked complete. User explicitly asked to prepare for context compaction.

## Scope and guardrails

- Workspace: `/home/gmo/projects/9router`; plain JS/ESM, SQLite existing persistence. Root CLAUDE.md and `open-sse/AGENTS.md` authoritative. Accepted `design-contract.md` owns policy.
- Direct execution; no subagents/delegated writers/reviewers. Advisor consultations allowed/required; recent Advisor payloads withheld source so they were summary/snippet reviews, not independent code approval.
- No commit/push/PR/publish authorized or done. Preserve all intentional dirty source and existing untracked plan files; do not reset or clean.
- Enforcement stays OFF until complete rollout hooks/recovery/coverage gates. `ledgerStartedAt` is not stamped; no lifecycle injected into inference yet.
- No hard cap/reservation/daily budgets; weekly/monthly recorded-spend OR gates, fixed Asia/Ho_Chi_Minh, attempts charged at start, exact raw usage only. Missing usage unresolved, never estimated zero; strict budgeted fail-closed. Unlimited identified recording failure requires durable gap latch; failed latch denies. No-key exemption never bypasses writer ownership.
- Chat+embeddings including retries/fusion only; excluded modalities remain excluded. New management must JWT or verified direct-loopback login-disabled, reject inference tokens/remote anonymous; CSRF guard. Never weaken trusted peer/header security.

## Current state

Observed Git: branch `master`, HEAD `a99cf57239ff778b61e434c2786009d5ed1c412c`, repository root as above. No commits since opening. Root/tests dependencies installed. Runtime Node24.21.0; Bun unavailable, better-sqlite intentionally not loaded on Node24 due existing SIGSEGV warning.

Intentional tracked modifications: `open-sse/providers/pricing.js`; `src/dashboardGuard.js`; `src/app/api/settings/database/route.js`; DB driver/schema/migration registry/001 migration/all4adapters/backup/index/apiKeysRepo/pricingRepo; `tests/unit/db-migration-chain.test.js`.

New files include:
- DB: `accountingCoverage.js`, `accountingInvariants.js`, `writerOwnership.js`, `durableFile.js`, `managedRestore.js`, `adapters/nativeDurability.js`, `helpers/apiKeyBindings.js`, `migrations/002-api-key-accounting.js`, `repos/apiKeyAccountingRepo.js`.
- Pricing: `src/lib/pricing/{money,catalogJson,catalogSync,catalogMapping,referenceResolver,catalogScheduler}.js`.
- Engine: `open-sse/config/apiKeyBudgetConstants.js`, `open-sse/utils/exactUsage.js` (not wired to inference).
- Tests: `api-key-ledger`, `api-key-ledger-durability`, `api-key-database-route`, `api-key-money`, `api-key-exact-usage`, `pricing-catalog-sync`; `tests/fixtures/accounting-child.mjs`; pricing minimal and overprecision fixtures.
- `docs/API_KEY_BUDGETS.md`, plan reports/checkpoint/journal/handoff. `plans/` was untracked from start. `.pi/` contains generated task logs; do not stage indiscriminately.

Last edit before compaction: `models-dev-overprecision.json` fixture and new test in `pricing-catalog-sync.test.js` for first-sync degraded + retained last-good. NOT verified yet. The parent performed a point-in-time background inspection for handoff: runtime currently reports **no background tasks**. Earlier durable notifications/results were consumed; do not poll or assume old jobs remain running.

## Decisions and rationale

- Keep accepted integer nanoUSD/1M rate precision/range contract. Live models.dev payload contains69original >9decimal rate lexemes, e.g.0.024999999999999998; production lossless lexer confirmed them. Do NOT round/prune/introduce rational representation silently.
- A precision-choice question returned no structured selection; user then said `continue`. Continue under existing strict contract and degraded sync, NOT consent to contract change. Ask again only if truly needed, not to re-open approved decisions.
- Catalog malformed batch retains last-known-good. First-sync failure has no catalog; valid approved bundled/manual pricing still follows existing precedence, not a fake synced/free fallback. Full live coverage JSON was NOT generated.
- Valid opaque model IDs @cf/~ supported bounded/exact; provider IDs exclude slash to avoid composite key collision. Payload never executes URLs/headers/capabilities.
- Legacy pricing API remains numeric provider/model map; enforcement snapshot resolver separate. Pricing-only projection includes exact catalog-provider model prices even if registry list lags; test asserts catalog-only model does not become routable. Unsupported catalog blocks automatic flat fallback; manual override highest.
- Available-runtime Phase01 evidence permits inactive pricing work but does not mark Phase01 done. Todo p2 dependency was removed only for this explicitly labelled inactive work; p3 depends on both p1,p2.
- Journal preference true. Local journal checkpoint exists; update/create final journal at actual finalization if needed, no social/wiki publish.

## Work performed

Storage: pre-open canonical DATA_DIR writer exclusion with atomic arbitration, Linux PID incarnation/dead-owner proof, HMR global owner; adapter verified WAL/FULL or SQL.js temp/fsync/rename/dir-fsync; uncertain-write poison and timer suppression; sync-only transactions; removed raw adapter escape handles. Driver shutdown precedes adapter hooks and retains lock when own pending/health uncertain, then proven-dead restart recovers unresolved.

Schema v2: ledger/policy/audit/key-binding tables and usage ID columns; exact legacy backfill after import, no historical debit. Attempt identity/CAS/dedupe, BigInt aggregate, audited manual waiver/cost correction, late observation conflicts. SQLite triggers enforce audit append-only/target/state-cost invariants. HMAC key material in protected coverage sidecar, retired bindings preserved externally; config import preflight before retirement and validation before DELETE. Cross-file crash may safely retire keys without DB commit; not cross-file atomicity. Managed restore preserves current sidecar/gaps/tombstones, maintenance first, independent snapshot checks, audited gap acknowledgement/release separate.

Config DB route fixed presence-only CLI shortcut using exported actual validator; 409 identity conflicts and unexpected error redaction.

Pricing: lossless bounded JSON parser with private Symbol numeric tokens; BigInt money one half-up round; manual/synced/provider/free/canonical exact snapshot provenance; streamed20MiB/15s fixed HTTPS/no redirects; durable snapshot/sync health; HMR single-flight; scheduler24h defaultoff (startup/admin settings wiring pending). Raw exact helper establishes Claude uncached-input vs OpenAI/Gemini inclusive-cache and subset/extra reasoning; rejects estimated/partial/bad/audio/1h-cache/tool-use semantics. Legacy explicit-zero fallback corrected. Existing estimation/client canonicalization untouched.

One new regression: synced Anthropic model omitted because projection iterated stale local registry models. Repaired exact provider-price projection; narrow22tests passed. Subsequent prior-revision jobs repeated old failure, not failed repairs. Identifier live-audit bug @cf/~ fixed; monetary incompatibility remains degraded intentionally.

## Verification

Pre-edit full suite: `/tmp/9router-budget-baseline-2HpAgS/` with results.json, intended-files.txt, failure-inventory.json, source revision.328files all reported;2960pass/99fail/98pending/1todo,39failed files including6without failed assertion; node:test outcomes not fully represented. Baseline comparator is false-green on collection errors and must be repaired in Phase06 before any full no-regression claim. A test without live gating made a public call; do not deliberately repeat it. Generated golden URL snapshot moved to baseline artifacts, not accepted into source.

Passing historical source-specific evidence:
- `/tmp/9router-phase1-results.json`:75pass/0fail, ledger21,durability17,database-route4,dashboard24,driver3,migration6. Lint0errors/1existing001warning.
- `/tmp/9router-sqljs-gates.json`:46pass/0fail (ledger22,durability18,migration6), real SQL.js full schema backup/policy/ledger/audit/meta/bindings/triggers+sidecar independently Node read-only integrity and reopenedSQL.js, timer/unhealthy-close/reopen.
- Owned-ledger SIGKILL intent/settlement and SIGTERM restart passed in `/tmp/9router-orphan-verification.json`72/0.
- Separate existing concurrency runs fail only two pre-edit assertions (100usagewrites/daily summary); matching identities are scoped evidence, not full comparator pass.
- `/tmp/9router-price-repairs-results.json`:51pass/0fail sevenpricing/usage files; clean scoped ESLint. This precedes latest @cf/~ fixture and overprecision rejection test.
- `/tmp/9router-price-map-repair.json`:22pass/0fail map repair.
- `/tmp/9router-pricing-raw-results.json`:42/0 raw usage/adjacent compatibility, older revision.
- `/tmp/9router-price-latest-results.json`:49pass/1fail on pre-repair projection; do not claim this passed.
- Active LSP probes10storage and9pricing files clean; directory-as-file initialprobe incomplete corrected.
- `git diff --check` passed.

Live public source: `/tmp/9router-models-dev.json` HTTP2005311759bytes226providers8385models. `/tmp/9router-catalog-invalid-lexemes.json` has69original invalid precision literals. No `/tmp/9router-pricing-coverage.json` exists. Live audit failed; current sync incompatible/degraded, last-good retention policy intact. Temp artifacts are machine-local; rerun if unavailable. New overprecision test not run. No production DATA_DIR or real inference credentials used intentionally. No build/full final suite/UI QA yet.

## Open risks and blockers

- Plan is incomplete; Phases03–06 not implemented. Native Bun/better runtime evidence not-run and release-blocking; power-loss/fsync-platform assumptions not proven by SIGKILL.
- Phase02 live sync degraded by source precision; strict contract retained. Need honest inventory/coverage matrix (not validated live prices), tests for degradation and final source-stable lint/regression.
- Manual PATCH route still numeric-only validation; decimal UI/changed-only/inherit/reset/sync metadata not updated. Scheduler not wired. Legacy complete override validation changes may expose consumer issues; actual route/UI tests required.
- Unsupported tiers/audio/long context cannot be flat charged automatically; snapshots need complete policy/provenance. Review canonical/offline approval carefully (no suffix guesses).
- Dispatch inventory preliminary; specialized binary/HTTP2/CLI/retry/control planes all require body review, exactly-one-owner hooks, per-route fixtures and raw usage before estimates. No implicit phase completion.
- Advisor often could not see exact source due disclosure settings; no independent red-team/review claimed. Direct parent owns inline security/compatibility fixes.
- Original88h estimate not re-estimated; no deadline commitment.

## Exact next actions

1. **First safe step**: read this handoff and `plan.md` checkpoint, verify Git HEAD/status against current repo. Preserve dirty work; inspect current tests/modules before edits.
2. Run latest isolated pricing checks/lint including new overprecision fixture. Use bg_run for long commands, yield for native notifications; no poll/sleep. Example: `(cd tests && HOME=$(mktemp -d) DATA_DIR=$(mktemp -d) ./node_modules/.bin/vitest run unit/api-key-money.test.js unit/api-key-exact-usage.test.js unit/pricing-catalog-sync.test.js unit/provider-pricing-minimax-m3.test.js unit/cached-token-usage.test.js unit/extract-usage-cache-shapes.test.js unit/openai-responses-usage-pivot.test.js --maxWorkers=1 --reporter=json --outputFile=/tmp/9router-price-resume.json)`; scoped ESLint on pricing repo/modules/new enginehelper/tests.
3. Record degraded original-literal live sync and last-good tests honestly. Create coverage inventory from raw catalog/mappings labelled **unvalidated live inventory**, or use approved valid fixtures/offline mapping evidence; do not prune/round to make sync pass. Ask user only for material contract change if needed.
4. Finish Phase02 strict snapshot/legacy API tests and scheduler preparation. Review with Advisor before acceptance, link exact current tests. Leave remaining unsupported/runtime/UI gates open; re-estimate after full dispatch inventory.
5. Implement Phase03 windows/errors/service/identity/analytics/recovery tests; preserve credential precedence/disabled key policy, unlimited durable-gap exception, no network serialization/reservations. Keep no activation until hooks/recovery ready.
6. Full Phase04 dispatch inventory then per-attempt optional injected hooks, failed retry settlement before next attempt, raw stream usage/cancel sinks, fusion collected-only barrier/stragglers/regeneration; all formats/embeddings. No engine import of app budget DB.
7. Phase05 strict management auth/CSRF/error envelopes + UI actual desktop/mobile verification; phase06 comparator repair/negativefixtures, regression/build/security/rollout/docs/journal. Commit/publish only if newly authorized.
8. Reconcile files-first plan checkboxes and todo; CLI plan ID `9router/261003-0827`. Status remains in-progress; do not blindly check/complete all phases.

## Source pointers

- Accepted contract/6phase files: `plans/261003-0827-api-key-quota-budget-pricing/`.
- Storage evidence: `reports/implementation-evidence.md` under plan.
- Pricing evidence: `reports/pricing-evidence.md` under plan.
- Partial dispatch inventory: `reports/dispatch-inventory.md` under plan (body findings on base/chatCore/embeddings/stream/fusion).
- Foundation guide: `docs/API_KEY_BUDGETS.md` explicitly unfinished.
- Journal: `plans/journals/2026-10-03-api-key-accounting-foundation-and-inactive-pricing-checkpoin.md`.
- Units: https://raw.githubusercontent.com/anomalyco/models.dev/dev/README.md; schema `packages/core/src/schema.ts` same repo. Gemini https://ai.google.dev/api/generate-content#UsageMetadata; OpenAI https://developers.openai.com/api/reference/resources/completions; Claude prompt-caching tracking fields.
- Pi tooling policy in developer context; no Pi docs needed unless user specifically asks about compaction implementation.
