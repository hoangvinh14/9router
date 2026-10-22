---
title: "Ledger và exact monetary service"
---

# Phase 2 — Ledger và exact monetary service

## Outcome và dependency

Sau complete identity/coverage boundary của [phase 1](./phase-01-start.md), cung cấp provider-independent per-attempt core cho P3. [Adopted design](./design-preparation.md) giải quyết repo/service cycle: service gọi repo, repo không import service/provider inventory. User đã authorize execution; không còn architecture approval pending.

## Implementation và files

- `src/lib/accounting/attempt-payload.js`: bounded detached canonical JSON và validated timestamp/text/errors.
- `exact-money.js`: BigInt/rational, original P1 rates/typed units, explicit quantities/inclusion/cache tiers và required disjoint categories; round-half-up một lần/attempt. Extended rates không silently rơi vào base-only calculation. Per-attempt overflow refuse; aggregate BigInt.
- `service.js`: private request contexts/operation registry/own receipts, required synchronous request authority, fresh application/post-ACK seam, one-use dispatch, terminal sinks độc lập với config/activation edits. Queue/registry count+bytes đều bounded.
- `src/lib/db/repos/api-key-accounting-repo.js`: canonical immutable intents, pending/settled/unresolved/not_dispatched/waived, duplicate conflicts, original snapshot, CAS manual recovery/audit và late observations. Missing/estimated settlement qua service thành unresolved/null cost.
- P3 interface và exact evidence contract nằm ở [docs/ACCOUNTING.md](../../docs/ACCOUNTING.md). P3/X owners vẫn phải chứng minh raw provider mapping; không coi provenance string là provider certification.

## Acceptance và evidence

Xem [execution receipt](../reports/implementation-261022-accounting-foundation.md) và actual Node/SQL.js tests `accounting-exact-money`, `accounting-ledger`, `accounting-coordinator`.

- [x] Bounded core API/dependency direction, private own ACK và request authority được source review.
- [x] Exact zero/missing/estimate/subset/tier/category/unit/range/rounding controls pass, including extended per-use fees từ original P1-like snapshot.
- [x] Immutable intent/terminal duplicate equality/conflict, original price qua config drift và durable reopen pass.
- [x] Unresolved/null cost, late exact settlement, proven not-dispatched, audited waiver/CAS/manual-wins controls pass.
- [x] Forged/visible row không cấp own ACK hoặc second dispatch; terminal sink còn sau activation/config edits.
- [x] Phase 3 nhận complete ledger contract; no historical debit hoặc ledgerStartedAt.

## Risk và rollback

Failed durable ACK không thành success vì đọc thấy row; caller phải giữ unknown outcome và P3 phải xử lý sink/gap. Invalid exact evidence refuse settlement, không guess zero. Giữ activation OFF và compatible ledger history khi revert; không xóa attempts để sửa conflict. Restore chỉ bằng verified compatible preactivation DB + coverage bundle sau stop-writer. Full management và all-platform parity thuộc P5/R.
