---
title: "Điều phối outcome và giới hạn execution"
status: in-progress
---

# Điều phối outcome và giới hạn execution

## Bắt đầu
1. Đọc roadmap, contract gốc và P1; không đọc lại toàn bộ chronology.
2. Xác minh HEAD/stash bằng immutable SHA. Không apply stash; không chạy matrix/harness cũ. Theo integration workflow hiện tại, feature branch mới bắt đầu từ `develop`; giữ nguyên các thay đổi chưa commit và không tự push/merge/activate.
3. P1 dependency check phải cho biết minimal file set và revision invalidation/storage/auth seams. Nếu phải thay writer topology hoặc authority thì dừng phase đó, báo quyết định/prerequisite, không kéo toàn B vào pricing.
4. Mỗi plan sau được hydrate chi tiết khi dependency đóng. Với X1–X6, tạo plan nhỏ theo từng owner/composition/seam qua `ak plan` trước implementation; envelope chỉ giữ coverage obligations.

## DONE mỗi slice
- Có exact phạm vi, dependency, file ownership, test-first control khi sửa defect, actual boundary và affected-consumer gate được gọi tên.
- Lưu source revision, environment/adapter thật, reached/unreached, red receipts, cleanup và known blockers. Reuse evidence chỉ khi inputs liên quan còn hợp lệ.
- Có đóng góp AC cụ thể; partial flow không là full AC. Chưa release khi coverage inventory còn thiếu.
- Không sửa cùng shared file từ hai plan active; chỉ một slice active. Plan blocked không tự mở slice khác; cập nhật dependency/thứ tự rõ trước khi chuyển.

## Diagnostic failure protocol
Trước diagnostic: ghi một giả thuyết, expected observation, finite run bound và quyết định mà kết quả sẽ thay đổi. Kết thúc bound thì repair cause đã chứng minh hoặc kết luận blocked/inconclusive; không tự tạo harness mới nối tiếp. Không identical rerun-for-green, prewarm, kéo timeout, giảm freshness hoặc sửa assertions để vượt gate. Product blocker giữ nguyên dù đóng cuộc điều tra.

## Tiến độ và tích hợp
- Báo: outcome đã đóng, phần còn thiếu, blocker, bước đóng tiếp theo; không tỷ lệ từ checkbox/test count.
- P1 closure không phụ thuộc tất cả inference owners; P2 closure không chờ toàn restore UI; mỗi slice phải giữ safety prerequisites cần thiết của chính nó. Không đẩy invariant bắt buộc sang plan sau.
- Partial code có thể được xem xét tích hợp độc lập sau review thích hợp, nhưng không tự cho phép commit/push/merge/activation. Default OFF không chứng minh schema/startup an toàn; phải test các side effects này.
- Whole product chỉ DONE khi scope-map không còn obligation chưa assign/thiếu support và R có current evidence. Không declare unsupported refusal là delivered coverage.

## Checklist điều phối

P1 và P2 đã đóng trong acceptance boundary riêng. P2 có [receipt hiện tại](../reports/implementation-261022-accounting-foundation.md); P3 là dependency-ready outline tiếp theo. Checklist P2–P5 vẫn mở vì P3/P4/P5 chưa được thực thi.

- [x] P1 đóng với evidence mới; không kế thừa lịch sử A như current pass.
- [ ] P2–P5 được detail và đóng lần lượt với dependency nhỏ.
- [ ] X1–X6 được tách/đóng theo inventory, không chạy nguyên envelope.
- [ ] R trace đủ 13 AC, docs/security/performance/adapters; activation quyết định riêng.
