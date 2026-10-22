---
title: "Chuẩn bị slice ledger"
status: todo
---

# Chuẩn bị slice ledger — chưa executable

Prerequisite P1 đóng; chỉ detail khi tới lượt, không code từ outline này.

- [ ] Đọc current schema/driver/key ACL và old identity/ledger/coordinator/durability tests; phân reuse/adapt, không apply stash.
- [ ] Chọn một slice nhỏ: ledger identity/state hoặc durable ACK/group commit; nếu hai phần phụ thuộc chặt thì ghi minimal complete boundary, không chẻ mất safety.
- [ ] Tạo detailed phase/child plan với explicit files, actual adapters, failure/ACK/crash matrix, runnable commands và affected consumers; giữ P2 outcome còn lại có owner.
- [ ] Chốt fresh intent gate, gap/maintenance/binding prerequisites và default-OFF behavior; no ledgerStartedAt trước đủ coverage.

**Exit chuẩn bị:** next slice có thể review/verify độc lập, không unresolved architecture authority change. Đây không phải P2 product DONE; DONE theo plan.md. Unavailable dependency là blocker, không permission rewrite driver toàn khối. Dùng common failure protocol của roadmap.
