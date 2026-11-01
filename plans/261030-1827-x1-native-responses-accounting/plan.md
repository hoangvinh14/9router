---
title: "X1/R1 — Native Responses accounting"
description: "Child đầu của full X1: native Responses token-only JSON/SSE, own ACK và budget trên selected fixtures."
status: completed
priority: P2
effort: "3 phase tuần tự; chưa estimate"
branch: develop
tags: [accounting, responses, budgets]
blockedBy: [261018-0213-durable-chat-accounting, 261030-0252-simple-budget-policy]
blocks: [261018-0215-responses-embeddings-accounting]
created: 2026-10-30
---

# X1/R1 — Native Responses accounting

## Overview và contract

Người dùng chọn **toàn X1, giao từng owner; Native Responses JSON/SSE trước**. Đây là child R1 executable, không là lệnh chạy nguyên X1. [Brainstorm quyết định](../reports/brainstorm-261030-x1-responses-embeddings-direction.md) và [full X1 owner map](./references/x1-owner-map.md) giữ các obligation tiếp theo OPEN/BLOCKED.

- **Outcome:** dynamic OpenAI-compatible node `apiType=responses` có per-actual-POST accounting, raw exact usage, original price/startedAt, own durable ACK và weekly/monthly budget.
- **Constraints:** [B1](../261030-0252-simple-budget-policy/plan.md) là policy authority; stable key isolation, single writer, auth/ACL/CSRF và transport/SSRF guards giữ nguyên. Linux Node SQLite + SQL.js, fixture-only activation; production OFF.
- **Non-goals:** hosted paid tools/media/resources/async Responses, Codex/GitHub/compact/registry producers và embeddings implementation trong child này; không loại chúng khỏi full X1. Không P5/recovery/reservations/hard cap, routing/Fusion rewrite, real DB, commit/push/deploy hoặc activation.
- **Acceptance:** native upstream JSON→JSON, native SSE→SSE và SSE→client JSON có actual socket→raw evidence→ledger→own ACK; exact failed usage, interruption, retry/fallback/drift/revoke, late/duplicate/restart, thresholds/increase/rollover/two keys và affected consumers. Refusal-only không chứng minh support.

## Implementation checkpoint — R1 fixture-scoped complete

User authorized continuation after the safety stop. **Fixture isolation and asynchronous teardown safety** now has current-source 4/4 evidence (`b1113bf65`) and Advisor review for future Linux execution only through `tests/fixtures/accounting/run-isolated.mjs`. Legacy presentation persistence is explicitly excluded; real ledger/pricing/transport remain active. Historical real-database access/mutation cannot be excluded and was not inspected/remediated. Phase1 selected JSON milestone passes239/239 plus16/16 supplemental, lint0 and LSP9clean. Phase2 native SSE/converter milestone passes183/18315suites,lint0,LSP10clean; phase checkboxes/CLI advanced toPhase3. Phase3 final unchanged-source gate `b047216d6`733/73342suites498.92s,0failed/pending/todo;1661source/input hashes unchanged, comparator0,lint0,LSP15clean. All3phases complete **only for selected Linux NodeSQLite/SQLjs fixtures**; no production/build/serving/release or parentX1/R acceptance. No activation/commit/push/deploy. [Case/adapter map](./references/r1-acceptance-evidence.md) and [durable raw evidence bundle](../reports/evidence/261031-r1-native-responses/) retained. Earlier224/224 remain historical, not current acceptance. [Implementation receipt and reached/unreached gates](../reports/implementation-261031-r1-native-responses.md).

Phase file checkboxes and CLI show3/3phases40/40tasks complete. Only R1 fixture scope is accepted; parentX1/R and R2–R4/C1/E1–E4 stayOPEN/BLOCKED. E1 is next separate hydration handoff, not auto-implementation.

## Chosen direction / dependencies

Reuse ledger + actual transport hook; tách closed-set protocol strategy cho authority/wire/raw parser/terminal. Không reuse Chat `[DONE]` hoặc translated usage cho Responses. [Protocol/pricing/ACK contract](./references/responses-contract.md) là authority chi tiết. Trade-offs và better approach rationale ở brainstorm linked phía trên.

