# Validation Session 1 — static source evidence

Date: 2026-11-14. Scope: plan validation only. No application imports, runtime/test/build, network/fetch, branch/index changes, private config/DB/credentials or generated/session contents. `M:` below is pinned master `1855aa44473e88feac9d3f131b9c0c5fc9706b68`; `W:` is the current public working tree on develop `08ee1a74954c5fe7a1659a6473e57b6b1ea9059b`. Paths relative to repository root. Evidence proves source shape/presence and traced logic only, not execution success.

## Verification Results

- Tier: **Full**, six phases, all four roles applied inline by the primary assistant; no delegated verification or independent security certification.
- Sample: **90 structural/source claims (15/phase)** plus **one storage behavioral claim** = **91 checked**.
- Initial: **90 verified / 1 failed / 0 unresolved factual claims**. Storage failure corrected with owner confirmation; final factual disposition **91 verified / 0 failed / 0 unresolved**. Future implementation/evidence gates are not counted as verified facts.
- The first literal probe for `unresolvedCount` in budget-projection returned no match. Reading its body resolved the indirection: `countAttemptStatesSync` is spread into the return value (`budget-projection.js:21–24`), with counts defined in `api-key-accounting-repo.js:118–129`. A failed search string is not a plan failure.
- Local refs, merge-base, 68/21 divergence, one worktree, 42 tracked modifications/staged0 match the planning baseline. All **14** selected SHA256 hashes still match. This is not a complete WIP/preservation certificate or remote-freshness proof.

## Fact Checker — 15 sampled claims per phase

Each numbered item is one sampled claim; adjacent claims may share a source file. Planned-new APIs/tests are not claimed to exist.

### Phase 00 — provenance and preservation inputs (15)

1–8. Public untracked native donor modules exist and export symbols: W `open-sse/utils/accounting-codex-usage.js:6`, `accounting-codex-wire.js:4`, `accounting-claude-request.js:20`, `accounting-claude-usage.js:5`, `accounting-claude-stream.js:7`, `accounting-claude-wire.js:4`; W `src/lib/accounting/codex-price-authority.js:3`, `claude-price-authority.js:5`.

9. Current contract §8 exists: W `plans/261113-1952-api-key-budget-scope-audit/references/brainstorm-contract.md:56`.
10. Master schema version declaration exists: M `src/lib/db/schema.js:6`.
11. Master Base fresh-socket per-URL state: M `open-sse/executors/base.js:105`.
12. Master low-level replay feature: M `open-sse/utils/proxyFetch.js:9,399–411`.
13. Background CLI version helper: M `open-sse/utils/claudeCliVersion.js:61`.
14. Master DONE handling exists: M `open-sse/utils/stream.js` (DONE handling; not evidence of monetary finality).
15. Recorded sync SHA: W `plans/261113-1952-api-key-budget-scope-audit/references/branch-handoff.md:22`.

### Phase 01 — boundaries and lifetimes (15)

1. M `src/sse/services/keyAccess.js:48–61`: extraction precedence.
2. Same file `:70–80`: unrestricted/unknown ACL returns null, not an accounting identity.
3. M `src/dashboardGuard.js:145–152`: same four extraction spellings.
4. M `src/lib/db/repos/apiKeysRepo.js:45`: UUID key ID.
5. M `next.config.mjs:75–110`: public rewrites.
6. M `src/app/api/v1/api/chat/route.js:18`: nested ingress POST.
7. M `src/app/api/v1beta/models/[...path]/route.js:36`: alternate ingress POST.
8. W `src/sse/services/chat-accounting.js:21–39`: request-identity fixture WeakMap, no production activation.
9. W `src/lib/accounting/service.js:13,19–22`: service cache per DB adapter.
10. Same file `:22,35–41`: private request-context WeakMap.
11. Same file `:108–118`: receipt ownership and one-use dispatch.
12. W `src/lib/accounting/budget-gate.js:7–8`: pending is not a reservation.
13. W `src/lib/accounting/persisted-chat-authority.js:126`: graph validation seam.
14. Same file `:188–218`: own credential-transition capability.
15. W `src/lib/accounting/budget-management.js:63,77–80`: fixture-based readiness, finite production save refused.

### Phase 02 — reusable minimum slice (15)

