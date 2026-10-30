---
title: "Budget semantics và dữ liệu cũ"
status: completed
---

# Phase 1 — Chỉ chi phí đã ghi nhận tác động budget

Đọc [contract B1](./plan.md) trước code. Một writer; branch mới từ develop; không chạm DB thật. Đọc `docs/ARCHITECTURE.md`, `docs/ACCOUNTING.md`, `docs/DB-SAFETY.md` và `open-sse/AGENTS.md` trước khi thay engine. B1 override đúng phạm vi unknown-interruption/P5; safety độc lập giữ nguyên.

<!-- Updated: Validation Session 1 - evidence classification, legacy ambiguity, interrupted settlement and conditional schema gates -->

## Requirements / validation decisions
- Giữ evidence có phân loại qua producer → terminal → persistence: absent, valid, malformed, conflicting và interruption provenance đáng tin cậy. Không suy từ error string hay `null` duy nhất. Chỉ interrupted + absent được bỏ qua; response hoàn tất thiếu usage không tự hưởng ngoại lệ. Unsupported/malformed/conflicting usage và lỗi storage/identity/pricing giữ safety policy, không thành miễn phí.
- Usage đã authoritative/hợp lệ theo selected profile, đủ trường và không có conflict đã quan sát phải debit một lần dù EOF/cancel trước `[DONE]`. Settlement không đồng nghĩa protocol success: không tự phát finish/DONE. Partial hoặc conflicting evidence không được nâng thành exact; duplicate/late callbacks không ghi lần hai.
- Revised approval: legacy và future abandoned attempts không có bằng chứng usage/phí khôi phục được không debit suy đoán/không block vì ambiguity. Known/persisted usage và lỗi ghi phí đã phát hiện vẫn giữ nghĩa vụ/safety; storage/identity/coverage độc lập không auto-clear. Không claim miễn phí, không giải phóng live intent. Quyết định này thay stop gate cũ; vẫn giữ negative controls completed+absent/malformed/conflicting.

## File ownership / implementation route
- `src/sse/services/chat-accounting.js`, `src/lib/accounting/service.js`: classify missing usage on interruption, bỏ unknown recovery path cho trường hợp đó, giữ valid raw usage trên error/late.
- `src/lib/db/repos/api-key-accounting-repo.js`, `src/lib/db/accounting-lifecycle.js`, `src/lib/db/migrations/002-accounting-foundation.js`: inspect current terminal constraints và verified-dead-owner restart; chọn thay đổi schema nhỏ nhất nếu thực sự cần, không rewrite migration đã ship. Nếu đổi schema thì thêm migration mới cùng schema verification/test, không drop ledger hoặc audit.
- `src/lib/accounting/budget-gate.js`: bỏ unknown-interruption blocker, giữ known-spend threshold và health/identity safety. Internal state tối thiểu chỉ phục vụ idempotency, không tạo recovery queue/marker riêng.
- `open-sse/executors/accounted-base.js`, `open-sse/utils/accounting-openai-usage.js`, `open-sse/utils/accounting-openai-stream.js`: trace và test evidence classification/terminal ownership; current observation gộp absent/invalid/conflicting thành null và SSE stop truyền null. Sửa producer/sink cần thiết để giữ authoritative usage qua interruption; không thay profile/schema hợp lệ thành estimate.
- Conditional schema owners: `src/lib/db/schema.js`, `src/lib/db/migrations/index.js`, `src/lib/db/migrate.js`, migration mới nếu cần; verifier consumers `src/lib/db/persisted-accounting-authority.js`, `src/lib/accounting/persisted-chat-authority.js` và `src/lib/accounting/budget-management.js`. Nếu đổi persisted schema/constraints: bump `SCHEMA_VERSION`, đăng ký migration mới, giữ pre-schema backup, test old→new migration/startup/verifier ordering. Không rewrite historical migration `up()` để thay migration mới; current-schema verifier có thể phải evolve nhất quán vì đang đọc `TABLES`. Nếu behavior-only thì chứng minh không cần schema change, không thêm migration vô cớ.
- `tests/unit/accounting-ledger.test.js`, `accounting-lifecycle.test.js`, `accounting-crash.test.js`, `chat-accounting-json.test.js`, `chat-accounting-stream.test.js`, `accounting-budget-gate.test.js`, `chat-budget-reopen.test.js`, `chat-budget-process-restart.test.js` (cùng `tests/unit/`): existing target suites, thêm cases trong cùng owner nếu có thể.

