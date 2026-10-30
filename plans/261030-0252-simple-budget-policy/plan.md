---
title: "B1 — Budget đơn giản, bỏ qua request gián đoạn thiếu usage"
description: "Thay P5 bằng điều chỉnh nhỏ: chi phí đã biết quyết định budget; không có quy trình xử lý khoản chưa rõ."
status: completed
priority: P1
effort: "Hai phase tuần tự; chưa estimate"
branch: develop
tags: [budgets, simplification, accounting]
blockedBy: [261018-0213-weekly-monthly-budget]
blocks: [261018-0213-budget-release-acceptance]
created: 2026-10-30
---

# B1 — Budget theo số tiền đã ghi nhận

## Quyết định người dùng — 2026-10-30
- Mục tiêu: theo dõi ngân sách cấp theo từng API key; chặn request mới khi số tiền đã ghi nhận chạm/vượt ngân sách. Admin tăng hạn mức thì key chạy tiếp nếu không còn chạm hạn mức nào.
- Người dùng chấp nhận sai số: request gián đoạn mà không nhận được thông tin sử dụng để tính phí thì **bỏ qua, không tính budget, không đánh dấu khoản chưa rõ, không yêu cầu admin xử lý**.
- Đã hỏi riêng và được chọn: **budget tuần/tháng tự làm mới theo kỳ**, không phải tổng credit vĩnh viễn. Sang kỳ mới có thể chạy tiếp mà không cần admin tăng budget; lịch sử chi phí không bị xóa.
- Đây là thay đổi yêu cầu có chủ đích so với contract cũ, không phải bằng chứng code hiện tại đã đáp ứng. [P5](../261018-0213-accounting-recovery/plan.md) bị hủy, không được đánh dấu hoàn tất.

## Contract hiện hành
- **Outcome:** API/UI cho thấy hạn mức tuần/tháng, đã dùng, còn lại và thời điểm kỳ mới; admission chỉ xét chi phí đã ghi nhận cho budget, không bị kẹt vì request gián đoạn thiếu usage (interrupted+absent); safety errors ngoài ngoại lệ giữ nguyên.
- **Constraints:** giữ key isolation, số tiền chính xác cho usage hợp lệ, original price/startedAt, không ghi trùng, lưu bền qua restart; giữ auth/CSRF/ACL và single writer. Calendar `Asia/Ho_Chi_Minh`, tuần bắt đầu thứ Hai 00:00, tháng bắt đầu ngày 1 lúc 00:00.
- **Non-goals:** recovery UI/API/CLI, correction/waiver workflow, danh sách/cảnh báo unknown, truy vấn nhà cung cấp để tìm lại phí, background reconciliation; managed physical restore; reservations/hard cap; mở provider/protocol coverage hoặc bật production trong plan này.
- **Acceptance:** actual selected chat JSON/SSE → ledger → API/UI → block/increase/period rollover trên Node SQLite/SQL.js Linux; gián đoạn thiếu usage không debit/không unknown blocker/UI; known spend không mất khi restart/import; duplicate/late evidence không double-charge; guard và storage-failure controls giữ đúng.

<!-- Updated: Validation Session 1 - narrow evidence exception and compatibility stop gate -->

