---
title: "R — Nghiệm thu sản phẩm và release readiness"
description: "Tổng hợp current evidence đủ scope/13 AC; không tự bật production."
status: pending
priority: P1
effort: "Chưa estimate"
tags: [acceptance, security, performance, release]
blockedBy: [261018-0213-accounting-recovery, 261018-0215-responses-embeddings-accounting, 261018-0215-messages-accounting, 261018-0215-gemini-accounting, 261018-0215-specialized-accounting, 261018-0215-routing-transport-accounting, 261018-0215-fusion-accounting]
blocks: []
created: 2026-10-18
---

# R — Nghiệm thu sản phẩm và release readiness

## Contract
- **Outcome:** full supported scope và 13 AC có current evidence; không còn unresolved release blockers, operator biết limits và runbook.
- **Constraints:** reuse unchanged evidence theo provenance/impact, không rerun everything để thêm green; failed/incomplete không biến pass; support/consistency change cần user riêng.
- **Non-goals:** rewrite đã đóng, generic benchmark platform, automatic production activation/commit/push/release.
- **Acceptance:** current UI→inference→ledger→UI→limits→restart/reset + fault/recovery/restore; protocol/routing/transport/adapters inventory đóng; regression/security/performance/docs đủ evidence.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Tổng hợp release gates](./phase-01-start.md) | Pending |

## Gates trước DONE
- [Scope map và 13 AC](../261018-0213-api-key-budget-roadmap/references/scope-map.md) không missing/unowned obligations; upstream new protocols được inventory thay vì silent skip. P1–P5 đóng không mặc định toàn B/C/D/E accepted.
- Actual all required adapters Node/SQL.js/Bun/better durability/crash/managed restore; unavailable là blocker hoặc user-approved support decision, không ghi passed.
- Full suite collection/final JSON/comparator integrity, known failure exact classification và before/after revision/env. Old search/capability/refresh failures phải đối chiếu master mới trước gọi regression/current repair. No cloud/live creds không phải pass.
- Matched per-operation vs group commit workload/targets chốt trước measurement: ledger equality, commits/persist calls, low/burst/sustained throughput, p50/p95/p99, event-loop delay/queue/memory và ledger size/adapters. No guards/deadline/prewarm loophole. Historical bytewise/nested failures phải disposition rõ, không xóa.
- Cross-feature API/native streaming/UI/pricing/migration/retention/identity compatibility, current build/serving and docs/changelog/runbook khớp actual behavior.
- Security auth/CSRF/ACL/stable key isolation/secret logs/catalog SSRF/socket peer headers/strict proxy/recovery audit; unsupported/inconclusive tools không clean certificate.
- Direct completion review và explicit product acceptance; production enable/ledgerStartedAt/deployment là bước riêng cần authority, có backup/rollback/coverage review. Không bật thử trên real DB để lấy evidence.

## Evidence policy
Không defer mọi kiểm thử tới R: mỗi slice phải tự đạt focused + actual boundary + affected consumers; R chỉ composition và những release gates thực sự cross-cutting. Chốt finite gates trước launch; failure chuyển cause-aligned fix hoặc blocker, không unlimited test loop.

[Roadmap/contract/failure protocol](../261018-0213-api-key-budget-roadmap/plan.md). Outline only, hydrate sau prerequisites. Không có baseline tests/product pass mới trong lượt lập plan.

<!-- slug: budget-release-acceptance -->
