# Session stickiness: OmniRoute và 9Router

Ngày: 2026-10-18
Trạng thái: **Ghi nhận khảo sát source để brainstorm sau — chưa phê duyệt thiết kế hoặc triển khai.**

## Mục tiêu

Lưu kết quả kiểm tra về Round Robin, Sticky Limit và session affinity nhằm thảo luận khả năng áp dụng cho 9Router. Không sửa runtime, không port code, không chạy inference/upstream và không thay đổi cấu hình đang dùng.

## Nguồn và giới hạn bằng chứng

- 9Router: source tại `/home/gmo/projects/9router`, working tree tại thời điểm khảo sát; chưa chốt commit của snapshot này.
- OmniRoute: source local tại `/home/gmo/projects/OmniRoute`, HEAD `488f57e9d3fccc8d1741fdf21d35d5730b118a18`.
- Remote upstream được cấu hình cho OmniRoute: `git@github.com:diegosouzapw/OmniRoute.git`; đây không phải xác nhận source local trùng bản upstream mới nhất.
- Không fetch GitHub; kết luận dựa trên đọc source local, không phải kiểm chứng runtime hoặc benchmark cache.
- Các đường dẫn và số dòng dưới đây là mốc tìm kiếm ở snapshot khảo sát, có thể thay đổi về sau.

## 1. Vấn đề người dùng quan ngại

Round Robin đổi tài khoản giữa các lượt trong cùng cuộc hội thoại có thể làm giảm prompt-cache hit nếu upstream phân vùng cache theo tài khoản hoặc phạm vi credential khác nhau.

Không khẳng định mọi provider đều mất cache khi đổi tài khoản. Cùng tài khoản cũng không bảo đảm cache hit: còn phụ thuộc model, prompt prefix, thời hạn cache, cache key và chính sách upstream.

## 2. 9Router hiện tại

### Sticky Limit là bộ đếm lượt, không phải ghim session

`src/sse/services/auth.js:148–203`:

- Chiến lược được chọn từ override theo provider, rồi setting global; mặc định `fill-first`.
- Với `round-robin`, `stickyRoundRobinLimit` mặc định là 3.
- Chọn connection dùng gần đây nhất và giữ nếu `consecutiveUseCount` chưa đạt giới hạn.
- Khi đạt giới hạn, chọn connection ít được dùng gần đây nhất, reset bộ đếm về 1.
- Cơ chế này không gắn bộ đếm với conversation/session của client.

Ví dụ nhiều chat xen kẽ với limit = 3:

```text
Chat X → A
Chat Y → A
Chat X → A
Chat X → B   # cùng chat nhưng đã chuyển account
```

UI: `src/app/(dashboard)/dashboard/profile/page.js:1438–1518`:

- Sticky Limit: “Calls per account before switching”, UI 1–10, mặc định 3.
- Combo Sticky Limit: “Calls per combo model before switching”; điều khiển model trong combo, không đồng nghĩa account affinity.

### Cache/session key không đồng nghĩa account pin

- `open-sse/executors/codex.js:134,225,474–476` có session identity, header `session_id` và inject `prompt_cache_key` nếu body thiếu.
- Chúng hỗ trợ nhận diện/routing cache phía upstream, không tự cung cấp session→account pin trong lớp Round Robin đã kiểm tra.
- Có `preferredConnectionId` trong hàm chọn credential, nhưng các call site đã tìm thấy sử dụng nó cho image/video; chưa thấy luồng chat thường dùng nó để ghim session.
- Không tìm thấy flag `stickiness` riêng cho chat session affinity trong phạm vi source 9Router đã khảo sát. Đây là kết luận có phạm vi, không phải audit toàn bộ mọi đường routing.

Tạm thời, Fill First tránh đổi tài khoản chủ động sau mỗi N lượt; không phải cam kết session pin tuyệt đối.

## 3. OmniRoute: hai lớp khác nhau

### 3.1 Account session affinity: `sessionAffinityTtlMs`

Nguồn:

- `src/sse/services/sessionAffinityPin.ts:197–315,424–459,483–540`
- `src/sse/services/auth.ts:1840–1900`
- `src/app/(dashboard)/dashboard/settings/components/ComboDefaultsTab.tsx:480–508`

Hành vi:

1. Lấy session key từ request.
2. Trong pool connection hiện đủ điều kiện, nếu có pin `(sessionKey, provider)` còn hạn thì dùng lại account đã pin.
3. Nếu chưa có pin phù hợp, chọn account ít được dùng gần đây nhất (LRU) và tạo pin.
4. Affinity được xét **trước** nhánh Round Robin/Fill First. Khi affinity chọn được account, nhánh Sticky Limit theo lượt không quyết định lựa chọn đó.
5. Pin không còn trong pool thì bị xóa; có thể chọn account mới.
6. Khi reuse pin, cập nhật thời điểm dùng qua `touchSessionAccountAffinity`.

TTL:

- UI hiển thị giây, giới hạn nhập 0–86400 giây; setting lưu mili giây.
- `0` tắt affinity; resolver trả 0 nếu không có giá trị dương hợp lệ.
- Resolver hỗ trợ override request dương, sau đó setting generic `sessionAffinityTtlMs`, fallback legacy `codexSessionAffinityTtlMs`.
- Code hiện áp dụng generic cho mọi provider, không chỉ Codex.
- Chưa kiểm tra sâu implementation backing store của account-affinity trong khảo sát này; không suy ra persistence/restart hoặc multi-process guarantees.

Thứ tự nhận diện session trong hàm extractor:

