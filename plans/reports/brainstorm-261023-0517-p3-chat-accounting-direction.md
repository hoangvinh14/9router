# P3: đề xuất hướng tích hợp chat accounting

Ngày: 2026-10-23, Asia/Ho_Chi_Minh. Source: `develop` tại `4cb4f80ecc5f629cd7d08c2167a443892ad38f2f`.
Trạng thái: **đề xuất sau source inspection; chưa phải accepted design, executable plan hay implementation acceptance**.

## Contract tái sử dụng

- **Outcome:** [P3](../261018-0213-durable-chat-accounting/plan.md) đóng actual app → chat core → Base/Default → loopback upstream → durable ledger, đủ JSON và SSE. Mỗi actual billable POST có own intent, raw usage, original price và terminal owner.
- **Constraints:** [P2 call contract](../../docs/ACCOUNTING.md), own durable ACK, stable key identity, fresh current authority sau awaits, request-local state, giữ ACL/auth/proxy/AbortSignal/deadlines và empty-content fallback. Accounting/enforcement/public activation OFF; không ghi `ledgerStartedAt`, không dùng live DB/inference.
- **Non-goals:** provider inventory đầy đủ, Responses/Messages/Gemini, nested fusion, budget/calendar/editor, management/recovery UI, transport rewrite hoặc generic authority framework. Không bỏ nghĩa vụ của các owner X/P4/P5/R.
- **Acceptance:** positive real flow JSON/SSE trên actual disposable adapters; held/lost ACK, drift, failed exact usage, unknown/null-cost, duplicate/conflict/late, abort, restart, two-key isolation, price drift và đo overhead hữu hạn. JSON riêng chưa đóng P3.

## Evidence hiện tại

Đây là feature integration chưa có, không phải một regression đã tái hiện. Chưa chạy tests/benchmark và không suy ra runtime pass từ việc đọc source.

| Evidence | Hệ quả thiết kế |
|---|---|
| [service.js](../../src/lib/accounting/service.js) có private contexts/receipts, required synchronous authority callback và one-use `assertDispatchAuthority`; callback nhận candidate/ACL. | App phải bổ sung current routing/credential/transport proof. Core không tự biết wire hoặc selected pool. Không cần viết lại ledger/coordinator. |
| [chat.js](../../src/sse/handlers/chat.js) chọn account trong vòng lặp; [chatCore.js](../../open-sse/handlers/chatCore.js) gọi executor ban đầu và sau refresh. | Một attempt bao quanh handler/execute không đại diện đủ mọi POST. Mọi successor trên path đã chọn phải có own receipt. |
| [base.js](../../open-sse/executors/base.js) retry status/network và fallback URL bên trong `execute`. | Gắn lifecycle tại từng generation dispatch; settle predecessor trước khi cho successor tiếp tục. |
| [proxyFetch.js](../../open-sse/utils/proxyFetch.js) có async dispatcher/DNS/module setup, TLS retry và proxy→direct fallback. Native fetch cũng có redirect behavior. | Gate trước lời gọi `proxyAwareFetch` chưa đủ gần actual network boundary; cần một prerequisite transport cụ thể. Không cấp một receipt cho nhiều lần gửi. |
| [nonStreamingHandler.js](../../open-sse/handlers/chatCore/nonStreamingHandler.js) đọc body rồi gọi analytics; [error.js](../../open-sse/utils/error.js) đọc body lỗi để parse message. | Accounting phải quan sát raw body trước các consumer này; response body chỉ có một reader owner. HTTP failure vẫn có thể có exact usage. |
| [stream.js](../../open-sse/utils/stream.js) estimate usage khi thiếu, cộng buffer ở output và gọi `onStreamComplete` không await. | Không lấy analytics/final callback làm exact settlement hoặc durable terminal barrier. Cần raw observer và awaited terminal barrier riêng. |
| [keyAccess.js](../../src/sse/services/keyAccess.js) đọc bốn dạng client key; `getKeyAccessContext` trả null cho unrestricted/no-key/unknown. | Accounting identity không được suy từ ACL context null hoặc masked key. Reuse extraction rồi xác minh record/binding; không thay authentication policy. |
| [executors/index.js](../../open-sse/executors/index.js) cache Default executors; [combo.js](../../open-sse/services/combo.js) fallback trên HTTP 200 nhưng empty content. | Không gắn request state lên singleton; accounting refusal không được biến thành provider cooldown/fallback, còn upstream empty-content semantics phải giữ. |

