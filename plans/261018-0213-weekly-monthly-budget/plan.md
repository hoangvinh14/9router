---
title: "P4 — Budget tuần/tháng và key UI"
description: "Calendar spend threshold trên ledger P3; management API/UI và end-to-end fixture acceptance, production OFF."
status: completed
priority: P1
effort: "Chưa estimate; ba phase tuần tự, preflight trước implementation"
tags: [budgets, dashboard, calendar]
blockedBy: [261018-0213-durable-chat-accounting]
blocks: [261018-0213-accounting-recovery]
created: 2026-10-18
---

# P4 — Budget tuần/tháng và key UI

## Contract
- **Outcome:** admin có budget editor và thấy weekly/monthly spent, remaining, overshoot, reset, pending/unresolved và health/coverage. Flow P3 được chọn thực sự ghi tiền, chạm threshold và refuse attempt tiếp theo; restart/calendar reset không mất allowance hay identity.
- **Constraints:** `null` unlimited, `0` block, invalid/negative/overflow rejected; fixed `Asia/Ho_Chi_Minh`, Monday 00:00 và ngày 1 00:00. Exact nanoUSD/BigInt; ledger là truth. Attempt thuộc kỳ `startedAt`; unresolved không tự hết. **Soft recorded-spend threshold, không reservation/hard cap**; nhiều request in-flight có thể cùng vượt budget, không có bound một request.
- **Non-goals:** mở coverage provider/protocol/fusion; redesign ACL; response cache; cron reset; bảng counters tiền mới; recovery/restore UI của P5; production/public/synchronous activation. Không commit/push/merge từ việc sửa plan.
- **Acceptance:** actual UI → guarded API → P3 app/core/transport → dummy upstream → durable ledger → UI → refusal → reopen/restart → calendar reset, JSON/SSE và hai keys trên Node SQLite/SQL.js. Both-window metadata, no-store/CORS và selected-profile native errors được kiểm tra tại actual boundary; không chỉ helper/unit tests.

## Historical evidence — clarification after P3 (superseded below)

P3 đã complete theo [final reconciliation](../reports/implementation-261028-1243-chat-plan-completion.md), chỉ selected `openai-chat-explicit-details`, Node SQLite/SQL.js. Production vẫn OFF; `associateChatAccountingFixture` là private WeakMap association, không có request/header/env/setting kích hoạt production. P4 **chưa implementation, chưa có test acceptance mới**.

Source inspection xác nhận policy table/version và migration đã tồn tại; ledger có index và `sumSpendSync` BigInt. Chưa có budget calendar gate, budget API hoặc panel trên nhánh hiện tại. Chat catch còn flatten accounting refusal thành generic 503. Xem [solution và source map](./solution-design.md) để biết phần reuse, phần phải bổ sung và các semantics đã chốt.

## Phases — tuần tự

| # | Phase | Status |
|---|-------|--------|
| 1 | [Preflight và calendar/enforcement trên P3](./phase-01-start.md) | Complete — scoped evidence below |
| 2 | [Guarded budget API và key UI](./phase-02-management-ui.md) | Complete — scoped API/UI/CLI evidence |
| 3 | [Actual end-to-end và affected acceptance](./phase-03-acceptance.md) | Complete — selected fixture acceptance; production OFF |

Phase 1 phải chứng minh test-web harness có thể gọi actual handler/routes mà không thêm shipping activation channel **trước khi coi browser flow khả thi**. Không đạt thì dừng, ghi evidence và review seam; không thay bằng mock-only rồi đánh dấu DONE.

## Chosen direction / trade-offs

| Approach | Giả định chính | Hỏng sớm khi |
|---|---|---|
| **Ledger-derived calendar windows + P3 lifecycle (chọn)** | Indexed ledger và short synchronous gates đủ cho workload đã đo | Scan/authority overhead vượt gate; phải đo lại, không tự thêm cache |
| Materialized weekly/monthly counters + reset job | Mọi settlement/recovery/import/reset cùng cập nhật atomic | Late settlement, restart hoặc recovery làm lệch counters so với ledger |
| Port nguyên old budget service | Authority/schema/routing cũ còn cùng semantics | Ghi đè persisted authority, ACK và ACL mới của P2/P3 |

**Better approaches:** thay vì coi “policy/API/UI cũ” là một module port nguyên khối, reuse policy/schema/ledger/ACK hiện tại và chỉ port calendar, validation, error contract, draft/panel có chọn lọc. Evidence: schema `apiKeyBudgetPolicies` và P3 dispatch boundary đã có; old management finite PUT tự refuse khi inactive. Operational delta: một nguồn tiền và một POST authority, không thêm job/counter. Cost: adapt old candidates, thêm error propagation và harness; không kế thừa green từ stash.

