---
title: "Preflight và calendar/enforcement trên P3"
status: todo
---

# Phase 1 — Preflight và calendar/enforcement trên P3

Prerequisite: P3 complete selected JSON/SSE trên Node SQLite/SQL.js; production OFF. Đọc [solution](./solution-design.md) trước implementation; không port service cũ hoặc mở coverage.

## Outcome / files

Actual P3 attempts obey weekly/monthly recorded-spend threshold, remain durable/exact, return trusted typed failures và không bypass qua retry. Phase này phải có actual handler→dummy POST→ledger→refusal, không helper-only closure.

**Existing owners được sửa có chọn lọc:**
- `src/lib/db/helpers/accounting-policy.js`, `src/lib/db/repos/api-key-accounting-repo.js`: policy CAS, counts/window projections; giữ schema/retention/identity.
- `src/lib/accounting/service.js`: fresh same-transaction gate + `startedAt` từ cùng clock; synchronous final gate và immutable receipt window identity.
- `src/lib/accounting/persisted-chat-authority.js`, `src/sse/services/chat-accounting.js`, `src/sse/handlers/chat.js`: composition, typed error propagation, policy drift, fixture clock/readiness association.
- `open-sse/utils/accounting-transport.js` chỉ sửa nếu typed metadata thực sự cần; giữ no-await và own receipt boundaries. Đọc `open-sse/AGENTS.md` trước bất kỳ engine edit; ưu tiên app-side composition.

**New proposed owners:** `src/lib/accounting/budget-windows.js`, `budget-policy.js`, `budget-errors.js`, `budget-management.js` (projection/readiness composition), `tests/fixtures/accounting/budget-web-fixture.mjs`; tests `accounting-budget-windows.test.js`, `accounting-budget-policy.test.js`, `chat-budget-loopback.test.js`, `chat-budget-stream.test.js`. Tên mới là planned files, không claim đã tồn tại.

## Tasks / hard preflight

- [x] Re-read P3 final receipt, current schema/persisted authority/health/transport and tests. Record revision/adapter/commands, feature branch từ develop khi được authorize implementation; không code trực tiếp master.
- [x] **Harness feasibility spike trước feature mutation:** dùng tests-only loopback runner chứng minh actual HTTP Request→private fixture association→actual `handleChat` và actual budget-route composition có thể cùng module/DB lifetime; static actual dashboard artifact qua browser và authenticated management boundary không mock. Budget route chưa có thì spike dùng existing guarded route để prove guard/HTTP seam, không gọi đó là budget acceptance. Ghi exact artifact/import/socket wiring và future file map trong receipt. Không thêm shipping header/env/route activation. Không prove được thì STOP/review, không đánh dấu preflight done.
- [x] Chuẩn bị clock fixture riêng, chỉ điều khiển domain instant, không network timers/deadline. Verify two keys và disposable DB không chạm `~/.9router`; capture baseline focused/affected tests theo phase3.
- [x] Test-first calendar matrix: exact boundary −1ms/at/+1ms; UTC khác HCM, Monday và day1, overlap Monday/day1, February28/29, 30/31 ngày, Dec→Jan; đổi `TZ` server không đổi result. Reject invalid clock/unsupported timezone.
- [x] Add exact validation/CAS + projection tests: null/0/positive/9-decimal/max; reject Number/exponent/extra/precision/negative/overflow; no-op/current vs stale version; sums > safe Number; unknown/missing policy fail closed. No new default/upsert/migration timestamp.
- [x] Test-first actual budget gate; capture admitted instant trong coordinator member transaction, policy+spend/count read và insert chung boundary. Không dùng stale quick check/queued time. Gate final sync trước permission consume, no await before actual invoke.
- [x] Preserve terminal-independent-of-policy/snapshot; final local refusal `not_dispatched` chỉ khi no exposure với own terminal ACK. Typed budget cause không mất trong catch; failed terminal durability →unavailable. Policy/key/ACL drift và rollover refuse, không tự retry/re-date/rebind.
- [x] Error propagation selected JSON/SSE giữ local provenance và terminal-only failure semantics; no-store/requestId/Retry-After/CORS, upstream lookalike không trusted. Không mở native formats ngoài selected profile.

## Verification matrix bắt buộc

| Control | Observable pass condition |
|---|---|
| null/null, zero, weekly-only, monthly-only, both | Unlimited records;0 no upstream; either exhausted refuses; blocked windows và max reset đúng |
| lower/raise/null/re-enable | Same spend/identity/history; fresh request policy mới; held request policy drift refuses trước POST |
| delayed terminal/concurrency | Hai pending live vẫn POST khi chưa có recorded exhaustion; overshoot cả hai settle exact, next blocked; không hard-cap claim |
| held intent ACK, peer settle | Peer exhausts budget trước held request dispatch → held request no POST + not_dispatched/own ACK |
| held intent ACK qua reset tuần hoặc tháng hoặc cả hai | Finite dimension rollover → no POST, reason budget_window_changed, no re-date/retry; dimension unlimited/null-null không calendar-deny; new request chọn kỳ mới |
| POST trước reset, terminal sau reset | Charge window startedAt cũ, previous-window summary/overshoot đổi; current window không bị chuyển tiền |
| unresolved/pending restart | Missing usage null-cost; finite next attempt blocked qua calendar/restart; orphan pending recover unresolved; unlimited vẫn đúng P3 rules |
| health/gap/authority | Invalid/missing policy/owner/sidecar denies; finite never gap-continues; unlimited recording-only failure cần fresh explicit unlimited + own gap ACK |
| retries + failed HTTP usage | Actual POST mỗi attempt riêng; exact failed usage charged; exhausted/unresolved/storage stops successor, no cooldown/fallback bypass |
| original price/late sink | Price/policy/reset drift không reprice hoặc drop acknowledged attempt; duplicate no double debit |
| JSON/prestream/SSE |429 hoặc503 đúng, native error terminal sau bytes, no late HTTP status rewrite; no false finish/DONE |

Run focused proposed files và existing accounting/chat suites bằng commands phase3 trên cả hai adapters. Mỗi denial kèm positive actual POST control. Ghi failed evidence và finite diagnosis; không sửa deadlines/guards/concurrency để qua test.

## Exit

- [x] Harness seam proven và test-only; exact executable runner commands/artifact wiring được chốt trước phase2.
- [x] Focused + actual JSON/SSE threshold, drift/rollover/concurrency/reopen controls pass; retained ledger/policy/identity verified trên Node SQLite/SQL.js.
- [x] No production activation/coverage timestamp, no new counters/job, no singleton per-key state, no regressions selected P3 ACK/authority behavior.
- [x] Receipt chỉ rõ support limits và baseline failures; phase2 mới được bắt đầu sau closure này.
