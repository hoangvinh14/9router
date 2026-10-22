---
title: "Tổng hợp release gates"
status: todo
---

# Tổng hợp release gates — chưa executable

- [ ] Sau prerequisites, reconcile tất cả slice receipts/source revisions và scope-map13AC; current upstream coverage inventory có owner hoặc explicit blocker, không orphan obligations.
- [ ] Detail finite cross-feature UI/inference/reset/recovery/restore + actual adapter release matrix; reuse relevant unchanged evidence, không rerun mọi focused suite.
- [ ] Chốt matched performance workload/targets/measurement trước launch; comparator/collection/synthetic controls và full-suite known-red classification bằng exact final results.
- [ ] Review auth/CSRF/key ACL/identity/no leaks/catalog SSRF/headers/proxy/audit, build/serving/docs/changelog/runbook; incomplete tools không clean claim.
- [ ] Ghi release-readiness verdict, remaining blockers và activation/rollback decision riêng; không auto bật enforcement/production từ verdict hoặc plan closure.

Exit chuẩn bị: finite release verification plan với commands/input manifest/stop/cleanup. R product DONE theo plan.md; nếu obligation còn thiếu thì chưa ready. Không dồn missing owner implementation vào final testing plan, trả đúng plan chủ quản.
