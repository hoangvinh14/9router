# Scope matrix, guarantee dispositions và decision register

## Authority

[B01–B08 + §8](../../261113-1952-api-key-budget-scope-audit/references/brainstorm-contract.md) là starting spec. [D1–D4/D2-W](../../261018-0213-api-key-budget-roadmap/references/m1-decisions.md), [historical selected path inventory](../../261018-0213-api-key-budget-roadmap/references/m1-selected-path-inventory.md), [M1 current decisions](../../261101-0716-m1-codex-standard-accounting/plan.md) là retained decision evidence, không tự biến toàn E0–E6 thành backlog mới. Những tài liệu cũ nói không authorize turn cũ không phải permission cho turn này; plan không tự cấp implementation authority.

## Support matrix — target khác eligibility

**Chưa có positive cell nào được certify bởi phiên lập plan.** Mỗi cell cần exact model/version/auth/effective request/usage/price/transport/output semantics và source provenance. Phase01 tạo machine-readable finite manifest; không wildcard provider/model regex, không import cả catalog và gọi supported.

| Cell | Intended scope / ingress / auth | Compositions và output | Disposition / gate |
|---|---|---|---|
| C0 — first vertical cell | Chọn một exact model ở Codex OAuth **hoặc** Claude Messages API-key/OAuth sau compare evidence; không chốt model nhờ dễ làm fixture | Một exact supported native request qua shipping route, client SSE và JSON khi applicable; direct secure transport trước | Selection pending P1–P4/owner scope; chọn một cell trước không bỏ C1–C4. Nếu không cell đủ evidence thì phase02 positive BLOCKED |
| C1 — Codex standard | `/v1/responses`, `/v1/chat/completions` → actual `codex`/`cx`, OAuth standard HTTP Responses SSE | Text, standard reasoning/public summary, client function definitions/calls/results, **encrypted continuation retained requirement**; forced SSE→client JSON; required Messages→Codex ingress không được silently drop | Original intended IDs `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-daybreak-blue-latest`, `gpt-reserve` retain individual blocked/eligible rows, không auto-swap với master new IDs. Luna/Terra roles historical verification, không eligibility |
| C2 — Anthropic API key | `/v1/messages` qua `anthropic`, native Messages JSON/SSE | Text/client functions/results; retained thinking/history và required Chat/Responses conversions phải có per-cell fidelity/evidence | Required follow-up; official API docs không chứng minh Claude OAuth; missing cache-tier semantics/pricing vẫn block |
| C3 — Claude subscription OAuth | `/v1/messages` qua `claude`/`cc`, subscription access-token identity | Native Messages JSON/SSE, client functions/history; session/cloaking/beta/header transformations và token refresh; same reference money invariants | Required follow-up, không infer từ model prefix hoặc API-key C2 evidence |
| C4 — supported transitions | C1–C3 supported exact class | Proactive/reactive 401/403 refresh, HTTP retry, owned SSE transient retry, next-account fallback; direct alias cùng accepted target | Positive delivery required; precursor terminal own ACK + fresh gate + successor intent own ACK; P2 finality can block retry even if success path known |
| C5 — graph/composition ngoài positive support | Combo/Fusion/nested/smart/router/classifier/judge/capacity expansion, Lite/compact, hosted paid tools/search/MCP, media/remote images, review/1M/premium tiers, dynamic compatible/reseller paths | Refuse **entire request** trước POST/remote prefetch/helper inference; không bỏ member rồi route phần còn lại | Không positive delivery ở first slice, không universal final de-scope; explicit disposition trước target completion. Ordinary keys giữ routes |
| C6 — other billable endpoints | Embeddings, images/videos/audio/search/web fetch, Gemini native APIs/alternate aliases, internal dispatch via public route | Budget-key explicit pre-POST refusal trừ khi có accounted accepted profile | Positive standalone embeddings không auto-import; không lỗ bypass qua endpoint khác. Budget refusal không provider cooldown/fallback |
| C7 — non-billable/control | Models/read-only metadata, count_tokens, health và management | Phân loại từ **actual implementation**, không tên endpoint. Có network/billable work thì apply closure/refusal; management dùng admin session riêng | List/read có thể allowed theo auth/ACL; count_tokens không tự mặc định free. Client key không admin authority |

Mỗi manifest row gồm: canonical client/logical/reference/wire model identities; exact producer auth/profile/version; source claim; input allowed fields+continuations; effective wire+headers+URLs/proxy; counters inclusion/null/missing; all tariff dimensions; success/failed/late finality; supported ingress/output; status eligible/blocked/refused; test selectors. Master model refresh **không** tự enroll new budget models. Required model removed upstream → ghi explicit unavailable target và xin disposition, không tự giảm target.

## Old guarantee → fresh-plan disposition

