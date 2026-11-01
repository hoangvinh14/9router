# R1 — Native Responses protocol, pricing và ACK contract

> Proposed implementation contract, chưa runtime-verified. Canonical owner R1 là dynamic compatible node `apiType=responses`. Dùng selected strict profile; không chứng nhận mọi Responses-compatible upstream.

## 1. Ba identity phải tách

| Dimension | Contract |
|---|---|
| Client ingress/output | `/v1/responses`, native Responses JSON hoặc SSE; Chat-client conversion là affected composition, không new charge owner |
| Actual upstream | Native `/responses` JSON **hoặc** SSE, chọn parser từ actual response content type + selected protocol, không từ `body.stream` client |
| Pricing/ledger endpoint | Đề xuất `chat` cho token inference. `provider`, resolved `model`, `connectionId` và original `startedAt`/snapshot giữ như service hiện có; protocol profile nội bộ không thay key identity |

<!-- Updated: Validation Session 1 - native client fidelity and explicit converter/caller impact approved -->

**Native client fidelity:** accounting-associated R1 native JSON preserves raw usage counters, `total_tokens`, both detail objects and explicit zero; no legacy +2000 buffer/filter. Phase 1 owns `nonStreamingHandler.js` and inspects shared `usageTracking.js` without globally changing defaults. SSE→JSON must preserve native terminal status/output/error/incomplete details/model/usage; `response.done` takes the validated embedded status, never unconditional completed. Phase 2 explicitly owns `streamToJsonConverter.js` and covers both callers (`sseToJsonHandler.js:209`, `responsesHandler.js:59`); the latter is compatibility-only, not the active R1 route. Keep current unassociated output baseline through paired tests and an internal closed-set association, not client flags or a new production switch. Missing usage must not become invented exact zero or success. Converter output is never settlement authority.

**Pricing compatibility gate trước integration:** dùng same model với configured input/output/cached/reasoning rates, assert resolver snapshot.endpoint=`chat`, exact-money subsets, persisted ledger round-trip/reopen, budget projection và reporting không gắn nhãn đây là actual `/chat/completions` support. Rà tất cả consumers của ledger endpoint; legacy `usageDb` chỉ là presentation, không settlement source. Nếu reporting cần distinguish protocol thì đề xuất metadata riêng; nếu endpoint mới/schema cần thiết thì dừng, detail named prerequisite và migration/verifier/compatibility plan trước khi sửa. Không tự thêm `responses` vào pricing enum.

## 2. Admission eligibility

Fixture-associated accounting only. Persisted compatible node + `apiType=responses` + resolved credentials/model + exact allowed wire URL/method/body phải được revalidate tại dispatch sau mọi await/queue. Default Chat vẫn chọn Chat profile, không nới mọi compatible node.

- First profile là **text/token-only, explicit detail counters**. Positive request là inline text, optional reasoning và client function-tool definitions/results đã chứng minh không tạo hosted billable calls. Không tự fetch resources.
- Before POST, reject hosted tools/search/fetch/code/image-generation, media inputs/outputs, file/remote resource references, background/asynchronous retrieval, unknown tool types và unsupported billing options trong accounting path. Kiểm final translated body, không chỉ input trước transforms; reject unknown billing-relevant declarations, không drop silently.
- Header/transport overrides không được đổi destination/credential authority. Không tin client gửi `usage`, `price`, `apiKeyId`, protocol profile hay fixture flag để cấp quyền.
- Có thể JSON response hiện thêm unexpected billable dimensions; classify unsupported/malformed, giữ safety, không bỏ counters để settle token cost giả đầy đủ.
- Optional detail omission **không** có zero semantics ở profile đầu. Upstream thiếu explicit cached/reasoning details vẫn unsupported cho accounting profile này, không coi universally free.

## 3. Raw usage profile

Proposed constant trong protocol config, tránh magic string rải rác. Root JSON `usage`; native SSE authoritative snapshot ở `frame.response.usage` trên selected terminal events. Chỉ lấy field khác nếu có documented authoritative profile riêng.

Required safe nonnegative integers: `input_tokens`, `output_tokens`, `total_tokens`, `input_tokens_details.cached_tokens`, `output_tokens_details.reasoning_tokens`. Require safe input+output=total, cached≤input, reasoning≤output. Explicit all-zero usage hợp lệ; thiếu field, negative/fraction/overflow/string không hợp lệ.

Normalize nội bộ thành exact usage hiện có: input/output/cacheRead, zero cacheWrite/tiers vì profile không có cache-creation billing và admission đã giới hạn, reasoning included-in-output=true. Unknown cache-write/tool/modality categories không được discard. Không dùng translated usage/defaults/text estimates/legacy logger.

Observation kinds: valid / absent / malformed / conflicting; retain first valid privately nhưng conflict/invalid đã thấy không được reset về absent. Exact duplicate = cùng observation, không cộng cumulative snapshots. Different valid snapshots ở authoritative positions = conflict; không chọn max/sum theo cảm tính. Deltas/created events không mặc nhiên là final usage.

## 4. Terminal matrix

