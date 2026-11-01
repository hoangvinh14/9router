---
phase: 1
title: "Authority, strict raw usage và embeddings price"
priority: P2
effort: "Chưa estimate"
dependencies: []
---

# Phase 1 — Authority, strict raw usage và embeddings price

<!-- Updated: Validation Session 1 - E1-local bounded reader and selected final-error fidelity -->

## Goal / prerequisites

Đạt selected positive synchronous embeddings JSON từ actual dummy POST đến raw exact ledger và own ACK, với strict profile/price/persisted selection. Pending; chỉ bắt đầu khi user yêu cầu cook. Đọc root CLAUDE, ARCHITECTURE (DB section stale), open-sse/AGENTS, [E1 contract](./references/e1-contract.md), R1 receipt và B1. R1 fixture-scoped complete, không production. Chỉ Linux NodeSQLite+SQLjs qua isolated runner; no real DB.

## Files to create / modify

All paths relative `/home/gmo/projects/9router/` (absolute root applies to each).
- Create proposed `open-sse/utils/accounting-embeddings-usage.js`, `src/lib/accounting/persisted-embeddings-authority.js`, `src/sse/services/embeddings-accounting.js`, `open-sse/handlers/embeddings-accounting.js`.
- Modify `src/sse/handlers/embeddings.js`, `open-sse/handlers/embeddingsCore.js` for optional selected association and initial raw dispatch integration; phase2 finishes both-fetch seam/lifecycle.
- Create proposed `tests/fixtures/accounting/embeddings-loopback.js`; `tests/unit/embeddings-accounting-{usage,pricing,json}.test.js`.
- Reuse `service.js`, `exact-money.js`, ledger/pricing, isolated setup and DB fixtures. Default raw JSON owner is E1-local in proposed `open-sse/handlers/embeddings-accounting.js`; existing `accounted-base.js:11-29` reader is NOT reuse-ready (unbounded awaited cancel and partial-read→absent classification). Shared extraction only with explicit caller/guard audit and Chat/R1 regressions; do not change their semantics as an incidental E1 fix. Narrow private helper extraction from Chat authority/session or `accounted-base.js` only with caller inventory and unchanged profile guards; no whole-session rewrite. These files require affected tests if edited.

## Design / implementation steps

1. Recheck branch/status including untracked R1; enumerate all core/authority consumers. Capture current unassociated default URLs, payload/CORS/normalize/success callbacks, auth/ACL and legacy success logger. Runtime characterization only inside sandbox; no DB import in planning scripts.
2. Define immutable versioned input-only profile and exact observation per reference. Strict root counters, integer equality, explicit zero, no completion/details aliases, unknown usage dimensions, decoded-equivalent duplicate JSON keys/invalid UTF8. Never parse arbitrary JSON with regex to detect duplicated keys. Preserve ordinary metadata/vectors; classify root usage absence independently of HTTP success.
3. Validate original request before adapter drops unknown fields and final serialized wire again: four input shapes, nonempty homogeneous arrays, float/base64, valid dimensions, token-only; no stream/async media/billing ambiguity. Unassociated validation unchanged.
4. Implement narrow endpoint-aware persisted authority: stable key/binding/coverage/policy/ACL/model alias, node type/id/baseURL, active API-key connection/proxy/material revision. Reject missing target (no OpenAI default), runtime credentials/transport/unsupported routes; no authority minted by client fields. Node apiType chat/responses is not upstream embeddings protocol choice. Preselection, post-await, queued-intent and dispatch rechecks follow service synchronous capability invariants.
5. Private fixture association only; begin session before awaits, retain original request signal. No external activation call site. Bind candidate `{provider,model,endpoint:"embeddings",connectionId}` and profile. Price compatibility must reject non-input-only snapshot before POST; service pricing at queue/dispatch still rechecks same original snapshot.
6. Initial path uses raw JSON boundary before error parsing/normalize/onRequestSuccess: bounded reader, strict observation, service settlement+own intent/terminal ACK, byte-preserving reconstructed response. Use reference precedence: interrupted zero-byte absence→unrecorded; incomplete observed JSON, oversize or invalid evidence→unresolved; complete absent→unresolved; valid full document settles even before later abort. Do not set failed HTTP attempt success merely because settlement succeeded. Retain the selected error status/body bytes privately only until fallback/final return is decided; if returned after valid exact usage and own terminal ACK, bypass destructive core error wrapping. Phase2 must carry this through account-exhaustion paths. Preserve upstream `Content-Type` only; local CORS/no-store/request-id headers remain locally owned, no forwarding upstream credentials/cookies/location/hop-by-hop/Content-Length/Content-Encoding. Budget/authority/recording refusals supersede upstream errors. No raw embedding payload persisted.
7. Independent price oracle: resolver→authoritative normalized snapshot(input1/output0)→1000tokens1000000nanoUSD→ledger→reopen→original week/month projection; both adapters. Invalid/extended/nonzero-output/missing price refuse prewire, no default free. Zero input-rate only with explicit selected approved source; zero usage requires explicit counters, not empty input.
8. Selected success matrix: each four input shapes, multi-item aggregation, float/base64/dimensions, explicit zero fixture, unknown response metadata/native usage fidelity; valid failed usage tested at raw boundary. Confirm ordinary unassociated adapters/loggers unchanged.

