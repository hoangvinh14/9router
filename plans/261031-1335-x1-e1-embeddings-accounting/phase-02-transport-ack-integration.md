---
phase: 2
title: "Transport, cancellation và own ACK integration"
priority: P2
effort: "Chưa estimate"
dependencies: [1]
---

# Phase 2 — Transport, cancellation và own ACK integration

<!-- Updated: Validation Session 1 - Final selected error response and local-reader lifecycle contract -->

## Goal / prerequisites

Phase1 accepted within selected fixture scope. Complete cả2fetch sites và account loop, effective transport/signal/body/own ACK/late semantics theo [E1 contract](./references/e1-contract.md). Không hỗ trợ OAuth E2 hoặc nới selection. Pending; một writer tuần tự với phase1.

## Files to create / modify

Prefix `/home/gmo/projects/9router/` applies to every path.
- Modify phase1 proposed `open-sse/handlers/embeddings-accounting.js`, `src/sse/services/embeddings-accounting.js`, `src/lib/accounting/persisted-embeddings-authority.js`, `src/sse/handlers/embeddings.js`, `open-sse/handlers/embeddingsCore.js`, fixture `tests/fixtures/accounting/embeddings-loopback.js`.
- Create proposed `tests/unit/embeddings-accounting-{transport,loopback,late-sink,final-controls}.test.js`.
- Modify existing `tests/unit/embeddingsCore.test.js` only if optional signal/dispatch behavior needs explicit backward-compatible assertions. Unassociated refresh positive retained.
- `open-sse/utils/{proxyFetch,accounting-transport}.js` initially reuse-only; shared accounted JSON reader is a reference, not reusable unchanged. Default E1-local reader owns bounded cancellation/partial evidence per phase1. If shared reader/transport changes, enumerate all callers and expand regressions, never add second hook around same POST. No catalog, schema, provider OAuth or global adapter rewrite.

## Implementation / acceptance matrix

1. Refactor core two fetch sites into one optional dispatch seam: initial and refresh retry share immutable wire/raw-response policy. Entry session controls association; core signal supplied from original request. Global fetch patch may supply env proxy, so tests observe actual direct/proxy destination rather than infer from function names. Explicit saved proxy options and `proxyAwareFetch` boundary required for associated requests. No stacked boundary/duplicate attempt.
2. Same bounded request lifetime for queue/network/body; compose caller cancellation+timeout at both sites, no retry indefinite reset. Pre-aborted/no intent, queued cancellation, committed intent before dispatch, headers/mid-body abort and usage-before-abort tested. Body read hangs must stop. Cleanup nonsettling/rejection must not become own ACK barrier or replace persistence failure.
3. For dynamic API-key selected flow DefaultExecutor has no mapped refresher.401/403 actual route asserts no credential refresh producer/successor POST; an attempted returned new apiKey/accessToken/refreshToken/runtime mutation through controlled core seam is refused before retry. Retain unassociated existing refresh-success test; it is not selected OAuth accounting positive. Fresh persisted mutation after await always invalidates selected authority, not silently adopted.
4. Actual two-account fallback with eligible failed priced usage: upstream sees predecessor exact row/own delivered terminal ACK before next POST. Distinct receipt/attempt per POST and original price/time. Budget consumed by first attempt can deny second. Valid0usage still an exact settlement; complete-without-usage/malformed cannot advance even when HTTP fallback status would normally allow it. Abort cannot launch next account. Selected valid-usage HTTP error retained after own terminal ACK must survive both core wrapping and entry `!credentials`/`allRateLimited` exhausted-account branches when that error is the final returned response. Keep fallback eligibility/account bookkeeping unchanged; fresh budget/authority/recording refusal takes precedence and cannot be overwritten with retained error. A later successful account returns its own response; release predecessor bytes. Unassociated wrapping stays unchanged.
5. Hold/loss own intent ACK forbids wire; hold/loss own terminal ACK forbids client successful completion and fallback. Copied receipt/visible ledger row/other key ACK cannot authorize. Inject actual terminal publication failure then held/lost own gap ACK: keep key/binding/coverage safety across reopen, peer key unaffected. Do not use gap ACK to permit retry after unresolved recording failure.
6. Persisted revoke/key rotation/ACL/alias/node+connection/model/proxy-pool drift at credential await, queue, held ACK and immediately before dispatch; no unauthorized POST. Approved account-failure bookkeeping patch is narrow and acknowledged against unchanged remainder of persisted material; not unrestricted mutation adoption.
7. Real direct and strict HTTP proxy intended positives, disabled/deleted pool/unavailable proxy refuses with zero direct POST; environment/proxy drift no escape.307/308 manual redirect to second listener: no second hit or leaked key, malformed/missing usage classification truthful. Relay/SOCKS/MITM bypass classes unsupported under selected association, no broad transport acceptance from HTTP proxy.
8. Raw evidence consumed before error parse/normalize/callback; preserve final selected valid-usage error status/body bytes end-to-end, not merely boundary replay, and normal float/base64 payload. Upstream header allowlist is `Content-Type` only; apply local CORS/no-store/request-id headers and never replay Content-Length/Content-Encoding/cookies/authorization/location/hop-by-hop headers. Test non-fallback final error, fallback exhausted after one/multiple accounts, later success, and successor budget/authority/recording refusal precedence. HTTP error remains failure even when accounting settles. Exact replay requires a complete within-cap validated document and delivered own ACK; oversize/partial/read failure/malformed/complete-absent follows local refusal/evidence disposition, never truncated client replay as certified evidence. Partial invalid UTF8/JSON or usage prefix remains malformed after interruption; only interrupted zero-body-byte absence without invalid evidence becomes nonblocking unrecorded in this JSON owner. Named cases cover abort before headers/after headers zero bytes/mid-JSON, premature EOF, cap termination, complete absent and valid full document before abort. Full error missing usage remains unresolved. Duplicate usage/counter keys including decoded escaped-equivalent names invalid, ordinary metadata retained. Known valid evidence before client abort still settles once at original time/rate.
9. Late sink retained privately after dispose/revoke/rate change may complete original attempt only; cannot authorize new work. Same exact usage duplicate idempotent, conflicting evidence retains known cost+safety. Original week/month projection checked, not merely stored timestamp. Persistence errors never caught as parser/transport absence.
10. Resource limits per contract: incremental8MiB even chunked/false length; below-cap large float/base64 exact replay; above cap/truncation/no EOF controlled refusal. Avoid response clone/tee, ledger payload retention or asynchronous drain; bound raw chunks/parse/replay lifecycle. Test cancel reject/never resolve, reader lock/resource release and concurrent requests no cross-key payload/activity. Do not call existing shared `readRawJson` unchanged: its awaited cancellation can hang, and its caller classifies partial read errors as absent. E1-local owner must settle/classify before nonblocking cleanup; shared hardening requires separate caller/regression audit. Record no peak-RSS certification unless measured separately; do not claim cap bounds all process memory.

