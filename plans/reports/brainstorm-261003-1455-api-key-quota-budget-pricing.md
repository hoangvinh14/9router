---
title: "API key quota, weekly/monthly budgets và master pricing"
type: brainstorm
status: ready-for-planning
created_at: "2026-10-03T14:55:50+07:00"
language: vi
project: 9router
local_revision: a99cf57239ff778b61e434c2786009d5ed1c412c
reference_repository: /home/gmo/projects/OmniRoute-langostino
reference_revision: a58000c7685f4091c7a6fd8ddf3ebce7d2ec67c3
implementation_started: false
---

# Brainstorm: API key quota, budget tuần/tháng và master pricing

## Summary

Xây dựng tracking và budget cho từng **API key do 9router cấp cho client**. Không nhầm các key này với credential/API key của upstream provider.

Hướng được người dùng chọn: tính quota bằng chi phí token quy đổi theo giá tham chiếu, bao gồm OAuth/subscription; áp dụng budget tuần và tháng đồng thời; chặn request mới khi chi phí đã ghi nhận đạt bất kỳ hạn mức nào. Phạm vi triển khai là **chat + embeddings**.

9router đã có nền tracking theo API key, SQLite và pricing resolver. Đề xuất mở rộng nền hiện có, tham khảo một số ý tưởng của OmniRoute, không transplant toàn bộ hệ thống quota/billing.

Report này là đầu vào cho implementation plan, **không phải plan đã được phê duyệt hoặc bằng chứng tính năng đã triển khai**. Chỉ có inspection source và quyết định sản phẩm; chưa sửa source hoặc chạy test. Các đề xuất kỹ thuật bên dưới chưa được người dùng chốt riêng từng chi tiết.

## Outcome

- Quản trị viên xem được usage theo từng key: số request, input/output/cache tokens và chi phí quy đổi.
- Mỗi key có thể cấu hình budget tuần, tháng hoặc cả hai; dashboard thể hiện số đã dùng, còn lại, phần trăm tiêu hao và mốc reset.
- Chạm một trong các hạn mức thì từ chối request mới thuộc phạm vi enforcement.
- Bảng giá tham chiếu có thể được đồng bộ, vẫn hỗ trợ override thủ công và hoạt động khi nguồn sync tạm thời không truy cập được.

## Quyết định đã chốt với người dùng

| Nội dung | Quyết định |
|---|---|
| Định danh đối tượng | API key gateway cấp cho client, không phải provider credential. |
| Cơ sở budget | Giá token quy đổi theo bảng giá tham chiếu, kể cả Claude/Codex dạng OAuth hoặc subscription. |
| Khi hết budget | Chặn request mới dựa trên chi phí đã ghi nhận; không triển khai reservation trong scope đã chọn. |
| Kỳ hạn mức | Có thể bật tuần và tháng đồng thời. Chạm mức nào cũng chặn. |
| Reset | Tuần lịch: thứ Hai 00:00. Tháng lịch: ngày 1 lúc 00:00. |
| Timezone | Timezone chung được đề xuất trong câu hỏi và người dùng chọn: `Asia/Ho_Chi_Minh`. |
| Phạm vi | Chat streaming/non-streaming, các format đi qua chat, combo/fusion và embeddings. |

Ví dụ: key được cấp $20/tuần và $60/tháng. Nếu hết $20 trong tuần thì bị chặn dù budget tháng còn tiền. Reset tuần không xóa chi phí tích lũy trong tháng; sau reset vẫn chặn nếu tháng đã hết budget.

**Quota tiền quy đổi không phải hóa đơn upstream.** Provider miễn phí hoặc subscription có thể không phát sinh phí theo request, nhưng vẫn tiêu hao quota nếu có giá quy đổi khác 0. Không mang cơ chế miễn trừ flat-rate khỏi monetary budget của OmniRoute vào thiết kế này.

## Constraints

- Dùng stack JavaScript/ESM, SQLite adapter và auth hiện có của 9router; không thêm database hoặc dịch vụ billing riêng.
- Giữ semantics routing, translation, combo/account fallback và streaming hiện có.
- Dùng định danh key ổn định, không lấy masked key làm identity và không đưa secret vào output tracking mới.
- Giá thay đổi không được tự ý sửa số tiền đã trừ trong lịch sử; cần thống nhất cách snapshot giá/chi phí.
- Phân biệt giá bằng 0 được xác nhận và model chưa có giá. Không âm thầm coi thiếu giá là miễn phí.
- Budget cần lưu bền vững qua restart; việc xóa log không được vô tình phục hồi allowance.
- Không yêu cầu đồng bộ giá thành công trên mỗi request; sử dụng giá đã lưu.
- Ngày reset được tính theo timezone cấu hình, không dựa vào timezone ngầm của máy chủ.
- Hệ thống chặn theo completed/recorded spend **không phải hard cap tuyệt đối**. Request đang chạy hoặc các request đồng thời có thể khiến tổng vượt mức.

