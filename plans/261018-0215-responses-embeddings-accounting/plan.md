---
title: "X1 — Responses và embeddings owners"
description: "Coverage envelope; mỗi transport owner thành slice riêng trước execution."
status: pending
priority: P2
effort: "Chưa estimate"
tags: [accounting, responses, embeddings]
blockedBy: [261018-0213-durable-chat-accounting]
blocks: [261018-0213-budget-release-acceptance]
created: 2026-10-18
---

# X1 — Responses và embeddings owners

## Current policy — 2026-10-30

Áp dụng [B1](../261030-0252-simple-budget-policy/plan.md): interrupted request thiếu usage bỏ qua, không debit/unknown marker/blocker/admin recovery. Valid priced usage vẫn ghi một lần; weekly/monthly tự rollover. B1 thay P5; references recovery trong outline/phase cũ không áp dụng cho ngoại lệ này. Giữ auth/storage/pricing/adapter safety và owner inventory. Khi hydrate owner, reuse B1 semantics, không phục hồi policy unknown cũ.

## Contract
- **Outcome:** actual Responses JSON/SSE và embeddings transport owners có per-POST accounting, raw exact usage/original price/own ACK.
- **Constraints:** giữ native errors/terminal, auth/ACL, raw-before-translation/estimation, predecessor-before-successor. Không local response-cache hit recharge usage cũ.
- **Non-goals:** toàn bộ aliases một test mỗi alias, standalone image/audio endpoints, làm lại P3 hoặc tự đổi routing.
- **Acceptance:** mỗi owner đạt full positive flow, exact failed response, interrupted missing-usage skip theo B1, retry/abort/drift/late/duplicate/restart/threshold và affected consumers. Refusal-only không là support.

## Child checkpoints — 2026-10-31

- [R1 native Responses](../261030-1827-x1-native-responses-accounting/plan.md): complete **chỉ selected Linux NodeSQLite/SQLjs fixtures**, không production/release.
- [E1 embeddings](../261031-1335-x1-e1-embeddings-accounting/plan.md): all3phases complete **chỉ selected private Linux Node SQLite/SQL.js fixtures**; final frozen1162reported cases/65suites gồm E1+affected gates,0failed/skipped. [E1 receipt](../reports/implementation-261031-e1-embeddings.md). Dynamic OpenAI-compatible API-key synchronous profile only; both-fetch seam không chứng nhận OAuth refresh. Eight inherited title-collision groups explicitly audited; LSP inconclusive. Production OFF; không broader provider/platform/release acceptance.
- [Canonical owner map](../261030-1827-x1-native-responses-accounting/references/x1-owner-map.md): R2–R4/C1/E2/E4 OPEN, E3 BLOCKED exact schema. ParentX1/R vẫn OPEN; production OFF.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Tách owner trước execution](./phase-01-start.md) | Pending |

## Slices phải tách
1. Native Responses JSON/SSE (khác Chat→Responses conversion), include relevant Codex/GitHub seam khi inventory cần; không duplicate ownership X4.
2. OpenAI-compatible embeddings, gồm account/refresh retries và identity/cost boundary.
3. Gemini embeddings và GitHub embeddings transport mới upstream; dependency tới Gemini schema X3 nếu cần, port route mới không ghi đè bằng version cũ.

Reuse old `accountedResponses`, `accountedRequest`/Gemini embedding owners, queued wire và raw parsers/tests. Canonical owner assignment được ghi inventory trước code để X3/X4 không claim cùng path hai lần. No blanket all-provider closure từ common base.

[Roadmap/contract/common failure protocol](../261018-0213-api-key-budget-roadmap/plan.md). Envelope only, chưa executable; tạo và detail **một** owner plan nhỏ khi tới lượt.

<!-- slug: responses-embeddings-accounting -->
