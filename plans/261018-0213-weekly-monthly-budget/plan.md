---
title: "P4 — Budget tuần/tháng và key UI"
description: "Đóng một flow quản trị đến inference đến ledger đến UI trên path P3."
status: pending
priority: P1
effort: "Chưa estimate"
tags: [budgets, dashboard, calendar]
blockedBy: [261018-0213-durable-chat-accounting]
blocks: [261018-0213-accounting-recovery]
created: 2026-10-18
---

# P4 — Budget tuần/tháng và key UI

## Contract
- **Outcome:** admin đặt limit và thấy spent/remaining/reset/pending/unresolved; actual P3 request chạm limit rồi bị refuse, restart/reset đúng.
- **Constraints:** null unlimited, zero block, negative/invalid rejected; Asia/Ho_Chi_Minh Monday00:00/day1; startedAt kỳ cũ settle về kỳ cũ; unresolved không tự hết; no reservation/hard cap.
- **Non-goals:** mở coverage provider/fusion; redesign key ACL UI; live production activation hoặc bỏ recovery prerequisites.
- **Acceptance:** real UI→API→inference→ledger→UI→threshold→restart→calendar reset, both-window headers/native errors và hai keys; không chỉ helper/unit tests.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Chuẩn bị slice budget](./phase-01-start.md) | Pending |

## Reuse / ownership
Old policy/windows/management HTTP/draft/ApiKeyBudgetPanel/browser tests và key usage projection; integrate vào EndpointPageClient mới, **giữ KeyAccessControls và accessRestricted/accessAllow**. Auth-first JWT/verified local/Origin guards từ P1/P2 reuse, không tạo auth logic song song.

## Exit obligations
- Limit lower/raise/toggle/re-enable không reset spend; null→budget có old unresolved sau coverage thì block. Missing price/storage terminal không vòng quanh bằng account/model fallback.
- Cả weekly/monthly cùng hiệu lực; khi cả hai exhausted Retry-After theo reset muộn cần thiết; no-store/CORS/native prestream và already-started error đúng.
- Reset không xóa ledger/identity; month short/year/time boundaries, cross-window completion và restart đủ evidence.
- Show reference cost/scope/coverage start/overshoot và unknown khác0; keyboard/mobile và ACL+budget cùng edit không mất state.
- Demo scoped fixture không chứng nhận all-protocol budget; toàn AC2/3/12 chỉ đóng ở R sau coverage mở rộng.

[Roadmap/contract](../261018-0213-api-key-budget-roadmap/plan.md). Outline only; detail sau P3, no automatic execution. Nếu cần tách policy/calendar và UI composition thì mỗi slice có actual behavior closure, không bỏ bước end-to-end cuối.

<!-- slug: weekly-monthly-budget -->
