# M1 — Accounting/budget cho Codex và Claude

## Quyết định có authority — 2026-11-01

Người dùng chọn **accounting/budget**, không giới hạn toàn gateway; Claude gồm **Anthropic API key và Claude OAuth/subscription**. Yêu cầu tiếp theo chỉ cho phép cập nhật plan. Đây là milestone ban đầu M1 thay cho việc đòi toàn bộ provider coverage trước lần nghiệm thu đầu, không tuyên bố toàn sản phẩm hoàn tất hoặc thay đổi support bằng code.

- **Trong phạm vi:** tích hợp accounting/budget cho Codex và hai hình thức kết nối Claude nêu trên, cùng những đường xử lý/phụ thuộc thực sự cần thiết của chúng.
- **Giữ dùng chung:** pricing/snapshot, exact money, ledger/idempotency, own durable ACK, stable key isolation, budget tuần/tháng Asia/Ho_Chi_Minh và UI/API quản trị đã có. Không xây ba ledger hay một implementation cho mỗi model.
- **Hoãn coverage ngoài milestone:** Gemini, GitHub Copilot, các provider/embeddings khác. Không gỡ, disable hoặc sửa khả năng routing hiện có của chúng chỉ từ quyết định này. R1/E1 và P1–P4/B1 giữ nguyên historical scoped completion; không suy Codex/Claude support từ receipts đó.
- **B1 giữ nguyên:** interrupted request thiếu usage dùng được thì bỏ qua, không debit/unknown/recovery blocker. Usage hợp lệ, kể cả failed/late, ghi một lần theo original context. Storage/auth/pricing/malformed evidence không tự được coi là miễn phí. P5 vẫn cancelled.
- **Không tự quyết:** mọi Codex standard/Lite/compact, Claude beta/cache/media/paid tools, conversion, combo/Fusion hay third-party Claude reseller đều chưa mặc định accepted hoặc bị loại chỉ vì tên provider. Phải inventory và ghi disposition trước child implementation/acceptance.

## Inventory và quyết định tiếp nối — 2026-11-01

Đã rà source `develop` tại `08ee1a74954c5fe7a1659a6473e57b6b1ea9059b`, ghi [selected-path inventory](./m1-selected-path-inventory.md), và user chốt [D1–D4](./m1-decisions.md): graph-level refusal trước inference POST cho budget-controlled key; reference pricing hiện có cho chi phí quy đổi subscription; chọn **Codex standard** làm child đầu; text/reasoning/client function tools, hoãn các composition khác ở child đầu. Không thay hành vi key thường.

Đã tạo đúng một [child R2-S1](../../261101-0716-m1-codex-standard-accounting/plan.md). **Chưa implement/activate**; [G0 research](../../261101-0716-m1-codex-standard-accounting/references/codex-standard-contract.md) đã hoàn tất ở mức tìm bằng chứng, verdict partial: reference formula/cache partition/reasoning và rollout-session role đã rõ; không cần rollout→USD. Producer normalization/internal cache, failure-envelope completeness và per-model/effective-profile B01–B03 còn chặn full acceptance; current G0 lock vẫn giữ trước runtime edits. Source inventory không phải provider acceptance. Claude API key/OAuth vẫn required M1 follow-ups; deferred child đầu không tự thành N/A cuối M1.

## Phân rã kế hoạch hiện hành

| Owner | M1 disposition |
|---|---|
| P1–P4/B1; R1/E1 | Giữ completion trong phạm vi đã ghi; chỉ reuse evidence khi revision/inputs còn phù hợp |
| X1/R2 | Inventory đã ghi; R2-S1 Codex standard được chọn để lập child, pending G0/implementation; Lite/compact deferred ở child đầu |
| X1/C1 | Áp dụng cho conversion thật sự reachable bởi selected Codex/Claude paths; không thêm owner/debit thứ hai |
| X1/R3/R4/E2/E3/E4 | Hoãn ngoài M1; nếu discovery tìm prerequisite thực sự dùng bởi selected path, đặt tên và resolve trước acceptance, không blanket support |
| X2 | Claude Anthropic API key + Claude OAuth/subscription; actual default/beta/stream/cache/tool compositions phải được phân loại |
| X3 | Gemini coverage hoãn; exact Gemini embeddings schema blocker E3 vẫn giữ cho broader coverage |
| X4 | Chỉ named transport/auth/parser prerequisites của selected Codex/Claude; provider khác hoãn |
| X5 | Retry/refresh/account/model fallback, transport/proxy, cache/unhealthy và authority seams reachable bởi selected paths vẫn bắt buộc |
| X6 | D4 hoãn combo/Fusion/nested ở child đầu; D1 phải từ chối trước mọi router/panel/judge POST. Applicability cuối M1 vẫn cần disposition, không implicit waiver |
| R | Nghiệm thu M1 theo 13 AC với explicit applicability/disposition; broader all-provider acceptance vẫn OPEN |

