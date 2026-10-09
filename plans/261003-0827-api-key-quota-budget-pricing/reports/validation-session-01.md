# Validation Session 1 — source verification (2026-10-03)

## Boundaries

Validation-only, direct parent inspection, no delegated reviewer. HEAD `a99cf57239ff778b61e434c2786009d5ed1c412c`, branch `master`, initial working tree `?? plans/`. All design/phase files, linked brainstorm/prior validation, architecture and engine instructions read. No source implementation, production DB access, live credential calls, dependency installation, build or application test suite. Proposed Create paths are not missing-source failures.

Full tier: Fact Checker, Flow Tracer, Scope Auditor, Contract Verifier; **15 sampled claims per phase, 90 total**. VERIFIED below means source fact/path or explicit documentary contract/dependency verified, not that proposed behavior is implemented. UNVERIFIED denotes future evidence gates. FAILED denotes an actual omission/conflict in the incoming plan; approved plan corrections resolve instructions, not application defects.

## Claim ledger

| ID | Lens | Claim checked | Result / evidence |
|---|---|---|---|
| 1.01 | Fact | Schema currently v1 | VERIFIED — `src/lib/db/schema.js:6`. |
| 1.02 | Fact | Stable key ID field exists | VERIFIED — `src/lib/db/repos/apiKeysRepo.js:7,34`. |
| 1.03 | Contract | Key validator returns boolean | VERIFIED — `apiKeysRepo.js:70-74`; preserve wrapper. |
| 1.04 | Fact | Current usage schema stores raw key | VERIFIED — `src/lib/db/schema.js:109-129`. |
| 1.05 | Flow | Versioned migrations precede additive sync/import | VERIFIED — `src/lib/db/migrate.js:246-255`; import branch returns at end, backfill must handle both paths. |
| 1.06 | Scope | Migration idempotence tracks adapter instances | VERIFIED — `migrate.js:15,217-219` WeakSet, not request-scoped. |
| 1.07 | Flow | SQL.js persistence is deferred | VERIFIED — `sqljsAdapter.js:22,30-38`. |
| 1.08 | Flow | SQL.js timer/shutdown flush suppresses errors | VERIFIED — `sqljsAdapter.js:36,114`. |
| 1.09 | Scope | Driver survives Next HMR globally | VERIFIED — `driver.js:4-5`. |
| 1.10 | Fact | All four native/fallback adapter targets exist | VERIFIED — `src/lib/db/adapters/{bunSqliteAdapter,betterSqliteAdapter,nodeSqliteAdapter,sqljsAdapter}.js`. |
| 1.11 | Scope | Blocking only budgeted admissions is sufficient writer protection | FAILED — `driver.js:60-76` loads/migrates DB first; `sqljsAdapter.js:24-37,106-118` any writer can export whole state. Revised to pre-open exclusion of all writes. |
| 1.12 | Contract | Generic backup paragraph covers configuration import/export | FAILED — `db/index.js:71-94` excludes accounting/meta, `:96-179` replaces keys; explicit import/export contract/route ownership absent. Revised. |
| 1.13 | Scope | Preserving tables makes legacy-binary inference downgrade safe | FAILED — incoming restore wording omitted recording coverage; current source has no ledger/hooks. Revised management-only downgrade + gap reconciliation. |
| 1.14 | Flow | Native/SQL.js durable acknowledgement proven | UNVERIFIED — existing PRAGMA `synchronous=NORMAL` (`schema.js:10`); new fsync/crash tests not implemented. Phase 01/06 gate. |
| 1.15 | Flow | Lightweight SQL.js backup round-trip proven | UNVERIFIED — `backup.js:44-62` ATTACH copy, not demonstrated persisted filesystem artifact. Phase 01 gate strengthened. |
| 2.01 | Fact | Pricing repo exists | VERIFIED — `src/lib/db/repos/pricingRepo.js:1`. |
| 2.02 | Scope | Pricing manual namespace/cache is process-local | VERIFIED — `pricingRepo.js:5-12` scope `pricing`, TTL cache; mutations invalidate. |
| 2.03 | Flow | User override lookup precedes constants | VERIFIED — `pricingRepo.js:51-56`. |
| 2.04 | Flow | Merged GET uses field merging | VERIFIED — `pricingRepo.js:24-45`; enforcement must select separate complete snapshot. |
| 2.05 | Contract | All price mutation methods exist | VERIFIED — `pricingRepo.js:60,80,106`; reset manual namespace. |
| 2.06 | Fact | Bundled provider, canonical and pattern prices exist | VERIFIED — `open-sse/providers/pricing.js:410-433`. |
| 2.07 | Flow | Explicit free namespace precedes canonical fallback | VERIFIED — `pricing.js:419`. |
| 2.08 | Flow | Legacy math loses explicit zero fallback rates | VERIFIED — `pricing.js:477,486,490` truthy fallback. |
| 2.09 | Flow | Legacy cost uses floating-point dollars | VERIFIED — `pricing.js:460-494`. New BigInt module proposed. |
| 2.10 | Contract | Canonical prompt includes cache subsets | VERIFIED — `usageTracking.js:148-216`. |
| 2.11 | Flow | Raw extraction is distinct from estimation APIs | VERIFIED — `usageTracking.js:239-337, estimateUsage` and `stream.js:233-236,394-396`. |
| 2.12 | Fact | Existing pricing/cache regression tests exist | VERIFIED — four existing unit targets in phase 02 checked on disk. |
| 2.13 | Scope | Sync source/mapping files are proposed, not registry edits | VERIFIED — phase 02 Create ownership, design pricing-only; generated registry untouched. |
| 2.14 | Fact | models.dev rate units/coverage validated for all models | UNVERIFIED — incoming plan explicitly defers first-party units/coverage fixture to phase 02; no live fetch in this validation. |
| 2.15 | Flow | Node/Bun runtime HTTP client can sync catalog | UNVERIFIED — prior report describes differing client behavior, no current runtime evidence. Future phase gate retained. |
| 3.01 | Fact | Auth wrapper is boolean | VERIFIED — `src/sse/services/auth.js:364-366`. |
| 3.02 | Flow | Chat validates only when requireApiKey enabled | VERIFIED — `src/sse/handlers/chat.js:72-82`. |
| 3.03 | Flow | Embeddings has same optional validation | VERIFIED — `src/sse/handlers/embeddings.js:56-66`. |
| 3.04 | Fact | Accounting constants/service/windows are proposed | VERIFIED — phase 03 Create paths, no claimed existing symbol. |
| 3.05 | Flow | Usage persistence is fail-open | VERIFIED — `usageRepo.js:242-314` try/catch logging. |
| 3.06 | Flow | Analytics reprices every save | VERIFIED — `usageRepo.js:247`; snapshot path must bypass. |
| 3.07 | Contract | Existing dedupe uses timestamp/token tuple | VERIFIED — `usageRepo.js:258-281`. |
| 3.08 | Scope | Daily analytics grouped by raw key | VERIFIED — `usageRepo.js:80-94,504-520`. |
| 3.09 | Contract | Usage-history reader exposes masked key | VERIFIED — `usageRepo.js:317-333`; new ID contract additive. |
| 3.10 | Scope | Stats output keys can retain raw identity | VERIFIED — `usageRepo.js:641-649`; redaction must inspect object keys too. |
| 3.11 | Fact | Attribution fixture exists and uses temp DATA_DIR | VERIFIED — `tests/unit/usage-api-key-attribution.test.js:10-14`; runtime isolation still must be asserted. |
| 3.12 | Contract | Weekly/monthly fixed TZ/no reservation consistent in all phases | VERIFIED — design + phases 01-06 documentary sweep, existing policies unchanged. |
| 3.13 | Contract | Gemini keys resolve identically at guard and handler | FAILED — `dashboardGuard.js:142-149` includes google/query, `auth.js:345-358` only Bearer/x-api-key. Revised shared precedence + route tests. |
| 3.14 | Scope | Unlimited availability vs durable recording failure unambiguous | FAILED — incoming design says all intents ack before fetch, yet fail-closed scoped budgeted and unlimited compatibility. User chose durable-gap exception; reject if latch fails. |
| 3.15 | Flow | New calendar/CAS/gap algorithms validated at runtime | UNVERIFIED — proposed modules/tests not written; boundary, race, outage fixtures remain acceptance gates. |
| 4.01 | Flow | Chat handles nested combo/capacity routing | VERIFIED — `chat.js:110-167,180-222`. |
| 4.02 | Flow | Chat app passes raw apiKey to core | VERIFIED — `chat.js:270-281`. |
| 4.03 | Flow | Core has initial and refresh execution | VERIFIED — `chatCore.js:376,445`. |
| 4.04 | Flow | Base internal retry occurs after network attempt | VERIFIED — `base.js:146-179`; lost response usage must settle before retry. |
| 4.05 | Flow | Codex re-enters base execution | VERIFIED — `codex.js:277-295`. |
| 4.06 | Flow | Embeddings initial/refresh fetch boundaries exist | VERIFIED — `embeddingsCore.js:64,99`. |
| 4.07 | Flow | Embedding app only persists successful exact usage | VERIFIED — `embeddings.js:130-148`. |
| 4.08 | Fact | Stream/forced JSON/nonstream targets exist | VERIFIED — `chatCore.js:501-516` and owned handler files. |
| 4.09 | Flow | Estimation may replace usage object | VERIFIED — `stream.js:236,396`. |
| 4.10 | Scope | Executors and default cache are shared singletons | VERIFIED — `executors/index.js:31-80`; context must be local args, never `this`. |
| 4.11 | Flow | Local failures otherwise reach cooldown | VERIFIED — `chat.js:327-345`, `embeddings.js:149`; new terminal branch required. |
| 4.12 | Fact | Existing combo/embedding/Responses test targets exist | VERIFIED — phase 04 verification list checked. |
| 4.13 | Contract | All Gemini chat error/abort wrappers owned | FAILED — `v1beta/models/[...path]/route.js:100-104` no original signal, `:428-429,457,524` pass/drop OpenAI errors; absent ownership. Revised. |
| 4.14 | Flow | All panels settled / one-answer response reused before next dispatch | FAILED — `combo.js:479-524` live ignored stragglers, `:616-618` generates again. Incoming settlement barrier ambiguous; revised collected-only barrier, retained quorum and separately gated regeneration. |
| 4.15 | Flow | Every specialized billable seam fully metered | UNVERIFIED — network scan found 27 fetch/HTTP2 matches in 13 executor files; complete semantic inventory/fixtures remains phase 04 preflight, not source coverage proof. |
| 5.01 | Fact | Key route GET/PUT/DELETE exists | VERIFIED — `src/app/api/keys/[id]/route.js:5,20,44`. |
| 5.02 | Fact | Endpoint key manager path exists | VERIFIED — `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js:251,621,646,664`. |
| 5.03 | Fact | Pricing page exists and loads price map | VERIFIED — `src/app/dashboard/settings/pricing/page.js:21`. |
| 5.04 | Contract | Pricing GET is bare merged map | VERIFIED — `src/app/api/pricing/route.js:9-12`. |
| 5.05 | Contract | Pricing PATCH accepts numeric fields | VERIFIED — `pricing/route.js:52-69`; finite/precision hardening proposed. |
| 5.06 | Contract | Pricing DELETE resets manual prices | VERIFIED — `pricing/route.js:94-108` + pricing repo scope. |
| 5.07 | Scope | Guard is deny-by-default, not protected-prefix enforcement | VERIFIED — `dashboardGuard.js:229-234`; PROTECTED_API_PATHS definition unused in that branch. |
| 5.08 | Contract | New nested route paths are Create/proposed | VERIFIED — phase 05, no new source existence claimed. |
| 5.09 | Scope | New recovery audit cannot include prompts/secrets | VERIFIED — consistent documentary contract, not implementation proof. |
| 5.10 | Contract | Paging/CAS/version limits explicitly specified | VERIFIED — phase 05 API contract default50/max200,409 and design. |
| 5.11 | Flow | Gemini wrapper can replace response headers | VERIFIED — `v1beta/models/[...path]/route.js:509-516`; expose/no-store tests must reach route. |
| 5.12 | Fact | Existing peer/guard regression tests available | VERIFIED — `tests/unit/dashboard-guard.test.js`, `local-request-peer-trust-3294.test.js`. |
| 5.13 | Contract | Current guard excludes CLI tokens from budget admin | FAILED — `dashboardGuard.js:232` admits CLI token for any non-public API. Revised route-level auth guard. |
| 5.14 | Contract | requireLogin=false management implies trusted local only | FAILED — `dashboardGuard.js:187` has no peer restriction. Revised new-route guard; unrelated APIs not rewritten. |
| 5.15 | Contract | Existing pricing modal preserves override precedence after sync | FAILED — `PricingModal.js:57` submits entire merged map, `:155` missing ->0, `:81-83` reset bundled. Ownership/tests added; changed-only/inherit/no-op behavior. |
| 6.01 | Fact | Baseline path hardcodes /app/ | VERIFIED — `verify-no-regression.mjs:17`. |
| 6.02 | Fact | Provider baseline scripts exist | VERIFIED — verify-providers.mjs, verify-alias.mjs, verify-oauth-urls.mjs on disk. |
| 6.03 | Contract | Tests are independent ESM/vitest package | VERIFIED — `tests/package.json`, `tests/vitest.config.js:1-37`. |
| 6.04 | Scope | Test aliases resolve src/open-sse from repo | VERIFIED — `vitest.config.js:29-33`. |
| 6.05 | Fact | Architecture doc is stale about db.json | VERIFIED — `docs/ARCHITECTURE.md` persistence vs `db/paths.js:5-6`; doc update narrowly owned. |
| 6.06 | Contract | Brainstorm has 13 AC, all mapped in phase06 | VERIFIED — brainstorm acceptance list + phase06 mapping. |
| 6.07 | Scope | New tests must pass separately from known-red suite | VERIFIED — phase06 focused gate, all phase instructions. |
| 6.08 | Contract | No implementation status claimed complete | VERIFIED — all phase frontmatter todo; plan pending/unchecked. |
| 6.09 | Fact | Existing Modify source paths and local links resolve | VERIFIED — path/link sweep; wildcard/proposed files excluded appropriately. |
| 6.10 | Scope | Six sequential dependencies are acyclic | VERIFIED — phase dependencies, effort sum 88h provisional. |
| 6.11 | Contract | Scope excludes billing/reservation/nonchat modalities | VERIFIED — design + all phases/brainstorm, no scope extension approved. |
| 6.12 | Flow | Comparator catches failed suites without assertions | FAILED — synthetic JSON testResults[{status:failed,message:collection error,assertionResults:[]}] exits0, prints no regression. Confirmed locally; revised gate/tests. |
| 6.13 | Contract | Keeping tables guarantees safe rollback coverage | FAILED — phase06 runbook lacked no-legacy-inference/managed-latch condition. Revised managed restore/downgrade wording across design/phase01/06. |
| 6.14 | Flow | Four-adapter crash/latency/query gates have run | UNVERIFIED — no implementation; future runtime/CI matrix. |
| 6.15 | Flow | New UI/native client/full suite/build gates have run | UNVERIFIED — no implementation; future evidence not fabricated. |

