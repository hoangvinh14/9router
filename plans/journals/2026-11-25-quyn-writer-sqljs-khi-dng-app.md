---
title: Quyền writer SQL.js khi dừng app
date: 2026-11-25
summary: Kiểm chứng SQL.js opt-in trên Linux và sửa đường đóng khi server thoát.
---

# Quyền writer SQL.js khi dừng app

## Lỗi và bản sửa

Khi listener SIGTERM của server gọi process.exit trước listener SQL.js, tiến trình để lại writer record. Ca kiểm chứng trước sửa cũng bỏ sót ảnh DB chưa lưu. Đường exit đồng bộ giờ flush ảnh hợp lệ, đóng adapter và nhả quyền writer.

## Kiểm chứng

Fixture persistence trên Linux Node 24 qua hai điểm lỗi xuất ảnh và SIGKILL. Docker operator Linux amd64 tạo và mở lại DB SQL.js với mạng tắt, rồi từ chối DB native WAL khi bật opt-in. Hồi quy startup đạt 33/33 và HTTPS loopback đạt 103/103. CI tại ff2773c0 hoàn tất cả bốn lane.

## Tiêu chí còn mở

Mất điện thực trên thiết bị dùng một lần và đối chiếu credential khi rollout.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