## So sánh hướng làm

| Hướng | Giả định chính | Điểm hỏng đầu tiên / chi phí |
|---|---|---|
| A. Combined JSON + SSE trong một slice, lifecycle chung tại từng POST. | Transport seam và terminal ownership có thể review cùng lúc trong một change đủ nhỏ. | Khi lỗi xuất hiện, khó tách queue/wire authority khỏi stream ordering; phạm vi review lớn hơn. Vẫn khả thi nếu source/test dependency thực tế rất nhỏ. |
| B. Lifecycle chung; prerequisite transport/authority, JSON trước, SSE sau. **Đề xuất.** | JSON có thể đóng một flow thực với cùng per-attempt contract sẽ dùng cho SSE. | SSE có thể buộc chỉnh interface; tránh khóa API vào buffered JSON. Có thêm một lần integration review nhưng dễ xác định lỗi và rollback từng phần. |
| C. Selective port toàn bộ composition Base JSON/SSE cũ rồi adapt vào P2 mới. | Helper graph và assumptions cũ còn tương thích với current app/core/P2. | Code cũ kéo nhiều config/provider/routing/unhealthy helpers; acceptance cũ không chứng minh P2 mới. Chi phí dependency audit và bỏ/rework cao nhất. |

**Trade-offs:** B ưu tiên reviewability và kiểm chứng từng boundary, không giảm phạm vi JSON/SSE. A giảm số bước nhưng gom nhiều failure modes. C tiết kiệm phần code đã viết nếu assumptions còn đúng, đổi lại dependency và acceptance risk lớn.

**Better approaches: none — recommended direction is the requested one:** bổ sung thiết kế kỹ thuật và detail P3 trên P2 hiện có. Evidence cho thấy vẫn phù hợp selective port của roadmap; chưa có căn cứ đổi kiến trúc hoặc mục tiêu sản phẩm. B là cách chia delivery được P3 hiện tại cho phép.

## Hướng đề xuất

### 1. Một request owner ở app, một attempt owner cho mỗi actual POST

App xác minh stable key ID/binding và giữ context riêng trong request; engine nhận optional hooks qua execute args/local closure. Engine không import DB/service trực tiếp. Hooks absent giữ standalone/default/no-key behavior hiện tại, subject to existing DB ownership/auth requirements.

Context sống qua các retries/account fallback thuộc request; attempt receipt và late terminal sink sống đủ để xử lý kết quả của POST đã gửi. Dispose request authority chỉ cấm future dispatch, không xóa sink của attempt đã ACK. Không dùng client-supplied IDs làm authority.

Snapshot wire trước admission gồm URL, serialized body, headers, selected credentials/connection, provider overrides và transport selection liên quan. Giữ secrets trong request-local memory; không persist/log snapshot credential. Equality với snapshot chỉ là ràng buộc: fresh synchronous callback vẫn phải đọc authority hiện tại, không tin cached proof.

### 2. Prerequisite nhỏ: fresh wire authority tại actual transport exposure

Trước khi hydrate implementation P3, tạo một owner plan nhỏ từ X5 cho **Base chat dispatch sau transport awaits**, không depend ngược P3. Files dự kiến: `open-sse/executors/base.js`, `open-sse/utils/proxyFetch.js`, app-side authority helper tại module boundary hiện có và focused tests; exact manifest phải được chốt bằng plan.

Phải giải quyết hai điểm trước khi gọi seam executable:

1. Transport preparation có thể await nhưng actual exposure phải synchronous-check current authority + consume đúng own receipt ngay trước network call; không có await ở giữa. Gate bị từ chối trước exposure mới đủ điều kiện `not_dispatched`. Sau khi đã consume/expose mà kết quả không chắc chắn thì unresolved.
2. Redirect, TLS retry và proxy fallback không được tạo thêm POST dưới receipt đã dùng. Redirect accounting path phải từ chối replay tự động; các explicit resend còn được phép phải thành fresh attempt riêng với predecessor terminal/gate và current transport authority. Giữ strict proxy/TLS policy; không silently bỏ fallback support hoặc đổi no-hook behavior để thu nhỏ patch. Nếu không chứng minh được branch, giữ blocker/owner obligation và activation OFF; refusal không phải support acceptance.