## Results

- Claims checked: **90** (15/phase).
- VERIFIED: **70** | FAILED incoming instructions: **12** | UNVERIFIED future runtime/external gates: **8**.
- Failures grouped into approved corrections: ownership/downgrade/import safety; unlimited outage policy; Gemini identity/wrapper; fusion lifecycle; admin authorization (CLI/local); pricing modal; baseline collection errors. Some findings affect multiple phases, so claim counts are not unique issue counts.
- After approved documentary propagation: unresolved plan failures **0**; runtime/external gates still **8 pending**, not pass claims. No unsupported automatic restore guarantee.

## Explicit consumers and lifetime inventory

### Key/auth interfaces (preserve boolean wrappers)

`isValidApiKey` has **10 production call sites**, excluding its definition: `src/sse/handlers/{tts.js:40,chat.js:77,videoGeneration.js:49,stt.js:52,imageGeneration.js:42,systemone.js:52,search.js:54,fetch.js:57,embeddings.js:61}` and `src/app/api/v1beta/models/[...path]/route.js:189` (TTS branch). DB `validateApiKey` runtime consumers: `src/dashboardGuard.js:154`, `src/sse/services/auth.js:366`. Separate Kiro upstream credential validation is unrelated. Re-exports: `src/lib/db/index.js:32`, `src/lib/localDb.js:13`, `src/models/index.js:36`; new accounting imports remain canonical.