1. Header: `x-codex-session-id`, `x-session-id`, `x-omniroute-session`.
2. Body: `metadata.session_id`, `metadata.sessionId`, `conversation_id`, `session_id`, `prompt_cache_key`.
3. Fallback: SHA-256 của text đầu vào đầu tiên do helper trích xuất.

Luồng chat còn có fallback sang `sessionId` tại `src/sse/handlers/chat.ts:657`; chưa audit toàn bộ cách sinh giá trị fallback đó.

Eligibility của pin có kiểm tra exclusions, model exclusion/lock, terminal status, rate limit, quota exhaustion và quota policy; một số behavior có options override nội bộ. Không nên mô tả thành ghim bất chấp tình trạng account.

### 3.2 Combo session stickiness: `disableSessionStickiness`

Nguồn:

- `open-sse/services/combo/sessionStickiness.ts`
- `open-sse/services/combo/targetResolution.ts:469–495`
- UI `src/app/(dashboard)/dashboard/combos/page.tsx:4331–4369`
- UI `src/app/(dashboard)/dashboard/settings/components/ComboDefaultsTab.tsx:747–762`

Cấu hình:

```js
disableSessionStickiness: false // cho phép lớp combo stickiness
disableSessionStickiness: true  // tắt lớp combo stickiness
```

Resolver ưu tiên:

```text
config riêng combo (boolean)
  → settings global
  → mặc định false
```

Hành vi source đã đọc:

- Key là hash tin nhắn user đầu tiên, có namespace combo ở production call site.
- Binding lưu connection ID trong in-memory Map.
- Khi có binding hợp lệ, đưa target có connection tương ứng lên đầu danh sách đã sắp theo strategy.
- TTL tính từ lần dùng gần nhất: 15 phút; refresh khi áp dụng pin thành công.
- Giới hạn 500 entry.
- Bỏ binding nếu connection không còn trong targets, TTL hết, headroom ≤0.15, terminal status (`credits_exhausted`, `banned`, `expired`), đang rate-limit hoặc hết quota window.
- Lỗi bất ngờ trong apply: trả danh sách gốc, không throw; một số lookup health/quota lỗi trả trạng thái unknown/fail-open nên không bảo đảm mọi lỗi lookup đều xóa pin.
- Có helper ghi binding, nhưng khảo sát này chưa trace đầy đủ mọi success/failure write-back call site; không tuyên bố đã kiểm chứng toàn bộ lifecycle.

**Quan trọng:** `disableSessionStickiness` không phải công tắc chung cho mọi affinity. Nó điều khiển lớp combo này; account affinity phía credential selection có setting TTL riêng.

## 4. So sánh ngắn

| Cơ chế | 9Router đã khảo sát | OmniRoute đã khảo sát |
| --- | --- | --- |
| Giữ account N lượt | Có Sticky Limit | Có |
| Ghim session→account trước Round Robin | Chưa thấy trong luồng chat đã đọc | Có `sessionAffinityTtlMs` |
| Ưu tiên combo target theo conversation | Chưa thấy cơ chế tương đương trong khảo sát | Có `disableSessionStickiness` để opt out |
| Provider cache/session key | Có ở một số executor, ví dụ Codex | Không audit toàn bộ executor trong lượt này |
| Bảo đảm cache hit | Không | Không; chỉ tăng cơ hội giữ cache |

## 5. Các câu hỏi cần brainstorm trước khi áp dụng cho 9Router

Đây là danh sách quyết định mở, **không phải thiết kế đã chọn**:

1. Muốn account affinity, combo target affinity, hay cả hai? Ưu tiên nào khi hai lớp mâu thuẫn?
2. Session key do client gửi hay tự suy ra? Scope có bao gồm tenant/API key, provider, model, combo không?
3. Có chấp nhận hash tin nhắn đầu tiên không? Hai chat cùng mở đầu “hi” có thể bị gom nhầm về cùng binding.
4. TTL idle bao lâu, max lifetime bao lâu; lưu RAM hay DB; restart/multi-worker cần hành vi gì?
5. Pin có ưu tiên hơn Round Robin/Fill First không? Session mới phân phối account thế nào?
6. Khi nào nhả pin: 429, model lock, quota, account disabled, upstream error, timeout? Có rebind sau success không?
7. Request đồng thời của cùng session có cần atomic selection để tránh pin hai account khác nhau?
8. Đo cache hit, cached tokens, latency và chi phí thế nào để chứng minh lợi ích theo provider? Không lấy con số tiết kiệm trong comment source làm bằng chứng.
9. UI nên phân biệt “Requests per account” và “Session affinity TTL” thế nào để tránh hiểu nhầm Sticky Limit?
10. Nếu port code, cần kiểm tra license và attribution trước; chưa copy implementation từ OmniRoute.

## 6. Security và privacy notes

- Session ID từ client là input không tin cậy, không phải authorization. Không được cho phép client pin sang credential ngoài pool được cấp quyền.
- Cần namespace theo tenant/API key hoặc trust boundary phù hợp để tránh cross-tenant affinity collisions; hai cơ chế hiện khảo sát dùng key theo provider hoặc combo chưa đủ để suy ra đã có tenant isolation toàn diện.
- Không log prompt thô, credential, token hoặc session ID nhạy cảm; cân nhắc hash key và retention.
- Giới hạn key length, số binding, TTL và tốc độ tạo binding để tránh memory exhaustion.
- Pin luôn phải tôn trọng account eligibility, exclusions, quota, budget và quyền truy cập hiện hành; không được dùng affinity để bypass các gate đó.

## 7. Bước tiếp theo

Người dùng sẽ brainstorm sau về cơ chế áp dụng cho 9Router. Chưa có authorization triển khai, thay đổi setting, port source, chạy benchmark/inference hoặc mở rộng scope.
