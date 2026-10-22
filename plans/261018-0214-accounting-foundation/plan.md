---
title: "P2 — Ledger và durability tối thiểu"
description: "Prerequisite hữu hạn cho một luồng accounting, không port mọi provider."
status: pending
priority: P1
effort: "Chưa estimate"
tags: [accounting, database, durability]
blockedBy: [261018-0213-reference-pricing-port]
blocks: [261018-0213-durable-chat-accounting]
created: 2026-10-18
---

# P2 — Ledger và durability tối thiểu

## Contract
- **Outcome:** ledger/service per-attempt dùng được bởi P3, có stable key binding, exact snapshot/money, idempotent transitions và own durable ACK.
- **Constraints:** giữ schema/ACL mới; single writer trước adapter mutation; group coordinator bounded, không network serialization/reservation; SQL.js unhealthy không đọc RAM như durable truth.
- **Non-goals:** provider hooks/parsers, budget UI, full restore/recovery UI; không deferred RAM spend hoặc generic persistence rewrite.
- **Acceptance:** actual Node/SQL.js intent/settlement/crash/duplicate/lost-ACK controls, unchanged key migration/import semantics; no ledgerStartedAt khi chưa đủ dispatch hooks. Adapter release parity vẫn là nghĩa vụ P5/R, không silent support cut.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Chuẩn bị slice ledger](./phase-01-start.md) | Pending |

## Boundary và nguồn reuse
Đọc từ `3a4955a0`: schema/migrations, apiKeyAccountingRepo, service/identity/windows, coordinator, writer ownership, durable file/adapters, binding/coverage primitives và tests. Đọc cả stash candidate để biết defect đang mở nhưng không auto-port. Một minimal primitive phải giữ invariant liên quan; không kéo toàn `src/lib/apiKeyBudget/` hoặc driver bằng directory checkout.

P2 cần key import/delete/retained fingerprint safety và gap/maintenance prerequisites cho persisted states; management procedures đầy đủ thuộc P5. Nếu minimal core không reviewable, tách P2 thành ledger identity và durable ACK/group commit, mỗi plan có exit riêng trước implementation. Không coi toàn P2 executable chỉ vì đã có tên.

## Exit obligations
- Exact states pending/settled/unresolved/not_dispatched/waived, per-operation CAS và duplicate conflicts, original snapshot, no historical debit.
- Crash before/during/after commit, lost ACK, group uncertainty poisons đúng lane; same-DATA_DIR competing writer không mutate.
- Fresh gate tại actual intent write sau queue await; abort reason/cancellation và bounded drain; successor không dùng stale admission.
- Upstream accessRestricted/accessAllow được giữ qua migration/key update/import; không stable ID chuyển sang secret khác.
- Future adapters unavailable được record release blocker; không native blanket claim từ Node/SQL.js.

[Roadmap/contract/failure protocol](../261018-0213-api-key-budget-roadmap/plan.md). **Outline only:** chưa cho phép code/test; hydrate phase/file/test matrix sau P1, user execution request riêng.

<!-- slug: accounting-foundation -->
