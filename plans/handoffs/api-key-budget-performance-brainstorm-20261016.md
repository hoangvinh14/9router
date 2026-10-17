# HANDOFF: API-key budget performance blocker — fresh-context brainstorm

## Superseding decision — direction A approved, 2026-10-16

The requested brainstorm is complete. Operator agreed to **direction A**, asked for the plan to be updated first, and will resume execution separately. Current authority: [plan decision](../261003-0827-api-key-quota-budget-pricing/plan.md#approved-direction-a-20261016) and [bounded nested-fusion execution contract](../261003-0827-api-key-quota-budget-pricing/reports/package-b-remaining-work.md#direction-a-fusion-20261016).

**Next resume:** read those sections, reconcile workspace/gates, then diagnose nested-fusion inner completion ACK → outer judge/regeneration and routing drift within B. This is a bounded exception to F-before-G, not whole G activation. Do not restart the performance brainstorm or another optimization by default. F/performance remains BLOCKED; original bytewise5s/producer failures/all13AC remain open; no consistency/authority redesign, deadline/prewarm/check reduction or activation approved.

This update is documentation only: no implementation/test/benchmark/delegation/commit/push/live calls/production DB operations. Read-only brainstorm verified HEAD094e2d61 and exact1865source/test preflight hashes; local docs changes are additional unpublished WIP. Reconcile live state when resuming, not this capture alone. The sections below retain the original intake and failure evidence; their “now/next” wording and task-not-yet-selected statements are historical after this decision. Safety/product invariants and failed receipts remain binding.

## Mission and current status (original brainstorm intake)

User request: “tạo handoff mô tả vấn đề, tôi sẽ clear context rồi brainstorm riêng”. **Next session is a separate, bounded brainstorm, not automatic implementation or another optimization attempt.**

Product mission remains the whole accepted API-key quota/budget/reference-pricing feature, not merely a green isolated test:
- Correct per-upstream-attempt intent, raw usage, immutable original reference price and own delivered terminal ACK across retries, fallback/capacity, fusion panel/judge/regeneration, supported formats and chat-embedded tools/media.
- Usable management/UI, dual weekly/monthly budgets, calendar reset, restart, audited recovery, durable persistence and managed restore, with integrated evidence.

Done: accumulated WIP published as two checkpoint commits; latest fresh-HMAC experiment evaluated, rejected and fully removed. No active gate/diagnostic is left running from this work.

Remaining: mandatory bytewise5s gate and producer timeouts, whole-feature integration, all13acceptance criteria. **Feature NOT complete; enforcement/public/synchronous activation OFF.** Historical A closure does not close the whole feature; B/F remain incomplete and later integrated packages remain open. No completion percentage/ETA supported.

Assistant process lesson: it stopped all work after a performance candidate failed. That was too broad. Separate this blocker from independently executable routing/fusion/management/recovery acceptance work; do not assume every remaining item depends on bytewise performance. This handoff does not select those implementation tasks yet.

## Scope and guardrails

Workspace: `/home/gmo/projects/9router`.

In scope now: understand the demonstrated blocker, compare materially new design options, identify the smallest discriminating evidence and clearly state any required decision. Read existing reports before proposing anything.

Out of scope now: implementation, new benchmarks/profiling, unchanged test reruns, delegation, live billable calls, production DB operations, activation, merge/release, automatic commit/push. Handoff creation alone grants none of these. Prior checkpoint publication permission was exercised for two specific WIP commits, not blanket future publication.

Constraints:
- Preserve unrelated/local WIP; never blanket-stage, reset, clean or discard it.
- Do not increase deadlines, weaken assertions, prewarm, move setup/work outside measured deadlines, coalesce bytewise pushes, split tests to hide a timeout, or rerun unchanged gates until green.
- Keep dequeue/pre-POST/post-yield, push/callback/finish, resource, pricing, terminal and own-delivered-ACK boundaries. A settled row is NOT a delivered ACK.
- Do not cache authorization, SQL rows, coverage views or freshness across boundaries; no broader shared binding/writer/coverage frame inferred from prior approvals.
- Synchronous/no-await code is not atomic across files/SQL/processes/reentry. Entry/final equality cannot detect every intermediate ABA/read error, and later refusal cannot undo earlier effects.
- Diagnostics, micro wins, native-only results and focused green cannot waive failed pipeline/integrated acceptance. Unsupported refusal proves safety, not delivered supported functionality.
- Freeze source/tests during gates; use disposable HOME/DATA_DIR, dummy loopback and real asserted adapter for any later approved test.

Safety boundaries: security-first; no credentials, prompts, resource URLs or protected binding material in reports/logs/ledger. Audit authentication/current bindings, SSRF/redirects, restore provenance and ACK identity. No security certification from secret scans alone.

Accepted product invariants to preserve:
- Stable gateway key identity; weekly AND monthly recorded-spend budgets; null unlimited, zero blocks; edits/toggle/re-enable do not erase spend. No reservations/hard-cap promise.
- Asia/Ho_Chi_Minh Monday00:00 and monthday1 windows; attempts settle against original startedAt windows, unresolved survives reset, ledger is not deleted.
- Possibly billable attempts own durable intent before POST; unknown usage remains unresolved/null cost, never guessed zero. Original prices never silently reprice after drift. Fresh successor gate; duplicate/late settlement idempotence and fusion late sink without quorum/grace changes.
- Only typed observed embedded-tool fees; no blanket client-tool fees or standalone endpoint scope creep. No byte/duration/FPS-derived token guesses.
- Poison uncertain persistence; audited recovery/managed stop-writer restore; actual supported-adapter proof required.

## Current state

Live read-only Git probes at2026-10-16T13:18:34+07:00:
- Repository/root verified: `/home/gmo/projects/9router`.
- Branch: `feat/api-key-quota-budget-pricing`.
- HEAD: `094e2d61ecaeb424a7dff12a9ba9b54e43da51d1`.
- Local vs last-known upstream:0ahead/0behind. No new fetch during handoff; do not confuse local refs with a fresh network verification.
- Earlier completed publication task `be0f2e00b` exit0 plus independent `git ls-remote` verified the remote branch exactly at this HEAD. Receipt `.pi/checkpoint-publish-result.json`.
- Working tree intentionally dirty, no staged changes at last experiment verification.

Changed tracked file (unrelated, preserve):
- `tests/unit/kimchi-strip-reasoning.test.js`.

Untracked before this handoff write:
- `.pi/` — diagnostics, profiles, backups, receipts; not default push content.
- `plans/261003-0827-api-key-quota-budget-pricing/reports/fresh-hmac-candidate-20261016.md` — latest rejected experiment report, local/unpublished.
- `plans/reports/cache-miss-investigation-20261011-pi-9router.md` — unrelated.
- `plans/reports/omniroute-session-affinity-account-rotation-comparison-20261011.md` — unrelated.
- `tests/translator/__snapshots__/golden-url-header.test.js.snap` — excluded generated snapshot.
- This handoff is an additional new local Markdown file after capture.

Intentional local modifications: yes. No optimization candidate remains in product/tests. Latest restoration independently rehashed twice against1865preflight with no changed/added/missing source/test inputs. This1865dictionary covers `.js/.mjs/.json` under open-sse/src/tests excluding node_modules, NOT every Git file or a general security guarantee.

## Decisions and rationale

- WIP backup, not release — `84125068` preserves168code/test files and `094e2d61`42documentation files. Secret scans empty; excluded WIP intact. No merge/activation. Reference: checkpoint report.
- Original independent audio/video permissions retained — private/raw grant Booleans defaultfalse and exact mode equality; video modes require six independent grants even when media absent. Old modes cannot launder new grants. Reference: owned-inline-video composition report.
- Narrow B permission was one full private current-authority verification per logical boundary followed by five independent grants; NOT general frame C or cross-boundary cache. B passed producer positives but failed original bytewise and was restored. No B consolidation remains.
- Conditional one-resource coverage-view experiment was explicitly risk-reviewed/approved once, then failed bytewise and was restored. Approval exhausted, not permission for another variant or broader consistency weakening. No provenance-adapter/lazy-betterSQLite/coverage-frame code remains.
- Fresh-per-call HMAC used a genuinely new source-linked mechanism without caching/check reduction, passed focused controls but failed mandatory bytewise. Rejected, not retained merely for micro wins.
- Broad failures remain failures. Repaired test precondition is not passing full positive continuation. Instrumented reached assertions are not uninstrumented acceptance.
- Need brainstorm, not endless local timing variants — no supported next performance candidate currently established; not a proof that satisfying the contract is impossible.

## Work performed

### Published continuation

Checkpoint publication included original-wire Claude/Gemini accounting, embedded tool/media rates, Gemini owned upload/lifecycle/provenance/capabilities, original price/usage/own-ACK wiring, related pricing UI/recovery code and tests. Retained validator-return security fix avoids reading arbitrary foreign `.then`; genuinely rejected Promise observed through native Promise machinery. Full acceptance remains open.

### Prior rejected approaches — do not silently repeat

| Approach | Scoped evidence | Decisive failure / current state |
|---|---|---|
| Filesystem/read and snapshot construction variants | Some semantic/micro controls passed | Original bytewise remained red; reverted. Historical architecture report records two filesystem candidates. |
| Fresh original equality without extra snapshot |4semantic controls,1000differentials/0mismatch,micro faster | Producer0pass2fail; JSON5s/body9062ms,SSE STACK_TRACE_ERROR/body6563ms; restored. |
| Refresh-policy cold-import extraction | Dependency explanation/scoped tests | Producer0pass2fail; JSON5s/body8475ms,SSE5736ms; other compatibility failures; restored. |
| Approved five-grant B consolidation |22focused; two producer positives JSON3933ms/SSE2445ms | Original bytewise0pass1fail/body7975ms,5stimeout; restored9files. |
| One-resource coverage-sidecar view |13prerequisite/45focused; explicit weaker ABA/read-error observation acknowledged | Original bytewise `bcf4c66a0`5stimeout/body19769.57ms; archived14files/restored10/removed4; exact1865. |
| Fresh per-call HMAC KeyObject | New Node24 mechanism,16vectors,micro faster;49focused/lint2/LSP2 | `bd44cd9c2`5stimeout/body10704.172ms; fully removed/exact1865. |

Unmatched historical timings are NOT causal speedup/regression comparisons. Do not add nested sampled totals or promise the observed micro difference is recoverable wall time.

### Current blocker source map

Original failing test: `tests/unit/gemini-owned-upload-loopback.test.js`, exact title:
`owned video metadata capability grant binds full original private upload authority through actual raw/reference/nativeSSE consumers`.

It uses genuine dummy loopback owned upload, real disposable SQL.js/migrations/writer/coverage/lifecycle, then native SSE parser with each encoded byte separately; original usage309000nanoUSD, full original authority, byte conservation, EOF and mutation checks. Historical source map reports562encoded bytes; verify rather than hardcode current length. Keep original5sdeadline.

Read graph:
1. `src/lib/apiKeyBudget/geminiOwnedFileUsage.js` — complete current checks around each push/callback/finish.
2. `geminiOwnedFileAuthority.js` — immutable original + all current owned resources; independent grant verifiers each full fresh authority.
3. `geminiOwnedUpload.js` → `geminiUploadRegistry.js` — exact runtime result provenance, signed row/current binding/expiry/receipt checks.
4. `queuedRequestAuthority.js` and `src/lib/db/helpers/apiKeyBindings.js` — current canonical SQL, credentials/settings/connection/pool, prior-ID/reverse/retired bindings and coverage.
5. `geminiResourceLifecycle.js` — fresh lifecycle JSON/stat/guarded snapshot/signature/receipt/coverage; before/after private ownership inspection.
6. `src/lib/db/accountingCoverage.js` — every status/fingerprint/retired read checks lock, fresh coverage JSON/history and policy SQL. Fingerprint is NOT just HMAC over in-memory key.
7. `src/lib/db/adapters/sqljsAdapter.js` — fresh writer/health assertion and executed SQL every get; compiled SELECT reuse already retained, rows never cached.
8. `src/lib/db/writerOwnership.js` — fresh lock parse per assertion, before/after inspection; process-incarnation data used in acquisition/reclamation.

### Existing profiling, not a new rerun

Stage diagnostic `bc404e1c5`: source1864stable, original5stimeout. body→imports/upload800ms; imports→price129ms; price→parser203ms; parser→byte loop84ms; instrumented byte loop12191ms. Whole-suite fs wrappers counted writer30499reads/2673ms,coverage11668/898ms,lifecycle1165/95ms. Wrapper overhead/nonexclusive suite windows, NOT exact loop CPU or benchmark.

Loop Inspector `b02ee141b`: original5stimeout,stable1864; loop7509ms/profile7558ms/16018samples. Sampled self: readFileUtf81638ms,prepared copy491,readOwner412,crypto slots382+243,Inspector.post349overhead,stat180,coverage.read161,timestamp151,groupcopy137,adapter.get121. Inclusive authority7082/resource6773/freshBinding3955/coverage2859/SQL2184/ownership1771 overlap, NOT additive. Profile metadata local, no locals extracted; raw metadata still requires disclosure review.

### Latest fresh-HMAC experiment

Reanalysis of old profile + current Node24.21.0 builtin crypto source found Buffer HMAC preparation probes KeyObject/CryptoKey through caught invalid-receiver exceptions. Sampled `prepareSecretKey`670ms inclusive/`createHmac`880ms inclusive, not enough established leverage for the5sgap.

`.pi/perf-fresh-hmac-diagnostic-20261016.mjs`: dummy keys only, fresh bytes/KeyObject every invocation, rotating dummy keys,16exactdigestvectors;3alternating6000call isolated-process rounds, Buffer1326/1579/871ms vs freshSecretKey557/394/454ms. No warmup/key/result cache; micro only.

Candidate changed only crypto import + fingerprint HMAC key argument in accountingCoverage; preserved `current()`, all reads/check order, bytes/messages/digests, legacyAttributionId, schemas and signed representations. Fresh native secret allocation introduces another copy/lifetime, no zeroization guarantee.

Red `bd52a92b1`:5expected mechanism failures/stable1866. Focused `bb7e828bd`:49pass/4files/stable1866/lint2empty/LSP2clean. Original bytewise `bd44cd9c2`:0pass1fail55filtered, log5000mstimeout/body10704.172ms/stable1866. Archived source/newtest/patch, restored onlycoveragebackup/removed onlynewtest; two independent full hashes exact1865. No follow-up variant/producer expansion/rerun.

0 redactions applied. No raw credential, prompt, user data or signed URL values were included in this artifact.

## Verification

| Check | Command / receipt | Outcome / when |
|---|---|---|
| WIP publication | Ordinary push then independent ls-remote; `.pi/checkpoint-publish-result.json` | Exit0/exact remote HEAD094e2d61, excluded hashes intact/indexempty; before latest experiment |
| Fresh-key dummy diagnostic | `node .pi/perf-fresh-hmac-diagnostic-20261016.mjs` | Exit0/16digests/3micro rounds; diagnostic only |
| Fresh-key focused | `python3 .pi/option-b-20261015/run-gate.py fresh-hmac-focused-20261016 unit/accounting-fresh-hmac-key.test.js unit/queued-authority-read-batch.test.js unit/gemini-upload-intent-registry.test.js unit/gemini-owned-resolution-capability.test.js` |49pass0fail0pending/stable1866; candidate test now archived, not runnable in restored tree |
| Original mandatory gate | Same wrapper `fresh-hmac-bytewise-20261016 unit/gemini-owned-upload-loopback.test.js -t '<exact title above>'` | FAILED0pass1fail55filtered/5000ms; no instrumentation or deadline change |
| Restoration | `.pi/fresh-hmac-candidate-20261016/restoration.json`, independent second rehash | Exact1865preflight/no changed-added-missing; whitespaceclean |
| Direct-consumer barrier | `.pi/option-b-20261015/owned-video-consumer-barrier-corrected-{results,union}.json` |2394pass10fail0pending,99distinctfiles18batches/stable1865 across36dictionaries; predates explicit negative-fixture repair |

Barrier failures: eight existing audio/mixed producer5stimeouts, one bytewise upload5stimeout, one missing-DOCUMENT negative-fixture premise failure. Positive helper legitimately supplied DOCUMENT rates; negative test now explicitly removes rates. Targeted repaired test STILL5stimeout/body5851ms. Instrumentation reached missing-rate refusal/noPOST/noACK/norow at~3.79s; positive restored-rate/original-price/own-ACK branch unobserved. Do not call repaired test passed or erase broad barrier failure.

Not run:
- No new full suite/build/browser/runtime/security/adapter/restore acceptance after latest experiment, because candidate failed mandatory discriminator and was rejected.
- No actual Bun/betterSQLite certification; earlier experiment actualSQL.js+node:sqlite only, Bun absent/native addon issue. Do not infer all-adapter parity.
- No live provider/billable tests or production operations.
- No fresh remote fetch during handoff capture.

Gate wrapper `.pi/option-b-20261015/run-gate.py`: repo-root launch, Vitest cwdtests, isolated temporaryHOME/DATA_DIR, clearsNODE_OPTIONS, maxWorkers one option default2/allowed1or2, outer300s, default+JSON reports, before/after source dictionary. Do not treat outer scheduling timeout as a passed gate. Historical `/tmp/9router-gemini-function-authority/` receipts are absent in this runtime; never invent equality with absent files.

## Open risks and blockers

- Type:blocker. Owner:next design discussion. Impact: mandatory bytewise5s still fails despite scoped semantic/micro wins. No next candidate has sufficient causal/equivalence/leverage evidence. Not a proof of impossibility.
- Type:risk. Owner:operator for contract changes. Impact: removing current reads can miss transient invalid/read-error/ABA states; rechecking later does not undo stale effects. Prior one-view approval was exhausted; do not quietly broaden it.
- Type:blocker. Owner:feature delivery. Impact: retry/fallback/fusion/allformats/tools integration, UI/reset/restart and audited recovery/managed restore are not fully certified. All13AC remain open; performance is not permission to abandon independently executable work.
- Type:risk. Owner:verification. Impact: Vitest can report5stimeout while synchronous/uncancelled tails continue; body duration/late marks are not passing assertions. STACK_TRACE_ERROR sometimes requires log classification. Diagnostic overhead/unmatched runs limit causal conclusions.
- Type:risk. Owner:documentation reader. Impact: canonical reports contain historical RUNNING/pending/no-commit text. This handoff supersedes live job/publication state ONLY, not historical failures or accepted contract. Ignore stale pi-lens informational accountingCoverage JSON.parse advisory as a new blocker absent fresh evidence.
- Type:risk. Owner:workspace. Impact: preserve unrelated Kimchi/snapshot/research WIP and local diagnostics. New report/handoff are local unpublished docs, not permission to push `.pi/` or raw evidence.

## Historical brainstorm next actions — completed, not the resume queue

Use the superseding direction-A decision at the top for the next execution. The steps below describe the completed brainstorm intake and are retained for traceability.

1. **First safe step** — read this handoff, `plan.md` confirmed-product-goals/current-delivery-roadmap, `design-contract.md`, latest fresh-HMAC report and bytewise architecture/stage-attribution reports. Verify Current state via bounded Git probes; verify candidate is absent and unrelated WIP preserved. Do not run tests or patch during intake.
2. Restate the brainstorm decision: can a materially new architecture/implementation preserve every accepted observation/ACK/durability boundary with plausible sufficient leverage? Separate mandatory work from incidental representation/runtime overhead. Do not assume Node/SQL.js/profiler blame from sampled totals.
3. Produce a small option table: mechanism, existing evidence, expected affected boundaries, consistency/security/restore risks, required consent, smallest falsifiable diagnostic, stop condition. Include “no currently supported performance change” as a valid conclusion, not refusal to deliver the broader feature.
4. Reject rebranded repeats of fs/snapshot/equality/import/grant/coverage-view/fresh-HMAC candidates and any unchanged rerun-for-green. If an option changes safety contract, explicitly describe missed observations/effects and obtain operator decision before experiment. No deadline/prewarm/check reductions by implication.
5. If useful, propose an independent backlog seam from the acceptance matrix with prerequisites; do not hold all work hostage to bytewise. Keep brainstorming separate from execution and do not launch parallel/delegated work without permission.
6. End brainstorm with an operator-reviewable design/decision and bounded validation plan; implementation is a later explicit step. Preserve all failure evidence and no-go outcomes. Do not claim full acceptance, speedup, risk percentage or ETA from current samples.

## Source pointers

Canonical docs (repo-relative):
- `CLAUDE.md`, `docs/ARCHITECTURE.md`; persistence correction in CLAUDE.md takes precedence: SQLite adapters, not old db.json.
- `open-sse/AGENTS.md` before any future open-sse edit.
- `plans/261003-0827-api-key-quota-budget-pricing/plan.md` and `design-contract.md`.
- `plans/261003-0827-api-key-quota-budget-pricing/reports/acceptance-closure-matrix.md`, `package-b-remaining-work.md`.
- Same reports directory: `bytewise-authority-architecture-review.md`, `bytewise-stage-attribution-20261015.md`, `owned-audio-cpu-diagnosis-20261014.md`, `owned-verification-core-feasibility-20261014.md`.
- Same directory: `option-b-implementation-20261015.md`, `performance-brainstorm-decision-20261015.md`, `narrow-coverage-view-design-20261015.md`, `coverage-view-candidate-20261015.md`.
- Same directory: `owned-validator-return-safety-20261015.md`, `owned-inline-video-composition-20261015.md`, `fresh-hmac-candidate-20261016.md` (local), `checkpoint-20261015.md`.
- `plans/handoffs/api-key-budget-context-reset-20261013-1548.md` for older full continuation; do not use its historical live status over this handoff.

Local evidence (do not push by default):
- `.pi/option-b-20261015/bytewise-{loop.cpuprofile,cpu-summary.json,cpu-result.json,diagnostic-result.json}`.
- `.pi/option-b-20261015/owned-video-consumer-barrier-corrected-{results,union}.json` and explicit-missing-document logs.
- `.pi/coverage-view-candidate-20261015/restoration.json` and rejected archive.
- `.pi/fresh-hmac-candidate-20261016/{preflight-inputs.json,accountingCoverage.js.backup,restoration.json,rejected-candidate/}`.
- `.pi/option-b-20261015/fresh-hmac-{red,focused,bytewise}-20261016.{json,log}` and corresponding `-scope.json`.
- `.pi/perf-fresh-hmac-diagnostic-20261016.{mjs,json}`, `.pi/perf-existing-crypto-inclusive-20261016.json`, `.pi/perf-existing-crypto-read-stacks-20261016.json`.
- `.pi/checkpoint-publish-result.json` — publication verified, not feature acceptance.
