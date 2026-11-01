---
phase: 2
title: "Native SSE, terminals và consumers"
priority: P2
dependencies: [1]
effort: "Chưa estimate"
---

# Phase 2 — Native SSE, terminals và consumers

## Goal

Sau Phase 1, raw Responses SSE có sole-reader bounded parser và own terminal ACK trước native terminal publication; native SSE→SSE và SSE→client JSON giữ protocol đúng. Settlement không phụ thuộc Chat `[DONE]`. Dùng [terminal/ACK contract](./references/responses-contract.md), không thay native failed/incomplete thành success.

## Files ownership

Paths relative `/home/gmo/projects/9router/`:

| Action | Path | Trách nhiệm |
|---|---|---|
| Create | `open-sse/utils/accounting-responses-stream.js` | Raw native event framing, observation/terminal retention, cancellation/cleanup |
| Modify | `open-sse/executors/accounted-base.js` | Chọn Responses SSE strategy trước translation |
| Modify | `open-sse/utils/accounting-openai-stream.js` | Chỉ extraction shared activity nếu cần; preserve Chat behavior |
| Create | `open-sse/utils/accounting-stream-activity.js` | Common WeakMap activity registry nếu cần hai producers; one source, no duplicate maps |
| Modify | `open-sse/utils/streamHandler.js` | Consume common raw activity/liveness/failure provenance, native failure output |
| Modify | `open-sse/handlers/chatCore/sseToJsonHandler.js` | Forced JSON propagates terminal accounting failure/no partial success; explicit converter caller compatibility |
| Modify | `open-sse/transformer/streamToJsonConverter.js` | Native terminal status/output/usage/detail fidelity; bounded framing, no synthetic success |
| Inspect; Modify only if required by compatibility test | `open-sse/handlers/responsesHandler.js` | Second converter caller at line 59; compatibility only, not an R1 route/charge owner |
| Modify | `open-sse/handlers/chatCore/streamingHandler.js` | Native passthrough failure mapping nếu current consumer cần |
| Modify | `open-sse/utils/responsesStreamHelpers.js` | Incomplete/error/compat terminals đúng; không dùng synthesized terminal làm accounting evidence |
| Modify | `src/sse/services/chat-accounting.js` | Native error bytes/late ticket sink không phụ thuộc disposed admission context |
| Create | `tests/unit/responses-accounting-stream.test.js` | Parser/terminal/ACK/cancel matrix |
| Create | `tests/unit/responses-accounting-consumers.test.js` | Native SSE + forced JSON consumers, activity/watchdog, duplicate error prevention |
| Create | `tests/unit/responses-stream-to-json-contract.test.js` | Direct converter terminal/field/framing tests and both caller compatibility checks |
| Modify | `tests/fixtures/accounting/responses-loopback.js` | Byte split, gates, SSE native responders |

`streamToJsonConverter.js` là explicit owner bắt buộc vì current converter bỏ incomplete/detail fields và map done thành completed. Không defer việc này tới conditional discovery. Chỉ sửa translator `open-sse/translator/response/openai-responses.js` hoặc transformer khác nếu test chứng minh consumer mismatch không sửa được tại shared handler; ghi lý do và thêm affected suites, không rewrite translator để lấy accounting usage.

## Tasks (test-first)

- [x] Thêm failing parser cases: `event:` + data.type consistency, multiline data, CR/LF, UTF-8 every-byte split, raw response id continuity; complete/failed/incomplete/done compatibility/error/EOF/`[DONE]`-only. Assert bản native outcome giữ nguyên.
- [x] Thêm observation tests: authoritative terminal usage only, no delta accumulation; equal duplicate idempotent; conflicting quantities/status/id/type invalid; partial/oversized frame/invalid UTF-8 không thành absent. Valid usage after downstream translation removed fields vẫn debit từ raw. Trước settlement, inspect toàn terminal-containing chunk đã nhận; conflict đã buffer chặn exact settlement. Sau cutoff cancel reader, không claim kiểm được unseen future chunks. Callback conflict sau commit giữ known spend, reject amendment, không double-debit/xóa phí hoặc giả thu hồi output đã gửi.
- [x] Implement sole raw reader, configured byte limits cho frame/terminal/JSON; không giữ full output stream. Deltas có thể flow nhưng terminal/usage bytes giữ tới ACK. Conflict/trailing evidence đã đọc phải invalidate; sau native terminal không drain vô hạn.
- [x] Reuse one activity registry cho Chat và Responses; raw upstream activity không bị hiểu là stalled vì terminal ACK giữ bytes. Private accounting failure provenance, không trust upstream error.code/message để mint budget error.
- [x] Sink/cleanup: request dispose đóng future admission, vẫn giữ terminal receipt để durable settlement/late duplicate. Abort/cancel không hủy known-usage terminal write; cleanup reader lock/listeners/timers/retained byte buffers. No new recovery queue/backfill.
- [x] Held-ACK tests ở ba thời điểm: trước authoritative usage, sau usage/trước ACK, sau ACK/trước publish. Trước usage interrupted+absent no debit/no blocker; sau usage exact settle once; native success terminal không lọt ra khi write failure/cancel. Valid settled failed/incomplete không đổi thành 200 success.
- [x] Native SSE positive actual socket: input text + client stream:true → native delta + response.completed; assert terminal withheld tới own ACK, correct ledger price/window. Test actual SSE client stream:false → forced JSON: same settlement/ACK but JSON Response shape đúng.
- [x] **Converter contract + both callers:** direct tests completed/failed/incomplete/compat done, terminal-only và delta+terminal, multiline/CRLF/byte splits, explicit zero/missing usage. Preserve native terminal `id`, `created_at`, status, `output`, error/incomplete details, model and usage/detail counters; `response.done` uses validated embedded completed/failed/incomplete status, not unconditional completed. No invented zero usage or success for absent/error/EOF. Inspect/test both current production callers: `sseToJsonHandler.js:209` and `responsesHandler.js:59`; latter remains affected compatibility, not R1 activation/owner. Associated path gets approved fidelity; paired unassociated controls freeze baseline, no global default rewrite. Ledger evidence remains exclusively raw boundary, not assembled converter fields. Assert known failed/incomplete never becomes successful conversion bookkeeping or partial 200 success; native HTTP/error-envelope expectations must be explicit in cases.
- [x] Error consumers: upstream failure, error-only, EOF, malformed and terminal DB failure produce truthful failure; no fake completed/DONE for accounting. Nếu existing client compatibility dùng failure+[DONE], đó chỉ output failure framing, không authority/claim successful native terminal.
- [x] Regression controls: Chat finish/DONE không đổi, conversion Response output/usage/abort/completion watchdog đúng; source default accounting OFF vẫn giữ exact observed baseline bytes/envelope/status.