## Quy tắc cụ thể
1. Usage hợp lệ từ upstream, định giá được bằng snapshot đã chọn: tính một lần, kể cả response lỗi hoặc client ngắt sau khi đã nhận đủ usage. Không dùng HTTP success/failure làm bằng chứng miễn phí.
2. Request gián đoạn/abort/mất kết nối và **không có usage dùng được**: không thêm chi phí, không tạo trạng thái unknown phải xử lý, không ngăn request sau. Phân loại evidence tường minh qua producer/terminal/persistence: absent khác malformed/conflicting; chỉ interrupted + absent được hưởng ngoại lệ. Response hoàn tất thiếu usage không tự hưởng ngoại lệ B1. Không ước lượng token từ text/bytes.
3. Không mở rộng ngoại lệ thành bỏ qua lỗi DB, ghi thất bại, identity/auth lỗi, thiếu cấu hình giá hoặc unsupported/malformed usage schema. B1 không tự sửa chính sách các lỗi này thành free hoặc thành request được phép chạy. Phân loại bằng evidence thật, không bằng chuỗi lỗi upstream.
4. Không tạo recovery workflow hay backfill job. Nếu callback hiện có nhận được usage hợp lệ đến muộn, ghi một lần vào kỳ `startedAt` gốc, không tiêu allowance kỳ mới; không tìm lại dữ liệu đã mất. Callback lặp không debit lần hai. Không yêu cầu terminal mới để tiếp tục request sau khi đã bỏ qua khoản thiếu usage.
5. Chỉ reuse metadata nội bộ cần cho ghi một lần (request ID, original startedAt, duplicate protection); không tạo durable unresolved-work marker, recovery queue hay budget blocker cho request gián đoạn thiếu usage, kể cả marker bị giấu khỏi UI. Giữ phân biệt request còn chạy và intent thuộc process đã xác minh chết; restart không yêu cầu admin clear-unknown. Không xóa record của request đang chạy hay charge đã biết để đơn giản hóa. Abandoned intent không có bằng chứng đã lưu áp dụng rule 8; lỗi ghi một khoản đã có usage được phát hiện hoặc usage đã lưu vẫn giữ nghĩa vụ/safety, không bị miễn bằng cách coi process đã chết.
6. Cả weekly/monthly cùng có hiệu lực. `null` unlimited, `0` block. Mỗi window chặn khi `spent >= limit`; tăng một hạn mức chưa đủ nếu hạn mức kia vẫn hết. Edit budget không reset spend. Kỳ mới chọn lại window, không xóa lịch sử. `0` vẫn block sau kỳ mới.
7. Đây là ngưỡng trên chi phí **đã ghi nhận**, không cam kết khớp hóa đơn hoặc không vượt từng cent: các request đang chạy có thể làm vượt budget. Không reserve tiền trước request.
8. Quyết định bổ sung đã được người dùng duyệt: chấp nhận sai số do crash, budget theo bằng chứng đã lưu. Áp dụng cho dữ liệu cũ và crash tương tự về sau: request đã kết thúc hoặc owner được xác minh chết, không có bằng chứng usage/phí khôi phục được thì không suy đoán phí và không chặn vì riêng sự mơ hồ đó. Giữ dấu vết/idempotency, không kết luận thực tế miễn phí, không tạo unresolved-work/recovery product. Usage đã lưu dù chưa settled vẫn là nghĩa vụ ghi phí; known spend/bindings/snapshot/audit không đổi. Lỗi ghi phí đã phát hiện, lỗi đọc/DB/coverage/identity độc lập vẫn giữ safety: không đọc được không có nghĩa là absent. Không giải phóng request đang chạy, không xóa sidecar/gaps, không thao tác DB thật. Rule này thay stop gate legacy ambiguity cũ; không mở rộng ngoại lệ cho completed+absent hay malformed/conflicting đã quan sát.
9. Với SSE đã có authoritative usage hợp lệ theo selected profile, đủ trường và không có conflict đã quan sát, EOF/client cancel trước `[DONE]` vẫn debit một lần theo snapshot/startedAt gốc. Settlement độc lập protocol success: không fake finish/DONE. Partial/invalid/conflicting observations không được nâng thành exact; duplicate/late callbacks vẫn giữ idempotency.

## Phases
| # | Phase | Status |
|---|---|---|
| 1 | [Sửa semantics và tương thích dữ liệu cũ](./phase-01-budget-semantics.md) | Completed — focused Linux milestone, 246/246 tests |
| 2 | [API/UI và actual acceptance](./phase-02-integration-acceptance.md) | Completed — selected Linux fixture scope |

## Completion — selected Linux fixture scope only

B1 complete within selected Linux Node SQLite/SQL.js fixtures. Final affected
regression **775/775, 49 files, zero failed/pending**; repository comparator PASS.
Fresh build `y-kR5qknFW8BhMBVv9Sku`; hybrid UI/API/chat/ledger/CLI20/20 each
adapter; detached shipping smoke8/8 confirms production remains OFF. Earlier
failed receipts, build warnings and bounded test corrections preserved.

[Implementation receipt](../reports/implementation-261030-b1-recorded-spend.md)
records commands, scope, evidence and limitations. Not whole-repo/all-platform/
all-provider/invoice-hard-cap/release acceptance. No real DB, activation,
commit/push/merge/deploy. Crash undercount and in-flight overshoot accepted;
independent safety/identity/coverage controls retained.

## Approved policy revision — after compatibility characterization

Người dùng duyệt nguyên văn: “Duyệt đề xuất: chấp nhận sai số do crash, budget theo bằng chứng đã lưu.” Cho phép cập nhật plan và tiếp tục implementation/checks hai phase. Không cho phép DB thật, production activation, commit/push/deploy. Sai số có thể làm budget thấp hơn hóa đơn upstream nếu crash sau nhận usage trước durable commit. Safety độc lập và nghĩa vụ usage đã lưu giữ nguyên. Legacy ambiguity không còn là blocker quyết định; implementation/acceptance vẫn phải chứng minh classification đúng.

