# E1 validation Session 1 — 2026-10-31

## Evidence level and method

Primary-agent Standard verification: Fact Checker + Contract Verifier, 10 sampled source/coverage claims per phase. Read the index, all three phases, E1 contract, creation self-verification, architecture/engine guidance, and the source bodies cited below. No subagent or independent red-team approval. Advisor consultations are advisory, not runtime proof. Checked live working tree on `develop` at `18a27a1b5e0655cf8c9b3998a0dc51b964686a47`; intentional tracked/untracked R1 edits retained. Did not rerun the historical source-hash manifest or certify its current equality.

No runtime tests, build, server, real DB, provider request, credential/config inspection, production activation, commit, push or deployment. Static source/Markdown reads and path/caller checks only. Historical real-DB uncertainty and legacy presentation-persistence exclusion remain.

## Verification Results — before interview

- **Tier:** Standard (3 phases; Fact Checker + Contract Verifier).
- **Claims checked:** 30 (10 per phase).
- **Verified:** 28 | **Failed:** 1 | **Unverified:** 1.
- Counts concern current source facts and planned coverage, NOT future implementation acceptance.
- Failed means a proposed coverage gate is insufficient, not an observed shipping activation. Unverified means the intended externally visible contract was ambiguous, not an observed incorrect E1 implementation (none exists).