1. W `src/lib/accounting/exact-money.js:10`: exact-money exports.
2. W `src/lib/accounting/budget-policy.js:5`: expectedVersion policy field.
3. W `src/lib/accounting/budget-windows.js:3`: HCM calendar.
4. W `src/lib/accounting/budget-projection.js:21–24` → repo `countAttemptStatesSync`: projected pending/unresolved counts.
5. W `src/lib/accounting/write-coordinator.js:54`: enqueue seam.
6. W `src/lib/db/repos/api-key-accounting-repo.js:15`: intent mutation.
7. Same file `:34`: terminal mutation.
8. W `src/app/api/keys/[id]/budget/route.js:19`: authorize mutation before body read.
9. Same file `:26`: streamed 4096-byte limit.
10. W `src/shared/components/ApiKeyBudgetPanel.js:98`: policy CAS input.
11. M `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js:22`: existing UI destination.
12. W `src/lib/accounting/budget-management.js:79`: finite save checks private capability lifetime.
13. W `src/lib/auth/managementGuard.js:73`: CSRF refusal.
14. W `src/lib/accounting/service.js:118`: dispatch receipt consumed.
15. W `open-sse/utils/accounting-transport.js:53`: manual redirects on selected transport.

### Phase 03 — retry/raw/compatibility seams (15)

1. M `open-sse/executors/base.js:100`: execute seam.
2. M `open-sse/executors/codex.js:298`: ordinary SSE peeker.
3. M `open-sse/executors/index.js:49`: singleton Codex executor.
4. W `open-sse/executors/codex.js:283–288`: invocation-local compact state patch.
5. W `open-sse/config/accountingProfiles.js:19`: private native binding.
6. W `open-sse/executors/accounted-base.js:42`: accounted execution adapter.
7. W `open-sse/utils/accounting-responses-stream.js:10`: raw stream helper.
8. W `open-sse/utils/accounting-responses-usage.js:7`: usage helper.
9. W `open-sse/transformer/streamToJsonConverter.js:82`: converter.
10. W `open-sse/handlers/chatCore/sseToJsonHandler.js:118`: conversion consumer.
11. W `src/sse/services/tokenRefresh.js:237`: accounting refresh option.
12. W `src/sse/services/chat-accounting.js:228`: persisted refresh seam.
13. M `src/app/api/v1/responses/compact/route.js:31`: Request reconstruction.
14. M `open-sse/utils/proxyFetch.js:411`: hidden stale-socket replay.
15. Same file `:480–482`: background fetch + header mutation.

### Phase 04 — integrity/migration seams (15)

1. W `src/lib/db/durableFile.js:5`: durability helpers.
2. W `src/lib/db/writerOwnership.js:32`: writer acquisition.
3. W `src/lib/db/accounting-lifecycle.js:8`: pending recovery.
4. W `src/lib/db/driver.js:53–67`: owner acquisition before lifecycle install.
5. W `src/lib/db/helpers/api-key-bindings.js:18`: changed fingerprint rejected.
6. W `src/lib/db/repos/apiKeysRepo.js:95–103`: retirement on deletion.
7. W `src/lib/db/repos/api-key-accounting-repo.js:83`: manual recovery requires unresolved + expected version.
8. Same file `:93–110`: dead-owner pending recovery can produce unrecorded; coverage faults remain independent.
9–11. W migrations `002-accounting-foundation.js:4`, `003-accounting-policy.js:15`, `004-recorded-spend.js:4` exist.
12. M `src/lib/db/migrations/index.js:6`: only m001 in pinned master registry.
13. M `src/lib/db/driver.js:87–93`: runtime-specific adapter fallback chain.
14. W `src/lib/db/backup.js:21`: backup integration exists.
15. W `src/lib/accounting/budget-gate.js:29`: threshold equality blocks via BigInt comparison.

### Phase 05 — storage/test baseline (15)

1. M `src/lib/usageDb.js:1–7`: SQLite re-export.
2. M `src/lib/db/paths.js:5–13`: DATA_DIR DB/legacy paths.
3. M `src/lib/dataDir.js:7–37`: HOME/APPDATA fallback + import-time mkdir.
4. M `src/lib/db/repos/usageRepo.js:284`: usageHistory insertion.
5. Same file `:782–789`: request log no-op/derived SQL read.
6. M `tests/__baseline__/verify-no-regression.mjs:17`: `/app/` split limitation.
7–9. M `tests/__baseline__/verify-{providers,alias,oauth-urls}.mjs` exist.
10–13. M `tests/unit/{proxy-keepalive-dead-socket,passthrough-done-sentinel,claude-header-forwarding,claude-cloaking}.test.js` exist.
14–15. W `tests/unit/{accounting-budget-gate,accounting-exact-money}.test.js` exist.