## Tasks
- [x] Test-first: matrix JSON/SSE gồm interrupted+absent, completed+absent, malformed, conflicting, authoritative usage trước EOF/cancel, errors với usage hợp lệ. Chứng minh failure đúng semantics cũ, không sửa assertion chỉ để xanh; asserted ledger debit và protocol outcome độc lập.
- [x] Implement smallest consistent terminal/restart/gate change; phân biệt live intent với abandoned owner, không xóa charge và không thêm unknown-product marker/API/workflow. Giữ ACK/storage failure là lỗi thật, không giả thành thành công.
- [x] Define + test old-row compatibility: lập bảng evidence → classification cho proven interrupted/absent, proven known-usage write failure và ambiguous legacy row; abandoned ambiguous không có contrary evidence → nonblocking theo rule 8 đã duyệt, không suy null cost là thực tế miễn phí. Interrupted/no-usage record được chứng minh không block, known charges/policy/identity/snapshot/audit không đổi; storage corruption/sidecar mismatch không bị auto-clear. Nếu cần migration, disposable old-schema fixture + reopen và startup/verifier ordering là bắt buộc.
- [x] Test duplicate và existing late callback: charge tối đa một lần với original price/startedAt; late callback qua ranh giới kỳ không chuyển tiền sang kỳ nhận callback. Không tạo background reconciliation.
- [x] Test both windows, zero/null, key isolation, admin raise/lower và rollover theo Asia/Ho_Chi_Minh. In-flight overshoot vẫn được thừa nhận, không thêm reservation.

## Verification dự kiến
Từ `tests/` (deps root/tests đã cài):
```bash
npx vitest run unit/accounting-ledger.test.js unit/accounting-lifecycle.test.js unit/accounting-crash.test.js unit/chat-accounting-json.test.js unit/chat-accounting-stream.test.js unit/accounting-budget-gate.test.js unit/chat-budget-reopen.test.js unit/chat-budget-process-restart.test.js
```
Chạy bằng background task khi implement; lưu actual command/revision/adapter/results. Tests cũ cho unknown manual recovery cần cập nhật theo decision, không xóa independent health/security coverage. Failed gate → fix proven cause hoặc dừng báo blocker; không tăng timeout/rerun-for-green.

## Current implementation — focused Linux acceptance

Runtime candidate adds classified evidence, `unrecorded` non-work disposition,
original-period late settlement and strict schema migration 004/declarative v5.
Historical accounting definitions are frozen rather than silently changing their
CREATE semantics; new migration owns the rebuild. Runtime verifier stays strict.
Independent detected recording failures retain coverage/safety controls.

Real process restart checks pass 4/4 on Node SQLite and SQL.js; actual SSE protocol
checks pass 18/18 at their source revisions. Final bounded matrix: **246/246 tests, 20 suites, 223.76s**; overlapping supplemental controls **28/28**. Storage failure controls 54/54. Scoped ESLint 0 errors / 2 warnings. Advisor reviewed bounded exit. This is focused Linux single-writer acceptance, not broad durability/concurrency/release or production activation. Pre-durable-gap crash window follows the explicit approved undercount tradeoff.
See [current implementation receipt](../reports/implementation-261030-b1-recorded-spend.md).

## Historical execution evidence — blocker subsequently superseded by approval

Disposable legacy characterization completed on Node SQLite and SQL.js: both
constructed histories (no usage vs exact terminal mutation lost before commit)
yield identical compared accounting evidence after verified-dead-owner startup
recovery. Known charges survive. This demonstrates the plan's ambiguity stop
condition, not actual historical charge loss. See [receipt](../reports/implementation-261030-b1-legacy-provenance-gate.md).

At that historical checkpoint, runtime implementation had not started and no schema/runtime change or activation occurred. Current runtime candidate and pending acceptance are recorded above; task checkboxes still require final evidence.
Người dùng đã duyệt quyết định riêng: chấp nhận sai số do crash, budget theo bằng chứng đã lưu. Runtime implementation tiếp tục theo rule 8 mới; Phase 2 remains pending. Passing characterization is not passing compatibility acceptance.

## Exit
Focused và actual lifecycle/restart controls pass trên Node SQLite/SQL.js Linux; evidence classification và valid-usage-before-disconnect có assertions riêng khỏi protocol success. Documented legacy-row decision không có reset tiền/identity; legacy ambiguity áp dụng rule 8 mới, không xóa contrary usage/write-failure evidence; acceptance phải chứng minh mapping và safety riêng. Những lane ngoài scope vẫn unvalidated, không inferred pass. Phase này không kích hoạt production.