### Routing interfaces

Six app `handleChat` call sites: `src/app/api/v1/chat/completions/route.js:33`, `v1/messages/route.js:34`, `v1/responses/route.js:29`, `v1/responses/compact/route.js:36`, `v1/api/chat/route.js:34`, `v1beta/models/[...path]/route.js:106`. One app `handleEmbeddings`: `v1/embeddings/route.js:20`.

Core production callers: `src/sse/handlers/chat.js:270`, `open-sse/handlers/responsesHandler.js:37`; embeddings core: `src/sse/handlers/embeddings.js:120`. `open-sse/index.js:67` re-exports core. Optional new hooks preserve standalone responses handler and existing core unit/live tests; live tests not authorized here. `getExecutor` registry/default cache are global across requests: no accounting mutable fields on executor instances.

### Pricing interfaces

Two `/api/pricing` UI consumers: `src/app/dashboard/settings/pricing/page.js:21` (GET) and `src/shared/components/PricingModal.js:20,54,79` (GET/PATCH/DELETE). App pricing lookup: `usageRepo.js:139` -> `pricingRepo.js:51-56` -> `open-sse/providers/pricing.js:410`. Cost: `usageRepo.js:146` -> `calculateCostFromTokens`. Re-exports in DB barrel/shim; tests include cached-token-usage, cline-free-tier-models, claude-sonnet-5-5, codex-gpt6-lite, db-sqlite-vs-lowdb. Keep legacy signatures/map shape; new exact resolver/snapshot separate, changed-only modal avoids manual pinning.