Đối chiếu riêng connect timer hiện tại trước khi đặt queue waits vào transport: không reset original deadline/backoff/quorum, không thêm prewarm. Positive native loopback và saved-proxy controls phải chứng minh seam thực sự gửi được, không chỉ test denial.

### 3. JSON đóng flow đầu tiên

Chọn một OpenAI Chat Completions protocol profile rõ ràng trên Base/Default; fixture dùng persisted compatible-node/connection authority và explicit reference price, không tùy tiện đổi URL ngoài authority đã kiểm tra. Chứng minh cả canonical Default behavior bằng affected controls; không suy mọi compatible provider có cùng usage semantics.

POST chỉ được gửi sau own intent ACK. Một body reader quan sát raw JSON/error trước translation, normalization/estimation/buffer; dùng bounded đọc theo conventions và trả body cho handler hiện hữu mà không tạo second debit owner. Đợi own terminal ACK trước eligible successful response và trước successor admission.

Exact adapter phải định nghĩa input/cache read/cache write/reasoning inclusion và khi nào absent field có documented zero nghĩa. Không mặc định optional field missing là zero cho mọi provider. Contradictory, estimated hoặc insufficient evidence thành unresolved/null cost; malformed response không biến thành free attempt. Original P1 snapshot quyết định debit dù price thay đổi sau dispatch.

### 4. SSE dùng cùng lifecycle, có terminal barrier riêng

Quan sát complete raw SSE events trước translator/analytics; hỗ trợ fragmentation/UTF-8, usage trailer, duplicate/conflicting usage và bounded parser state. Không tính cumulative counters nhiều lần hoặc coi partial frame là exact.

Content deltas có thể đi qua trong lúc stream chạy. Giữ các terminal báo success, bao gồm `finish_reason` có ý nghĩa kết thúc và `[DONE]`, cho tới khi thu đủ protocol evidence và nhận own settlement ACK. Có giới hạn chờ trailer/EOF dựa trên deadline policy hiện có; không buffer toàn stream hoặc chờ EOF vô hạn. Giữ native error framing khi settlement/trailer thất bại; sau bytes không hứa đổi HTTP status.

Translator/output layer phải biết accounting terminal result để không tự synthesize success trong `flush` hoặc watchdog sau lỗi. Analytics vẫn có thể estimate/buffer theo contract riêng; các số đó không vào ledger. Disconnect/abort dọn reader/timer có giới hạn nhưng giữ sink để xử lý exact usage đã quan sát hoặc late callbacks hợp lệ; không đổi cancellation policy toàn hệ thống.

### 5. Failure classification và unlimited exception giữ nguyên contract

Tách accounting refusal/unknown ACK khỏi transport/provider error trước Base retry, token-refresh catch, account cooldown và combo fallback. Local storage/authority failure phải đi xuyên các lớp này, không bị nuốt hoặc tạo successor ngoài gates. Upstream empty-content 200 vẫn có thể là billable predecessor và giữ fallback semantics sau accounting checks.

Giữ [unlimited contract gốc](../261018-0213-api-key-budget-roadmap/references/legacy-design-contract.txt): chỉ recording failure với verified ownership/schema/identity/current config mới có thể tiếp tục sau independent durable gap ACK. Gap ACK failure cho 0 successor POST; maintenance/ownership/schema/sidecar invalid không dùng exception. Không dùng SQL.js RAM đã unhealthy làm proof.

P2 chưa cung cấp continuation exception và P4 chưa triển khai policy classification. P3 phải gọi tên prerequisite/proof cho path mình hỗ trợ trước acceptance; không suy unrestricted ACL là unlimited budget, không invent temporary policy default và không chuyển exception thành fail-closed vĩnh viễn. Chưa chứng minh thì giữ nghĩa vụ mở, public activation OFF.

## Delivery và verification đề xuất