## Historical implementation attempt — legacy compatibility stop

Branch `test/b1-legacy-provenance-gate`, base `57d82de4`. Disposable actual-process
SIGKILL characterization passes on Node SQLite and SQL.js (2/2): absent usage
and exact usage lost before terminal commit produce identical compared accounting
evidence after startup recovery. Independent known spend survives. This is a
provenance limitation, **not** evidence of actual historical lost charges.

Theo rule 8 tại thời điểm đó, đã dừng để xin quyết định riêng; nay quyết định được duyệt phía trên thay stop gate này. Characterization vẫn là bằng chứng lịch sử, không phải compatibility acceptance. Production remained OFF; Phase 1/2 acceptance chưa hoàn tất tại checkpoint lịch sử đó. See [evidence and exact scope](../reports/implementation-261030-b1-legacy-provenance-gate.md).

## Current source — chưa sửa
Inspection tại `develop` `57d82de4`:
- `src/lib/accounting/budget-gate.js`: unresolved row hiện chặn finite budget.
- `src/sse/services/chat-accounting.js`: exposed POST thiếu usage hiện finalize thành unresolved; fixture-only, không có production activation.
- `src/lib/accounting/service.js`, `src/lib/db/repos/api-key-accounting-repo.js`, `src/lib/db/accounting-lifecycle.js`: terminal/restart/late settlement và accounting constraints phải được sửa nhất quán, không chỉ bỏ một if trong gate.
- `src/lib/accounting/budget-management.js`, `src/lib/accounting/budget-projection.js`, `src/shared/components/ApiKeyBudgetPanel.js`: eligibility/count/UI vẫn theo quy tắc unknown recovery cũ.
- Production finite budget PUT vẫn trả `accounting_not_ready`. B1 không tuyên bố hoàn tất hai chức năng trên production khi vẫn fixture-only; activation cần scope/authority riêng, không lén bật từ simplification.

## Phạm vi thay thế và không thay thế
B1 là authority mới cho ngoại lệ gián đoạn thiếu usage, no-marking và việc bỏ recovery-product P5. X1–X6 phải theo semantics này khi được triển khai; các chữ unknown/unresolved/recovery trái quy tắc này trong outline cũ không còn là yêu cầu sản phẩm. Không có blanket waiver cho storage/auth/pricing/adapter safety hoặc coverage chưa triển khai. P1–P4 receipts giữ nguyên như bằng chứng lịch sử theo contract lúc đó, không chứng minh B1 đã pass.

So với P5 đầy đủ, hướng nhỏ hơn reuse ledger/gate/API/UI có sẵn và chỉ đổi semantics liên quan. Chi phí đổi hướng là test/migration/consumer updates; không xây công cụ vận hành mới. Bỏ hẳn mọi kiểm tra và chỉ tăng số dư UI là không đủ vì code hiện vẫn chặn ở dispatch.

## Historical planning log — trước validation
- Review kế hoạch trong phiên + Advisor trước khi sửa docs; không independent full-source audit.
- Các quyết định product phía trên do người dùng chốt, không hỏi lại. Runtime/adapter/source coverage chỉ là phạm vi dự kiến, chưa acceptance.
- Kiểm tra links, dependency graph, file/test paths và consistency được ghi trong [receipt](../reports/planning-261030-simple-budget-policy.md).
- Không sửa runtime, không thao tác DB thật, không commit/push/merge/deploy hoặc activation.

## Validation Log

### Session 1 — 2026-10-30
**Trigger:** `/ak:plan validate plans/261030-0252-simple-budget-policy/plan.md`.
**Questions asked:** 4. Không hỏi lại weekly/monthly/no-recovery product decisions đã chốt.
**Scope:** docs-only; source tại `develop` `57d82de4`; hai phase vẫn pending. Không chạy unit/browser/build/runtime tests hoặc chạm DB thật. Giữ nguyên các thay đổi planning/build artifacts có sẵn ngoài B1.

#### Verification Results
- **Tier:** Light — Fact Checker, 5 sampled claims/phase.
- **Claims checked:** 10.
- **Verified:** 10 | **Failed:** 0 | **Unverified:** 0 (chỉ sample source facts, không phải implementation acceptance).

