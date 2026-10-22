# Contract gốc — tham chiếu bất biến

[Exact contract bytes](./legacy-design-contract.txt) được lấy bằng `git show 3a4955a0336f970505c325b0faf892f5397c93bb:plans/261003-0827-api-key-quota-budget-pricing/design-contract.md`. Đây là contract đã thống nhất, không phải code đã có trên master mới. Links nằm trong bản text dùng base của plan cũ; tra chúng trong Git cũ, không coi là local links của roadmap mới.

[Checkpoint WIP trước chuyển nhánh](./legacy-checkpoint.txt) được lấy từ tree của stash commit `d515fb4927ed45a5853104406cd0fecca549c04c`, original path `plans/261003-0827-api-key-quota-budget-pricing/plan.md`. Chỉ top checkpoint ngày 2026-10-18 là latest state cũ; chronology phía dưới không tự khởi động thực thi.

## Các quyết định bắt buộc giữ

- Attribution theo gateway key ID, không masked/raw-key/name; mỗi actual có-thể-billable POST có attempt riêng. Không debit lịch sử trước ledgerStartedAt; migration schema không tự stamp coverage.
- Ledger tiền là truth; usage analytics là projection. NanoUSD integer/BigInt/rational, round-half-up một lần mỗi attempt; immutable original price snapshot. Explicit zero khác missing; estimated usage không dùng cho exact debit.
- Durable intent ACK trước POST và own terminal ACK trước eligible terminal; settled row không đồng nghĩa ACK đã delivered. Unknown/abort thiếu exact usage là unresolved/null-cost; duplicate/late không double debit; fresh gate trước successor.
- Budget null=unlimited, zero=block; weekly/monthly cùng hoạt động, reset Monday/day1 theo Asia/Ho_Chi_Minh. Attempt thuộc kỳ startedAt; reset không xóa ledger/unresolved. No reservation/hard cap.
- Unlimited identified keys vẫn record; accounting-unhealthy continuation chỉ sau independent durable gap ACK và verified ownership/identity/config. Không dùng exception để bypass corrupt authority/maintenance. No-key compatibility riêng; không anonymous impersonation.
- Single writer/DATA_DIR; Node/better/Bun/SQL.js đều có obligations durability và crash/restore. Không dùng RAM-success hoặc silent adapter skip làm accepted support.
- JWT hoặc verified direct loopback + login-disabled cho management; auth trước privileged read/body/write/fetch, Origin/CSRF và socket provenance. Giữ ACL mới của upstream cùng các guards này.
- Fixed-source pricing-only models.dev sync, bounded HTTPS/redirect/payload/parser, no credentials; override không bị sync ghi đè, failure giữ last-known-good, scheduler default OFF. Legacy price map compatibility giữ riêng resolver exact.
- Chat mọi client format + embeddings, retry/fallback/capacity/fusion/panel/judge/regeneration, supported OAuth/specialized/binary; chat-embedded media/tools đúng observed schema/unit/original rate. Không meter standalone media/search/fetch endpoints.
- Restore/import/export/key deletion/retention không reset allowance hoặc chuyển identity; audit/CAS/late races/gap generation/tombstones/material theo contract. Không hứa out-of-band antirollback.

Đây là bản chỉ mục đọc nhanh; khi có khác biệt chi tiết, exact contract và các clarification có provenance trong checkpoint cũ là reference. Chuyển thứ tự công việc không waive acceptance. Mọi thay đổi scope/support/consistency/activation phải được user quyết định riêng.
