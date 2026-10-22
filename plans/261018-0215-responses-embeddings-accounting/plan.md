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

## Contract
- **Outcome:** actual Responses JSON/SSE và embeddings transport owners có per-POST accounting, raw exact usage/original price/own ACK.
- **Constraints:** giữ native errors/terminal, auth/ACL, raw-before-translation/estimation, predecessor-before-successor. Không local response-cache hit recharge usage cũ.
- **Non-goals:** toàn bộ aliases một test mỗi alias, standalone image/audio endpoints, làm lại P3 hoặc tự đổi routing.
- **Acceptance:** mỗi owner đạt full positive flow, exact failed response, missing usage unresolved, retry/abort/drift/late/duplicate/recovery/threshold và affected consumers. Refusal-only không là support.

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