## Behavioral failure and correction

**F1 — FAILED initially:** plan §7 / phase05 said usageDb always writes HOME JSON/log files and ignores DATA_DIR. Both M and W instead re-export SQLite. Usage repo stores SQL rows and derives logs; dataDir fallback still makes HOME/APPDATA isolation necessary. Owner approved the factual correction. Plan/phase05 corrected, sandbox isolation retained; root instructions/ARCHITECTURE historical statements not modified by this validation.

## Flow Tracer / Scope Auditor

- Existing shipping management route → auth/CSRF → bounded body → capture → CAS/durable mutation. Capture defaults to null fixture lifetime, so finite production save is currently refused, not delivered.
- Existing chat capture requires exact Request fixture identity; missing association returns null and follows ordinary path. Compact rebuilds Request. Plan correctly requires new server-owned admission + fail-closed alternate routes; current fixture helpers do not supply it.
- Accounting service is DB-adapter-lifetime cached; contexts/receipts private, per-request/per-attempt. Persisted chat authority/session closures are request-local. Executor map caches Codex singleton; W invocation receiver patch is relevant to ordinary isolation, not producer eligibility.
- `service.beginAttempt` → durable coordinator/intent → own receipt → synchronous fresh final gate → one consumed permission. Terminal mutation independent of disposed request context retains original row snapshots. These are source paths, not durability test results.
- Unrecorded B1/E2 absent interrupted evidence contributes no spend and no unresolved blocking count. Independent coverage/health faults still block. `resolveAttemptSync` accepts unresolved only. Approved plan now explicitly preserves this distinction; unknown normal completion must not be reclassified as accepted interrupted absence.
- `installAccountingLifecycle` runs after exclusive acquisition and recovers prior-owner pending; beforeClose stops write lane before current-owner recovery. Required invariant preserved in plan; no multi-process runtime proof claimed.

## Contract Verifier — explicitly traced consumers

Public production source consumers found (tests excluded from these counts):

- `captureBudgetManagement`: **2 calls**, GET and PUT in `src/app/api/keys/[id]/budget/route.js:16,30`.
- `createPersistedChatAuthority`: **1 call**, `src/sse/services/chat-accounting.js:43`.
- `createAccountingService`: **2 calls**, chat-accounting `:44` and `src/sse/services/embeddings-accounting.js:27`; embeddings is not silently admitted for positive support.
- `handleChatCore`: **2 calls**, `src/sse/handlers/chat.js:350` and `open-sse/handlers/responsesHandler.js:37`. Changes must examine both, plus tests, before port.
- `resolveAttemptSync`: **1 call**, `src/lib/accounting/service.js:144`; no shipping recovery route caller found. New recovery API/UI is explicitly planned, not existing support.
- `recoverPendingSync`: **2 calls**, lifecycle `:8,18`, with different ownership stages.
- `getKeyAccessContext`: **13 calls in 12 files**: `src/sse/handlers/chat.js:124,236`; handlers `embeddings.js:115`, `fetch.js:98`, `imageGeneration.js:73`, `search.js:78`, `stt.js:69`, `systemone.js:80`, `tts.js:49`, `videoGeneration.js:126`; API routes `src/app/api/v1/models/route.js:668`, `src/app/api/v1/models/[...model]/route.js:47`, `src/app/api/v1beta/models/[...path]/route.js:250`. Re-enumerate this explicit list, tests and any new consumers at port time.

This sample is not the final route-closure/rotation consumer manifest. Phase01 must freeze complete actual dispatch/test/import/export/backup consumers on the freshly pinned baseline. Newly approved recovery/rotation protocols remain design work, not a pass.

## Remaining gates

A0/A1 operational authority and secure recovery locator; P1–P4 exact producer evidence; D05 sidecar equivalence/D06 transport disposition if needed; exact phase01 route closure and API/binding protocol; platform/runtime/migration tests and legal retention before applicable rollout. No positive cell certified. All six implementation phases pending.
