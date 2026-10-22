# Planning validation — 2026-10-18

## Phạm vi kiểm tra
Review trực tiếp trong phiên, không delegated/independent review. Deep-style planning: next P1 chi tiết, future scopes chỉ outline; không external research/model calls. Không hỏi lại settled product decisions, không có scope/support/authority change được âm thầm áp dụng.

## Evidence và findings đã xử lý
- CLI `ak plan validate <dir> --json --no-interactive`: **13/13 format hợp lệ**. Đây chỉ format check, không acceptance hoặc khả năng chạy product.
- P1 `ak plan parse`:3phases/10exit checkboxes/pending; parser percentage0 không product progress.
- Local link/path/dependency sweep: all13plan directories tồn tại, blockedBy targets có thật, graph không cycle; old frozen .txt links dùng old base như wrapper giải thích.
- Contract .txt byte-exact với Git cũ, SHA256 `2b186040564ffbc826d2f9e865da75c7b09a345a343bb3ac7fa109ad667ceacf`.
- Checkpoint .txt byte-exact với stash tree, SHA256 `9d739f1877cf8896ce38da479ca50cad3d9093402f6709672d9635131c8cb3ed`.
- File/test claims phân biệt **current** và **planned port**. Caught `pricing-route.test.js` chỉ ở old branch, không master; sửa baseline command sang current `provider-pricing-minimax-m3`, `key-access`, `key-access-migration`. Các planned P1 test paths đã kiểm tra tồn tại Git cũ, chưa runnable trên master.
- Caught shorthand dễ hiểu sai depth64; đã sửa thành depth16/bound64 routing-node occurrences, không cap POST.

## Review theo bốn góc nhìn

| Góc nhìn | Evidence / quyết định |
|---|---|
| Assumptions | Pricing old imports accounting config; cache adapter seam absent current. P1 phase1 phải resolve dependency bằng minimal manifest, không whole-driver cherry-pick. Không khẳng định port feasible trước seam check. |
| Failure | Old setup PASS không actual ACK/POST proof; nested/bytewise blockers giữ. Diagnostic finite hypothesis/stop; no harnesschain/rerun-for-green. |
| Scope | Old B vẫn quá lớn; tách P2/P3 và envelopes X1–X6 bắt buộc tạo child plan một owner/composition trước code. P1–P5 scoped closure không full AC; scope-map13AC + B1–B7/IO/QF GTIV/CDE không bỏ obligations. |
| Security | New per-key ACL/schema fields giữ qua key UI/migration/import; auth/CSRF/trusted peer/catalog SSRF/strict proxy/no credentials/own ACK không giảm. Stash/DB không được apply/open trong planning. |

## Whole-plan consistency sweep
- Các plan index, phase details và references đã đối chiếu: pending, chỉ P1 detailed; proposed branch chưa tạo; code không nằm master; old A closure historical, all13AC integrated vẫn OPEN.
- Dependency P1→P2→P3→P4→P5, owners X1–X6 và R rõ. Named X5 prerequisite trước P3 không phụ thuộc ngược P3; whole X5 closure vẫn chờ owner evidence. Adapter safe primitives P2, procedures/parity P5/R, không defer bắt buộc runtime safety.
- Pricing interface contract tests P1 không giả actual inference consumption; P2/P3 phụ trách consumption. Snapshot cache chưa verified eligibility thì không cache; không tạo ledgerStartedAt hay bật enforcement/scheduler để demo.
- Không placeholders template. Relative links được kiểm tra; source/index diff clean, HEAD/stash hashes giữ nguyên. Chỉ docs plan/journal mới dự kiến.
- Không mâu thuẫn còn mở trong **planning scope**. Chưa chứng minh implementation feasibility/performance; không routine approval interview khi không có consequential missing choice.

## Giới hạn / quyết định thực thi tiếp theo
- **Chưa chạy** baseline tests, install, build, browser, matrix, inference hay DB. Deps installed và adapter/runtime/browser availability phải kiểm tra khi implement; không clean tool claim từ Marksman silent/inconclusive.
- P1 phase1 là next executable preparation **khi user yêu cầu triển khai**. Pricing isolation decision, exact impacted consumers và runtime comparator validity còn discoverable tại phase đó; đây là gate rõ, không được coi đã pass.
- Không tính ETA tổng. Không có commit/push/merge/production activation hoặc thay đổi scope/support được cho phép từ plan creation.