Làm tuần tự: transport/authority prerequisite → JSON full flow → SSE full flow → combined affected/performance acceptance. Đây là sequence đề xuất, chưa thay phase checklist thành completed.

| Gate | Observable acceptance |
|---|---|
| Identity + admission | Bốn dạng key extraction; unrestricted key vẫn có stable accounting ID; unknown/no-key giữ auth semantics. Held intent/lost intent/credential-key-pool-routing drift: 0 invalid POST, positive control có POST. |
| JSON + predecessors | Actual adapter/loopback; failed HTTP exact usage vẫn debit; no usage/abort/network unknown không zero. Retry URL/status/refresh/account successor có own attempt; ACK failure không bị fallback/cooldown. |
| SSE | Delta trước terminal được phép; finish/DONE sau settlement ACK. Trailer split/late/missing/conflicting, EOF/stall, cancel giữa settlement và native failure terminal; không estimate debit hoặc synthesize success sau lỗi. |
| Durability/isolation | Node SQLite và SQL.js trong disposable DATA_DIR; stored row không substitute delivered ACK; reopen original price, pending recovery, duplicate/conflict/late và hai keys interleave trên shared executor. Preserve backup-before-mutation requirements. |
| Affected behavior | `base-executor-retry`, `antigravity-retry-hook`, `strict-proxy-enforcement`, `qoder-proxy-replay`, `key-access`, `key-access-handlers`, `account-fallback-4xx`, relevant stream/translator và empty-content controls theo changed callers. Không gọi all-provider green từ bộ này. |

Tests mới dùng real isolated adapter + native localhost upstream cho acceptance; fault injection tại ACK-delivery boundary để phân biệt committed row và delivered receipt, không mock ledger/network rồi claim actual boundary. Chốt exact test filenames/commands khi hydrate plan; runner hiện có: `npm --prefix tests test -- <named-files>`.

Performance proposal: một finite matrix JSON/SSE × accounting-off/on × hai adapters × concurrency 1/4/16, 100 requests/cell, same fixed payload/upstream behavior, tách cold startup khỏi steady-state observations nhưng không prewarm để vượt functional gates. Báo p50/p95 total latency/TTFT/terminal delay, throughput, commit/group/queue metrics và bounded cleanup. Chưa có benchmark hoặc accepted numeric overhead threshold; không tự gọi pass dựa trên số tự đặt.

Mỗi diagnostic phải có hypothesis, expected observation và finite bound theo [roadmap protocol](../261018-0213-api-key-budget-roadmap/phase-01-start.md). Giữ failures, không identical rerun-for-green/timeout increase. Không start server/watchers trong brainstorm này.

## Reuse và giới hạn chứng cứ

Đã đọc diff của stash `d515fb4927ed45a5853104406cd0fecca549c04c` đối với `requestAccounting.js`/`accountedBase.js`, nội dung candidate Base và test declarations của bốn queued files. Repair cũ bổ sung recheck saved credential/key/pool authority sau delivered intent ACK và sau transport awaits; tái sử dụng hypothesis/cases, chưa coi repair accepted hay tests pass trên revision mới.

Ưu tiên port từng invariant vào current P2 API. `accounting-queued-base-boundary` và `accounting-queued-loopback` là nguồn cases phù hợp; saved-proxy cases giúp transport prerequisite. Fusion queued file chủ yếu thuộc X6, chỉ lấy failure-ordering cases thật sự thuộc selected P3 path. Không apply stash, không copy unrelated Kimchi/snapshot WIP.

Brainstorm này chỉ thêm decision report và link từ plan; không code, không test run, không data change, không commit/push/merge/activation. P3 vẫn pending và chưa executable.

## Còn phải xác minh khi detail plan

- Exact lower transport resend/exposure ownership và smallest file manifest; nếu bắt buộc thay semantics thì trình lựa chọn có evidence trước implementation.
- Exact OpenAI profile, absent-field semantics và terminal/trailer bounds; không coi chữ “compatible” là usage certification.
- Current-authority proof cho selected connection/pool/environment và eligible unlimited continuation; không dùng stale/poisoned DB reads.
- Baseline/current test results và measured overhead; chưa có bằng chứng runtime trong lượt brainstorm này.
