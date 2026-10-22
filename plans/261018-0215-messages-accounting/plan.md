---
title: "X2 — Messages và embedded server tools"
description: "Chia Messages theo raw schema/transport; không refusal-as-coverage."
status: pending
priority: P2
effort: "Chưa estimate"
tags: [accounting, anthropic, messages]
blockedBy: [261018-0213-durable-chat-accounting]
blocks: [261018-0213-budget-release-acceptance]
created: 2026-10-18
---

# X2 — Messages và embedded server tools

## Contract
- **Outcome:** Messages API/native streaming và OAuth liên quan giữ original→wire→raw usage, exact snapshot và own terminal ACK, gồm paid tools đã nhận scope.
- **Constraints:** cumulative/cache tiers/thinking không double count; explicit original rate/category/unit/observed counters; thiếu semantic authority refuse/unresolved, không đoán từ result blocks.
- **Non-goals:** standalone search/fetch metering, executing client tools, blanket miễn phí OAuth hoặc server tools.
- **Acceptance:** actual default/beta/OAuth relevant configs, JSON/SSE, HTTP/tool error/pause_turn/refresh/successor/abort/late, original-price recovery, threshold và native errors; mocks/helper-only không đủ.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Tách Messages slices](./phase-01-start.md) | Pending |

## Slices phải tách trước làm
- Standard raw usage/streaming/native terminal; beta defaults và cache TTL/tier explicit.
- OAuth original headers/signatures/history/thinking authority; shared owner không gán hai nơi với X4.
- Embedded server search/fetch/code/citations/tool history theo category/schema; mỗi slice có full flow với exact money, không hàng chục patches thiếu positive producer.

Reuse old Anthropic/Claude OAuth candidates/parsers/raw owners, rate schema và tests. Pricing units/UI/snapshot extension là dependency của từng tool slice, không đổi complete-source precedence. Unknown/new versions giữ blocker rõ; không blanket free. Quảng cáo support chỉ sau positive intended POST/own ACK, không từ copied-issuer denial tests.

[Roadmap/contract/failure protocol](../261018-0213-api-key-budget-roadmap/plan.md). Envelope only; detail một owner/composition khi tới lượt, chưa executable.

<!-- slug: messages-accounting -->