P3/B1 selected prerequisites được tài liệu ghi complete, không có nghĩa Responses đã support. Phase 1 phải chứng minh pricing endpoint `chat` tương thích Responses token inference (rate/snapshot/persistence/reporting); nếu không, STOP lập named prerequisite thay vì âm thầm thêm schema. X5 chỉ named seam trong selected Base/account fallback/direct+strict HTTP proxy; OAuth-positive/full proxy matrix/Fusion không thừa hưởng closure. Node/SQL.js selected fixtures không thay Bun/better/Windows/R parity.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Authority, strict usage và raw JSON](./phase-01-start.md) | Complete — scoped milestone |
| 2 | [Native SSE, terminals và consumers](./phase-02-native-sse-consumers.md) | Complete — scoped milestone |
| 3 | [Actual-boundary, durability và budget acceptance](./phase-03-actual-boundary-acceptance.md) | Complete — fixture-scoped final gate |

## Success Criteria

- [x] Phase 1: protocol authority/eligibility + raw JSON actual positive, pricing compatibility và Chat regression pass; associated native JSON counters/details/total unchanged, unassociated baseline frozen.
- [x] Phase 2: native SSE + forced JSON intended positives, terminal/ACK/cancel matrix, bounded lifecycle pass; explicit converter/two-caller fidelity and B1 raw-evidence/late-sink gates.
- [x] Phase 3: hai adapter actual durability/budget/security/affected gates có receipt; không missing mandatory evidence.
- [x] Chỉ R1 được accepted; parent X1/R vẫn OPEN, production OFF và full owner map cập nhật truthful.

## Execution rules

Ba phase tuần tự, một writer cho shared authority/boundary/consumer files. Không hydrate follow-up owners thành quyền auto-implement. Re-read source/dirty state trước cook; historical planning commands are superseded for execution by the isolated runner amendment in Phase3; final reached gates and exact commands/results are in the receipt. Failure protocol: stop + report reached/unreached khi exact authority/price/ACK/safety fail; không nới profile/default zero/bỏ guard/tăng timeout để xanh. Handoff chỉ `/ak:cook /home/gmo/projects/9router/plans/261030-1827-x1-native-responses-accounting/plan.md` khi người dùng yêu cầu implementation; không tự thêm `--auto`.

## Planning verification

Source reviewed ở `develop` `18a27a1b`; runtime chưa sửa/chưa test trong phiên planning. CLI scaffold tạo child + 3 phase, clock CLI dùng UTC 2026-10-30 (local 2026-10-31). Link/path/format checks và final review được ghi tại [planning receipt](../reports/planning-261030-x1-native-responses.md). User clarification: 2 questions, both answered; không hỏi lại B1. Technical stop gates nằm trong phases, không phải unresolved product scope.

## Validation Log

### Session 1 — 2026-10-31

**Trigger:** User requested `validate /home/gmo/projects/9router/plans/261030-1827-x1-native-responses-accounting/plan.md`.
**Questions asked:** 3; all answered explicitly. Planning-only corrections approved; no implementation/activation permission inferred.

#### Verification Results

- **Tier:** Standard — Fact Checker + Contract Verifier, 10 sampled claims per phase.
- **Claims checked:** 30. Intake: **Verified 27 | Failed 3 | Unverified 0** for the sampled source/path/plan-coverage claims, not runtime acceptance.
- **After approved correction:** 3 documentation failures resolved; **outstanding Failed 0**. This does not turn proposed implementation into passing runtime evidence.
- Evidence table, caller map, exact in-memory probe/reproduction and limitations: [validation receipt](../reports/validation-261031-x1-native-responses.md).
- No Red Team Review evidence section exists in this child; source verification was performed, not skipped. No delegation or multi-agent review.

#### Failures at intake — now corrected in plan, runtime still unchanged

1. **Phase 1 consumer coverage:** `open-sse/handlers/chatCore/nonStreamingHandler.js:314-315` mutates native usage through buffer/filter; `usageTracking.js:33-55,85-89` adds 2000 and excludes total_tokens for Responses. Probe: native input 10 became 2010 and total 13 disappeared. Ownership and exact associated-native assertions were missing.
2. **Phase 2 converter coverage:** `streamToJsonConverter.js:30-38,49-105` ignores incomplete, drops terminal fields/details, and maps done to completed. Probe: native incomplete terminal became in_progress/empty output/zero usage. Transformer ownership was only conditional, and both callers were not enumerated.
3. **Phase 2/3 regression completeness:** minimum commands omitted existing `b1-usage-evidence.test.js` (raw boundary consumers) and `b1-late-chat-sink.test.js:8-35` (both engines, disposal, original price/time, duplicate/conflict). Stored startedAt alone is not an original-window projection assertion.