## Tasks

- [x] P2.1 Red tests for both-fetch seam, selected unsupported refresh/mutation refusal and unassociated refresh-success compatibility.
- [x] P2.2 Integrate optional explicit proxy-aware dispatch/raw boundary for both fetch sites without double ownership.
- [x] P2.3 Prove composed signal+timeout and bounded body lifetime at both sites; no successor after client abort.
- [x] P2.4 Prove actual two-account fallback, predecessor policy-eligible own ACK, distinct attempts and successor budget recheck.
- [x] P2.5 Prove hold/lost intent+terminal ACK, copied/peer receipt refusal and actual publication/gapACK failure controls.
- [x] P2.6 Prove persisted revoke/drift and narrow failure bookkeeping adoption across awaits/queue/wire.
- [x] P2.7 Prove intended strict HTTP proxy positive and no-direct/redirect/credential-leak negative controls.
- [x] P2.8 Prove raw invalid/absent distinctions, bounded E1-local read/cleanup and large/chunked/truncated body; preserve final selected error status/body through core and exhausted-account branches with safe headers and refusal precedence.
- [x] P2.9 Prove late/duplicate/conflict/original-window isolation after dispose/revoke and error precedence.
- [x] P2.10 Run focused+named affected gates, static checks and case receipt on unchanged source; no OAuth or broad-platform claim.

## Verification (future only)

From repo root, proposed files must exist:

```bash
node tests/fixtures/accounting/run-isolated.mjs unit/accounting-fixture-isolation.test.js unit/embeddings-accounting-usage.test.js unit/embeddings-accounting-pricing.test.js unit/embeddings-accounting-json.test.js unit/embeddings-accounting-transport.test.js unit/embeddings-accounting-loopback.test.js unit/embeddings-accounting-late-sink.test.js unit/embeddings-accounting-final-controls.test.js
node tests/fixtures/accounting/run-isolated.mjs unit/embeddingsCore.test.js unit/embedding-usage-persistence.test.js unit/ollama-local-embeddings.test.js unit/key-access-handlers.test.js unit/accounting-persisted-authority.test.js unit/accounting-request-authority.test.js unit/accounting-transport-boundary.test.js unit/accounting-stream-terminal.test.js unit/b1-usage-evidence.test.js unit/b1-late-chat-sink.test.js unit/b1-ledger-disposition.test.js unit/b1-terminal-failure-reopen.test.js unit/default-executor-accounting-compatibility.test.js
```

If shared Chat/Responses authority/transport/reader code changed, also execute all current Chat+R1 gates listed phase3, not only embeddings tests. Scope lint all changed JS and active LSP including new files, diff check. Save per-case adapter identities/POST sequence and exact JSON report; no mocked fetch-only closure. Every actual claimed route needs private loopback positive; unassociated refresh mocked positive explicitly labeled compatibility-only.

## Exit / risks / stop

Both-adapter gates complete with zero skipped mandatory case; phase1 remains green; no legacy presentation-persistence certification. A terminal ACK is necessary but not sufficient for fallback: disposition must be policy-eligible. Failures to preserve target/proxy/signal/time bounds or own ACK stop phase; never mask errors with default0, swallow recording failure, relax authority, increase timeout solely to green or activate OAuth. Data beyond cap is unsupported selected profile, not universally invalid embeddings. Phase3 still mandatory for durability/budget and final frozen source receipt.

## Execution receipt — selected fixture scope only

Completed within the child's selected Linux Node SQLite/SQL.js fixture scope. Frozen final `b22e7657f`: 1162 reported test cases across65suites,0failed/skipped; all5isolated batches and original comparators passed. Original price, own-ACK, transport/error-fidelity, durability/budget and affected gates are mapped in [E1 evidence](./references/e1-acceptance-evidence.md). Exact commands/raw reports and1693unchanged source/input hashes are preserved in `plans/reports/evidence/261031-e1-embeddings/`. Eight audited inherited title-collision groups use exact multiplicity exceptions; new E1 identities are unique. LSP20paths inconclusive despite0diagnostics; scoped ESLint passed. No independent subagent/full-code Advisor approval claimed. Production OFF; legacy presentation/historical realDB uncertainty and all broader owner/platform/release exclusions remain. Historical future-command/pending prose above records planning, not current status.