| # | Phase / claim | Result / evidence |
|---|---|---|
| 1 | P1: finite gate hiện block unresolved | VERIFIED — `src/lib/accounting/budget-gate.js:21-23` |
| 2 | P1: exposed POST thiếu usage hiện tạo unresolved | VERIFIED — `src/sse/services/chat-accounting.js:101-108,123` |
| 3 | P1: service/repo sở hữu terminal, original snapshot và late settlement | VERIFIED — `src/lib/accounting/service.js:109-120`; `src/lib/db/repos/api-key-accounting-repo.js:30-52` |
| 4 | P1: startup/close pending recovery là mutation cần sửa nhất quán | VERIFIED — `src/lib/db/accounting-lifecycle.js:6-15`; `src/lib/db/repos/api-key-accounting-repo.js:83-87` |
| 5 | P1: 8 named focused Vitest suite paths tồn tại | VERIFIED — filesystem check cả 8 `tests/unit/*.test.js` trong P1 command; không chạy tests |
| 6 | P2: projection/eligibility vẫn dùng unresolved counts | VERIFIED — `src/lib/accounting/budget-projection.js:19-23`; `src/lib/accounting/budget-management.js:54` |
| 7 | P2: API GET/PUT có management guard, production finite PUT chưa ready | VERIFIED — `src/app/api/keys/[id]/budget/route.js:13-19`; `src/lib/accounting/budget-management.js:76-79` |
| 8 | P2: panel còn unknown count/recovery copy | VERIFIED — `src/shared/components/ApiKeyBudgetPanel.js:62-63,74` |
| 9 | P2: 7 named focused Vitest suite paths tồn tại | VERIFIED — filesystem check cả 7 `tests/unit/*.test.js` trong P2 command; không chạy tests |
| 10 | P2: browser/CLI checks được fixture runner import, không phải standalone entrypoints | VERIFIED — `tests/fixtures/accounting/budget-web-fixture.mjs:222-225`; hai check files tồn tại |

Supplemental mechanical checks: 5 local Markdown links resolve; all 15 named Vitest test files exist. Đây không phải coverage/pass assertion; không có full-source/independent audit. Không có `[UNVERIFIED]` tags hoặc Red Team Review evidence để skip verification.

#### Source-backed gaps resolved by interview
1. `open-sse/utils/accounting-openai-usage.js:19-27` gộp absent, malformed và conflicting thành `null`; `chat-accounting.js:123` không có phân loại đủ narrow cho ngoại lệ B1. Cần structured evidence, không dựa chuỗi lỗi.
2. `src/lib/db/repos/api-key-accounting-repo.js:83-87` gán `network_unknown` cho mọi pending được recover, không giữ provenance để chứng minh absent usage khác failed known-usage write. Không thể chứng minh mọi legacy row migrate được; đây là conditional implementation blocker, không phải fact-check failure.
3. `open-sse/utils/accounting-openai-stream.js:33-40,89-92` chỉ settlement tại DONE, stop dùng null; authoritative usage đã quan sát có thể mất khi EOF/cancel. `chat-accounting.js:100-102` cache terminal promise nên phải kiểm tra cả sink duplicate/late ownership, không chỉ đổi gate. JSON catch `open-sse/executors/accounted-base.js:35-47` cũng phải phân biệt evidence failure và terminal-write failure, không downgrade thành absent.
4. Schema state constraint nằm ở `src/lib/db/schema.js:109`; verifier trong `src/lib/db/migrations/002-accounting-foundation.js:23-36` đọc current `TABLES`. Consumer imports hiện có: `src/lib/db/migrate.js:12`, `src/lib/db/persisted-accounting-authority.js:2`, `src/lib/accounting/persisted-chat-authority.js:1`, `src/lib/accounting/budget-management.js:4`; chính migration cũng gọi verifier. Schema route cần conditional inventory/version/backup/ordering, không sửa shipped `up()` thay migration mới.

#### Questions & Answers

1. **[Architecture / Assumptions]** B1 cần phân biệt trường hợp thiếu usage nào để tránh biến lỗi dữ liệu thành request miễn phí?
   - Options: **Phân loại tường minh (Recommended)** — chỉ interrupted+absent được bỏ qua; giữ valid/malformed/conflicting riêng, completed+absent ngoài ngoại lệ | **Mở rộng sang mọi thiếu usage** — thêm completed+absent vào ngoại lệ, không miễn trừ malformed/conflicting/storage.
   - **Answer:** Phân loại tường minh (Recommended).
   - **Custom input:** Không có.
   - **Rationale:** `null` hiện tại không đủ chứng minh ngoại lệ, có thể che lỗi schema/conflict.
