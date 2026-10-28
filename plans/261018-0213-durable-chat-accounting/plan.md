---
title: "P3 — Một luồng chat accounting khép kín"
description: "OpenAI-compatible chat JSON/SSE với ledger thật và own ACK."
status: completed
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
- **Acceptance:** positive full flow JSON/SSE, gồm cache-read/write usage → đúng chi phí ledger; lost ACK/duplicate/late/abort/restart/two-key isolation, original snapshot qua price drift và current authority qua held awaits; measured overhead rõ workload, không bỏ guards để đạt deadline.

## Phases

**Completed — 2026-10-28.** Both named prerequisites and all four P3 phases
have acceptance evidence: 185 selected JSON/SSE controls, 126 affected-consumer
controls, the complete 4800-request measurement, production build and isolated
standalone smoke. [Final reconciliation](../reports/implementation-261028-1243-chat-plan-completion.md)
maps every exit obligation and retains limitations/red history. Acceptance is
the selected strict compatible-chat profile on Node SQLite/SQL.js; production
activation remains OFF. P4/P5, provider inventory and release remain separate.

[Brainstorm hướng tích hợp, 2026-10-23](../reports/brainstorm-261023-0517-p3-chat-accounting-direction.md) là proposal lịch sử. Invocation `--auto` hiện tại chọn lifecycle chung, prerequisite policy/persisted authority và transport, JSON trước rồi SSE; user đã chọn narrow policy classifier + verified read-only persisted authority. [Execution design](./design-preparation.md) giữ nguyên toàn bộ acceptance, cache scope và activation OFF.

1. [Chuẩn bị slice chat](./phase-01-start.md).
2. [JSON attempt lifecycle](./phase-02-json-attempt-lifecycle.md), sau named prerequisite.
3. [SSE terminal lifecycle](./phase-03-sse-terminal-lifecycle.md), sau JSON.
4. [Combined acceptance](./phase-04-combined-acceptance.md).

Trạng thái chi tiết theo checkboxes/`ak plan status`; các mục execution có ngày
bên dưới giữ lại lịch sử, không thay thế final reconciliation.

## Execution — 2026-10-23

[Named prerequisite](../261023-0739-p3-chat-dispatch-prerequisites/plan.md) phụ thuộc P2, không depend ngược P3; đây là slice active duy nhất. Đã có candidate policy/schema/sidecar marker và adapter-owned persisted reader trên `feat/durable-chat-accounting`, chưa accepted. Focused gate có 15 pass/2 timeout; diagnostic có 13 pass/4 timeout, không xác định đầy đủ nguyên nhân. Dừng theo finite failure protocol trước transport/JSON/SSE. Không tăng timeout, bỏ guard, đổi concurrency để lấy green, apply stash, commit/push/merge hay activate. [Execution receipt](../reports/implementation-261023-1430-durable-chat-accounting.md) giữ evidence và phần chưa reached.

Ngày 2026-10-26 user yêu cầu tiếp tục. Review đã sửa việc giữ proof sau lỗi
đóng engine ở adapter; hai controls mới và 39 tests liên quan đạt. Gate tập
trung hiện tại vẫn đỏ: 18 đạt, một ca Node timeout 5 giây. Đã nhận counsel và
dừng vòng hữu hạn này trước transport/JSON/SSE vì chưa chứng minh nguyên nhân.
[Báo cáo tiếp tục](../reports/implementation-261026-1757-durable-chat-accounting.md)
ghi rõ scope chưa xong; trạng thái CLI là `in-progress`, không nghiệm thu P3.

## Historical execution — 2026-10-27

Both named prerequisite phases are accepted: [policy/persisted proof](../reports/implementation-261027-0850-persisted-authority.md) and [per-POST transport](../reports/implementation-261027-0903-transport-boundary.md). Historical timeouts were diagnosed and repaired without changing deadlines or guards. JSON/SSE implementations have passing selected-profile app controls on both adapters. [Current receipt](../reports/implementation-261027-chat-lifecycle.md) retains the evidence and red history. Combined acceptance is unaccepted: the 300-second measurement retained 1600/4800 completed request evidence; the independent 300-second build stopped at compile without completion evidence. Guards/deadlines were preserved. Full P3 is not complete; activation stays OFF.

The user requested completion again and explicitly approved a 1200-second bound
for the full measurement on October 27. Only its total run limit changes;
request deadlines, concurrency and guards do not. The
[continuation diagnosis](../reports/debugger-261027-1324-chat-acceptance.md)
records batched synchronous authority reads and build tracing evidence.