Một actual inference POST có một raw accounting owner; các đường thực sự tương đương được gom nhóm, khác auth/retry/schema không tự kế thừa coverage. Client endpoint/model label không phải admission proof. Anthropic API key và Claude OAuth cần positive evidence độc lập; OAuth token refresh không tự là inference charge.

## Các quyết định/blocker trước readiness hoặc activation

1. **Selected-path inventory:** static inventory đã ghi ở link trên; R2-S1 còn G0 exact model/effective-wire/raw-usage/units gate, Claude follow-up contracts và selected prerequisites chưa accepted. Inventory không thay positive runtime evidence.
2. **Routing ngoài coverage:** D1 đã chọn **từ chối toàn graph không an toàn trước inference POST đầu tiên**; chưa implementation/acceptance. Không silently bypass/synthetic zero hoặc đổi key thường. Smart classifier/compact/alternate ingress phải có zero-POST controls; production vẫn OFF.
3. **Giá OAuth/subscription:** D2 dùng reference resolver/snapshot hiện có; gọi chi phí quy đổi để trừ budget, không actual provider bill. Thiếu giá/category/unit hợp lệ từ chối; không tự đổi rates từ docs hoặc đoán rollout-unit tariff.
4. **Composition decisions:** D3/D4 đã chọn Codex standard text/reasoning/client tools cho child đầu. Lite/compact/hosted tools/media/premiums/1M-review/combo/Fusion hoãn ở child này với pre-POST refusal bắt buộc. Claude beta/cache/tools và final-M1 applicability tiếp tục cần child/disposition; raw usage/rate authority chưa rõ vẫn là named blocker.
5. **Release safety:** adapter/platform set, auth/CSRF/ACL/key isolation/secrets/SSRF/proxy, known-spend durability, restart/migration/retention, performance và build/serving/UI vẫn cần evidence phù hợp. Không loại Bun/better/Windows obligations chỉ vì thu hẹp provider; nếu đổi supported platform cần quyết định riêng. Legacy presentation persistence exclusions/historical data-access uncertainty không tự được đóng bởi M1.

## Thứ tự tiếp theo — chỉ planning, chưa cook

1. Inventory, reusable evidence và D1–D4 đã ghi; không rerun runtime để lấy lại context. Recheck relevant source hashes khi chuyển sang execution.
2. Review [R2-S1](../../261101-0716-m1-codex-standard-accounting/plan.md); đóng G0 contract/manifest trước runtime implementation. Chưa unconditional cook-ready; thiếu authority thì báo field/model blocker, không synthesize support.
3. Implement chỉ khi có user authorization riêng; mỗi child tự đạt focused + actual dummy-upstream + affected gates. Runtime accounting bắt buộc qua `node tests/fixtures/accounting/run-isolated.mjs <unit paths>`; không ordinary Vitest/real DB/provider.
4. Đóng selected-path prerequisites/composition và R/M1 finite release gates. Milestone DONE không đóng các envelope coverage đã hoãn; production activation/deploy/ledgerStartedAt là quyền riêng.

## Tiêu chí hoàn tất cập nhật plan này

Roadmap, scope-map, X1/X2/X3–X6 dispositions, owner map và R nhất quán với M1; giữ lịch sử, không biến deferred thành completed hoặc thay original contract. Đây là documentation validation, không runtime/security/product acceptance. Không code, migrate, test real DB, commit/push/deploy hay activation từ lượt cập nhật này.