| Actual response/event | Protocol outcome | Accounting disposition |
|---|---|---|
| JSON complete object + valid usage | Giữ native JSON/status; validate native status consistency | Settle theo original price/startedAt trước trả final response |
| HTTP non-2xx JSON + valid authoritative root usage | Giữ lỗi, không convert thành success | Settle trước error parse/retry/account fallback |
| SSE `response.completed`, status completed | Native success terminal | Validate usage/identity; settle + own ACK trước publish terminal |
| SSE `response.failed`, status failed | Native failure terminal | Valid usage: settle; absent: completed+absent safety, không B1 skip |
| SSE `response.incomplete`, status incomplete | Native incomplete, không success | Valid usage: settle; absent terminal không tự là interruption exemption |
| SSE `response.done` | Compatibility terminal **chỉ khi** full response status và usage đáp ứng cùng profile | Validate như corresponding completed/failed/incomplete; tên event một mình không đủ authority |
| `error` event không có authoritative usage | Giữ native failure; không invented usage | Explicit terminal error là non-interrupted absent/safety; transport abort trước terminal absent mới là B1 candidate |
| EOF/cancel trước native terminal, chưa observe usage | Gián đoạn, không fake success | interrupted+absent → unrecorded/no debit/no unknown-work blocker B1 |
| Valid usage đã observe rồi cancel/EOF, chưa publish terminal | Protocol có thể interrupted | Settle một lần nếu no observed invalid/conflict; cancellation không xóa evidence/ACK obligation |
| Malformed UTF-8/JSON/partial frame, invalid counters/identity hoặc conflicting terminals | Native failure, không success | Không thành absent exemption; safety/refusal và known-evidence preservation |

Event name và `data.type`/response status mismatch phải fail closed. Verify response id nhất quán giữa created/terminal khi có; không trust usage của response khác. `[DONE]` không phải native authority và không bắt buộc để settle. Bounded parser phải giữ `event:` + multiline `data:` semantics, UTF-8 chunk boundaries, CR/LF. Retain terminal bytes có bound; reject conflict/trailing non-whitespace **đã đọc** sau native terminal, không drain vô hạn để săn trailing data. Late callback hiện có vẫn qua retained idempotent sink; không phát minh background retrieval.

**Finality cutoff:** parser xác thực terminal cùng tất cả bytes của transport chunk đã nhận chứa terminal (và mọi frames đã parse/buffer trước đó) trước khi gọi settlement. Equal duplicates trong phần đã nhận được collapse; conflict trong phần này làm observation conflicting, không settle exact. Sau cutoff, cancel sole reader; không chờ chunks tương lai để đối soát. Không hứa phát hiện conflict chưa từng đọc. Nếu callback nội bộ hiện có báo conflict sau durable settlement, preserve known spend và original snapshot, reject conflicting amendment qua service/repo conflict safety; không âm thầm xóa/debit lại/correction và không khẳng định thu hồi success đã gửi. Record bounded failure evidence theo existing controls, không tạo recovery product. Test trước cutoff và callback sau commit là hai cases riêng.

Current converter đã được source/probe xác nhận không giữ `response.incomplete`/failed/compat done fidelity đầy đủ; Phase 2 bắt buộc sửa consumer với regression tests, không sửa upstream outcome thành completed. Existing synthesized `response.failed` phục vụ lỗi client có thể giữ, nhưng không là upstream usage authority hay bằng chứng success.

## 5. Ordering và lifecycle

```text
persisted identity + eligibility + exact price
 → beginAttempt/own intent ACK
 → revalidate immutable wire + persisted selection + budget
 → consume one-shot permission → actual POST
 → bounded raw observation trước translation
 → completeAttempt/own terminal ACK
 → native terminal/JSON publication HOẶC successor inference POST
```

- No ACK: không success terminal, không successor. Durable row hiển thị qua read không thay own callback ACK; forged/copied/stale receipt bị từ chối. Nếu commit đã thành công nhưng callback delivery thất bại, spend đã commit vẫn tồn tại; retry settlement của cùng ticket/usage phải idempotent, không replay inference POST để lấy ACK. Nếu existing service latches independent coverage failure thì giữ safety đó, không waive bằng B1. Reopen giữ recorded spend; không tuyên bố tiếp tục admission từ read-visible row.
- JSON persistence failure trả safe accounting error; SSE đã gửi deltas thì kết thúc bằng native failure hoặc stream error đúng consumer, không publish held success. Forced JSON không trả partial 200 thành công khi terminal sink fail.
- Cancel/abort client không truyền cancellation để hủy durable known-usage write. Retained terminal promise/sink độc lập request context admission; dispose đóng quyền future POST nhưng không xóa obligation của ticket đã phát.
- Sink chỉ sống đến bounded terminal write/delivery, dùng existing queue count/bytes/operation limits; reader cancel/lock/listener/timer cleanup. Không chờ straggler vô hạn và không durable recovery queue mới.
- Predecessor terminal must ACK trước Base retry/URL retry, auth refresh inference retry hoặc next account. Absent completed error không được coi miễn phí để mua successor. Interrupted+absent cho request sau theo B1, không tự retry một aborted request.
- Price/kỳ **mỗi actual attempt** lấy theo `beginAttempt` và admission clock; không dùng thời điểm callback để chuyển phí sang kỳ mới. Không khóa toàn root vào cùng giá nếu successor là attempt mới. Late settlement của cùng attempt dùng snapshot/startedAt ban đầu.
- B1 known spend/bindings/coverage/storage guards giữ nguyên, kể cả degraded identified-unlimited own-gap ACK. Không bỏ coverage sidecar để xanh tests.

## 6. Non-claims

Không live-provider certification, optional-details profile, hosted tools/media pricing, async Responses retrieval, Codex/GitHub/compact support, all registry transports, embedding support, full X5/X6, Bun/better/Windows parity hoặc production activation. Đây là support boundary của **R1**, không phải cắt các obligations khỏi full X1 owner map.