### Import/export/backup

`src/app/api/settings/database/route.js:19,33` calls export/import; localDb re-export preserved. `src/lib/db/index.js:103-111` deletion must be preceded by collision validation; historical accounting and gap/meta cannot be erased. `backup.js:39-62` generic table copy is not physical restore detection. DB initialization global/HMR state; writer ownership before initialization, not per-request.

## Executed checks and limitations

1. HEAD/branch/status verified; all existing Modify targets and existing phase test references checked; proposed Create targets not executed.
2. Local Markdown links resolved; dependencies/phase statuses checked.
3. Synthetic comparator probe run with a temporary JSON file only, **no application imports or DB**. Command `node tests/__baseline__/verify-no-regression.mjs <temporary-json>` returned exit0 for a failed suite with zero assertions. This is defect evidence, not suite success.
4. Source searches include `proxyAwareFetch`, fetch and HTTP/2; **27 matches in 13 executor files**, semantic billable/control-plane classification not finished and correctly gated by phase04 inventory.
5. Advisor reviewed validation direction. User answered four concrete decisions; exact interview recorded in plan.md. Advisor is advisory, not independent source/test attestation.
6. No runtime durability/native envelope/UI/catalog coverage claims established. All must be verified during implementation in isolated DATA_DIR/fixtures.
7. `AK_NO_AUTO_UPDATE=1 ak plan validate plans/261003-0827-api-key-quota-budget-pricing --json --no-interactive` returned `kind=plan.validate`, `data.valid=true`, `errors=null`. This verifies plan-directory format only; not architecture/runtime correctness.