## Non-goals

- Thanh toán, hóa đơn, subscription management, credit top-up, multi-tenant billing.
- Quota-sharing pools, phân bổ quota theo account upstream, đồng bộ kỳ budget client với kỳ reset quota provider.
- Daily budget, rolling 7/30-day windows, per-key custom reset schedules trong phạm vi đã chọn.
- Giữ trước ngân sách cho request hoặc bảo đảm chi phí thực tế upstream không vượt budget tuyệt đối.
- Metering/enforcement cho image, audio, video, search/fetch và các API ngoài chat + embeddings. UI/docs phải nêu rõ chúng không được bao phủ.
- Port toàn bộ model catalog/capability sync hoặc thêm nhiều nguồn pricing chỉ để giống OmniRoute.

## Findings: hiện trạng 9router

| Source | Bằng chứng từ inspection | Ý nghĩa |
|---|---|---|
| `src/lib/db/repos/apiKeysRepo.js` | Key có `id`, `key`, `name`, `machineId`, `isActive`, `createdAt`; chưa có budget fields. | Đã có stable ID để mở rộng policy. |
| `src/lib/db/repos/usageRepo.js` | Lưu `usageHistory`, chi phí và tổng hợp `byApiKey`; hiện attribution dựa trên raw key. | Tracking đã có nền, không xây lại từ đầu. |
| `tests/unit/usage-api-key-attribution.test.js` | Test giữ các key có prefix mask giống nhau ở bucket riêng. | Có coverage ban đầu cho key isolation; đây là source test đã đọc, chưa chạy. |
| `src/lib/db/schema.js` | `usageHistory` có raw `apiKey`, `cost`, tokens; chưa có `apiKeyId` hoặc index theo ID key/kỳ. | Cần xem xét migration, stable attribution và query budget. |
| `src/lib/db/repos/pricingRepo.js` | Có user override và resolver về giá mặc định. | Mở rộng precedence, không thay toàn bộ pricing API. |
| `open-sse/providers/pricing.js` | Có canonical/provider pricing, fallback và hàm tính chi phí token. | Tái sử dụng math, kiểm tra cache/reasoning và mapping trước khi enforce. |
| `src/sse/handlers/chat.js` | Raw key truyền tới chatCore; có single-model, fallback, capacity adapter và fusion. | Policy và accounting phải bao phủ dispatch thực tế, không chỉ model client yêu cầu. |
| `open-sse/handlers/chatCore/requestDetail.js` | Usage được lưu bất đồng bộ; bỏ qua zero-token rows. | Analytics hiện tại không đủ làm budget ledger đáng tin cậy khi usage thiếu. |
| `src/lib/db/repos/usageRepo.js` | `saveRequestUsage` bắt lỗi rồi log; thiếu giá/lỗi tính giá cho cost 0. Dedupe dựa trên timestamp/token tuple. | Không dùng nguyên fail-open analytics cho enforcement; cần idempotency và trạng thái unknown rõ ràng. |
| `src/sse/handlers/embeddings.js` | Có attribution API key và gọi lưu usage. | Phải tích hợp chung budget/accounting với chat. |
| `src/dashboardGuard.js` | Remote LLM API yêu cầu key hoặc CLI token; có local access mode. | Budget per-key không tự bao phủ traffic không có key. |
| Các handler image/audio/video/search/fetch | Inspection cho thấy metering không đồng đều với chat/embeddings. | Không được tuyên bố budget hiện kiểm soát mọi API. |

Lưu ý: hướng dẫn root còn nhắc usage JSON; source hiện tại cho thấy `src/lib/usageDb.js` là shim re-export sang DB SQLite. Khi lập plan, lấy source làm authority và đọc lại state hiện hành.

## Findings: tham khảo OmniRoute

Source được khảo sát: `/home/gmo/projects/OmniRoute-langostino`, revision `a58000c7685f4091c7a6fd8ddf3ebce7d2ec67c3`. Source repo không bị chỉnh sửa bởi phiên brainstorm. Inspection thấy thay đổi có sẵn tại `docs/guides/DOCKER_GUIDE.md`, ngoài phạm vi tính năng.