2. **[Risks / Compatibility]** Với row cũ chỉ có `network_unknown`/null cost và không đủ provenance để biết thiếu usage hay từng ghi phí thất bại, B1 nên xử lý thế nào?
   - Options: **Chặn tương thích đến khi phân loại (Recommended)** — dừng compatibility acceptance/report blocker nếu không phân biệt được, không bulk-waive hay thêm recovery product | **Bỏ qua row mơ hồ không có usage** — chấp nhận historical undercount, giữ known spend và independent storage/identity controls.
   - **Answer:** Chặn tương thích đến khi phân loại (Recommended).
   - **Custom input:** Không có.
   - **Rationale:** Không được đánh đồng thiếu provenance với miễn phí hoặc corruption. Nếu evidence không đủ, cần quyết định riêng trước exit; không biến thành per-request admin recovery.
3. **[Architecture / Tradeoffs]** Nếu SSE đã có usage hợp lệ rồi EOF/client ngắt trước `[DONE]`, có ghi phí mà vẫn giữ response là gián đoạn không?
   - Options: **Ghi phí, không giả success (Recommended)** — authoritative profile-valid usage, original snapshot/startedAt, không fake finish/DONE | **Giữ DONE là điều kiện ghi phí** — thiếu completion thì chưa settle, phải đổi contract hiện tại.
   - **Answer:** Ghi phí, không giả success (Recommended).
   - **Custom input:** Không có.
   - **Rationale:** Ledger settlement và protocol success là hai kết quả độc lập; partial/conflicting observations không thành exact evidence.
4. **[Scope / Verification]** Có bổ sung các gate còn thiếu vào phase files, nhưng vẫn giữ B1 là hai phase và không mở rộng production scope không?
   - Options: **Bổ sung gate có điều kiện (Recommended)** — conditional schema/verifier owners, consumer inventory và finite current-source harness preflight | **Giữ outline hiện tại** — chỉ log unresolved gates, chưa đề nghị cook.
   - **Answer:** Bổ sung gate có điều kiện (Recommended).
   - **Custom input:** Không có.
   - **Rationale:** Schema change không mặc định cần thiết; build/runner có historical defaults không đủ làm current-source acceptance.

#### Confirmed Decisions
- Narrow exception: interrupted+absent only; structured classification, không nới completed/malformed/conflicting.
- Legacy ambiguity: stop/report trước compatibility exit; không auto-waive, không tạo recovery product/blocker mới.
- Authoritative usage-before-EOF/cancel: settle một lần mà không giả protocol success.
- Thêm conditional schema, explicit consumer inventory và finite harness gates, giữ hai phase, production OFF.

#### Action Items / Impact on Phases
- [x] P1: bổ sung evidence matrix, terminal ownership, legacy triage/stop condition và conditional schema/verifier/migration gates.
- [x] P2: propagate negative/positive evidence controls, legacy stop gate, consumer inventory, phân biệt stale/health errors với unknown-usage product và current-source harness preflight.
- [x] Index: reconcile narrow exception, legacy compatibility rule và SSE settlement; không đánh dấu implementation complete.
- [ ] Implementation P1: chứng minh legacy classification bằng disposable fixtures; nếu không đủ evidence, dừng và xin quyết định riêng.
- [ ] Implementation P2: ghi inventory và exact build/run/cleanup commands theo actual source/runtime trước khi launch.

### Whole-Plan Consistency Sweep
- Files reread: `plan.md`, `phase-01-budget-semantics.md`, `phase-02-integration-acceptance.md`.
- Decision deltas checked: 4 — narrow classified evidence, legacy ambiguity stop, valid usage before interruption, conditional schema/consumer/harness gates.
- Reconciled stale references: 7 contract/phase locations — broad missing-usage outcome/rule, legacy index rule, P1 old-row task/exit, P2 restart task và broad unknown UI copy. Historical source/planning findings giữ nguyên, có nhãn historical/current-source; không giả code đã đổi.
- Unresolved contradictions: 0. Legacy provenance feasibility và exact implementation harness commands là explicit future stop/preflight gates, không phải acceptance đã pass.
- Recommendation: eligible to begin P1 test-first/disposable-fixture implementation sau khi người dùng cho phép; không đồng nghĩa legacy compatibility đã được chứng minh hoặc cho phép activation. Dừng đúng gate nếu evidence không đủ.
