---
title: "X1/E1 — OpenAI-compatible embeddings accounting"
description: "Selected persisted dynamic API-key nodes: exact per-POST embeddings usage, own ACK và B1 budgets trong isolated fixtures."
status: completed
priority: P2
effort: "3 phase tuần tự; chưa estimate"
branch: develop
tags: [accounting, embeddings, budgets]
blockedBy: [261030-1827-x1-native-responses-accounting, 261030-0252-simple-budget-policy]
blocks: [261018-0215-responses-embeddings-accounting]
created: 2026-10-31
---

# X1/E1 — OpenAI-compatible embeddings accounting

## Overview và contract

Người dùng đồng ý E1 sau brainstorm và sau đó explicit `/ak:cook <this-plan> --auto`; implementation/verification hoàn tất **chỉ selected Linux fixture scope**, không production/release. HOLD SCOPE: reuse ledger/pricing/transport, không mở toàn bộ embeddings providers. [Source, profile và ownership contract](./references/e1-contract.md) là chi tiết bắt buộc; [planning verification](./references/planning-verification.md) không là runtime evidence.

- **Outcome:** selected persisted dynamic `openai-compatible-*` nodes, API-key auth, synchronous `/embeddings` JSON có một attempt mỗi actual POST; raw exact usage, original `embeddings` price/startedAt, own durable ACK và weekly/monthly budgets.
- **Constraints:** [B1](../261030-0252-simple-budget-policy/plan.md), key isolation, single writer, persisted auth/ACL/model/proxy authority trước/sau awaits và tại wire; Linux Node SQLite + SQL.js fixtures qua isolated runner. Production OFF; R1 uncommitted phải được bảo toàn.
- **Non-goals:** E2 GitHub OAuth, E3 Gemini, E4 custom/selfhosted/registry exceptions; async Batch API/SSE, rate/catalog expansion, hard cap/reservations/recovery, real DB, production/build/UI/CLI/release acceptance, commit/push/deploy. Single/batch input trong một synchronous POST vẫn thuộc E1.
- **Acceptance:** four input shapes, float/base64, raw positive và valid failed usage; strict profile/price/response bounds, initial/retry seam và actual account fallback, signal/timeout/proxy/redirect/drift, own ACK/gap ACK, late/duplicate/conflict/restart, original-window/two-key/threshold/rollover/overshoot và affected Chat/R1 consumers. Refusal-only không là support.

## Current execution checkpoint

User explicitly authorized `/ak:cook <this-plan> --auto`. All3phases completed for selected private Linux Node SQLite/SQL.js fixtures only. Final frozen `b22e7657f`: **1162/1162 reported test cases,65/65suites,0failed/skipped**,5isolated batches; original comparator passed each report,1693source/input hashes unchanged. [Case map and limits](./references/e1-acceptance-evidence.md), [implementation receipt](../reports/implementation-261031-e1-embeddings.md), raw reports/manifests at `plans/reports/evidence/261031-e1-embeddings/`. Eight audited inherited title-collision groups explicitly excepted; no unique parameter identity claim for those rows. ESLint passed; LSP20paths inconclusive despite0diagnostics. Existing R1 delta preserved. Production OFF; parent X1/R and other owners remain OPEN/BLOCKED. No real DB/build/commit/deploy. Earlier diagnostic failures and collection-verifier correction retained.

## Historical planning checkpoint

Planning-only trên `develop` `18a27a1b`; 88 dirty entries trước scaffold, 0 staged. R1 receipt733/73342suites là historical fixture evidence, không phải E1 hoặc production acceptance. **E1 implementation/tests chưa bắt đầu; cả3phase Pending.** Historical real-DB access/mutation không thể loại trừ; không điều tra hay remediation. Legacy presentation persistence bị disable trong sandbox và vẫn ngoài chứng nhận.

## Chosen direction và trade-offs

Reuse service/exact money/ledger và `proxyAwareFetch` actual boundary; thêm embeddings-specific strict profile + narrow persisted authority/session + JSON boundary. Không reuse Chat explicit detail counters hoặc Responses stream machinery. Default E1-local bounded JSON owner; shared `accounted-base.js` reader cannot be reused unchanged (awaited cancellation and partial-read evidence mismatch). Extract shared private helpers chỉ khi giảm duplication mà không nới guards; không rewrite Chat session hay thêm migration mặc định.

| Approach | Assumption lớn nhất | Hỏng sớm khi / trade-off |
|---|---|---|
| **Shared invariants, embeddings-specific policy — chọn** | Có thể bind endpoint/profile mà không nới Chat/R1 authority | Shared refactor admit sai owner; cần paired regressions, nhưng tránh duplicate durable protocol |
| Copy toàn Chat accounting stack | Hai stack giữ cùng safety invariants lâu dài | Own ACK/B1 fixes lệch; localize nhanh nhưng tăng maintenance, không chọn |
| Giant full-X1 implementation | OAuth và Gemini exact schema đều sẵn | E3 blocker hoặc custom transport giữ toàn delivery; không chọn |

