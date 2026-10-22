# Scope map — không cắt nghĩa vụ để làm plan nhỏ

## 13 AC gốc → owners
Các số giữ nguyên brainstorm gốc. Bảng này là traceability, **mọi AC vẫn OPEN ở mức whole-product**; không checkbox percentage.

| AC | Nghĩa vụ | Plan chính / composition |
|---|---|---|
| 1 | Stable key ID, hai keys không gộp masked prefix/rename | P2/P3; P5 binding/restore; R |
| 2 | Weekly/monthly đồng thời, key isolation | P4; R trên toàn supported owners |
| 3 | Calendar Asia/Ho_Chi_Minh, short month/year/restart | P4; P5 restore; R |
| 4 | Unlimited/no-key compatibility, không enforcement ngầm | P3/P4; X5 gap exception; R |
| 5 | Chat JSON/SSE/Messages/Responses/Gemini, embeddings, fallback/fusion | P3 + X1–X6; R inventory closure |
| 6 | Idempotency/cache-read/cache-write/reasoning không double-charge | P1 price math; P2/P3 states; X1–X4 schema; P5 recovery |
| 7 | Concurrency/in-flight overshoot, không hard cap | P2/P3/P4; X5/X6; R load |
| 8 | Disconnect/abort/missing usage/pricing/storage, no silently free | P2/P3/P5; X1–X6 actual owners |
| 9 | Sync/override/mapping/units/last-good/original prices | P1; X1–X4 typed extensions; P2/P3/P5 snapshot consumption |
| 10 | Migration/retention/restart, các SQLite adapters | P2/P5; R parity |
| 11 | Management auth/validation/no raw key/no local-refusal cooldown | P1/P2/P4/P5; X5 transport/ACL; R cross-feature security |
| 12 | UI config/spend/remaining/reset/pricing/enforcement/scope | P1/P4/P5; R whole-feature browser |
| 13 | Focused/lint/relevant regressions, comparator integrity | Từng slice; R full/composition |

## Old roadmap obligations → tiếp nhận

| Old package/packet | New owners |
|---|---|
| A reference pricing đã đóng lịch sử | P1 port/compatibility; không claim current pass từ old closure |
| B1/B6 owners/raw/original-wire/native terminal | P3; X1–X4; X6 terminal ownership |
| B2 generation retry/fallback/capacity/routing | P3 path prerequisite; X5 mở rộng; X6 regeneration |
| B3 nested/concurrent/late-owner | X6; P3 two-key primitive |
| B4 unhealthy-unlimited | P2 coverage primitives; X5 actual authority/gap exception |
| B5 transport pool/global/env/relay/SOCKS | X5; từng owner X1–X4 giữ actual transport |
| B-IO group commit/cache | P2 own ACK/CAS; P1 immutable price revision; X5 response-hit semantics; R matched load |
| B7 inventory/current evidence | Mỗi owner; R full inventory/security |
| C weekly/monthly/API/key UI | P4; native extension X1–X4; R full scope |
| D recovery/restore/adapters | P2 safe prerequisites; P5 procedures/parity; R release |
| E regression/security/performance/runtime/docs | Mỗi slice affected gate; R integration |
| Q finite queued slice cũ | Reuse proof/input có điều kiện, map P2/P3/X1–X5; không rerun để đếm xanh |
| F raw schema/media/tools + performance blocker | X1–X4 protocol semantics; X3 bytewise; R overhead/load; không waived |
| G generation/routing/concurrency | X5/X6; P3 selected path |
| T transport | X5 + owner boundary |
| I unhealthy exception | X5 + P2/P5 gap protocol |
| V affected validation/group integration | Từng slice actual/affected gates; R release composition |

## Giới hạn coverage inventory
Master mới đã có Bedrock, MiniMax Code, Nous và GitHub embedding/ACL/routing changes. X4/X1 phải inventory actual paths và dependency/rate authority, không tự gán accepted support từ tên provider. Envelope X1–X6 được phân rã thêm trước execution; mọi remaining obligation vẫn phải có owner/blocker. New future upstream changes được đánh giá impact, không tự hút feature ngoài scope; thay đổi supported set cần quyết định rõ.

## Những gì không đổi
No-history debit; monetary exact/zero-vs-missing; ledgerStartedAt đúng activation; per-attempt original price/own ACK; calendar/unresolved semantics; single writer/adapters; bound64/depth16 routing contract; late fusion sinks/quorum/grace; paid embedded tools; managed restore/audit/identity/gap protocol. [Exact source](./legacy-design-contract.md).

Không thay 13 AC bằng AC dễ hơn cho từng slice. Scoped DONE có giá trị giao hàng độc lập nhưng không đồng nghĩa release/full-feature DONE.
