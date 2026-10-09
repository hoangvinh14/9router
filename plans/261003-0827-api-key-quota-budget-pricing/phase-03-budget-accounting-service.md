---
title: "Phase 3: Windows, budget gates và accounting lifecycle"
status: in-progress
priority: P1
effort: 12h
depends_on: [1, 2]
---

# Phase 3: Windows, budget gates và accounting lifecycle

> **Technical reference, không phải backlog song song.** [Roadmap Gói A–E](./plan.md#current-delivery-roadmap) supersedes next-delivery/order statements dưới đây: attempt lifecycle/unhealthy authority thuộc B; windows/budget gates thuộc C; initialization/operator recovery thuộc D. Requirements vẫn bắt buộc; stale pending descriptions phải reconcile với current evidence, không làm lại completed prerequisites.

<!-- Updated: Validation Session 1 - Gemini credential precedence, unlimited gap policy và request-local state -->

## Outcome

Một app service dùng chung cho chat/embeddings, kiểm tra recorded spend và exact settlement idempotent. Engine chỉ nhận injected hooks. [Design contract](./design-contract.md) là authority cho state/window/money/error semantics.

## Approved group-commit addition — B/C service consumer

Theo [I/O/cache design](./reports/io-group-commit-cache-design.md): bounded existing-writer queue, async wait ngoài synchronous transaction, fresh gate/identity/windows/authority tại dequeue/intent write; own durable ACK trước POST/eligible terminal. Preserve per-attempt cost/round/CAS/abort/receipt; uncertain group commit không success ACK. Không thêm RAM-only allowance hoặc deferred spend flush. Benchmark trước derived spend cache; queue bounds/deadlines không được nới test/HTTP deadlines. Đây là remaining implementation, không scoped pass đã có.

## Current delivery state và next bounded deliverable

Windows, identity, immutable attempt service, gates/state recovery, analytics receipts/projection và unhealthy begin-only proof+latch có code/focused tests; accounting chưa nối inference. Snapshot/ownership inspection là unused groundwork, không durable initialization intent.

**Next delivery:** explicit bounded Node/SQL.js initialization-intent + offline recovery writer, exact pre/post + receipt, deterministic payload, intent-before-sidecar, durable ACK/crash/replay matrix và operator gates cần cho lifecycle. Không startup repair, retrofit ambiguous history hay bỏ strict recorded-spend semantics. Legacy sidecar-first initializer phải fail-closed/unreachable khi replacement ship, nhưng giữ isolated original failure evidence/assertions. Không mở thêm foundation nếu không có consumer/blocker trực tiếp. Sau gate này ưu tiên actual hooks Phase04; broader release parity vẫn giữ. [Protocol design](./reports/initialization-intent-design.md) và [current roadmap](./plan.md#current-delivery-roadmap) là chỉ dẫn tiếp tục; phase chưa accepted.

## File ownership

Paths expand từ `/home/gmo/projects/9router/`.

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/lib/apiKeyBudget/service.js` | Resolve context, gate/begin/settle/unresolved/recovery; dùng accounting repo + pricing snapshot + durable coverage-gap state. |
| Create | `src/lib/apiKeyBudget/windows.js` | Monday/month calendar `[start,end)` UTC derived từ timezone explicit. |
| Create | `src/lib/apiKeyBudget/errors.js` | Local typed errors/codes, native client envelope helpers. |
| Create | `open-sse/config/apiKeyBudgetConstants.js` | Shared state/error/scope/timezone constants, không magic strings lặp. |
| Modify | `src/sse/services/auth.js` | Resolve active gateway key identity; giữ isValidApiKey wrapper. |
| Modify | `src/lib/db/repos/usageRepo.js` | Analytics projection cost snapshot + ID; keep legacy rows readable, no enforcement from fail-open saveRequestUsage. |
| Create | `tests/unit/api-key-budget-windows.test.js` | Boundary/calendar/TZ tests. |
| Create | `tests/unit/api-key-budget-policy.test.js` | Gate/concurrency/toggle/exhaustion/unresolved tests. |
| Create | `tests/unit/api-key-accounting-state.test.js` | Callback replay/abort/late usage/recovery/version tests. |
| Modify | `tests/unit/usage-api-key-attribution.test.js` | Stable-ID grouping/new output redaction + legacy compatibility. |

## Requirements và implementation checklist

- [ ] Window helper accepts clock injection, timezone from shared config. Fixed `Asia/Ho_Chi_Minh` v1; không dùng server-local date parsing hay duration 7/30 ngày. Verify Monday/month 00:00 maps to UTC previous day 17:00.
- [ ] Generate requestId + attemptId server-side. Resolve active key ID regardless of requireApiKey toggle for known keys; disabled known key fails auth, không hạ xuống local bypass. Match outer guard precedence Bearer > x-api-key > x-goog-api-key > query key; phase 04 owns Gemini wrapper/cancellation/native errors, TTS outside scope. Enumerate 10 production `isValidApiKey` callers theo [source audit](./reports/validation-session-01.md); giữ boolean wrapper compatibility. Keep no-key/CLI compatibility theo current guard; require key nếu muốn mọi traffic chịu quota.
- [ ] Read policy + settled spend + cross-window unresolved + key/global durable coverage-gap + storage health. Null limit unlimited, zero immediate refusal. Budget activation và budgeted admissions block khi unreconciled gap; no-key exemption không bypass writer ownership. Unlimited identified inference continue chỉ sau durable gap latch ack; nếu latch failure reject identified dispatch. Check weekly/monthly OR, no in-memory-only cached allowance, no network serialization.
- [ ] `beginAttempt` rechecks gate, resolves valid immutable price snapshot and durable pending insert trước fetch. Unlimited recording failure chỉ exception durable-gap latch như policy ở trên; budgeted intent failure never dispatch. For unlimited identified key, record intent even if price unknown; unknown price/usage finalized unresolved và hiển thị, không block unlimited. Budgeted key missing-price candidate skipped before dispatch.
- [ ] Finalize exactly once by attemptId, exact usage only; failed billed responses settle như success về cost. Proven not-dispatched persists explicit outcome. Missing/incomplete/estimated/invalid usage, ambiguous abort/network lỗi -> unresolved cost null. Pending live không reservation/không block, orphan recovery requires dead owner proof.
- [ ] Unresolved block cross-window cho budgeted key. Toggle unlimited/budget/re-enable, lowering/raising limits và restart giữ ledger spend. Never debit pre-ledger legacy history.
- [ ] Add gap reconciliation qua shared coverage service (phase 01), audited actor/reason/evidence + CAS. Ack/clear sidecar sau audit durable, không erase gap history hoặc gọi estimated costs exact. Freeze affected unrecorded admissions hoặc CAS gap generation để recovery không clear mới phát sinh; global latch requires scope-wide audit. Phase 05 ownership recovery API/UI bao gồm gap state.
- [ ] Add recovery CAS logic with operationId + reason/admin actor. Late exact event resolves unresolved nếu chưa manual action; conflicting settled event signal reconciliation. Waiver là explicit audited zero, không xóa dòng hoặc giả provider exact. Preserve original rate snapshot; missing snapshot requires audited manual cost evidence.
- [ ] Analytics projection chỉ sau ledger ack, uses same ID/cost. Two identical token tuples with distinct IDs both charged; duplicate same attempt no-op. New stats bucket keys/output no raw secret; partial legacy ring/day aggregates phải redacted tại API boundary được chạm.
- [ ] Request/attempt/hooks là local args/closures, không singleton executor `this`/global state; interleaving two keys + retries tests isolation. Driver ownership/health process-global riêng, HMR-safe.
- [ ] Shared local errors distinguish candidate-unpriced vs terminal exhausted/unresolved/unavailable. Provider account cooldown không biết những lỗi này. Native envelope helpers designed for pre-stream and stream terminal usage.

## Verification gate

```bash
(cd tests && npx vitest run unit/api-key-budget-windows.test.js unit/api-key-budget-policy.test.js unit/api-key-accounting-state.test.js unit/usage-api-key-attribution.test.js)
npx eslint src/lib/apiKeyBudget src/sse/services/auth.js src/lib/db/repos/usageRepo.js open-sse/config/apiKeyBudgetConstants.js
```

Test matrix: weekly only/month only/both, limit exact equality, two keys same mask, UTC server timezone vs chosen zone, December/January, February leap/non-leap, starts exactly end boundary, restart before/after reset, long attempt crossing reset, enable after unlimited spend, lower/toggle budgets, unresolved previous month, multiple simultaneous admissions overshoot with subsequent denial, duplicate/late/conflicting callback and admin races. New tests all green; overshoot test explicitly expects recorded-spend contract, **not hard cap**. Add unlimited intent/settlement failure + durable gap latch, failed-latch dispatch denied, restart gap persistence + budget activation denied, admin gap reconciliation race, conflicting Gemini credentials và disabled key tests.

## Risk/security/failure protocol

Admin recovery là tối thiểu để strict missing-usage policy có lối thoát, không billing credit/topup system. Monetary fields/actor/operationId validated; no key secret/prompt retained in audit. Stop nếu SUM/precision vượt safe bound, window lệch hoặc state transitions ghi sai tiền; không thay strict policy bằng free/estimated usage để tests pass.