## Execution checkpoint / safe verification

Phase1 scoped milestone complete (239/239+16/16); Phase2 scoped milestone complete183/18315suites (`b38b45216`), lint `b047ca453`exit0, LSP10clean. Post-run hash manifest captured and rechecked unchanged; not pre-run attestation. Previously red pending-read assertion now passes with malformed expectation. Full R1 remains unaccepted; Phase3 required. Future runtime tests must use `node tests/fixtures/accounting/run-isolated.mjs <unit paths>` from repo root: read-only source, private mount/network namespace, pre-import disposable HOME/DATA_DIR; legacy presentation persistence excluded, authoritative price/ledger/transport real. The historical direct Vitest command below records the planned suite list, not an allowed unisolated execution path after the isolation prerequisite.

Current evidence and failed checkpoints: [implementation receipt](../reports/implementation-261031-r1-native-responses.md). Earlier affected gate172/172 retained as history; final183/183 includes later partial-cancel/generator cleanup and stronger tests. Phase2 checkboxes marked through CLI; no broader provider/platform or release claim.

## Verification — planned suite inventory

```bash
cd tests
NODE_OPTIONS=--max-old-space-size=4096 timeout 240s npx vitest run unit/responses-accounting-stream.test.js unit/responses-accounting-consumers.test.js unit/responses-stream-to-json-contract.test.js unit/b1-usage-evidence.test.js unit/b1-late-chat-sink.test.js unit/chat-accounting-stream.test.js unit/chat-accounting-stream-loopback.test.js unit/accounting-stream-terminal.test.js unit/openai-responses-terminal-event.test.js unit/responses-abort-terminal.test.js unit/openai-responses-completion-watchdog.test.js unit/openai-responses-completed-usage.test.js unit/openai-responses-usage-pivot.test.js unit/openai-responses-nonstream.test.js
```

Parser unit tests dùng fake ticket để hold ACK; positive consumer tests dùng actual dummy upstream + real service/ledger trên Node SQLite/SQL.js, không thay actual POST bằng vi.mock. No provider live tests. Reached/unreached và cleanup failures phải nằm trong receipt; no skipped acceptance case.

## Exit / risks

- [x] Cả native SSE→SSE và SSE→JSON intended positive đạt transport→raw usage→ledger→own ACK→truthful terminal; threshold/restart broad acceptance chờ Phase 3.
- [x] Terminal matrix đủ completed/failed/incomplete/done/error/EOF/cancel/conflict và observed trailing evidence; không có Chat protocol assumptions trong Responses accounting parser.
- [x] Bounded state/cancellation tests chứng minh không leak sockets/listeners hoặc retain whole body; no arbitrary grace tăng để giấu ACK stall.
- [x] Chat/conversion/unassociated consumers giữ observed baseline; associated converter field/status fidelity và cả hai caller compatibility có named tests. B1 raw evidence/late sink gates chạy trên hai adapters, không suy original-window assertion chỉ từ stored startedAt.

<!-- Updated: Validation Session 1 - mandatory converter ownership, two caller compatibility, terminal fidelity and explicit B1 regression gates approved -->

Nếu schema terminal không có authoritative profile hoặc consumer không thể giữ native truthfulness, STOP ghi named prerequisite và evidence. Không chỉ test refusal rồi đánh dấu support; không nới terminal chuẩn để pass.