**Better approaches:** raw actual-POST boundary tốt hơn nối `saveRequestUsage`: entry chỉ log success sau normalize, core có2fetch và error parse riêng. Operational delta: không bỏ failed attempt hoặc retry; switching cost là narrow profile/session/boundary + regressions, không ledger rewrite. Đây là refinement của E1 đã chọn, không đổi mục tiêu X1.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Authority, strict raw usage và embeddings price](./phase-01-start.md) | Completed — selected fixture scope |
| 2 | [Transport, cancellation và own ACK integration](./phase-02-transport-ack-integration.md) | Completed — selected fixture scope |
| 3 | [Durability, budgets và affected acceptance](./phase-03-durability-budget-acceptance.md) | Completed — selected fixture scope |

## Success Criteria

- [x] Phase1: selected positive actual POST→raw→price→ledger→own ACK trên cả2adapters; strict input-only profile, target/price gate và unassociated baseline.
- [x] Phase2: actual account fallback sau eligible predecessor own ACK; unsupported refresh không phát successor; effective strict proxy/redirect/signal/timeout/authority, raw fidelity/late/terminal failure gates; final selected valid-usage HTTP error preserves status/body bytes through core+account exhaustion, with safe headers/refusal precedence and unchanged unassociated wrapping.
- [x] Phase3: crash/reopen, weekly/monthly/two keys/original window và unchanged-source focused+affected evidence đầy đủ; E1-specific activation guard plus forbidden-caller negative control; không skipped mandatory case.
- [x] Chỉ E1 selected fixture scope được xem xét acceptance; X1/R và R2–R4/C1/E2–E4 vẫn OPEN/BLOCKED; production OFF, legacy persistence exclusions giữ nguyên.

## Execution rules và handoff

Một writer cho shared files; phase2 phụ thuộc phase1, phase3 phụ thuộc phase2. Không chạy từ envelope X1. Tất cả runtime chỉ qua `node tests/fixtures/accounting/run-isolated.mjs <unit paths>` ở repo root; không ordinary Vitest, server hoặc real provider/DB. Runner failure/isolation drift: STOP; không bypass sandbox. Missing authority/profile/price trước wire: refuse no POST; malformed/complete-absent sau wire giữ safety; interrupted+absent dùng B1 nonblocking `unrecorded`, không synthetic zero.

DefaultExecutor không có dynamic OAuth refresher; E1 không tạo mới. Hai fetch sites phải dùng cùng optional dispatch seam; selected refresh/mutation refused trước successor, unassociated refresh compatibility vẫn tested. Không gọi seam tests là OAuth-positive support. Mọi shared extraction cần Chat/R1 gate; schema change, unsupported rate dimensions hay mutation không có authority là named prerequisite, không lén mở scope.

Khi người dùng yêu cầu implementation: `/ak:cook /home/gmo/projects/9router/plans/261031-1335-x1-e1-embeddings-accounting/plan.md`. Không tự thêm `--auto`. Final verification commands/test inventory và stop protocol nằm trong phases. Plan pending không có nghĩa user đã cho chạy runtime.

## Validation Log

Creation self-verification và Advisor review được ghi tại [planning verification](./references/planning-verification.md). Source/contract verification chỉ chứng minh kế hoạch bám source, không chứng minh future code đúng. Không independent subagent/red-team approval. Không hỏi lại B1 hoặc priority đã được chấp thuận.

### Session 1 — 2026-10-31

**Trigger:** Explicit `/ak:plan validate` of this child. **Questions asked:** 2. **Scope:** docs-only; no implementation/runtime authorization. Source `develop` `18a27a1b`, intentional R1 dirty state preserved. [Current source checks and caller inventory](./references/validation-session-1.md); creation self-verification above remains historical, not this validation's evidence.

#### Verification Results

- **Tier:** Standard; Fact Checker + Contract Verifier, 10 sampled claims/phase.
- **Claims checked:** 30. **Before interview:** Verified28 | Failed1 | Unverified1.
- Failed coverage claim: unchanged `tests/unit/budget-activation-boundary.test.js:7-15` guards only budget+Chat fixture helpers; cannot certify proposed E1 helper activation-off.
- Unverified contract: current core `open-sse/handlers/embeddingsCore.js:112-116` consumes/wraps HTTP error, entry `src/sse/handlers/embeddings.js:106-117,159-168` replaces exhausted-account errors; plan required raw fidelity without explicit end-to-end behavior.
- Additional verified prerequisite: `accounted-base.js:11-29,46-49` shared JSON reader has unbounded awaited cancel and partial-read→absent handling; E1 cannot inherit unchanged.
- 55 existing distinct unit paths present;9missing E1 paths explicitly Proposed. No unexpected missing paths. No tests executed.
- **After confirmed plan corrections:** outstanding planning Failed0 | Unverified0 for sampled claims. Future gates remain unexecuted; this is not runtime acceptance.

#### Questions & Answers