#### Questions & Answers

1. **[Architecture / Native JSON]** Should R1 preserve exact native client-visible JSON usage, rather than applying the current +2,000-token buffer and field filtering?
   - Options: Preserve native usage (Recommended) | Keep legacy presentation.
   - **Answer:** Preserve native usage (Recommended).
   - **Custom input:** None.
   - **Rationale:** Freeze exact associated-native counters/details/zero while retaining default/unassociated baseline; ledger must not consume buffered presentation usage.
2. **[Architecture / SSE conversion]** Should Phase 2 explicitly require native terminal preservation in the SSE→JSON converter, including incomplete/failed status, terminal output, usage details, and compatibility-event status?
   - Options: Require preservation (Recommended) | Split a prerequisite.
   - **Answer:** Require preservation (Recommended).
   - **Custom input:** None.
   - **Rationale:** Truthful terminal outcomes require an explicit converter owner and compatibility checks for both callers; native done must respect its validated embedded status.
3. **[Scope / Regression gate]** Should the minimum regression gate explicitly include B1 raw-evidence and late-sink tests, plus targeted tests for the affected native JSON/converter contracts?
   - Options: Add explicit gates (Recommended) | Keep validation blocked.
   - **Answer:** Add explicit gates (Recommended).
   - **Custom input:** None.
   - **Rationale:** Raw-boundary and retained-sink changes can regress B1 even when the existing minimum subset passes.

#### Confirmed Decisions

- Exact native JSON usage in accounting-associated R1; no +2000/filter loss. Internal association is authority, not a client flag or new activation mechanism. Unassociated baseline unchanged.
- Converter terminal fidelity is mandatory Phase 2 work, not optional discovery. Two source callers explicitly covered; Workers responsesHandler remains compatibility-only, not the actual R1 route.
- Add direct converter contract tests, actual consumer assertions, both B1 regression gates and original-window projection checks on Node SQLite/SQL.js.
- B1 policy, pricing-chat compatibility stop gate, owner map, no production activation and no broader-X1 completion claims remain unchanged.

#### Action Items

- [x] Phase 1: add native JSON consumer/usage-helper impact and paired associated/unassociated acceptance.
- [x] Phase 2: add converter owner, explicit two-caller checks and proposed `responses-stream-to-json-contract.test.js`.
- [x] Phases 2/3: add B1 evidence/late-sink suites and original-window projection assertions.
- [x] Propagate summary/protocol contract, preserve pending implementation state and reconcile whole plan.

#### Impact on Phases

- Phase 1: ownership, tasks and exit criteria extended; no new schema or global presentation rewrite.
- Phase 2: converter ownership/caller matrix, tests and command updated; terminal accounting authority stays at raw boundary.
- Phase 3: native fidelity acceptance, focused/affected command lists and explicit B1 regression requirements updated.
- Protocol reference: approved fidelity/consumer scope recorded; owner map unchanged because no new inference owner is added.

#### Whole-Plan Consistency Sweep

- Files reread: `plan.md`, all 3 phase files, `references/responses-contract.md`, `references/x1-owner-map.md`; receipt reviewed separately.
- Decision deltas checked: 3. Reconciled stale coverage groups: 3 (native JSON, converter, regression gates).
- Unresolved contradictions: 0. Local link/proposed-file/command and document checks recorded in receipt.
- **Recommendation:** ready for user-authorized Phase 1 implementation, conditional on its explicit source/price/eligibility/adapter gates. Not runtime support, not accepted R1, not permission to cook automatically. All three phases remain Pending; production OFF.

<!-- Updated: Validation Session 1 - all three user-approved consumer/regression corrections propagated; implementation remains pending -->

<!-- Live CLI add-phase creates phase files but leaves the scaffold table unchanged; this file-first index reconciles all three phases. Phase completion remains checkbox/CLI check driven. -->

<!-- slug: x1-native-responses-accounting -->