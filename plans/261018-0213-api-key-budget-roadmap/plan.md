---
title: "API key budgets — roadmap trên master mới"
description: "Port chọn lọc từ nhánh cũ; đóng từng outcome, không tiếp tục monolithic backlog."
status: in-progress
priority: P1
effort: "Chưa ước lượng; chỉ estimate từng slice sau dependency check"
branch: develop
tags: [roadmap, migration, pricing, accounting, budgets]
blockedBy: []
blocks: []
created: 2026-10-18
---

# API key budgets — roadmap trên master mới

## Contract
- **Outcome:** reference pricing + durable per-key attempt accounting + weekly/monthly budgets + quản trị/recovery dùng được, được giao từng phần trên nền upstream mới.
- **Constraints:** giữ exact money, own durable ACK, stable key identity, ACL upstream, single writer, calendar Asia/Ho_Chi_Minh và toàn bộ nghĩa vụ cũ. Không áp nguyên stash/cherry-pick checkpoint khổng lồ. Enforcement/public/synchronous activation OFF.
- **Non-goals:** rewrite từ đầu; reservations/hard cap; billing; metering standalone image/audio/video/search/fetch; sửa routing/quorum để qua test; tiếp tục chuỗi diagnostic cũ tự động.
- **Acceptance:** từng slice có code + focused/actual-boundary/affected evidence trên revision mới; đủ scope và 13 AC trước whole-product acceptance. Planning này không phải product acceptance.

## Nguồn và cách đọc
- Nền: `87a74e1bda3677193c6f71a7e2100c90311f0689`, v0.5.104; master đã pull fast-forward, không ahead/behind lúc intake.
- Code cũ: `3a4955a0336f970505c325b0faf892f5397c93bb`; WIP: stash commit `d515fb4927ed45a5853104406cd0fecca549c04c`. Không dùng vị trí stash@{0} làm identity lâu dài.
- [Contract gốc bất biến](./references/legacy-design-contract.md), [provenance và hiện trạng](./references/migration-baseline.md), [scope/13 AC crosswalk](./references/scope-map.md).
- Plan cũ là reference/history trên Git, không là execution backlog nữa trong hướng chuyển giao này. Giữ failures; không chạy matrix cũ từ câu “next” lịch sử.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Điều phối các plan con](./phase-01-start.md) | In progress — P1–P4 complete within recorded boundaries; P5 next |

## Các plan con và thứ tự

| ID | Outcome / plan | Prerequisite | Mức chi tiết |
|---|---|---|---|
| P1 | [Reference pricing](../261018-0213-reference-pricing-port/plan.md) | Nền đã pull; dependency check trong phase 1 | Complete — conditional Linux acceptance |
| P2 | [Ledger/durability tối thiểu](../261018-0214-accounting-foundation/plan.md) | P1 | Complete — Node/SQL.js foundation; activation OFF |
| P3 | [Một luồng chat khép kín](../261018-0213-durable-chat-accounting/plan.md) | P2; named prerequisite below | Complete October 28 — selected JSON/SSE, Node/SQL.js; activation OFF |
| P4 | [Weekly/monthly budget + UI](../261018-0213-weekly-monthly-budget/plan.md) | P3 | Complete October28 — selected fixture Node/SQL.js, guarded UI/API/CLI; production OFF |
| P5 | [Recovery/vận hành](../261018-0213-accounting-recovery/plan.md) | P4; dùng primitives P2 | Contract, chưa executable |
| X1 | [Responses và embeddings](../261018-0215-responses-embeddings-accounting/plan.md) | P3; pricing/schema phù hợp | Envelope: tách owner trước làm |
| X2 | [Messages](../261018-0215-messages-accounting/plan.md) | P3; pricing/schema phù hợp | Envelope: tách owner trước làm |
| X3 | [Gemini và chat media/tools](../261018-0215-gemini-accounting/plan.md) | P3; pricing/schema phù hợp | Envelope: tách composition trước làm |
| X4 | [Specialized/OAuth/binary](../261018-0215-specialized-accounting/plan.md) | P3 + protocol dependency | Envelope: tách từng owner trước làm |
| X5 | [Routing/retry/transport/unhealthy](../261018-0215-routing-transport-accounting/plan.md) | P3; từng owner liên quan | Envelope: tách seam trước làm |
| X6 | [Fusion/nested/late owners](../261018-0215-fusion-accounting/plan.md) | X5 seam + owners được dùng | Envelope: tách flat rồi nested |
| R | [Whole-product acceptance](../261018-0213-budget-release-acceptance/plan.md) | P1–P5 + X1–X6 inventory đóng | Contract, chưa executable |