1. **[Architecture / Compatibility] For selected E1 requests, when an upstream HTTP error contains valid exact usage, what should happen to the client-visible response after accounting completes?**
   - Options: **Preserve final error (Recommended)** — Keep existing account-fallback policy. If the last upstream error is returned and accounting/authority permits it, preserve its status and raw JSON body, including account-exhaustion paths; forward only explicitly safe headers. Budget/safety refusals still take precedence. Unassociated behavior stays unchanged. | **Preserve at raw boundary only** — Keep original status/body for raw accounting evidence and replay into core; retain existing core/client error wrapping and exhausted-account response behavior. Narrow the plan's client-fidelity claims accordingly.
   - **Answer:** Preserve final error (Recommended).
   - **Custom input:** None.
   - **Rationale:** Raw replay alone does not preserve the final client response through destructive core/entry wrappers. Selected errors remain failed requests; settled usage alone cannot bypass fallback/refusal policy.
2. **[Security / Verification] May I update the plan to close the activation-guard coverage gap and make the JSON-reader prerequisite explicit, without expanding implementation scope?**
   - Options: **Add explicit gates (Recommended)** — Plan an embeddings-helper activation guard with a failing forbidden-caller control; default to an E1-local bounded JSON owner, because the shared reader cannot be reused unchanged. Shared extraction still requires caller audit and Chat/R1 regressions. Docs only; no cook. | **Record as open blockers** — Leave phase instructions unchanged, record these findings as unresolved, and mark the plan for revision rather than ready for implementation.
   - **Answer:** Add explicit gates (Recommended).
   - **Custom input:** None.
   - **Rationale:** An unchanged two-helper guard cannot cover a new E1 capability; shared reader behavior cannot satisfy E1's existing bounded cleanup and partial-evidence contract.

#### Confirmed Decisions

- Preserve final selected valid-usage upstream error status/raw body after own ACK, including exhaustion; fallback eligibility/bookkeeping unchanged, later success wins, local budget/authority/recording refusals take precedence.
- Upstream header allowlist: `Content-Type` only; local CORS/no-store/request-id headers owned locally. Do not replay credentials/cookies/Location/hop-by-hop/Content-Length/Content-Encoding. Unassociated wrapping unchanged.
- E1-local bounded JSON owner by default; no blind shared-reader reuse or incidental Chat/R1 semantic changes. Shared extraction still requires caller inventory and paired regressions.
- Extend activation guard for proposed `associateEmbeddingsAccountingFixture`/sole declaring module, shipping src+open-sse inventory and same-scanner forbidden-caller negative control; no real shipping activation for that control.
- B1 policy, selected E1 profile/priority, production OFF and exclusions unchanged. No cook authorization.

#### Action Items / Impact on Phases

- [x] Phase1: name E1-local reader prerequisite and selected error-byte retention/allowlist; update P1.5.
- [x] Phase2: bind final-error fidelity through core and exhausted accounts, refusal precedence, safe headers and bounded reader lifecycle; update P2.8.
- [x] Phase3: explicitly own activation test modification/negative control and cumulative final-error matrix; update P3.5 and exit gate.
- [x] Reconcile index and E1 contract; retain proposed files, pending phases and 8/10/8 execution tasks.
- [x] Add source evidence/caller inventory at `references/validation-session-1.md`; no historical receipt overwritten.

#### Whole-Plan Consistency Sweep

- Files reread: index, all3phases, E1 contract, creation history and current validation reference.
- Decision deltas: 3 (final selected error contract; E1 activation guard; local bounded JSON owner).
- Reconciled current guidance: index +3phase files +contract; historical creation verification preserved as historical.
- **Unresolved contradictions:0.** Current guidance reconciled across5files; historical self-review remains historical. Final selected error replay requires complete, within-cap, validated usage and own ACK; partial/oversize/read-error cases retain local refusal precedence. E1 guard/negative control is mandatory for fixture acceptance, never permission for production enablement.
- Static checks:11relative file links,0broken (anchor validity not separately certified);9future fenced runtime commands all isolated;55existing command test paths/9explicitly proposed missing. A whole-prose scan initially counted56 existing paths by including the excluded cloud suite and failed its count assertion; corrected command-only check passed55. No runtime rerun implied.
- CLI `ak plan validate`:valid=true; `ak plan status`:pending,0of3phases completed,0of26implementation tasks completed. `git diff --check`:exit0. Markdown tooling initially warned unavailable for two edits; no runtime LSP/JS checks claimed.
- Advisor final summary review found no conceptual blocker, conditional on actual documents; full files/diff were not supplied to Advisor, so not independent code/document approval. Clarified bounded replay and mandatory activation gate per that review.
- **Recommendation:** planning validation complete, eligible for implementation only after separate user authorization. No unresolved planning questions from this session; implementation remains unstarted. Required activation/final-error/runtime gates are specified, NOT passing or executed. Production OFF and exclusions unchanged.

<!-- CLI add-phase tạo phase files nhưng scaffold table không tự expand; file-first index đã reconcile đủ3phases. -->
<!-- slug: x1-e1-embeddings-accounting -->
