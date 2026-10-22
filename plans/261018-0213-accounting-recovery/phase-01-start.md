---
title: "Chuẩn bị các recovery slices"
status: todo
---

# Chuẩn bị các recovery slices — chưa executable

Prerequisite P4 và safe primitives P2. Không thao tác real DB.

- [ ] Chia correction/waiver, gap/maintenance, managed restore/lifecycle, adapter parity thành plan nhỏ có prerequisite thật; không gộp toàn P5 vào một execution.
- [ ] Đọc current persistence/import/export/key ACL + old restore/receipt fixtures; define stable identity/material/generation preservation và actor/reason/evidence/CAS.
- [ ] Detail một slice có explicit files, actual UI/API/disposable crash fixtures, adapter assertion, operationId replay/lost ACK/late race và cleanup commands.
- [ ] Inventory adapter/runtime/filesystem availability; missing lane report blocker hoặc xin support decision, không silent skip. Runbook phải match actual procedure.

**Exit chuẩn bị:** một recovery slice executable và mọi obligation còn lại có owner. Product P5 chưa DONE; plan.md và common failure protocol là exit authority. Không tạo generic backup/disaster recovery subsystem.