Mặc định P1→P2→P3→P4→P5 rồi chọn X1→X2→X3→X4→X5→X6 theo dependency đã resolve; không làm song song. Nếu P3 cần seam retry/transport của X5 thì chỉ kéo đúng prerequisite được đặt tên, không mở toàn X5. Envelope không được chạy như một giant plan mới.

P3 invocation `--auto` ngày 2026-10-23 đã đặt tên
[policy/persisted-authority + transport prerequisite](../261023-0739-p3-chat-dispatch-prerequisites/plan.md),
phụ thuộc P2 và không depend P3. Cả hai prerequisite phases đã accepted ngày 27/10 với
actual-adapter/transport evidence. P3 JSON/SSE và combined acceptance đã hoàn tất
ngày 28/10; [final reconciliation](../reports/implementation-261028-1243-chat-plan-completion.md)
giữ test/measurement/build/standalone evidence và scope limits. Không production activation.

## Trade-offs và better approach
- Merge/rebase toàn nhánh: giả định conflict cùng lúc vẫn kiểm soát được; hỏng sớm ở ACL/schema/routing khác nghĩa. Selective port: giả định tách dependency được; hỏng sớm khi shared driver kéo theo cả accounting. Rewrite: giả định reuse ít giá trị; hỏng sớm ở lặp lại defect và mất evidence.
- **Chọn selective port.** Better approach so với chỉ đổi tên A–E: vertical slices có DONE riêng, work boundary rõ và dependency gate trước port; chi phí là review/revalidate theo impact, không tự kế thừa green trên nền cũ.

## Current integration workflow — 2026-10-22

- User selected `master` for upstream synchronization and `develop` for integrating local features. New feature branches start from `develop`; completed features merge back into `develop`. Upstream updates enter `master` first, then merge into `develop` with affected checks.
- The P1 integration request authorized local commits and merging `feat/reference-pricing-port` into `develop`. That historical authorization covered P1 only. The subsequent explicit user request authorizes committing/pushing `feat/accounting-foundation` and merging/pushing it into `develop`; production deployment and changes to `master` remain outside this delivery. The only configured remote is `origin`; an `upstream` remote has not been configured or verified.
- P1 and its DB safety prerequisite are closed within the recorded conditional Linux boundary. P2 is complete on `feat/accounting-foundation`, with 3/3 phases and 22/22 tasks; implementation is committed at `e5e111f0`, with standalone tracing fix at `16754067`. Remote publication and integration follow the explicit Git delivery request; the receipt preserves its historical pre-Git capture state. Its [execution receipt](../reports/implementation-261022-accounting-foundation.md) records 311 focused/affected tests, lint, production build and detached standalone acceptance. Independent full-source review and Bun/better/Windows accounting parity remain P5/R release blockers.
- The historical next step above has been superseded: P3 and P4 completed October28 within their selected fixture-only boundaries. [P4 completion](../reports/implementation-261028-p4-completion.md) records726 affected tests,19 browser checks per Node/SQL.js adapter,8 detached shipping checks, process crash/restart controls and scoped performance disposition with observed overhead. Full CI remains baseline-red; existing Endpoint lint debt and independent-review limits are disclosed. [P5 handoff](../reports/handoff-261028-p4-budget-to-p5.md) preserves recovery/restore constraints. P5, X1–X6 and R remain open. No accounting, enforcement or public activation follows; P4 did not authorize or perform Git publication/deployment.

## Historical intake status / authorization
- Chỉ tạo plans; chưa triển khai slice nào. Đồng bộ Git hoàn tất, **baseline tests mới chưa chạy**.
- A pricing từng đóng ở nhánh cũ; P1 là port/compatibility acceptance, không tuyên bố A chưa từng hoàn thành. B/C/D/E cũ chưa whole-accepted; patch trong stash chưa accepted.
- Không có ETA tổng đáng tin; `88h` cũ không dùng lại. Target một slice reviewable, không cam kết số ngày trước dependency check.
- Next: đọc P1 phase 1; chỉ khi user yêu cầu triển khai mới tạo feature branch và chạy baseline/port. Không code trực tiếp trên master, không commit/push/merge/activate từ plan này.
- [Validation và giới hạn](./references/validation.md).

<!-- slug: api-key-budget-roadmap -->