## Advisor completion review and final sweep

Advisor recommended **conditional Phase 01 entry**, not technical sign-off; its context did not include full file contents, so it explicitly could not independently confirm source/claim ledger. Followed boundary clarifications: ownership/schema/maintenance/corrupt-required-sidecar precedence deny (no unlimited exception); freeze/read generation -> DB audit durable -> sidecar CAS fsync ack; crash after audit remains blocked/replayable; maintenance clear separate. Managed restore retains current generation/retired-key tombstones/protected stable fingerprint key; missing/mismatched artifacts blocked, no silent clean regeneration or reactivation. Trusted loopback tied to authenticated socket-peer/custom-server boundary, not proxy loopback/client headers. Fusion client completion distinct from accounting terminal. Comparator repair/negative fixtures prerequisite to trusting regression; phase 01 captures raw pre-edit baseline first.

Whole-plan reread completed after these refinements: plan.md, design-contract.md, six phases. Links/Modify paths/dependencies/status/counts checked again. Parent documentary sweep found **0 remaining contradictions**, not proof of implementation correctness; eight explicitly unverified runtime/external claim groups remain gates. Original 88h remains provisional and requires revised estimate. No source files or implementation statuses changed.

**Recommendation:** structurally valid and documentarily reviewed; conditionally ready to begin Phase 01 preflight/tests when user explicitly authorizes implementation. Do not enable enforcement or release until all execution evidence gates pass. No cook/commit/publish performed.
