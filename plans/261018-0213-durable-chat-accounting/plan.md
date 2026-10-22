---
title: "P3 — Một luồng chat accounting khép kín"
description: "OpenAI-compatible chat JSON/SSE với ledger thật và own ACK."
status: pending
priority: P1
effort: "Chưa estimate"
tags: [accounting, chat, streaming]
blockedBy: [261018-0214-accounting-foundation]
blocks: [261018-0213-weekly-monthly-budget]
created: 2026-10-18
---

# P3 — Một luồng chat accounting khép kín

## Contract
- **Outcome:** actual app→core→Base/default transport→dummy upstream→ledger, JSON và SSE; từng billable POST có key/intent/raw usage/original price/terminal owner.
- **Constraints:** P2 durable ACK; request-local context không singleton key state; giữ auth/ACL/proxy/AbortSignal; failed HTTP exact usage cũng charge, missing usage unresolved/null-cost.
- **Non-goals:** toàn bộ provider inventory, nested fusion, budget editor hay rộng hóa transport support; không claim toàn B/AC5.
- **Acceptance:** positive full flow + lost ACK/duplicate/late/abort/restart/two-key isolation, original snapshot qua price drift và current authority qua held awaits; measured overhead rõ workload, không bỏ guards để đạt deadline.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Chuẩn bị slice chat](./phase-01-start.md) | Pending |

## Reuse và ranh giới
Old sources: requestAccounting/service, chat handlers/chatCore/Base integration, raw usage/SSE/parser và queued Base controls. Read **unaccepted** stash `requestAccounting.js`/`accountedBase.js` và bốn tests như candidate, không treat security repair đã accepted. Không copy unrelated Kimchi/snapshot WIP.

P3 bao gồm actual retries vốn có trên transport được chọn: mỗi generation POST own attempt và fresh successor gate. Nếu thiếu seam thì tạo prerequisite nhỏ từ X5; không tuyên bố path supported nhưng bỏ internal retry. Current upstream empty-content fallback/ACL phải được giữ và có tests.

## Exit obligations
- Intent ACK trước POST, own settlement ACK trước eligible terminal; persisted row không substitute delivered ACK. Streaming failure đóng native terminal đúng format, không promise đổi HTTP status sau bytes.
- Hold intent→credential/key disable/pool/routing drift phải refuse invalid POST; positive controls vẫn thực sự dispatch, không chỉ denial tests.
- Duplicate/conflicting/late callbacks, cross-key concurrency, failure exact usage, unknown/no-zero và reload DB có evidence.
- Named affected consumers + relevant strict proxy/default no-key regressions; no local refusal cooldown/bypass by fallback. Gates không thay original deadlines/prewarm.
- Không public partial accounting coverage/ledgerStartedAt toàn scope; isolated fixture-only activation phục vụ tests, không production.

[Roadmap/contract](../261018-0213-api-key-budget-roadmap/plan.md). Outline only; detail scope/files/tests sau P2. Có thể tách JSON/stream thành hai slice liên tiếp nếu dependency review thấy còn lớn; giữ cả hai obligation.

<!-- slug: durable-chat-accounting -->