## Reuse và ranh giới
Old sources: requestAccounting/service, chat handlers/chatCore/Base integration, raw usage/SSE/parser và queued Base controls. Read **unaccepted** stash `requestAccounting.js`/`accountedBase.js` và bốn tests như candidate, không treat security repair đã accepted. Không copy unrelated Kimchi/snapshot WIP.

P3 bao gồm actual retries vốn có trên transport được chọn: mỗi generation POST own attempt và fresh successor gate. Nếu thiếu seam thì tạo prerequisite nhỏ từ X5; không tuyên bố path supported nhưng bỏ internal retry. Current upstream empty-content fallback/ACL phải được giữ và có tests.

## Phạm vi cache đã thống nhất — 2026-10-23

“Cache hit” ở đây là **prompt cache phía provider**: request vẫn gọi upstream, provider báo lượng token đọc từ cache và có thể báo lượng token ghi cache. Không có yêu cầu thêm response cache lưu rồi trả lại nguyên câu trả lời tại 9router/proxy; source inspection hiện tại không tìm thấy tính năng này trong luồng chat. Claude CLI bypass là nhánh trả lời cục bộ riêng, không phải cache hit hoặc bằng chứng usage upstream.

- Reuse [P2 exact usage contract](../../docs/ACCOUNTING.md#exact-usage-and-states) và [bộ tính chi phí](../../src/lib/accounting/exact-money.js), không tạo công thức riêng ở parser. Input chuẩn hóa bao gồm cache read/write; hai phần này không chồng nhau và phải trừ khỏi input thường trước khi áp đơn giá. Cache hit không làm giảm giá toàn bộ request; output vẫn theo giá output/reasoning tương ứng.
- Giữ original price snapshot: cache read dùng `cached`, cache write dùng `cache_creation`; thiếu hai mức giá này dùng giá input theo fallback đã có. Giá khai báo `0` là mức giá bằng zero, khác thiếu giá. Nếu profile có cache-write tiers 5m/1h, phải có counts/rates theo contract gốc; thiếu bằng chứng bắt buộc thì không settle exact.
- P1/P2 đã có pricing/core và [unit tests cache cost](../../tests/unit/accounting-exact-money.test.js), nhưng chưa chứng minh mapping raw provider JSON/SSE → exact usage → durable ledger của P3. Profile được chọn phải xác định total input đã bao gồm cache hay chưa, tên trường usage và khi nào trường vắng có nghĩa zero; không suy mọi provider “compatible” có cùng semantics. Usage thiếu hoặc mâu thuẫn không được tự coi là zero hay áp giá input thường để che thiếu dữ liệu; phải giữ unresolved/null-cost khi không đủ bằng chứng exact.

## Exit obligations
- Intent ACK trước POST, own settlement ACK trước eligible terminal; persisted row không substitute delivered ACK. Streaming failure đóng native terminal đúng format, không promise đổi HTTP status sau bytes.
- Hold intent→credential/key disable/pool/routing drift phải refuse invalid POST; positive controls vẫn thực sự dispatch, không chỉ denial tests.
- Duplicate/conflicting/late callbacks, cross-key concurrency, failure exact usage, unknown/no-zero và reload DB có evidence.
- Cache acceptance trên actual selected-profile JSON/SSE: no-hit, partial/full cache-read với giá khác input, explicit zero cache rate và missing-rate fallback; cache-write/tier cases theo profile. Kiểm tra raw usage, normalized counts và persisted cost sau reopen, không tính cache hai lần; giữ original cache rates qua price drift. Missing/conflicting cache evidence theo semantics đã chốt phải unresolved/null-cost. Nếu profile không phát sinh một category/tier, phải ghi rõ evidence cho zero/not-applicable; không claim provider inventory đã covered từ core tests.
- Named affected consumers + relevant strict proxy/default no-key regressions; no local refusal cooldown/bypass by fallback. Gates không thay original deadlines/prewarm.
- Không public partial accounting coverage/ledgerStartedAt toàn scope; isolated fixture-only activation phục vụ tests, không production.

[Roadmap/contract](../261018-0213-api-key-budget-roadmap/plan.md). Outline only; detail scope/files/tests sau P2. Có thể tách JSON/stream thành hai slice liên tiếp nếu dependency review thấy còn lớn; giữ cả hai obligation.

<!-- slug: durable-chat-accounting -->
