---
title: "Chuẩn bị slice chat"
status: todo
---

# Chuẩn bị slice chat

Prerequisite P2 đóng; detail trước khi code, không kích hoạt inference thật.

Inspection, serial owner/profile/test matrix và finite measurement đã được
ghi tại [execution design](./design-preparation.md). User chọn narrow policy
classifier + verified persisted reader. [Named prerequisite](../261023-0739-p3-chat-dispatch-prerequisites/plan.md)
đã hoàn tất cả hai phase với actual-adapter/loopback/affected/lint và finite
proof measurement ngày 27/10. JSON/SSE và combined acceptance đã hoàn tất ngày
28/10; [final reconciliation](../reports/implementation-261028-1243-chat-plan-completion.md)
giữ bằng chứng actual-flow riêng với preparation.

- [x] Trace current app/core/Base JSON/SSE, retries/ACL/empty-content fallback; đối chiếu old candidate và unaccepted stash repair.
- [x] Chọn JSON→SSE slices hoặc một combined boundary đủ nhỏ; assign exact original/wire/raw/ACK owners và named X5 prerequisite nếu có.
- [x] Chốt cache semantics cho selected profile JSON/SSE: raw field mapping, input inclusion, absent vs explicit zero, cache-read/write và tiers nếu có; reuse P1/P2 original rates/fallback. Không thêm response cache hoặc coi local bypass là upstream usage.
- [x] Viết phase/test matrix với disposable actual adapter/loopback, positive intended POST, held/lost ACK/current credential drift/unknown/duplicate/two-key/restart; list exact files/commands/affected gates.
- [x] Đưa cache acceptance từ plan.md vào matrix JSON/SSE: no-hit/partial/full read, distinct/zero/missing cache rate, write/tiers theo profile, missing/conflicting usage, original price drift và persisted cost sau reopen. Core unit tests không thay actual provider-mapping/ledger evidence.
- [x] Định nghĩa finite overhead/latency measurement và failure stop; giữ deadlines/quorum/guards, không run diagnostic cũ.

**Exit chuẩn bị:** slice reviewable không missing authority; chưa P3 DONE. Product closure theo plan.md, common failure protocol từ roadmap. Nếu runtime/protocol dependency không rõ thì block và báo, không tạo generic wrapper framework.
