# Bàn giao brainstorm — nested-fusion readiness và chi phí runtime

**Ngày:** 2026-10-17
**Mục đích:** report để operator brainstorm riêng, không phải proposal đã được duyệt hoặc lệnh chạy tiếp.
**Trạng thái:** STOPPED_NOT_ALL_GREEN; không có gate đang chạy. Patch authority là **WIP chưa được chấp nhận toàn phạm vi**. B duy nhất active; all13AC OPEN; bytewise/performance BLOCKED; C–E pending; enforcement/public/synchronous OFF.

## 1. Tóm tắt cho người brainstorm

Đã chứng minh và sửa một lỗi cụ thể: khi own intent đã được ghi bền vững nhưng delivery ACK bị giữ, credential hoặc trạng thái active của connection cùng ID có thể thay đổi; Base trước đây vẫn POST bằng authority cũ. Patch hẹp đã có scoped verification, nhưng chưa đủ affected-consumer/nested-positive evidence để nghiệm thu toàn phạm vi.

Blocker hiện tại của nested-positive là **collector kết thúc trước khi nhận đủ kết quả của inner fusion**. Các diagnostic cho thấy công việc đồng bộ, adapter/ownership checks, native HTTP và test harness cùng xuất hiện trong đường chạy. Chưa có một nguyên nhân đủ cô lập để đưa ra bản sửa performance an toàn.

**Không nên kết luận:** “chỉ cần cache lock”, “bỏ guard trùng”, “tăng collector”, “bỏ releaseLock”, hoặc “đây chỉ là máy chậm”. Những kết luận đó chưa được chứng minh và một số sẽ đổi contract bảo mật/lifecycle.