| Source | Cách hoạt động | Quyết định áp dụng |
|---|---|---|
| `src/domain/costRules.ts` | Scheduled budget daily/weekly/monthly, calendar UTC, một `resetInterval` hoạt động. | Tham khảo tính window và spend; thích nghi thành tuần/tháng đồng thời theo timezone đã chọn. |
| `src/lib/usage/apiKeyUsageLimits.ts` | Hệ thống riêng: daily timezone Fortaleza, weekly theo provider hoặc rolling fallback; tính lại chi phí usage bằng resolver hiện tại; fail-closed khi thiếu giá. | Không port hệ thống reset này hoặc cơ chế repricing lịch sử. Chỉ tham khảo việc phân biệt unpriced usage. |
| `src/lib/usage/meteredBudgetPolicy.ts` | Flat-rate provider không tiêu hao monetary budget; kiểm tra theo candidate provider. | Không lấy exemption vì người dùng chọn virtual token-price budget. Tham khảo việc không coi từ chối local là lỗi quota upstream. |
| `src/lib/modelsDevSync.ts` | Lấy giá/spec từ `models.dev`, lưu namespace riêng, giữ override ưu tiên cao hơn. | Tham khảo pricing-only sync và provenance; không mang capability sync. |
| `src/lib/pricingSync.ts` | Sync catalog LiteLLM, chuyển đơn vị về USD/1M tokens, tách khỏi overrides. | Tham khảo validation/namespace; chưa cần nguồn thứ hai. Không copy provider alias map vì 9router khác registry. |

**Master pricing ở đây là catalog tham chiếu**, không phải một billing API chung của tất cả AI provider. Source OmniRoute dùng `models.dev` và LiteLLM. Phiên này chưa gọi live endpoint hoặc xác minh độ phủ/tính đúng của giá hiện hành.

OmniRoute dùng MIT License, copyright `(c) 2026 diegosouzapw`. Nếu port code đáng kể, giữ copyright/license notice phù hợp. Đây không phải quyết định copy nguyên file TypeScript sang 9router.

## Trade-offs: các phương án enforcement

| Phương án | Giả định quan trọng nhất | Điều kiện thất bại đầu tiên | Kết luận |
|---|---|---|---|
| Chỉ cảnh báo | Người vận hành chấp nhận mức vượt và phản ứng thủ công. | Client tiếp tục gửi request sau khi hết quota. | Không chọn; không đạt nhu cầu chặn. |
| Chặn theo chi phí đã ghi nhận | Người dùng chấp nhận request in-flight có thể làm vượt budget. | Nhiều request đồng thời hoặc một request dài làm vượt allowance trước khi quyết toán. | **Đã chọn**; ít phức tạp hơn reservation, phải công khai giới hạn. |
| Reservation trước dispatch | Có thể tính bound chi phí đủ tin cậy và giới hạn output. | Tokenizer/usage/price thiếu chính xác hoặc client không có output bound; có thể chặn quá bảo thủ. | Không chọn; ngoài scope hiện tại. |

## Better approaches

**Mở rộng nền 9router thay vì bê nguyên OmniRoute** là hướng tốt hơn so với transplant feature nguyên khối.

- **Evidence:** 9router đã có stable key ID, SQLite usage, `byApiKey` và pricing resolver; OmniRoute có hai hệ thống giới hạn với semantics reset khác nhau.
- **Operational delta:** chỉ một nguồn sự thật cho budget; không thêm provider-reset inference, quota pools hoặc nhiều pricing pipelines.
- **Switching cost:** cần migration attribution/policy và tích hợp accounting đáng tin cậy, nhưng không phải chuyển stack TypeScript hoặc thay database/auth.
- Hướng này đáp ứng ý định người dùng: chỉ lấy đúng những gì cần từ OmniRoute.

## Recommendation: kiến trúc tối thiểu cho plan

### 1. Identity và attribution

- Resolve key đã xác thực thành `apiKeyId`, truyền context tới mọi dispatch chat/embeddings.
- Dùng ID cho budget và usage mới; không grouping bằng raw/masked secret.
- Lập policy backfill cho lịch sử match được key hiện có. Lịch sử không map được phải được đánh dấu, không đoán identity.
- Giữ key đã xóa ở dạng historical attribution phù hợp; budget/accounting không nên cascade-delete ngoài ý muốn.

### 2. Một hệ thống budget thống nhất

