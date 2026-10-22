---
title: "P5 — Recovery và vận hành an toàn"
description: "Operator phục hồi unknown/gaps/restore, không reset allowance."
status: pending
priority: P1
effort: "Chưa estimate"
tags: [recovery, durability, security]
blockedBy: [261018-0213-weekly-monthly-budget]
blocks: [261018-0213-budget-release-acceptance]
created: 2026-10-18
---

# P5 — Recovery và vận hành an toàn

## Contract
- **Outcome:** operator xử lý exact correction/waiver/gaps/maintenance/managed restore qua API/UI/runbook với audit, original price và no double debit.
- **Constraints:** stable binding/tombstones/generation/material, DB audit ACK trước sidecar CAS, single writer; lost ACK/replay/late callback-admin race không tạo tiền hai lần. Missing authority giữ blocked.
- **Non-goals:** generic disaster recovery, external antirollback/multi-writer, đoán exact cost từ dữ liệu đã mất; không tự thực hiện trên production DB.
- **Acceptance:** actual management UI/API + disposable crash/restart/restore procedures trên supported adapters, auth/CSRF và retained identity, không chỉ repository mocks.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Chuẩn bị các recovery slices](./phase-01-start.md) | Pending |

## Chia trước execution
Đây là envelope vận hành, không một giant implementation task: (a) correction/waiver/audit replay, (b) gap reconciliation/maintenance, (c) managed backup/restore/import/retention/downgrade, (d) adapter crash/release parity. Detail từng slice ngay trước khi làm; primitives an toàn P2 không được trì hoãn tới đây.

## Reuse / exit
Reuse old management/global/recovery receipts, writer/coverage/restore/offline initialization và browser/crash fixtures sau review dependency. Exact original snapshots/categories/units giữ qua correction; waived có reason/evidence, không fabricated exact.

- Backup/restore giữ DB+sidecar/current generation+tombstones/fingerprint material; stop writer, maintenance trước replace; old clean sidecar không xóa gap mới. Missing/corrupt/mismatch không silently clean-init.
- Config import giữ accounting/policy/audit/ACL và reject rebinding transactionally trước DELETE; log clear/retention/delete-key không reset spend. Unsupported downgrade inference cần reconciliation, không pretend coverage liên tục.
- Node/SQL.js/Bun/better crash + actual durable ACK/restore evidence hoặc **release blocker**; muốn đổi supported set cần user quyết định, không skip xanh. Filesystem không thực hiện contract phải report unsupported trước affected dispatch.
- UI natural lost ACK/replay/late race không lặp mutation; scope-wide maintenance không clear qua per-key recovery. Không raw key/prompts/credentials trong API/audit/report.

[Roadmap/contract](../261018-0213-api-key-budget-roadmap/plan.md). Outline only; future detail, không execution hiện tại.

<!-- slug: accounting-recovery -->
