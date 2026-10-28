---
title: "X5 — Retry/routing/transport/unhealthy seams"
description: "Mỗi cross-cutting seam thành slice, không lặp toàn provider matrix cho mọi patch."
status: pending
priority: P2
effort: "Chưa estimate"
tags: [accounting, routing, transport, security]
blockedBy: [261018-0213-durable-chat-accounting]
blocks: [261018-0215-fusion-accounting, 261018-0213-budget-release-acceptance]
created: 2026-10-18
---

# X5 — Retry/routing/transport/unhealthy seams

## Contract
- **Outcome:** generation retries, account/model/capacity fallback, transport và unhealthy-unlimited có current authority và một intent/terminal owner mỗi actual billable POST.
- **Constraints:** fresh gate sau awaits/queue và trước POST; no stale key/credential/pool permission; preserve strictProxy/TLS/redirect/no replay và upstream ACL/empty-content fallback. Unlimited unhealthy chỉ sole durable gap ACK với verified authority.
- **Non-goals:** routing preference/scheduler/cancellation redesign; server-wide proxy rewrite; generic cached authority frame; giảm freshness vì performance.
- **Acceptance:** từng named seam positive real flow + held/released/lost ACK/drift/no-post controls, correct predecessor/unknown handling, two-key concurrency và bounded late cleanup; relevant default/no-key behavior unchanged.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Tách cross-cutting seams](./phase-01-start.md) | Pending |

## Slices trước làm

P3 đã tách [named prerequisite](../261023-0739-p3-chat-dispatch-prerequisites/plan.md)
cho explicit policy/persisted authority và Base actual-POST transport exposure.
Prerequisite không depend P3; cả hai phases đã accepted ngày 27/10 với
persisted-proof và actual per-POST transport evidence. Không mở parallel owner trên các file adapter/Base/proxy đó.
X5 envelope và các seam còn lại vẫn chưa accepted.

- Core/URL/auth refresh và internal generation retries; exact failed usage trước fresh successor, 200-empty-content upstream semantics giữ.
- Account/model/combo/capacity + immutable routing graph; alias/settings drift refuse future generation, not rebuild permission.
- Direct/pool/global/env/relay/SOCKS/no-auth/rotation/missing-lookup guards; fresh transport admission, strict proxy không silently direct fallback.
- Unhealthy identified-unlimited authority từ persisted proofs/current key/config/selection; no-key riêng; invalid ownership/schema/maintenance không dùng exception. Gap ACK failure0POST.
- Local response-cache hit0POST0newdebit; miss/revalidation/race own attempt. Không xây response cache engine nếu upstream không có.

Reuse queued wire/current-authority/persisted graph/gap proof/tests từ old branch và review unaccepted Base stash fix. P3 có thể kéo một prerequisite rõ từ envelope này; plan nhỏ không dependency ngược P3 nếu đó là prerequisite của P3. Final full envelope closure sau P3 và owners liên quan; không tạo cycle ảo.

[Roadmap/contract/failure protocol](../261018-0213-api-key-budget-roadmap/plan.md). Outline only; named consumer inventory trước affected gate, không repeated huge caller barrier sau từng tiny patch.

<!-- slug: routing-transport-accounting -->
