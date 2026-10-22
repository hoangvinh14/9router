---
title: "X4 — Specialized, OAuth và binary owners"
description: "Inventory bằng actual transport, một owner/slice; giữ upstream mới."
status: pending
priority: P2
effort: "Chưa estimate"
tags: [accounting, providers, protocols]
blockedBy: [261018-0213-durable-chat-accounting]
blocks: [261018-0213-budget-release-acceptance]
created: 2026-10-18
---

# X4 — Specialized, OAuth và binary owners

## Contract
- **Outcome:** supported specialized paths có explicit dispatch/raw usage/terminal owners thay vì assume Base coverage; OAuth/subscription không tự miễn recording/reference cost.
- **Constraints:** binary/protobuf/EventStream/NDJSON ở executor thật, không round-trip lossy qua OpenAI; per-generation ID/ACK/original price và raw-before-estimation.
- **Non-goals:** một test mỗi alias/model, model catalog sync hoặc rewrite upstream provider; không dùng unsupported denial làm delivered support.
- **Acceptance:** actual transport/protocol inventory đầy đủ, mỗi supported owner positive/error/unknown/retry/abort/late/drift/recovery với real adapter/dummy socket, affected regressions và no-secret review.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Inventory rồi một owner](./phase-01-start.md) | Pending |

## Inventory và slices
Old Codex/GitHub/Kiro/CommandCode/Cursor/Qoder/Trae/Windsurf/Zed/GrokCli/Antigravity và dynamic registry/default paths phải map actual executor/generation/format/usage. X1 sở hữu Responses/embeddings; X2 Messages/OAuth; X3 Gemini semantics; X4 chỉ phần dispatch/transport riêng chưa owner. Có phụ thuộc thì đặt tên chứ không duplicate integration.

Master mới thêm Bedrock/AWS EventStream, MiniMax Code, Nous/free-tier và các thay đổi Cursor/Kiro/Responses transport. **Đưa vào inventory bắt buộc**, xác định thuộc accepted supported chat scope bằng code/contract, không tự loại vì không có trên nền cũ và cũng không tuyên bố supported bằng test không có. Missing authority = named blocker cho R; scope/support change cần user riêng.

Reuse old executor hooks/candidates/parsers/tests theo owner. Trước port kiểm tra upstream strictProxy, usage/exact image/cache/reasoning, new free identity và token refresh. Không ghi đè executors bằng file cũ; transport safety/auth/SSRF là gate, không post-hoc note.

[Roadmap/contract/failure protocol](../261018-0213-api-key-budget-roadmap/plan.md). Envelope only; **không execute toàn X4**, tạo một provider-protocol plan khi tới lượt.

<!-- slug: specialized-accounting -->
