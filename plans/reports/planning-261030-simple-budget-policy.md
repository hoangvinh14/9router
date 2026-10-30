# Planning receipt — budget simplification, 2026-10-30

## Authority / scope
Người dùng yêu cầu thực hiện việc hủy P5 và thay bằng plan nhỏ theo quyết định: interrupted request không có thông tin usage để tính phí được bỏ qua, không debit/marker/recovery. Câu hỏi bổ sung đã được trả lời: giữ weekly/monthly tự làm mới theo kỳ. Không đổi thành lifetime credit. Lượt này chỉ cập nhật planning docs; chưa implementation/activation.

## Changes
- P5 và phase duy nhất chuyển `cancelled`, bỏ active task checkboxes, giữ nội dung lịch sử; không giả completed.
- Thêm [B1](../261030-0252-simple-budget-policy/plan.md), hai phase semantics/data compatibility và API/UI/actual acceptance; cả hai pending.
- Roadmap, coordination checklist, scope-map và wrapper contract chỉ rõ current policy override, không sửa exact legacy `.txt` bytes.
- R thay dependency P5 bằng B1, không yêu cầu recovery-product/managed restore nữa; giữ các independent storage/auth/adapter/coverage gates.
- X1–X6 nhận current-policy notice và chỉnh acceptance bị ảnh hưởng; không thêm blanket dependency edges, không silently giảm supported providers/adapters. Các phase outlines đọc theo current-policy notice của plan chủ quản.
- P1–P4 completion receipts, P4→P5 handoff và runtime docs giữ lịch sử/current implementation; không rewrite chúng thành bằng chứng semantics B1 đã chạy.

## Source inspection / proposed test targets
Đã đọc gate, service, chat-accounting owner, repository/restart mutations và management projection. Source vẫn tạo unresolved và chặn finite budget; UI vẫn yêu cầu recovery. New plan không thể được coi implemented chỉ bằng việc hủy P5.

Existing source/test/browser paths và các Vitest command paths đã được kiểm tra bằng filesystem trong documentation validation. Đây không phải chạy tests. Sửa engine cần đọc `open-sse/AGENTS.md` trước và implementation sẽ phải chốt actual fixture commands/cleanup theo current entrypoint.

## Validation
- Advisor trước edit: giữ ngoại lệ narrow (interrupted + thiếu usable usage), không biến pricing/storage failure thành miễn phí; định nghĩa duplicate/late/start-window và verified abandoned-owner behavior, không thêm reconciliation job. Các điểm này đã đưa vào B1.
- Mechanical checks PASS: 18 Markdown files / 64 local links; 16 plans với dependency targets/DAG hợp lệ; 39 source/test paths tồn tại. P5 cancelled/no active recovery checkboxes; R depends B1, không depends P5. `git diff --check` sạch. Đây chỉ là documentation validation.
- Final Advisor chỉ nhận filename/stat summaries, không source prose; không sign-off semantic consistency độc lập. Góp ý được đối chiếu và làm rõ trực tiếp: không durable unknown marker kể cả giấu UI, late usage thuộc kỳ gốc không tiêu kỳ mới, Monday/day1 00:00 Asia/Ho_Chi_Minh, dead owner không miễn phí cho lỗi persist known usage. Không dùng review này như full-source audit.
- Không chạy baseline/unit/browser/build/runtime; không chạm real DB hoặc kích hoạt accounting. Marksman silent/incomplete không phải clean certificate. Không independent full-source audit.

## Remaining delivery
B1 pending; code hiện vẫn theo semantics cũ và fixture-only. Production readiness, activation và các protocol owners chưa được giải quyết bằng planning change. Không commit/push/merge/deploy.