Tài liệu chi tiết và chronological evidence: [Base post-intent authority report](./base-post-intent-authority-20261016.md). Execution authority: [plan](../plan.md), [direction-A contract](./package-b-remaining-work.md#direction-a-fusion-20261016), [design contract](../design-contract.md), [acceptance matrix](./acceptance-closure-matrix.md).

## 2. Mục tiêu phải giữ nguyên

Seam được duyệt: inner completion phải giao **own ACK** trước khi cho phép outer judge/regeneration phụ thuộc; lost ACK hoặc current routing drift không được cho phép successor trái contract.

Mỗi attempt có khả năng bị tính phí phải có:

- Own durable intent trước POST; stable request ID và distinct attempt ID.
- Raw usage chính xác, immutable original price snapshot và terminal sink riêng.
- Own delivered completion ACK trước dependent successor/success.
- Fresh authority/budget/health/routing tại các boundary bắt buộc; row đã settled/pending **không thay thế delivered ACK**.
- Late owners vẫn được theo dõi và có sink; collector timeout không được xóa tiền hoặc bỏ attempt.

Collector fixture hiện có: **1000 ms**, quorum **2**, grace **5 ms**. Không đổi collector, test/hook deadlines, quorum/grace/cancel policy hoặc observation contract để làm test xanh.

## 3. Lỗi authority đã chứng minh — tách khỏi performance

### Red và patch

- Actual app/core/native HTTP red `b82649db2`: **2 pass / 2 fail / 28 filtered**. Một failure là readiness; credential-drift case chứng minh inner judge đã POST bằng credential cũ. Lỗi auth ở outer POST sau đó là sự kiện riêng, không phải bằng chứng gốc.
- Direct Base red `be2af8ea1`: **1 pass / 2 fail / 26 filtered**. Credential/disable thay đổi sau intent delivery vẫn cho POST; không phụ thuộc nested collector.
- Patch tại `src/lib/apiKeyBudget/requestAccounting.js` và `open-sse/executors/accountedBase.js`: private WeakMap giữ equality material theo **exact delivered handle**; fresh SQL/key/connection/pool/wire/pending request checks sau ACK và qua guard trước/sau dispatcher acquisition. Refusal có own `not_dispatched` terminal, nằm ngoài network retry catch.
- V2 chỉ retain Base-chat wire, không áp delivery policy mới lên Responses/embeddings. Không có state theo request trên executor singleton, không dùng row làm bằng chứng ACK.

### Verification hiện có

| Gate | Kết quả | Giới hạn |
|---|---|---|
| Native direct socket `be1db852d` |3 pass, 34 filtered|Node SQLite asserted; valid/original200000 và credential/disabled no-POST terminal. Không nested collector.|
| SQL.js direct socket `b0f9f368a` |3 pass, 34 filtered|Actual SQL.js asserted; **cùng ba control**, không phải sáu unique control.|
| V2 Base/proxy/alternate `be28f01e1` |81/81|Base31, embeddings20, Responses11, saved-proxy19; scoped, không toàn sản phẩm.|
| Hai file chưa được thực thi `b8a29d1a7` |50/50|Request-context46, ACK-durability4.|
| Base suffix chưa được thực thi `b0bfab41d` |10 pass, 89 filtered|Không bù receipt thiếu của phần đầu file.|
| V2 lint/LSP |Lint6 exit0, whitespace0; LSP6 clean|Evidence của revision v2 đã tiêu thụ trước diagnostic, không phải lần chạy mới cho report này.|

Giữ patch này riêng về diff/lập luận/evidence với bài toán performance. **Tách riêng không có nghĩa chấp nhận patch, commit hoặc bật enforcement.**

## 4. Các khoảng trống kiểm chứng còn bắt buộc

- Plain actual app candidate: native `baaa355b3` **3 pass / 1 fail / 28 filtered**; lost ACK/routing/credential refusal reached, positive deliver readiness fail trước held entry.
- SQL.js actual app `bfedac2dd`: **1 pass / 3 fail / 28 filtered**; lost ACK reached; ba case còn lại fail trước hold/mutation, guard assertions UNREACHED.
- V1 impact Gemini: outer300s, **không final JSON**. Log ghi failure của `owned video metadata capability grant binds full original private upload authority through actual raw/reference/nativeSSE consumers` ở10554ms, chưa có stack cuối. Không gán failure này thành bytewise hoặc kết luận baseline/regression.
- Unhealthy4file `bd665e748`: outer320s, **không final JSON/wrapper receipt**. Có136-case unhealthy-chat-core summary và Base progress tới `latched`; không có final per-assertion statuses. Kết quả50/10 phía trên không retroactively đóng khoảng trống đó.
- Original bytewise và các timing failures trước đây vẫn BLOCKED; profile mới không sửa hoặc waive chúng.
- Historical nested5-vs4 POST failures chưa được chứng minh có cùng nguyên nhân với các diagnostic hiện tại.

## 5. Timeline các diagnostic — không gộp run

Tất cả là disposable HOME/DATA_DIR, dummy loopback, asserted node:sqlite, external Vite transform. Không đổi1866 source/test inputs, không prewarm inference/network/ledger, không đổi deadline. Diagnostic topology/profiler có thể thay đổi schedule; **không run nào là plain acceptance**.

| Run | Kết quả | Boundary thực sự đạt | Chưa đạt / failure |
|---|---|---|---|
| Stage `b685e2b59` |0 pass / 1 fail / 31 filtered|68events; outer1043ms both timeout, inner1004ms aok/ctimeout. Ba originals và fresh fallbacka có own sinks; drain.|First held-inner-intent race fails; cả hai judge chưa được admitted. Later assertions UNREACHED.|
| Dispatch spans `bafbe29b6` |0 pass / 1 fail / 31 filtered|188events; outer1158ms/inner1137ms. Base guards12calls133.6ms, routing30calls191.4ms across drained request; nativefetch→parent receipt301–443ms.|First held entry fails; không tách khoảng fetch→callback thành network-only. Guard sums không phải guaranteed removable savings.|
| Isolated HTTP child `bb786c527` |0 pass / 1 fail / 31 filtered|248events. **Held inner intent reached**, pending inner +3original settled200000/no inner POST before release assertions passed. Innercollector811ms bothok; inner own ACK released.|Outer1059ms lefttimeout/rightok trước innercompletion. Response200 nhưng contentfixture-b thay fixture-judge. Final five-model/IDs/money assertions sau content UNREACHED.|
| Single CPU profile `b6724208e` |0 pass / 1 fail / 31 filtered|Một profile0600; originals và late innerjudge có own sinks; drain. Full JSON/receipt/hash.|**First held-inner-intent race fails**. Inner intent chỉ delivered sau khi app response thắng race; không được coi như isolated run đã tới hold.|

### Isolated HTTP đã phân biệt điều gì?

Một child process Node nhận HTTP độc lập, rồi IPC về parent để chạy **nguyên fixture callback/assertions/response generation**. Payload chỉ là dummy fixture trong private IPC, không ghi body/header/URL vào trace. Child shutdown/exit0 được assert.

Trong chính isolated run:

| Original panel | Native fetch → child headers | Child body complete → parent IPC callback |
|---|---:|---:|
| a |114.7ms|98.3ms|
| c |60.2ms|104.8ms|
| b |40.3ms|125.5ms|

Có độ trễ xử lý thông báo sau khi receiver đã nhận đủ body. Nó bao gồm IPC/OS scheduling/parent event loop; **không quy riêng cho guard CPU**. Child topology có overhead và không phải fixture correction đã được nghiệm thu. Không trừ thời gian giữa hai run khác topology để tuyên bố speedup.

Isolated run có năm POST thực tế **a,c,b,innerjudge,b**, không phải năm model kỳ vọng **a,c,b,innerjudge,outerjudge**. POST thứ năm là fresh fallback attempt, không hidden replay. Đây không phải reproduction của historical routing-drift5vs4.

## 6. CPU profile — kết quả có giới hạn

Operator đã chọn **đúng một profile rồi dừng**, không tự thử optimization variants. Đã thực hiện đúng giới hạn: chỉ một profiled request, không task đang chạy.

- File: `.pi/fusion-app-continuation-20261016/nested-isolated-cpu.cpuprofile`, permission0600,681018bytes,1453samples.
- SHA256: `1989b9d3b9e95ed6e84352e0a0a475b5b28be6e385f112032506ed3afc72d689`.
- Whole profile2555.4ms gồm khoảng530ms Inspector.start **trước app invocation**. Windowed analysis loại phần đó.
- App/late-owner window2022.8ms; outercollector window1019.1ms.
- Đây là time-delta-weighted sampling, không stopwatch CPU chính xác. Inclusive ancestors và category unions có thể chồng lấp; không cộng các nhóm để ước lượng tiết kiệm.

| Category/stack | App+late owners | Outercollector | Ý nghĩa |
|---|---:|---:|---|
| Writer ownership |318.5ms|164.1ms|Fresh writer-lock read/validation là hot path; không có bằng chứng được phép cache/bỏ.|
| Native adapter |453.4ms|219.3ms|Bao gồm ownership, health, prepare và SQLite; chồng lấp ownership.|
| Strict snapshot |111.0ms|51.4ms|Bounded copy/descriptor validation; chưa có replacement tương đương được chứng minh.|
| Vite module/source-map |124.5ms|79.0ms|Harness cost hiện diện trong collector, không đại diện mặc nhiên cho production build.|
| Logger formatTime |119.4ms|6.7ms|Phần lớn ngoài collector; chưa đủ cơ sở sửa logger để giải quyết positive flow.|
| Idle leaf |149.1ms|9.9ms|Không cho thấy collector chủ yếu chờ network idle; vẫn không phân loại toàn bộ thời gian còn lại là CPU thuần.|

### Các call stack đã đối chiếu source

1. `service.gate/readStatus → adapter.get/prepare → nativeDurability.assertUsable → writerOwnership.assertOwned/readOwner → fs.readFileSync`.
   - Source: `src/lib/db/adapters/nodeSqliteAdapter.js`, `src/lib/db/writerOwnership.js`.
   - Đây là observation liên quan ownership, không phải “redundant check có thể bỏ” đã chứng minh.
2. `readAccountingText → reader.releaseLock → Node lazyReadableReleasingError → prepareStackTrace → Vite source-map decode`.
   - Source: `open-sse/utils/readAccountingJson.js` xác nhận release trong finally.
   - Normal cleanup có thể kích hoạt lazy stack formatting của harness. Không chứng minh cleanup sai/leak hoặc an toàn để bỏ releaseLock.
3. `handleChatRequest → logger.info → formatTime → toLocaleTimeString`.
   - Source: `src/sse/utils/logger.js`. Chỉ6.7ms sample trong collector của run này.
4. Capability matching, strict snapshot, real group writes và terminal projection cũng có mẫu.

Transformed profile line numbers không phải original source line numbers; dùng function/module để điều hướng. Đã có script phân tích window và artifact, không cần chạy lại profile để đọc chúng.

## 7. Advisor đã tư vấn gì?

Advisor được gọi theo yêu cầu operator, với checkpoint tóm tắt và `gitContext:none`. **Advisor chưa đọc trực tiếp report/diff/profile**; đây là tư vấn chiến lược, không independent verification hoặc approval patch.

Khuyến nghị:

- Brainstorm hẹp ngay để chốt **proposal kiểm chứng**, chưa triển khai tối ưu hoặc chạy thêm theo quán tính.
- Một câu hỏi trung tâm: blocker do harness, runtime thật hay tương tác cả hai?
- Ưu tiên đối chiếu artifact hiện có; sau đó mới thiết kế so sánh harness với runtime build có semantics tương đương; chỉ cân nhắc đo thành phần nếu còn thiếu.
- Trước run mới phải chốt giả thuyết bác bỏ được, invariants, ma trận, ngân sách hữu hạn, artifact và stop conditions.
- Trước implementation phải quy thuộc được chi phí và chứng minh hướng sửa giữ contract; stack nóng của một profile chưa đủ.
- Tách patch stale-authority khỏi performance về evidence, nhưng giữ acceptance gaps rõ ràng.

Advisor lưu ý không gộp run reached/unreached. Mục5 ở đây ghi rõ isolatedHTTP reached hold, còn CPU-profile run không reached hold trước response.

## 8. Đầu vào cho buổi brainstorm riêng

### Câu hỏi cần chốt, chưa có đáp án mặc định

1. Evidence hiện tại đủ phân biệt harness-specific overhead và runtime authority cost đến đâu? Còn đúng một missing fact nào cần lấy trước khi code change?
2. Có thể thiết kế runtime-build comparison giữ nguyên original input/SQL/transport/authority/collector/lifecycle không? Nếu khác semantics, phải gọi là diagnostic, không acceptance.
3. Hướng tiếp theo là test-harness correction có bằng chứng, semantics-preserving implementation change có proof, hay báo contract/performance chưa khả thi? Không giảm scope im lặng.
4. Patch stale-authority cần những current affected-consumer receipts nào để nghiệm thu riêng mà vẫn không che nested/performance blocker?
5. Nếu hướng sửa động đến ownership freshness/collector/cancellation/resource lifetime, quyết định rủi ro nào cần operator phê duyệt riêng?

### Đầu ra mong muốn sau brainstorm

Một proposal ngắn, chưa phải patch, gồm:

- Giả thuyết chính và giả thuyết cạnh tranh; observation nào phân biệt được.
- Một phương án ưu tiên và lý do loại các phương án khác.
- Danh sách invariants và chi tiết thay đổi topology/harness nếu có.
- Phạm vi file, inputs/adapters/workload, ngân sách run hữu hạn.
- Evidence bắt buộc và tiêu chí pass/fail/inconclusive trước execution.
- Stop ngay khi hết ngân sách, thiếu JSON/receipt, semantics lệch hoặc không phân biệt được giả thuyết; không nối thêm variant.
- Điều kiện trước implementation và quyền cần xin lại.

**Report này không chọn hoặc khởi chạy các phương án đó.** Operator sẽ brainstorm riêng; assistant chờ scope/decision mới.

## 9. Giới hạn bảo mật và quyền thực thi

Không tự động được phép:

- Cache/coalesce/bỏ fresh ownership/key/connection/pool/routing/coverage observations.
- Giảm số lần kiểm tra chỉ vì inclusive time cao; dùng pending/settled row làm ACK.
- Bỏ cleanup/releaseLock, prewarm, tăng deadline hoặc đổi collector start/quorum/grace/cancel policy.
- Hồi sinh HMAC/coverage-view/architecture candidates đã bị reject.
- Xóa failed receipts, nâng partial logs thành pass, loại popular route khỏi accepted scope để đóng B.
- Tắt/kill user services, đổi affinity/priority hoặc đổ lỗi môi trường từ snapshot sau run.
- Live billable calls, production DB operations, activation, delegation, commit/push trong reporting scope này.

Không có secret mới được đưa vào report/trace. Raw profile chỉ lưu metadata hàm/source cục bộ, không request arguments; không nên upload profile/raw `.pi` tùy tiện. Đây không phải security certification toàn hệ thống.

## 10. Artifact và trạng thái bàn giao

Artifact root cục bộ: `.pi/fusion-app-continuation-20261016/`.

- `candidate-v2-inputs.json`: frozen1866 source/test dictionary.
- `nested-*.receipt.json`, `*.vitest.json`, `*.failures.json`, traces và analysis: receipts theo từng run phía trên.
- `nested-isolated-cpu.windowed-analysis.json` và `analyze-request-cpu.py`: phân tích theo app/collector windows, tách profiler startup.
- `nested-isolated-cpu.reconciliation.json`: profile hash/mode/count, frozen dictionary và protected WIP checks.
- `v2-verification-scope.json`: scope hiện tại, không whole-plan certificate.
- Earlier failed/incomplete native/SQL.js/Gemini/unhealthy artifacts giữ nguyên.

HEAD checkpoint: `094e2d61ecaeb424a7dff12a9ba9b54e43da51d1`; feature WIP chưa commit trong continuation này. Hai production files và bốn test files thuộc patch mới; diagnostic không đổi source/test bytes. Bốn WIP ngoài phạm vi được bảo toàn: Kimchi test, golden URL/header snapshot, cache-miss research và OmniRoute comparison report.

**Bàn giao:** report đã sẵn sàng; không có run đang chờ; không có approval/closure mới. Chờ operator brainstorm và trả lại quyết định/phạm vi thực thi.
