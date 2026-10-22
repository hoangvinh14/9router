---
title: "Chuẩn bị slice chat"
status: todo
---

# Chuẩn bị slice chat — chưa executable

Prerequisite P2 đóng; detail trước khi code, không kích hoạt inference thật.

- [ ] Trace current app/core/Base JSON/SSE, retries/ACL/empty-content fallback; đối chiếu old candidate và unaccepted stash repair.
- [ ] Chọn JSON→SSE slices hoặc một combined boundary đủ nhỏ; assign exact original/wire/raw/ACK owners và named X5 prerequisite nếu có.
- [ ] Viết phase/test matrix với disposable actual adapter/loopback, positive intended POST, held/lost ACK/current credential drift/unknown/duplicate/two-key/restart; list exact files/commands/affected gates.
- [ ] Định nghĩa finite overhead/latency measurement và failure stop; giữ deadlines/quorum/guards, không run diagnostic cũ.

**Exit chuẩn bị:** slice reviewable không missing authority; chưa P3 DONE. Product closure theo plan.md, common failure protocol từ roadmap. Nếu runtime/protocol dependency không rõ thì block và báo, không tạo generic wrapper framework.
