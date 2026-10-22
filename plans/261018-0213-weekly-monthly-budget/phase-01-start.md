---
title: "Chuẩn bị slice budget"
status: todo
---

# Chuẩn bị slice budget — chưa executable

Prerequisite P3 đóng. Không code UI trên giả định ledger đã port.

- [ ] Trace current EndpointPageClient/KeyAccessControls, policy/API/UI và old budget drafts; giữ ACL cùng budget state.
- [ ] Detail một flow scoped P3 với null/zero/edits/both windows/errors/overshoot; named files và commands, disposable DB/browser, no live inference.
- [ ] Lập clock-controlled reset/cross-window/restart matrix không sleep dài; prove unresolved không tự hết và không xóa ledger.
- [ ] Chốt actual UI→inference→ledger→UI→refusal→restart/reset evidence, auth/CSRF/mobile/keyboard và relevant consumer gate.

**Exit chuẩn bị:** executable plan nhỏ có exact verification, không whole-product coverage claim. P4 DONE theo plan.md; common failure protocol từ roadmap. Không trì hoãn safety prerequisite chỉ vì nằm ở P5 management UI.