## Exit obligations / scope locks
- Edits lower/raise/null/re-enable và key toggle không reset spend, pending, coverage hoặc identity. Unlimited vẫn record; bật limit gặp old unresolved thì refuse admission. Missing price candidate-local; exhausted/unresolved/storage là terminal, không fallback/cooldown vòng quanh.
- Cả weekly/monthly cùng hiệu lực; Retry-After dùng reset muộn nhất của blocked windows. `0` không tự mở lại khi reset; metadata/UI phải nói cần đổi policy, Retry-After chỉ advisory trong trường hợp đó.
- Settlement dùng original price và immutable `startedAt`, kể cả policy đổi hoặc reset; calendar selection không xóa history. Unresolved/gap/maintenance không tự clear theo clock/restart.
- Giữ `KeyAccessControls`, `accessRestricted/accessAllow`, key CRUD và inference ACL. Auth-first JWT/verified direct local/Origin guards được reuse; named key-CRUD guard prerequisite nằm trong phase 2, không đợi P5.
- Show reference cost, inactive enforcement, precise selected scope, coverage start, overshoot và unknown khác 0; keyboard/mobile và ACL+budget edits không mất draft/state.
- Production finite PUT bị từ chối `409 accounting_not_ready`; không có deployment flag để vượt gate. Full recovery trước production activation vẫn là prerequisite. Fixture success không chứng nhận all-protocol budget; toàn AC2/3/12 chỉ đóng ở R sau coverage mở rộng.

## Execution — 2026-10-28: P4 scoped completion

User authorized `ak-cook --auto`; execution is on `feat/weekly-monthly-budget`
from develop `b41dca0a`. [Preflight receipt](../reports/implementation-261028-p4-preflight-blocked.md)
records the passing 488-test affected baseline and failed test-only web seam.
Actual unauthenticated guarded HTTP passed, but real source login returned500:
`cookies` was called outside a request scope. An observation-only diagnostic
confirmed the missing Next request lifecycle; authenticated UI/inference/ledger
assertions were not reached. SQL.js web acceptance was not attempted after the
common seam failure. No shipping feature source or production activation changed.

**Seam revision authorized:** after the diagnostic, user selected revision of the
test-only real-Next-lifecycle seam. Advisor reviewed the candidate; actual
`AppRouteRouteModule` now owns request contexts/proxy/cookie finalization. The
[auth-only proof](../reports/verification-261028-p4-next-auth.json) passes browser
login → real cookie → guarded GET. This supersedes the pause for that narrowly
authorized investigation, not the feasibility gate: full actual POST/ledger,
associated/unassociated isolation and both adapters were subsequently proven by
[the revised preflight receipt](../reports/implementation-261028-p4-web-preflight.md):
seven controls each on actual Node SQLite/SQL.js, including independent persisted
image verification and two-key concurrent isolation. The harness prerequisite is
closed. [Phase1 completion receipt](../reports/implementation-261028-p4-phase1-progress.md)
records386/386 consolidated controls,106/106 final controls, current-code
independent process restart2/2, scoped lint and preserved/regression-repaired
failed evidence. Phase1 checkboxes are complete; phase2 API/UI/security prerequisite
is complete for the selected scope. The hybrid runner does not claim full middleware/standalone equivalence.
[Phase2 progress](../reports/implementation-261028-p4-phase2-progress.md) records final
19-check compiled-panel flows on each adapter (including CLI authenticated CRUD,
failed-read freshness, keyboard and late-key response isolation), plus8 detached
shipping checks on `.next-budget-freshness` build `PAbPyLpr4xQerMRevrlP5`.
Earlier proxy-cache, selector and stale-display failures remain preserved with repairs.
Phase3 is complete within the [final receipt](../reports/implementation-261028-p4-completion.md):
final affected controls726/726, both-adapter process restart/crash4/4, final paired CI
with no newly unexplained failure (suites remain red), build/standalone/browser and
[acceptance trace](../reports/verification-261028-p4-acceptance-trace.md). Initial1920-request
measurement showed material elapsed regressions; the480-request ABBA repeat and
[performance review](../reports/verification-261028-p4-performance-review.md) document
observed+6.26% diagnostic summed elapsed and roughly+7–11% finite cells. This supports
retaining the selected fixture design, not a bound/SLO/equivalence or production approval.
All production/recovery/coverage scope locks remain. Five exact-base Endpoint hook
lint errors/two warnings and incomplete LSP coverage are disclosed; no independent
full-source audit is claimed. P5/X1–X6/R remain open; no Git publication/deployment.

## Historical validation / next step (before implementation authorization)

Đây là clarification theo source inspection và hai lượt Advisor review, không phải nghiệm thu code. Static validation đã kiểm tra local Markdown links của cả năm P4 documents và roadmap: không broken link; `git diff --check` sạch. Không chạy runtime tests/build/browser vì chưa sửa feature code. [Phase 3](./phase-03-acceptance.md) có commands và matrix **dự kiến**, không được báo đã chạy. Status giữ `pending` tới khi có yêu cầu implementation riêng. Không tự chạy `/ak:cook`.

[Roadmap/contract](../261018-0213-api-key-budget-roadmap/plan.md) và [contract gốc](../261018-0213-api-key-budget-roadmap/references/legacy-design-contract.md) vẫn authoritative. Common failure protocol: bounded diagnosis, giữ failed evidence, không đổi deadline/guards/concurrency để lấy green; unresolved blocker thì dừng và hỏi, không activate.

<!-- slug: weekly-monthly-budget -->