## Tasks

- [x] P1.1 Re-inventory source/callers and characterize unassociated baseline in isolation; record dirty-state preservation.
- [x] P1.2 Write red strict input/usage/duplicate-key/profile tests with paired valid and invalid cases.
- [x] P1.3 Write red persisted identity/ACL/baseURL/API-key/proxy/profile price admission tests; each refusal asserts no POST.
- [x] P1.4 Implement profile and narrow persisted selection; private session cannot be enabled by client/env/settings.
- [x] P1.5 Implement E1-local bounded actual POST raw owner and exact body replay with own intent/terminal ACK; valid failed usage retains selected status/body for permitted final return, not only accounting evidence.
- [x] P1.6 Prove independent embeddings price→money→ledger→reopen→original-window projection on both adapters.
- [x] P1.7 Prove four-shape single/batch/float/base64/dimensions/zero and unassociated native fidelity controls.
- [x] P1.8 Run phase gates, scoped static checks and source/case receipt; stop on missing schema/price/authority rather than widening profile.

## Verification (future commands, not yet executed)

From repo root, after proposed tests exist:

```bash
node tests/fixtures/accounting/run-isolated.mjs unit/accounting-fixture-isolation.test.js unit/embeddings-accounting-usage.test.js unit/embeddings-accounting-pricing.test.js unit/embeddings-accounting-json.test.js unit/embeddingsCore.test.js unit/embedding-usage-persistence.test.js unit/ollama-local-embeddings.test.js unit/key-access-handlers.test.js
node tests/fixtures/accounting/run-isolated.mjs unit/accounting-exact-money.test.js unit/accounting-persisted-authority.test.js unit/accounting-request-authority.test.js unit/accounting-transport-boundary.test.js unit/chat-accounting-json.test.js unit/responses-accounting-json.test.js unit/responses-accounting-pricing.test.js unit/b1-usage-evidence.test.js
```

Scoped ESLint explicit changed JS paths and active LSP all changed source/test paths; `git diff --check`. No ordinary Vitest or imports outside sandbox. `embeddings.cloud.test.js` excluded due missing `cloud/`, not claimed passed. Record actual assertions/adapter names/zero skips, commands/raw JSON paths and source hashes, not cumulative pass totals. New source/test edits invalidate old gate evidence.

## Exit / risk / stop

Phase1 milestone only if actual positive and price/reopen/projection plus own ACK pass both adapters and unassociated controls preserved. Phase2 retry/proxy/resource acceptance not inherited. More than8files is justified by separated persisted policy, raw parser, private integration and real fixtures—not additional ledger services. If existing helper extraction broadens scope, choose narrower integration or stop with named prerequisite. No migration without separate source/schema review. Explicit complete-absent/malformed errors cannot be waived to pass tests. Historical DB uncertainty and legacy-persistence exclusion remain.

## Execution receipt — selected fixture scope only

Completed within the child's selected Linux Node SQLite/SQL.js fixture scope. Frozen final `b22e7657f`: 1162 reported test cases across65suites,0failed/skipped; all5isolated batches and original comparators passed. Original price, own-ACK, transport/error-fidelity, durability/budget and affected gates are mapped in [E1 evidence](./references/e1-acceptance-evidence.md). Exact commands/raw reports and1693unchanged source/input hashes are preserved in `plans/reports/evidence/261031-e1-embeddings/`. Eight audited inherited title-collision groups use exact multiplicity exceptions; new E1 identities are unique. LSP20paths inconclusive despite0diagnostics; scoped ESLint passed. No independent subagent/full-code Advisor approval claimed. Production OFF; legacy presentation/historical realDB uncertainty and all broader owner/platform/release exclusions remain. Historical future-command/pending prose above records planning, not current status.