- Policy lưu tuần/tháng dạng tùy chọn; key không cấu hình budget giữ hành vi unlimited hiện có.
- Tính window `[start, end)` theo timezone chung. Reset bằng chuyển window, không xóa lịch sử.
- Storage cụ thể do plan lựa chọn; cần durable accounting/counters độc lập với việc xóa log và hỗ trợ adapter chain của repository.
- Cân nhắc fixed-precision monetary units để tránh drift dấu phẩy động; độ chính xác cần quyết định từ giá token thực tế.
- Nếu chạm tuần hoặc tháng, từ chối dispatch mới. Local refusal không được đánh dấu provider credential là rate-limited hoặc cooldown.

### 3. Accounting đáng tin cậy

- Dùng request/dispatch identifier để quyết toán idempotent; timestamp và token tuple không đủ chứng minh duplicate.
- Một request client có thể có nhiều upstream dispatch: fallback, retry, fusion panel/judge. Tính theo usage/cost thực sự được ghi nhận của từng dispatch, không giả định một HTTP response bằng một lần tiêu hao.
- Chốt ngữ nghĩa khi provider lỗi nhưng đã phát sinh usage; không tự coi mọi failed attempt là miễn phí.
- Streaming abort, thiếu usage và persistence failure phải có trạng thái rõ ràng. Không âm thầm quyết toán thành 0 hoặc tuyên bố ledger chính xác khi mất dữ liệu.
- Snapshot chi phí và provenance giá dùng cho quyết toán; cập nhật giá không hồi tố spend.
- Không serialize mọi request hoặc thêm reservation một cách ngầm định. Theo dõi/hiển thị overshoot do in-flight như giới hạn đã được chấp nhận.

### 4. Pricing sync

- **Đề xuất, chưa chọn nguồn chính thức riêng:** dùng pricing-only `models.dev` trước, giữ khả năng thêm nguồn khác sau này nếu coverage thật sự thiếu.
- Precedence: **manual override > synced catalog > bundled defaults**. Duy trì quy tắc explicit free-price, không để canonical fallback biến model miễn phí thành có phí.
- Lookup theo provider/model thực được sử dụng; provider ID/alias và reseller price phải được map rõ, không đoán từ model name.
- Lưu nguồn, thời điểm cập nhật và trạng thái định giá; hỗ trợ sync thủ công và tùy chọn định kỳ.
- Timeout, giới hạn payload/schema, allowlisted source/redirect policy; chỉ commit bản giá hợp lệ. Sync lỗi giữ last-known-good và overrides.
- **Đề xuất missing-price policy:** từ chối model không có giá trước dispatch bằng key đang enforce monetary quota; admin có thể đặt giá override. Không reset ledger bằng cách thay giá. Người dùng chưa chốt riêng policy này.

### 5. Dashboard và API quản trị

- Tích hợp vào quản lý API key: config budget, usage tuần/tháng, remaining, progress và next reset.
- Cho phép drill-down usage theo model/provider trong scope đã chọn.
- Đánh dấu rõ “reference/virtual cost”, không dùng từ ngữ hứa khớp invoice.
- Expose budget-exceeded error có machine-readable code, window/reset information và format phù hợp client. HTTP status/header cụ thể cần kiểm tra với OpenAI/Anthropic/Gemini clients, không copy ngoại lệ status OmniRoute mà chưa test.
- Không thêm self-service portal, notification integrations hoặc billing screens ngoài scope.

## Security notes

- API cấu hình budget/pricing/usage mới phải giữ auth quản trị hiện có; client key không được phép sửa budget của mình hoặc xem key khác.
- Không trả raw secret trong usage output mới, không dùng secret trong URL/query parameter mới. Audit các boundary được chạm thay vì mở rộng thành auth rewrite.
- Anonymous local/CLI modes không tự chịu per-key budget. Giữ compatibility và công khai exemption; muốn mọi traffic chịu hạn mức phải yêu cầu API key.
- Missing price, missing usage và DB failure không được biến thành free spend một cách im lặng. Enforcement failure policy phải được xác định trước implementation.
- Catalog URL/payload là dữ liệu không tin cậy. Không cho phép arbitrary URL fetch tạo SSRF hoặc catalog sync ghi đè manual override.
- Việc sửa usage attribution không đồng nghĩa đã loại toàn bộ raw-key storage khỏi repository; plan phải xác định phạm vi migration/redaction thực tế.

## Acceptance criteria

Các tiêu chí dưới đây là bằng chứng cần tạo trong implementation, **chưa được kiểm chứng trong brainstorm**.

