---
title: "P2 — Ledger và durability tối thiểu"
description: "Prerequisite hữu hạn cho một luồng accounting, không port mọi provider."
status: completed
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

Phase status được suy từ checkboxes trong từng phase file (`ak plan status`), tránh một bảng status lặp lại dễ stale.

1. [Schema, identity và coverage](./phase-01-start.md) — P1 merged; adopted design gate.
2. [Ledger và exact monetary service](./phase-02-ledger-exact-monetary-service.md) — sau complete phase 1.
3. [Coordinator và lifecycle acceptance](./phase-03-coordinator-lifecycle-acceptance.md) — sau complete phase 2; P3 chỉ bắt đầu sau P2 acceptance.

## Current baseline — 2026-10-22

- P1 đã merge vào `develop` tại `2ca88257`; [P1 closure](../261018-0213-reference-pricing-port/plan.md#execution-status--2026-10-22) đóng trong conditional Linux boundary. Single-writer, `durableTransaction` và health primitives hiện tại là reuse baseline; không port driver cũ toàn khối.
- [DB prerequisite acceptance](../261018-0749-db-safety-pricing/reports/r7-conditional-linux-acceptance.md) vẫn giới hạn Linux development, incomplete independent review và caught-inner RELEASE control; shutdown bị loại khỏi assurance. P2 cần thay đổi shutdown thì phải có scoped design trước, không kế thừa chứng nhận graceful stop.
- `3a4955a0` chỉ là nguồn selective reuse; `d515fb49` là saved WIP chưa accepted, không apply. Evidence và seam cần adapt nằm trong các phase.
- Giữ bốn trường contract ở trên. “Unchanged key migration/import semantics” nghĩa là giữ ACL, pricing và valid round trips, đồng thời thực thi collision refusal đã có trong contract; không giữ unsafe rebinding ID sang secret khác.
- P2 sở hữu binding/fingerprint/tombstone và minimum gap/maintenance/import/delete safety cho persisted accounting states. P5 sở hữu full management procedures; ranh giới chi tiết phải chốt trước source edits.

## Exit obligations

- Exact states pending/settled/unresolved/not_dispatched/waived, per-operation CAS và duplicate conflicts, original snapshot, no historical debit.
- Crash before/during/after commit, lost ACK, group uncertainty poisons đúng lane; same-DATA_DIR competing writer không mutate.
- Fresh gate tại actual queue application/intent write sau queue await; abort reason/cancellation và bounded drain. Own ACK không được thay bằng row visibility. P3 sở hữu actual dispatch integration và stale post-ACK/successor authority checks.
- Upstream accessRestricted/accessAllow được giữ qua migration/key update/import; không stable ID chuyển sang secret khác.
- Actual Node/SQL.js accounting acceptance là P2 gate. Bun/better/Windows parity là P5/R release blocker, không support cut hoặc blanket claim từ primitive tests cũ.

## Execution — 2026-10-22

User đã authorize execution qua completion và delegated routine technical decisions. [Adopted design](./design-preparation.md) đóng ba quyết định mở: private P3 core/own ACK; exclusive-lifetime pending recovery/close; independent sidecar + full identity/import/delete/minimum-maintenance boundary. Thứ tự P1 → 1 → 2 → 3 → P3 giữ nguyên. Không còn design-only approval gate.

Implementation nằm trên `feat/accounting-foundation`, base `2ca88257`, đã commit tại `e5e111f0`; standalone tracing fix tại `16754067`. User đã authorize commit, push branch và merge/push `develop`. Git delivery thực hiện sau acceptance; receipt bên dưới giữ nguyên trạng thái pre-Git tại lúc kiểm chứng. Không có deployment hoặc activation trong phạm vi delivery này. [Execution receipt](../reports/implementation-261022-accounting-foundation.md) là source-bound acceptance record; [internal interface](../../docs/ACCOUNTING.md) và [DB safety](../../docs/DB-SAFETY.md) là maintainer handoff. Receipt ghi actual runtime, source hashes, commands, failed histories, fixes và limits; không tái dùng old receipts như new accounting evidence.

Actual Node/SQL.js kiểm chứng identity/artifact/import/delete, exact ledger/state/CAS/duplicate, own ACK/fresh gates, bounded queue/cancellation, RELEASE uncertainty, crash/reopen/contender và scoped close/signals. Independent full-source review và Bun/better/Windows accounting parity vẫn là P5/R release blockers; không support cut hoặc whole-product acceptance.

No `ledgerStartedAt`, historical debit, provider hooks, budgets, enforcement/public/synchronous activation hoặc live-data operation. P3 vẫn sở hữu actual POST/successor/late-sink integration; P4 policies/windows/UI; P5 managed restore/management. P2 prerequisite đã hoàn tất: 311 focused/affected tests trên 22 files, lint 33 JS/MJS files, production build/postbuild và detached standalone SQL.js/localhost smoke đều pass; phase checkboxes đủ. Kết quả này không cho phép activation.

[Roadmap/failure protocol](../261018-0213-api-key-budget-roadmap/plan.md) và [contract gốc](../261018-0213-api-key-budget-roadmap/references/legacy-design-contract.md) giữ nguyên authority.

<!-- slug: accounting-foundation -->