| # | Phase | Result / sampled claim | Read/search evidence |
|---|---|---|---|
| 1 | 1 | VERIFIED — POST forwards same Request, OPTIONS local only | `src/app/api/v1/embeddings/route.js:6-20` |
| 2 | 1 | VERIFIED — entry legacy helper/save is success-only, not raw attempt accounting | `src/sse/handlers/embeddings.js:18-24,141-155` |
| 3 | 1 | VERIFIED — one runtime caller of core; optional signature must preserve direct test/mocked consumers | `src/sse/handlers/embeddings.js:125`; scoped `handleEmbeddingsCore` search across src/open-sse/tests, inventory below |
| 4 | 1 | VERIFIED — OpenAI body builder forwards input/encoding/dimensions, normalize identity | `open-sse/handlers/embeddingProviders/openai.js:19-29` |
| 5 | 1 | VERIFIED — dynamic compatible adapter falls back to OpenAI URL and removes suffix | `open-sse/handlers/embeddingProviders/openaiCompatNode.js:8-11` |
| 6 | 1 | VERIFIED — existing persisted guard restricts compatible apiType chat/responses, not embeddings endpoint | `src/lib/accounting/persisted-chat-authority.js:110-125` |
| 7 | 1 | VERIFIED — pricing endpoint embeddings exists and normalizes omitted output0; E1 must reject unsupported dimensions itself | `src/lib/pricing/constants.js:3-6`, `rateValidation.js:10-23` |
| 8 | 1 | VERIFIED — exact-money requires original input/output rates and explicit exact category authority | `src/lib/accounting/exact-money.js:14-55,57-84` |
| 9 | 1 | VERIFIED — service resolves price/budget at admission/queue and compares original price at dispatch | `src/lib/accounting/service.js:43-66,88-108` |
| 10 | 1 | VERIFIED — E1 is proposed, not implemented; creation/test ownership and local profile require new files | All four runtime modules, two fixture modules and nine E1 unit paths absent; contract §6 names them Proposed |
| 11 | 2 | VERIFIED — core has two POST fetch sites | `open-sse/handlers/embeddingsCore.js:64-72,97-104` |
| 12 | 2 | VERIFIED — no caller signal; initial timeout only, retry lacks timeout | `open-sse/handlers/embeddingsCore.js:13-20,68-70,99-103` |
| 13 | 2 | UNVERIFIED — preserve valid failed raw HTTP body through final client response vs keep current wrapper | Core `:112-116` consumes/wraps; `src/sse/handlers/embeddings.js:106-117,159-168` replaces exhausted-account responses; `open-sse/utils/error.js:59-102`. Ambiguity in planned fidelity endpoint resolved by Q1 |
| 14 | 2 | VERIFIED — dynamic DefaultExecutor has no legitimate refresh mapping | `open-sse/executors/default.js:267-289`; no refreshToken returns null, fixed refresher map excludes dynamic provider |
| 15 | 2 | VERIFIED — proactive refresh may adopt persisted tokens and write credentials after awaits | `src/sse/services/tokenRefresh.js:229-304`; E1 requires post-await recheck/no producer |
| 16 | 2 | VERIFIED — patched fetch loses explicit saved proxy options; explicit boundary available | `open-sse/utils/proxyFetch.js:379-477` |
| 17 | 2 | VERIFIED — accounted transport rechecks immutable request, synchronous single-use dispatch, manual redirect | `open-sse/utils/accounting-transport.js:25-61` |
| 18 | 2 | VERIFIED — private Chat WeakMap and own intent/terminal/gap ACK protocol are invariant references | `src/sse/services/chat-accounting.js:16-28,47-58,100-147`; reuse is not blanket embeddings admission |
| 19 | 2 | VERIFIED — shared raw JSON reader is not E1-ready unchanged; cap exists but cancellation/read-error semantics need a new local owner | `open-sse/executors/accounted-base.js:11-29,46-49`; `open-sse/config/runtimeConfig.js:106`. Awaited cancel can hang; read failure maps absent without retaining partial-byte evidence |
| 20 | 2 | VERIFIED — no-cache claim is limited to current entry/core and actual no-POST controls, not a new cache feature | Full `src/sse/handlers/embeddings.js` and `open-sse/handlers/embeddingsCore.js` reads; core directly dispatches, no cache path |
| 21 | 3 | VERIFIED — isolated runner mounts public inputs only, drops host env/network, fixes config and JSON reporter, timeout600s | `tests/fixtures/accounting/run-isolated.mjs:8-39` |
| 22 | 3 | VERIFIED — legacy usage writes mocked before application tasks; cannot certify presentation persistence | `tests/fixtures/accounting/isolated-setup.js:1-10` |
| 23 | 3 | VERIFIED — actual process SIGKILL/reopen precedent covers both node/sqljs, not E1 evidence | `tests/unit/responses-accounting-restart.test.js:5-31`, `tests/fixtures/accounting/responses-process.mjs` |
| 24 | 3 | VERIFIED — actual service terminal publication failure retains safety and private receipts | `src/lib/accounting/service.js:109-131` |
| 25 | 3 | VERIFIED — HCM Monday/calendar windows, per-key threshold and original-window admission guards | `src/lib/accounting/budget-windows.js:3-35`, `budget-gate.js:9-35` |
| 26 | 3 | VERIFIED — management GET authenticated/no-store and production finite activation refusal retained | `src/app/api/keys/[id]/budget/route.js:5-16`; existing activation test §management readiness |
| 27 | 3 | FAILED — rerunning unchanged activation-boundary test does not cover new E1 fixture helper | `tests/unit/budget-activation-boundary.test.js:7-15` hardcodes only budget+Chat helpers and scans src only; Q2 authorizes E1 coverage + forbidden-caller control |
| 28 | 3 | VERIFIED — exact-report comparator exists but cannot prove collection; `/app/` ID caveat requires independent checks | `tests/__baseline__/verify-no-regression.mjs:1-29` |
| 29 | 3 | VERIFIED — cited runtime command files: 55 existing distinct unit paths,9 explicitly proposed missing E1 unit paths | Static regex/path scan of child Markdown; no unexpected missing test or broken relative link |
| 30 | 3 | VERIFIED — pending phase1→2→3 dependency chain,8/10/8 unchecked tasks; R1 receipt remains fixture-only historical | All phase frontmatter/tasks, `plan.md`, R1 `references/x1-owner-map.md:3,15-20`, `plans/reports/implementation-261031-r1-native-responses.md:5` |

## Contract consumer inventory

`handleEmbeddingsCore` has **one runtime call site** in this checkout: `src/sse/handlers/embeddings.js:125`. Direct runnable test consumers: `tests/unit/embeddingsCore.test.js:33`, `tests/unit/ollama-local-embeddings.test.js:3`. Mocked entry consumer: `tests/unit/embedding-usage-persistence.test.js:23-24,39`; entry access test: `tests/unit/key-access-handlers.test.js:48,159`. Known non-runnable cloud mock/import consumer: `tests/unit/embeddings.cloud.test.js:27-28,61-63` (absent cloud worker). `open-sse/handlers/search/index.js:150` is a calling-convention comment, not a call site. Request route caller is `src/app/api/v1/embeddings/route.js:20`.

