---
title: "API/UI và nghiệm thu budget đơn giản"
status: completed
---

# Phase 2 — Theo dõi, chặn, tăng budget hoặc sang kỳ mới

Prerequisite: phase 1 đạt exit theo quyết định bổ sung đã duyệt: chấp nhận sai số do crash, budget theo bằng chứng đã lưu (cả legacy và crash tương tự về sau). Chỉ một slice active; không làm song song trên ledger/gate.

<!-- Updated: Validation Session 1 - evidence acceptance, consumer inventory and finite harness gates -->

## Files / consumers
- `src/lib/accounting/budget-management.js`, `src/lib/accounting/budget-projection.js`, `src/lib/accounting/budget-errors.js` và `src/app/api/keys/[id]/budget/route.js`: projection/eligibility phải khớp gate, không trả unknown-recovery requirement cho request được bỏ qua. Chỉ loại field/error obsolete sau inventory consumers; không drop health/maintenance safety.
- `src/shared/components/ApiKeyBudgetPanel.js`, `src/shared/utils/budgetManagementDraft.js`, `cli/src/cli/menus/apiKeys.js`: UI/CLI nói rõ chi phí đã ghi nhận có thể thấp hơn chi phí upstream; không cảnh báo/list/count unknown-usage cho interrupted+absent hay nút clear/waive. Health/coverage gaps, stale read và unknown save outcome không thuộc phần loại bỏ. Giữ coherent draft/version-conflict/failed-read freshness và secret handling.
- `tests/unit/accounting-budget-management.test.js`, `accounting-budget-projection.test.js`, `budget-management-draft.test.js`, `key-budget-management-security.test.js`, `chat-budget-loopback.test.js`, `chat-budget-stream.test.js`, `chat-budget-failure-controls.test.js` (trong `tests/unit/`), `tests/browser/budget-panel-checks.mjs`, `tests/browser/budget-cli-checks.mjs`, `tests/fixtures/accounting/budget-web-fixture.mjs` và existing restart fixtures.
- Docs consumers sau code: `docs/ACCOUNTING.md`, `docs/DB-SAFETY.md`, roadmap/scope-map/B1 receipt và changelog theo actual implementation. Historical receipts không rewrite thành current acceptance.

## Tasks / observable acceptance
- [x] Inventory trước khi bỏ/đổi field/error: `countAttemptStatesSync`, `projectBudget`, unresolved counts và `api_key_accounting_unresolved`; ghi số lượng và liệt kê cụ thể production/test/browser/CLI consumers rồi update trong cùng slice. API/UI không còn unknown count/recovery-required message cho interrupted+absent; giữ health/coverage gaps, stale read, unknown save outcome và guards vì đây không phải unknown-usage product. Projected eligibility khớp actual dispatch. Không request/header/env/setting nào được dùng để giả fixture authority.
- [x] Actual guarded UI→API→chat JSON/SSE→dummy upstream→ledger→UI: known cost tăng; interrupted+absent không tăng, request sau vẫn chạy nếu còn budget. Authoritative usage trước disconnect/EOF trước DONE vẫn tăng, nhưng response vẫn gián đoạn, không fake finish/DONE; errors với usage hợp lệ cũng tăng. Completed+absent, malformed và conflicting usage có negative controls chứng minh không bị nhập vào ngoại lệ; partial observations không tự thành exact.
- [x] Hai keys độc lập; chạm limit block request mới trước upstream POST. Admin tăng đủ cả blocked windows → chạy lại mà spent không đổi. Sang tuần/tháng mới tự có allowance; lịch sử giữ nguyên; limit0 vẫn block, null vẫn unlimited.
- [x] Restart với old abandoned intents được chứng minh interrupted+absent không tạo unknown blocker; known costs giữ nguyên. Legacy ambiguity không còn bằng chứng usage khôi phục được áp dụng rule 8 đã duyệt: không debit suy đoán/không unknown blocker; giữ known spend và nghĩa vụ usage đã lưu, không tạo admin recovery workflow. Duplicate/late terminal và kỳ rollover không double debit, không cần admin recovery. Actual storage/write failure vẫn không được giả thành miễn phí/thành công.
- [x] Auth/CSRF/ACL, version conflict, draft freshness và no-secret regressions giữ; affected tests, scoped lint/build/standalone checks theo changed files; classify baseline-red bằng repo comparator, không tuyên bố all-green từ focused tests.
- [x] Lưu scope/results/source revision, limits và failed evidence. Production activation vẫn là delivery riêng; báo rõ nếu hai chức năng mới chỉ được nghiệm thu qua fixture. Không dùng việc hủy P5 để auto-deploy hay tuyên bố mọi provider được hỗ trợ.

## Verification dự kiến
Từ `tests/`:
```bash
npx vitest run unit/accounting-budget-management.test.js unit/accounting-budget-projection.test.js unit/budget-management-draft.test.js unit/key-budget-management-security.test.js unit/chat-budget-loopback.test.js unit/chat-budget-stream.test.js unit/chat-budget-failure-controls.test.js
```
Browser/CLI preflight bắt buộc trước launch: đọc `tests/fixtures/accounting/budget-web-fixture.mjs` và P4 acceptance receipts; runner import `budget-panel-checks.mjs`/`budget-cli-checks.mjs`, hai file này không phải standalone entrypoints. Chốt và ghi exact build + run commands cho từng engine (`--engine=sqljs` chọn SQL.js), Node runtime, timeout hữu hạn, receipt path, source revision/artifact identity và `BUDGET_STANDALONE` trỏ build từ source hiện tại (không dùng default artifact lịch sử). Xác nhận bind loopback/port, temporary DATA_DIR/HOME/APPDATA, dummy upstream, child/server cleanup và artifact retention; không dùng DB hoặc credentials thật. Chưa chốt được → preflight blocked, không tự chạy harness lịch sử. Node SQLite và SQL.js Linux phải có actual assertions, không mock-only. Probe changed-source LSP nếu dùng; timeout không phải clean result.

## Scoped completion evidence

Selected Linux Node SQLite/SQL.js fixture scope complete, production OFF.
Final affected regression775/775 across49files, zero failed/pending; repository
no-regression comparator exits0. This is affected scope, not whole-repo green.
Fresh build `y-kR5qknFW8BhMBVv9Sku`: hybrid browser/CLI20/20 on each adapter,
detached shipping smoke8/8; build warnings retained. Guarded API focused90/90,
LSP5files clean, scoped Phase2 lint clean. Overlapping suites are not summed.
Receipt includes migration upgrade/rebuild, restart, storage-failure controls,
consumer inventory, failure history and test scheduling corrections.

See [implementation receipt](../reports/implementation-261030-b1-recorded-spend.md)
and [browser preflight](../reports/b1-browser-preflight.md). No real DB changes,
commit/push/merge/deploy/activation. Crash undercount and in-flight overshoot are
explicit limitations; no invoice/hard-cap/provider-wide or all-platform claim.

## Exit
Có receipt cho toàn bộ flow, evidence matrix, consumer inventory, harness preflight và những giới hạn còn lại; không unknown recovery feature, không mất known spend, không bypass management/inference guards. Legacy policy đã được duyệt; cần actual evidence thực thi đúng rule 8 mới trước exit. B1 complete không thay X1–X6 coverage hoặc R release acceptance. Không commit/push/merge/deploy/activation từ plan này.