| Old item | Disposition trong plan | Invariant/decision phải giữ |
|---|---|---|
| Stable binding, one ledger, attempt CAS/idempotency, immutable price, exact nanoUSD | **RETAIN** | B01/B05/B07. Không thay bằng analytics raw-key totals/floats; no destructive history/import |
| HCM weekly/monthly, independent applicable limits, recorded-spend overshoot | **RETAIN** | B02/B03; pending **không reserve**, original start window cho late settlement, fresh window gate trước POST |
| D1 graph no-bypass, unsupported 0 POST | **RETAIN** | B03/B08 ở all reachable budget routes; helper classifier/judge và retries không exception |
| D2 reference valuation/manual precedence + D2-W aggregate cache-write rate | **RETAIN** | OAuth local reference USD không invoice/quota; D2-W không cho default missing W=0. Price exact endpoint/model/category; rollout units không tự đổi USD |
| Known spend/policy durability, writer ownership, own durable intent+terminal ACK | **RETAIN** | Transactional/durable publication trước authority; row existence không ACK; stale/copied ACK không dispatch |
| Sidecar/tombstone/generation/restore protocol | **RETAIN until approved equivalent replacement** | Candidate DB-centric simplification chưa approved. Phase01 phải compare integrity/import/backup/retirement effects và gate change; không chỉ bỏ dependency để giảm files |
| Degraded-storage unlimited continuation/persisted read-only authority | **APPROVED CHANGE — Validation Session 1 / D03** | Fail-closed mọi accounting-controlled path, gồm unlimited identified accounting keys, khi recording/storage unhealthy. Chỉ remove dedicated continuation/read-only branches sau dependency/migration review; retain known truth/durable safety. Ordinary keys genuinely outside accounting giữ compatibility, không hứa miễn ảnh hưởng global DB |
| Broad config snapshots | **ADAPT conditionally** | Could selected dependency versions + final gate replace; vẫn preserve ACL/policy/credentials/selected endpoint/proxy/price drift. Chưa chứng minh equivalent thì giữ/review existing boundary |
| Optional catalog sync/scheduler/dashboard | **NOT AUTO-ADMITTED** | Snapshot/resolver vẫn cần; giữ persisted synced/manual rates và precedence. Không schedule background jobs chỉ để close old plan; omission shipping mechanism khác xóa saved data |
| Standalone embeddings/all-provider positive coverage | **NOT AUTO-ADMITTED** | Fresh target Claude/Codex; unsupported budget key endpoints refuse trước POST. Không gọi refusal là embeddings support |
| Exact old models/encrypted history/failed usage/owned SSE retry | **RETAIN, evidence-blocked where applicable** | Owner từng giữ scope; không nâng narrower strict helper profile thành scope approval. Need exact evidence hoặc separate owner change |
| E2 post-process-death acquisition/recovery | **REMOVE obligation — already owner-accepted limitation** | Possible undercount explicit; durable known truth/live received valid late evidence/original key-price-period/ACK/restart vẫn retained. No service/new recovery product |
| E3 native isolation và E4 timeout | **Nghiệm thu có giới hạn theo quyết định 2026-11-26** | Một ca native đồng thời, một lượt kiểm CONNECT và lưu trữ trên cấu hình đích. Điều tra khi lỗi tái hiện. |
| Platform support Node + SQL.js/Bun/better-sqlite3/node:sqlite + Windows/build/performance | **End-to-end trên Docker Linux amd64** | Dùng bằng chứng persistence và build đã có theo từng runtime. Mở nghiệm thu end-to-end bổ sung khi rollout đòi hỏi runtime khác. |
| Collector/login/evidence tooling và historic E0–E6 receipts | **REFERENCE/ARCHIVE, not shipping dependencies** | Không run collector/research/live tự động, giữ immutable receipts; tests selectively reuse only matching inputs |
| Production activation/ledgerStartedAt | **DESIGN missing; separate rollout authority** | Shipping-path enablement tested trong disposable instance không host production activation. Finite save readiness tied real installed coverage, not fixture capability |

## Phạm vi đã kiểm tra và bằng chứng còn thiếu

