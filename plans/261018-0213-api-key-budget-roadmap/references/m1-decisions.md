# M1 — Quyết định sau inventory, 2026-11-01

## Authority và giới hạn

Người dùng đã đồng ý bước **inventory → chốt quyết định → tạo một child plan** sau readiness review. Trong questionnaire cùng phiên, user chọn cả bốn phương án dưới đây. Đây là authority cho thiết kế/phạm vi, **không phải authorization implement runtime, commit/push, deploy, migration hoặc production activation**. `ledgerStartedAt`, accounting/enforcement/public activation vẫn OFF.

[Contract M1](./codex-claude-milestone.md) giữ outcome Codex + Anthropic API key + Claude OAuth/subscription. B1 giữ nguyên: interrupted/no-usage bỏ qua; valid failed/late usage ghi một lần; malformed/pricing/auth/storage failure không trở thành miễn phí.

## D1 — Graph-level refusal cho budget-controlled key

- Trước **mọi inference POST**, kiểm tra toàn bộ graph reachable từ request: alias, account/model fallback, capacity adapter, combo/nested, classifier/router, panel/judge và retry transport. Có path chưa có accepted accounting profile/composition thì từ chối cả request trước inference POST đầu tiên.
- Child đầu chưa hỗ trợ combo/Fusion/nested/smart routing: từ chối ngay tại admission, không gọi smart classifier rồi mới kiểm tra. Alias trực tiếp tới đúng selected standard model được xét như target đó; cycle/ambiguity/missing mapping từ chối.
- Retry/account fallback chỉ trong accepted standard class vẫn được xét sau predecessor terminal own ACK và fresh budget/authority gate; D1 không cấp quyền từ graph cũ cho successor.
- Không sửa graph bằng cách silently bỏ member, không bypass/zero-cost, không đưa accounting refusal vào provider cooldown/fallback.
- Áp dụng khi có server-owned accounting admission trong phạm vi được bật; key thường/no-key giữ routing hiện hành. Trong child chỉ dùng private isolated activation. **Không bật enforcement trên DB thật từ quyết định này.** Trước activation, R/M1 phải chứng minh entry activation không cho budget-key rơi xuống ordinary path do thiếu fixture association.
- Với graph ngoài scope, acceptance là **0 inference POST và 0 debit**, không chỉ status lỗi. Không coi refusal là delivered provider coverage.

## D2 — Reference tariff cho OAuth/subscription

- Dùng resolver reference pricing hiện có: manual override hợp lệ và complete-source precedence hiện hành, immutable original snapshot, exact nanoUSD math; không tự đổi bundled/catalog prices từ tài liệu web.
- `codex → openai`, `claude → anthropic` là reference mapping, không bằng chứng actual provider bill hoặc miễn phí subscription. UI/docs gọi **chi phí quy đổi để trừ budget (USD)** / reference cost, không hóa đơn thực tế.
- Thiếu exact model price/rate category/unit hợp lệ thì từ chối trước inference POST. Không chia phí subscription theo token, đoán từ output, hoặc ép unknown thành 0.
- Raw usage có cache-write, tier hay unit mới cần semantic authority riêng. D2 không tự approve cách quy đổi `codex_rollout_budget_units` hoặc 1M/fast premiums.

## D3 — Child đầu: R2-S1 Codex standard Responses

- [Child R2-S1](../../261101-0716-m1-codex-standard-accounting/plan.md) là child được chọn để lập chi tiết, chưa implement.
- Ingress positive: `/v1/responses`, `/v1/chat/completions`; actual provider `codex` (`cx`), OAuth, standard HTTP Responses SSE; client stream hoặc JSON từ forced SSE.
- Giữ shared ledger, price snapshot, own intent/terminal ACK, budget tuần/tháng Asia/Ho_Chi_Minh. Không reservation/hard cap, không ledger riêng, không thêm debit trên conversion.
- Chốt manifest exact models/wire/schema từ phase 1 trước runtime implementation; không support bằng `provider === codex` hoặc regex tên model. Candidate core models và unknowns nằm trong inventory.
- Anthropic API key (`anthropic`) và Claude OAuth (`claude`/`cc`) vẫn là required M1 follow-ups, không được đóng bằng R2-S1.

## D4 — Composition child đầu

**Nhận để thiết kế và kiểm chứng:** text, reasoning (gồm encrypted reasoning continuation khi contract chứng minh), client function-call definitions/calls/results; native Responses và Chat→Responses conversion; retry/refresh/account fallback trong selected accepted standard class.

**Hoãn ở child đầu, không loại khỏi M1 vĩnh viễn:** Lite, compact, hosted paid tools/search/fetch/code/MCP/custom hosted tools, media/remote image, priority/fast/service-tier premiums, 1M/review/auto-review variants, combo/Fusion/nested/smart/capacity expansion sang path khác, Claude API key/OAuth implementation. Budget-key phải bị từ chối trước POST; ordinary-key availability không đổi. Input chỉ chứa text nhắc đến tool/media không phải tool/media invocation; classification dựa structured fields/actual route, không keyword.

Không có quyết định giảm platform support: Bun/better/Windows và các R/security/build/performance gates giữ nguyên. D4 chỉ giảm child đầu; trước R/M1 phải có disposition cập nhật cho compositions thực sự intended, không tự suy mọi deferred row là N/A cuối milestone.

## D2-W — Aggregate Codex reference cache-write, 2026-11-02

User chọn **“Chấp nhận P-W”** trong questionnaire follow-up: toàn bộ observed cache-write W được định giá bằng một `cache_creation` rate trong original complete reference snapshot, theo precedence/fallback hiện có; không mô phỏng TTL upstream và không map 30m/12h vào local 5m/1h. Đây là reference budget cost, không actual subscription bill. Không đổi giá hoặc mở client cache options/premiums ngoài D4. Producer inclusion/partition, missing/null semantics và B01–B03 vẫn phải có evidence; không coi missing W là 0.

P-E (exact-money với incomplete breakdown) **chưa được duyệt**. User đồng thời chọn **thiết kế thử nghiệm** để duyệt riêng; chỉ authorize soạn [protocol](../../261101-0716-m1-codex-standard-accounting/references/g0-experiment-protocol.md), không chạy inference, thu thập credentials/capture, sửa runtime, đọc host DB/log/token hoặc production activation. Thiết kế không hứa hard spend cap khi selected upstream chưa có enforceable output/quota bound. Sau đó user chọn Terra-first và đồng ý viết standalone collector + offline tests (section0 protocol); không authorize live adapter/launcher, credentials hoặc provider run. Đây là exception scoped cho collector/test files, không mở G0/application runtime phases.

## Trạng thái sau quyết định

| Hạng mục | Kết luận |
|---|---|
| Product policy D1–D4 + D2-W | Đã chốt cho thiết kế child đầu; P-E chưa duyệt |
| Static selected-path inventory | [Đã ghi](./m1-selected-path-inventory.md), không runtime certification |
| Codex cache-write/rollout units, selected exact manifest/contract | Hard gate phase 1; chưa chứng minh đủ để cook toàn child không dừng |
| R2-S1 implementation | Pending; cần authorization riêng |
| Claude API key/OAuth và deferred compositions | Follow-up, không accepted |
| R/M1, platform/release/security/production activation | OPEN/OFF |