1. Usage mới của hai key khác nhau không gộp nhầm, kể cả cùng masked prefix; key ID tồn tại ổn định qua đổi tên.
2. Weekly/monthly budget hoạt động đồng thời; hết một mức sẽ chặn request mới trong scope, không chặn nhầm key khác.
3. Reset đúng Monday/month boundary theo `Asia/Ho_Chi_Minh`; test tháng ngắn, cuối năm, timestamp boundary và restart trước/sau reset.
4. Key không budget và explicit no-key mode giữ compatibility; UI/docs công khai phạm vi không enforce.
5. Chat streaming/non-streaming, Messages/Responses/Gemini qua chat, embeddings, fallback và fusion đều có attribution/accounting đúng.
6. Dedupe/idempotent settlement không double-charge; cache-read/cache-write/reasoning không bị tính phí hai lần.
7. Concurrent requests và in-flight overshoot được test theo contract đã chọn; không tuyên bố hard cap.
8. Disconnect/abort, missing usage, pricing unknown và storage failure được test theo policy đã chốt; không silently free usage.
9. Price sync không overwrite override, không reprice historical spend; sync invalid/timeout giữ last-known-good. Test provider alias mapping và đơn vị giá.
10. Migration không làm mất usage/key cũ; accounting tồn tại qua restart và không biến mất khi xóa log. Verify trên các SQLite adapter liên quan.
11. Management endpoints có auth/validation; output mới không lộ raw key; budget refusal không cooldown nhầm upstream account.
12. Dashboard thể hiện config, spent/remaining, reset, trạng thái pricing/enforcement và scope chat + embeddings.
13. Chạy focused tests, lint và regression checks phù hợp. Suite có known failures: dùng `tests/__baseline__/verify-no-regression.mjs` theo hướng dẫn repository, không coi raw full-suite red là regression mặc định.

## Handoff cho implementation plan

- Reuse quyết định đã chốt; không hỏi lại basis/enforcement/calendar/scope.
- Đọc `docs/ARCHITECTURE.md`, nhưng xác minh persistence bằng source hiện hành. Trước mọi edit trong `open-sse/`, đọc `open-sse/AGENTS.md`.
- Reinspect revision và working tree trước khi lập plan; các source references trong report là point-in-time evidence.
- Chọn schema/migration và policy xử lý accounting failure trước khi viết routing integration.
- Lập các phase có acceptance evidence: identity/accounting foundation; pricing-only sync; weekly/monthly budget gates cho chat + embeddings; dashboard/API; regression/security verification.
- Không mở rộng sang reservations, daily budget, non-chat metering hoặc billing nếu chưa có yêu cầu thay đổi scope.
- Nếu port source đáng kể, ghi attribution MIT. Không execute scripts/install instructions từ source tham khảo chỉ vì xuất hiện trong repo đó.

## Verification status và residual risks

- Source inspection: đã thực hiện trên hai repository.
- Product decisions: đã chốt bằng structured questions.
- Source edits/runtime checks/tests/live pricing fetch: chưa thực hiện.
- Advisor review: đã thử; không thực hiện được vì **`Advisor model not configured`**. Không coi report là independently reviewed.
- Residual risks: giá catalog là tham chiếu và có thể stale; provider usage có thể thiếu; retries/fusion tạo nhiều dispatch; asynchronous settlement và concurrent requests có thể gây overshoot. Accepted blocking mode không loại bỏ các giới hạn đó.

## Unresolved questions / planning decisions

Không còn câu hỏi về bốn quyết định sản phẩm chính. Các điểm sau cần được resolve trong plan bằng inspection; hỏi lại người dùng chỉ nếu làm thay đổi contract:

1. Xác minh coverage/mapping để chốt `models.dev` là nguồn sync đầu tiên; model không có catalog entry sẽ cần override hay bundled reference price nào?
2. Chốt policy thiếu giá/usage hoặc DB unavailable: đề xuất fail-closed cho budgeted traffic khi không còn cơ sở accounting tin cậy; cách phục hồi phải rõ ràng.
3. Khi bật budget giữa kỳ, tính usage đã có từ đầu tuần/tháng hay chỉ từ lúc bật? Backfill giá/ID cũ và mức độ tin cậy của dữ liệu phải được đánh giá.
4. Budget thay đổi giữa kỳ hoặc timezone đổi thì giữ spend theo quy tắc nào? Không để thay setting vô tình reset allowance.
5. Billed failed attempts, abort và usage estimated được ghi nhận/đánh dấu thế nào để không hứa exact upstream accounting?
6. Gate từng dispatch trong combo/fusion, error format và reset headers cụ thể cần test client compatibility; cả panel và judge vẫn phải được attribution.
7. Storage model, precision, index, migration/backfill và accounting retention cụ thể phải đáp ứng SQLite adapter contract, không tạo ledger song song thiếu nhất quán.