Potential shared extraction consumers checked, not permission to change them:
- `createPersistedChatAuthority`: sole runtime consumer `src/sse/services/chat-accounting.js:34` (import:4).
- `createAccountedBoundary`: runtime consumer `open-sse/executors/base.js:105` (import:1); direct test consumers `b1-usage-evidence.test.js:54,66,73,82`, `chat-accounting-json.test.js:35`, `responses-accounting-json-boundary.test.js:7`.
- `runAccountedTransport`: three invocation locations in `open-sse/utils/proxyFetch.js:256,296,396` (import:4).
- `captureChatAccounting`: runtime `src/sse/handlers/chat.js:43`; tests `b1-late-chat-sink.test.js:15`, `responses-accounting-late-sink.test.js:15`.
- `createAccountingService`: sole application consumer `src/sse/services/chat-accounting.js:35`; 7 test consumer files: `accounting-budget-gate.test.js:17,67,76`, `accounting-coordinator.test.js:15`, `accounting-transport-boundary.test.js:44`, `b1-terminal-failure-reopen.test.js:16,25`, `chat-accounting-final-controls.test.js:131`, `chat-accounting-loopback.test.js:168`, `responses-accounting-loopback.test.js:58`. No E1 change to service assumed.

Re-inventory at implementation time; this is a current source inventory, not a claim of future unchanged consumers.

## Resolution after user interview

Q1 selected **Preserve final error (Recommended)**: retain existing fallback, preserve selected ultimately returned valid-usage error status/body after own ACK, including exhaustion, with local refusal precedence and unchanged unassociated behavior. Upstream headers narrowed to `Content-Type`; local safety headers owned locally; no encoded-body length/header replay.

Q2 selected **Add explicit gates (Recommended)**: plan E1 helper activation guard with forbidden-caller negative control and E1-local bounded JSON owner by default. No blind reuse of existing raw reader. Shared changes still require caller audit/regression gates and cannot relax Chat/R1 guards.

**Post-propagation disposition:** original coverage failure addressed by explicit Phase3 file ownership/test gate; original response ambiguity resolved across index, all phases and E1 contract. **Outstanding planning Failed:0 / Unverified:0** for the 30 sampled claims. This does not reclassify historical source behavior as fixed or claim the proposed gates executed. No runtime approval follows automatically.

## Final consistency/static checks

Reread index/all3phases/contract and validation references. Three decision deltas propagated with markers;0unresolved contradictions. Final Advisor reviewed a concise summary, not full files/diff: conditional no conceptual blocker, not independent verification. Clarified exact error replay only for complete within-cap validated usage with own ACK; malformed/partial/oversize/read-error/absent cases keep disposition/refusal precedence. Activation guard+negative control is mandatory fixture acceptance, not optional cleanup and never production enablement.

Static checks:11relative file links,0broken (anchors not separately certified);9future fenced runtime commands use isolated runner;55existing command test paths and9explicitly proposed missing. An initial all-prose scan counted56 by including the excluded `embeddings.cloud.test.js` mentioned in this receipt and failed its count assertion; corrected command-only inventory passed55. CLI format valid=true; implementation status pending,0/3phases completed,0/26tasks completed. `git diff --check` exit0. Documentation checks do not establish runtime runner safety/test correctness. No runtime tests/JS diagnostics claimed; initial Markdown analyzer warnings were availability warnings, not proof of clean files.

## Remaining risks

Implementation may expose unsupported price/schema/transport prerequisites; stop rather than expand E1. Final-error payload retained only request-locally and within existing bounds; it must not override budget/refusal errors or retain superseded vectors. A textual activation guard proves only its scanned inventory; implementation still needs cumulative diff/security review, helper inventory and negative controls. No official-schema re-fetch or live provider behavior verification in this validation. Existing historical receipts are not E1 runtime evidence. All implementation phases remain Pending and require a separate user request to cook.
