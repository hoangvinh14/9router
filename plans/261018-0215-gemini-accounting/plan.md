---
title: "X3 — Gemini chat/media/tools accounting"
description: "Tách schema và actual producer compositions, giữ performance blocker cũ."
status: pending
priority: P2
effort: "Chưa estimate"
tags: [accounting, gemini, media]
blockedBy: [261018-0213-durable-chat-accounting]
blocks: [261018-0213-budget-release-acceptance]
created: 2026-10-18
---

# X3 — Gemini chat/media/tools accounting

## Contract
- **Outcome:** Gemini JSON/SSE và native wrapper có raw exact modality/cache/tool usage, independent authority cho inline/owned resources và original prices.
- **Constraints:** không suy billable quantities từ bytes/MIME/duration/results; freshness/ownership/current bindings trước mọi required boundary; giữ native terminal, original AbortSignal và credential precedence.
- **Non-goals:** standalone media generation/TTS/search/fetch, bỏ guards/prewarm/coalescing để qua bytewise timeout, tự đổi consistency contract.
- **Acceptance:** từng composition intended actual POST/pending/own ACK/original cost + failed/unknown/abort/revoke/drift/recovery và affected barrier; unchanged bytewise/performance obligations chưa đóng vẫn release blocker.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Tách Gemini compositions](./phase-01-start.md) | Pending |

## Slices trước làm
- Text/cache client format→wire→raw; `/api/v1beta` auth/native envelopes và Gemini4 upstream semantics.
- Inline image/PDF; client tools/history; owned upload/resource identity; mỗi family positive producer riêng trước combined matrix.
- Audio/video/resolution/metadata/processing và embedded tool rates; extend pricing/snapshot/recovery typed units cùng slice, không guessed modalities.
- Combined compositions theo inventory; bytewise/resource verification/performance là một blocker decision hữu hạn, không tự nối lại harness cũ.

Reuse candidate/dispatch/parsers/private resources/geminiOwned upload/queued tests từ branch cũ sau review dependencies. Gemini embeddings owner X1, specialized envelope X4 chỉ reference, không duplicate. Old rejected optimizations không hồi sinh tự động; imported code phải không chứa invalid authority shortcut. P1–P5 partial closure không waive obligation media đã nhận.

[Roadmap/contract/failure protocol](../261018-0213-api-key-budget-roadmap/plan.md). Envelope only, detail một composition trước execution; không estimate toàn X3 bằng pass counts.

<!-- slug: gemini-accounting -->