- C0–C4 có kết quả trên các profile và model cụ thể trong [Phase 03](../phase-03-native-retry-and-compatibility.md#chốt-nghiệm-thu-tích-hợp). Giá được chọn theo snapshot bên ngoài. Ngoại lệ `gpt-reserve` và Claude OAuth mất usage cuối được owner chốt ở đó. C5 cần disposition theo tổ hợp ngoài profile đã nghiệm thu. Refusal đã được kiểm tra cho compact, một số helper strategy/capacity và route reconstruction. [Phép kiểm bổ sung](../phase-05-acceptance-and-handoff.md#kiểm-chứng-offline-ngày-2026-11-26).
- **Tổ hợp C5 đã đối chiếu.** Nested fallback qua alias đã ghi chi phí và chặn ở đúng hạn mức. Smart/Fusion và capacity expansion trong fixture route readers bị từ chối trước chọn account. Codex compact bị từ chối cho key có budget ở đường reconstruction. Paid tools và content block ngoài profile SSE Anthropic bị từ chối trước transport. Các ca này xác nhận hành vi hiện tại của từng fixture. Codex Responses SSE đã kiểm tra thêm hosted search/MCP, ảnh URL và priority. Các biến thể ở profile khác, review/1M và dynamic compatible/reseller còn cần đối chiếu. [Kiểm chứng bổ sung](../phase-05-acceptance-and-handoff.md#kiểm-chứng-offline-ngày-2026-11-26).
- **Đồng thời.** Dùng một ca HTTPS loopback native với hai key, hai connection và usage khác nhau. Cho request gửi sau hoàn tất trước, đối chiếu account/session trên wire và khoản ghi vào từng key. Yêu cầu tạo phép thử riêng cho việc đọc trạng thái muộn đã được bỏ khỏi tiêu chí đóng plan.
- **Timeout.** Chạy một lượt ca CONNECT và lưu trữ hiện hành trên cấu hình đích. Nếu timeout tái hiện, lưu log theo từng giai đoạn và xử lý trước khi đóng. Nếu ca đạt, ghi kết quả lần chạy. Hồ sơ lịch sử tại ref `7a4f3a3e`, tệp `plans/261101-0716-m1-codex-standard-accounting/references/remaining-items-owner-review.md`, vẫn ghi CONNECT 1.040 ms so với ngưỡng 1.000 ms và SQL.js close/crash/JSON/rename vượt 5.000 ms. Nguyên nhân lịch sử vẫn chưa xác định.
- **Runtime.** Nghiệm thu end-to-end trên Docker Linux amd64 với adapter của cấu hình đích. Windows x64 có persistence và standalone build. Linux x64 có persistence trên `node:sqlite`, SQL.js, Bun và `better-sqlite3`. [Kết quả theo runtime](../phase-04-integrity-and-migration.md).

## Đối chiếu các model Codex đã giữ trong C1

Ngày 2026-11-26, bộ phân tích giá của 9Router đọc bảng ChatGPT Work and Codex models từ [OpenAI](https://help.openai.com/en/articles/20001415-chatgpt-rate-card-enterprise-token-based-pricing). Cả sáu ID có trong [registry Codex](../../../open-sse/providers/registry/codex.js). Bảng dưới ghi USD trên một triệu token và khoản debit với 100 input (40 cached) và 25 output.

| Model | Input | Cached input | Output | HTTPS loopback |
|---|---:|---:|---:|---|
| `gpt-6-astra` | 10.00 | 1.00 | 50.00 | 1.890.000 nanoUSD |
| `gpt-5.6-sol` | 4.00 | 0.40 | 20.00 | 756.000 nanoUSD |
| `gpt-5.6-terra` | 2.00 | 0.20 | 12.00 | 428.000 nanoUSD |
| `gpt-5.6-luna` | 0.20 | 0.02 | 1.20 | 42.800 nanoUSD |
| `gpt-daybreak-blue-latest` | 4.00 | 0.40 | 20.00 | 756.000 nanoUSD |
| `gpt-reserve` | — | — | — | Khi còn hạn mức, một POST và một terminal 0 nanoUSD. Tại hạn mức, 0 POST. |

Ca xác minh tạm trên source ứng dụng `6fcc3cd3` nạp năm dòng giá đã đọc vào fixture Codex. Responses SSE gửi đúng ID qua HTTPS loopback, ghi tổng 3.872.800 nanoUSD vào cùng key và chặn lượt sau ở đúng ngưỡng. Credential và usage thuộc fixture. Tình trạng model trên từng tài khoản thật thuộc rollout.

Cùng lượt kiểm thử, Responses SSE của Codex từ chối `web_search`, `mcp`, ảnh URL và `service_tier: priority` với HTTP 503, không tạo intent và có 0 lượt gửi inference. Toàn suite `run-composed.mjs --tls` đạt 104/104 khi có ca xác minh tạm. Phần review/1M và dynamic compatible/reseller còn cần đối chiếu riêng.

## Decision register

Không hỏi lại settled §8. **Current continuation:** A0 completed per [phase00 record](./phase00-execution.md); D01–D04 approved Session 1, implementation protocols still gated; D05/D06 và P1–P4 unchanged. Owner automatic continuation covers approved offline/static plan work; A1 exact sandbox runner/commands still must be reviewed/admitted before runtime execution. No live/production authority. [Phase01 partial design](./phase01-boundary-design.md) proposes protocols without declaring them implemented or accepted.

<!-- Updated: Validation Session 1 - approved policy/lifecycle changes; conditional gates remain -->

| ID / owner | Decision / status | Blocking scope / cần output |
|---|---|---|
| A0 / owner | **COMPLETED continuation:** reviewed preservation + owner no-backup disposition exclusions, exact master fetch and normal integration switch, docs/tooling commit `5b1fc863…` | External receipts and [phase00 execution](./phase00-execution.md); no service stop/private backup/deletion implied |
| D01 / owner + implementer | **APPROVED Session 1:** normal/error missing/malformed/contradictory usage → unresolved NULL + safe error/status, block affected key until authorized resolution; preserve known cost. Add minimal authenticated audited CAS admin recovery for unresolved | Phase01 designs bounded operation/actor/reason/evidence/idempotency/version contract; phase02 shipping API/UI recovery, phase04 faults. B1/E2 interrupted-no-evidence remains unrecorded/may-undercount, not zero claim, no required post-death recovery |
| D02 / owner + implementer | **APPROVED Session 1:** unpriced/invalid tariff → deterministic pre-POST refusal; estimates separate, not exact authoritative debit | Ngoại lệ được owner chốt ngày 2026-11-26 áp dụng riêng cho Codex OAuth Standard `gpt-reserve` và tính 0 nanoUSD. Các model khác giữ quy tắc D02. [Tiêu chí nghiệm thu](../phase-03-native-retry-and-compatibility.md#ngoại-lệ-gpt-reserve-ngày-2026-11-26). |
| D03 / owner | **APPROVED Session 1:** recording/storage unhealthy → fail closed every accounting-controlled path including unlimited identified keys; no unauthorized successor; ordinary behavior preserved only if genuinely independent | Phase01/02 remove old dedicated unlimited continuation only through admitted dependency/migration change; retain health latch, durable known truth and own ACK safety |
| D04 / owner | **APPROVED Session 1:** rename + verified authorized secret rotation keep stable ID/policy/spend/history; delete retires binding/history; no ID reuse or automatic purge | Phase01 new explicit rotation/binding protocol (donor currently rejects changed fingerprint), phase02 minimum operation, phase04 import/backup/fault tests. Legal retention duration remains separate rollout gate; never invent purge deadline |
| D05 / owner nếu đổi guarantee | DB-centric sidecar replacement/selected config versions only after equivalent invariant proof | Phase01 dependency admission; migration/read/write/import/export/restore semantics, smaller alternative comparison. Không approval → retain existing invariant/mechanism or stop if closure cannot bound |
| P1–P4 / producer evidence owner | No guessed counter-zero/model/profile/failure cutoff/tariff | Phase01 exact evidence manifest; selected positive support/retry phases blocked nếu thiếu. New named source/version/claim needed, not repeat broad audit |
| D06 / owner | Initial direct secure transport, strict saved HTTP CONNECT follow-up; refuse unproven proxy/env/relay/SOCKS/premiums on budget paths | Không thay ordinary transport; retained intended support cells outside initial set remain pending, require disposition before whole-target completion |
| A1 / owner + implementer | Owner permits automatic approved-plan continuation; runtime/test execution remains conditional on exact sandbox/code/command admission; production rollout/live inference separate | No runtime imports/tests/build executed in continuation. Review fail-closed isolation and exact selectors before any launch; no host fallback, real refresh, deployment/push |

## Failure/accounting outcome distinctions (D01–D04 approved Session 1; detailed protocol pending)

1. Before exposure refusal/cancel: no inference POST, no monetary debit; intent nếu đã persisted thì terminal not_dispatched có proof.
2. Valid exact priced usage received (success hoặc eligible failure): debit original attempt once, even after downstream cancel/disposal. Trả client terminal success chỉ theo protocol/own ACK; monetary settled không biến provider error thành success.
3. Interrupted after exposure **without usable evidence**, accepted B1/E2 limitation: unrecorded/NULL, explicit may-undercount, không auto call free; không tạo mandatory post-death recovery. Không dùng classification này cho malformed/normal-completed-without-usage/storage/auth failures.
4. Unknown/malformed/conflicting normal/error evidence: approved unresolved safety, unknown != zero. Không overwrite previous durable known spend với NULL/zero để clear failure. Minimal shipping recovery only for unresolved uses authenticated management actor, bounded reason/evidence, idempotent operation ID and expectedVersion CAS; preserve immutable snapshots and label operator adjustment/waiver separately from producer usage. Exact actions/statuses designed phase01; no DB-console recovery requirement. `unrecorded` B1/E2 is deliberately outside required manual recovery and must not be used to classify normal-completion missing/malformed usage. A peer/live owner must never be reclassified as dead: startup recovery only after exclusive writer acquisition, final-close after write-lane stop; preserve owner-lifecycle gates on any port.
5. Lost durability ACK/ambiguous commit: no successor cho đến authoritative resolution; visible row không grant dispatch. Restart đọc durable truth, không resurrect old permission.
