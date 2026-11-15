# Audit: develop có đi quá mục tiêu API-key budget không?

Ngày: 2026-11-13. Chuẩn đối chiếu: [brainstorm-contract.md](./brainstorm-contract.md), B01–B08. Đây là **static comparative review**, không phải runtime verification hay lệnh bỏ code cũ.

> **Owner update sau audit:** chọn **branch integration mới từ master đã sync remote, trong cùng checkout, không worktree riêng**, và selective port từ develop. Không viết lại toàn bộ trước rồi nhập core cũ. Đây là quyết định mới cho cách tiếp tục, không phủ nhận source findings bên dưới. Đọc [contract section 8](./brainstorm-contract.md#8-owner-selected-branch-strategy-and-context-reset-handoff) và [branch handoff](./branch-handoff.md) trước khi lập plan. Audit baseline/hashes bên dưới là lịch sử tại revision đã ghi, không tự nâng thành review của master vừa sync.

## 1. Kết luận và đề xuất

**Có phần scope và cơ chế rộng hơn nhu cầu vừa chốt, nhưng nền tảng chính không đi sai mục tiêu. Đề xuất: giữ nền tảng và đơn giản hóa có chọn lọc; chưa có đủ căn cứ để bỏ toàn bộ develop và làm lại từ master.**

Phân biệt hai loại gap:

- **Gap về ý tưởng/nền tảng: không lớn trong các seam đã đọc.** Thiết kế core được kiểm tra có vẻ phù hợp: budget theo stable API-key ID, ledger riêng với analytics, tiền chính xác, price snapshot, tuần/tháng, gate trước POST, API/UI đều có code tương ứng; không phải chứng nhận toàn implementation. Không tìm thấy reservation/hard-cap engine: implementation hiện tại cũng là recorded-spend/block-next.
- **Gap để sử dụng thật với Claude Code/Codex: đáng kể.** Không tìm thấy đường production activation trong entrypoints/initialization/callsite đã kiểm tra; finite budget PUT có explicit production refusal trong source. Native Codex/Claude chủ yếu nằm trong pending/untracked work, với profile/input restrictions và retry khác ordinary path. Không thể gọi đây là “chỉ cần bật một flag”.

“Có over-engineering” không đồng nghĩa mọi consistency/security mechanism đều thừa. Phần dư rõ nhất là **coverage ngoài Claude/Codex, pricing catalog/scheduler đầy đủ, evidence acquisition tooling và quy trình proof kéo dài** so với contract hiện tại. Các lớp degraded-storage/persisted-authority/sidecar có lý do từ contract cũ, nhưng là **ứng viên đơn giản hóa cần quyết định rõ**, không phải code có thể xóa an toàn ngay.

Không có tỷ lệ % hay ETA: file/test totals không đo được correctness hoặc chi phí rewrite. Không có kết luận bất khả thi về upstream semantics.

## 2. Baseline và provenance

### Git local được kiểm tra

| Đối tượng | Revision / kết quả |
| --- | --- |
| `master` | `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d` |
| `develop` / HEAD | `08ee1a74954c5fe7a1659a6473e57b6b1ea9059b` |
| Merge-base | Bằng master; master-only 0, develop-only 21 commits |
| Pending tracked ban đầu | 42 paths; staged 0 |
| Relevant pending source/scripts/tests | 84 status entries; không gộp vào committed develop |

User xác định master được sync upstream; không fetch nên không xác nhận remote mới nhất. Git commit IDs chỉ revision local. [Source baseline](./source-baseline.json) ghi paths, SHA-256, Git blobs và exclusions; [evidence index](./inspected-evidence-index.json) ghi provenance các seam được đọc. File được hash/inventory **không mặc nhiên đã review toàn bộ body**.

### Kích thước diff thực tế

`master → develop`: 1.179 paths, 221.966 dòng thêm / 1.288 dòng xóa, trong đó:

| Nhóm | Paths | Dòng thêm / xóa | Ý nghĩa |
| --- | ---: | ---: | --- |
| `plans/` | 912 | 207.357 / 0 | Tài liệu, lịch sử và receipts, không phải runtime |
| `src/` | 91 | 4.699 / 1.162 | DB, pricing, accounting, API/UI, guards và hỗ trợ build |
| `open-sse/` | 24 | 987 / 44 | Integration/transport/usage parser |
| `tests/` | 136 | 8.530 / 68 | Test/fixtures/config, không phải feature surface |
| `cli/` | 7 | 92 / 14 | Management auth compatibility |

Pending tracked riêng: `open-sse/` 13 paths, `src/` 6, tests 6, plans 17. Relevant untracked còn có native usage/wire modules và collectors. Toàn status ~32.838 paths chủ yếu là generated `.next-*`/session artifacts; không đọc chúng và không tính là over-engineering runtime.

### Ba lớp code không được nhập nhằng

1. **Upstream/master:** đã có SQLite adapter fallback, inference translators/executors, usage history, `byApiKey`/`byAccount`, pricing và UI/API pricing. Không cần tái tạo chúng từ đầu.
2. **Committed develop:** thêm reference pricing, storage safety/ledger, compatible-chat accounting, weekly/monthly budget, fixture-native Responses/embeddings. Commit subjects còn dùng rõ “fixture-scoped”.
3. **Working tree:** native Codex/Claude integration, credential-transition controls, compact/session fixes và tests. Ví dụ `open-sse/executors/codex.js` có cùng Git blob trên master/develop; `Object.create(this)` ở dòng 286 là **pending modification**, không phải đã ship trên develop. `accounting-codex-usage.js`, `accounting-claude-usage.js` là **untracked**.

Citations bên dưới dùng working-tree line numbers tại hashes đã ghi. Với file clean committed, nội dung thuộc develop revision trên; với file dirty/untracked, xem hash/provenance trong evidence index. Không lấy kết quả pending làm bằng chứng committed branch đã có feature.

## 3. Security và đường activation — kiểm tra trước

### S01 — Chưa tìm thấy production activation trong đường đã trace; đây là delivery blocker chính

- `src/sse/handlers/chat.js:41–44` gọi `captureChatAccounting(request)`.
- `src/sse/services/chat-accounting.js:21–38` chỉ lấy capability từ private Request WeakMap; không có association thì trả `null`.
- Đã scan references của ba association names trong `.js` dưới `src/` và `open-sse/`: chỉ có owner definitions, không tìm thấy shipping caller. Đây là lexical/callsite evidence tại source hiện tại, không phải dynamic reachability proof cho mọi kỹ thuật JavaScript.
- `src/lib/accounting/budget-management.js:50–62` xác định `enforcementActive` bằng fixture lifetime; `:79` từ chối finite PUT với `accounting_not_ready` khi không có capability đó.
- `src/shared/components/ApiKeyBudgetPanel.js:55–61` hiển thị rõ inactive production; `:94–102` khóa finite save khi chưa ready. Panel đã được gắn vào Endpoint page ở `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js:1072`.

**Ảnh hưởng:** code helper/API/UI tồn tại nhưng user chưa thể đặt finite budget production rồi được chặn theo nó. Không suy ra config secret hay header có thể bật feature. Không thử bypass hoặc bật feature trong audit.

**Khuyến nghị:** giữ inactive boundary cho đến khi có activation design theo server-resolved key identity và exact coverage. Không “sửa nhanh” bằng gọi fixture-association function từ production.

### S02 — Management guards là cần thiết, không phải phần dư nên bỏ

`src/lib/auth/managementGuard.js:61–77` kiểm tra dashboard session hoặc verified direct loopback/login-disabled; mutation có same-Origin/CSRF policy. `src/app/api/keys/[id]/budget/route.js:14–39` thực hiện auth trước body/privileged operation, có bounded body và no-store. Key CRUD cùng sử dụng guard trong `src/app/api/keys/route.js:11–28`.

`custom-server.js` thêm socket-provenance metadata nhưng giữ strip/stamp nguyên tắc có sẵn. `cli/src/cli/api/managementSession.js:4–47` là compatibility cho management session exact-origin, không dùng inference key làm admin credential.

**Giữ invariant này khi simplification/rebuild.** Không công bố security sign-off: chỉ các seam liên quan được đọc; không chạy adversarial/runtime checks. Không đọc credentials/DB thật.

### S03 — Activation không được chỉ đặt ở cuối handler

`/v1/messages` và `/v1/responses` gọi common `handleChat`; `/v1/responses/compact` lại tạo Request mới (`src/app/api/v1/responses/compact/route.js:29–39`). Guard hiện tại chỉ nhìn fixture association trước reconstruction. Nếu tương lai bật budget bằng key nhưng bỏ qua alternate route này, cần kiểm chứng lại authority propagation/early refusal; **không phải bypass đang được chứng minh trên feature đã bật**.

Không được dùng thêm header/body field do client cung cấp làm accounting permission. Mọi refusal phải dừng trước dispatch, không bị ordinary fallback/cooldown hiểu thành lỗi provider để đi tiếp.

## 4. Mapping contract → code → gap

| ID | Đã tìm thấy trong source | Gap / disposition |
| --- | --- | --- |
| B01 stable API-key identity | `service.js:35–41`; ledger row `api-key-accounting-repo.js:17–29`; bindings helper `:7–41` | **Giữ.** Upstream `usageHistory` dùng raw-key field và không thay thế retained stable identity. Existing rotation/import/tombstone policy nghiêm hơn mô tả mới; cần giữ hoặc sửa có chủ đích. |
| B02 policy + presentation | `budget-policy.js`, `budget-windows.js`, `budget-projection.js:7–30`, management route, panel | **Giữ/reuse.** Production finite write còn khóa; không thiếu toàn bộ UI/API như một số handoff tổng quát có thể gợi ý. Cần E2E shipping validation về sau. |
| B03 block-next | `budget-gate.js:9–33`: spent >= limit, pending không reservation; `service.js:53,112–121` rechecks before dispatch | **Đúng semantics mục tiêu ở core.** Chưa production-wired; không hứa hard cap. Existing test source có case overshoot/peer settlement, không được gọi là mới pass. |
| B04 reuse inference | existing `chat.js → chatCore → BaseExecutor`; optional accounting boundary ở `base.js:104–189` và `accounting-transport.js:26–64` | **Reuse có thật nhưng không hoàn toàn transparent.** Native path có strict validation/format changes, khác retry; cần compatibility matrix nhỏ, rõ. |
| B05 one charge/original attribution | attempt IDs, frozen price, terminal replay/CAS `api-key-accounting-repo.js:15–67`; terminal sinks `chat-accounting.js:160–194` | **Giữ logic cốt lõi.** Không cần ledger thứ hai cho Claude/Codex. Phải kiểm chứng actual attempt/refresh/retry coverage, không dedup theo request đơn thuần. |
| B06 evidence provenance | strict Codex/Claude normalizers; missing/invalid -> unresolved/null; reference resolver | **Không dùng telemetry cost trực tiếp.** Profiles hiện hẹp hơn working inference; cần giải quyết mapping/omission chính xác, không chỉ thêm explicit-zero fixtures. |
| B07 durability/restart | native WAL/FULL, SQL.js atomic persist, lifecycle/recovery, writer ownership | **Giữ guarantees cần thiết.** Sidecar + degraded continuation + toàn bộ config snapshot là ứng viên thu gọn riêng; xem phần 5. |
| B08 security/no bypass | management guard, server key resolution, transport single-use authority, refusal tag | **Giữ invariants.** Chưa activation/security runtime evidence. Không tắt TLS/proxy/ACL hoặc dùng API key làm admin session để rút gọn. |

## 5. Phân loại phần đã làm

| Phần | Kết luận | Vì sao / alternative nhỏ hơn | Dependency, migration và future validation |
| --- | --- | --- | --- |
| Stable key identity, single per-attempt ledger, idempotency/CAS | **KEEP** | B01/B05/B07; analytics cũ không có identity/event guarantees tương đương. Một ledger dùng chung đã là hướng hợp lý. | Import/key retirement và schema đang phụ thuộc; phải giữ known spend và history. Test actual retries/duplicate/concurrent keys/restart. |
| Exact money + immutable price snapshot + calendar gate | **KEEP** | ~90 dòng exact-money và ~39 dòng windows không phải một hard-cap engine. Cắt chúng để cộng floating cost về analytics sẽ giảm correctness. | Manual/synced price formats, old attempt snapshots; verify deterministic money, period rollover và late usage. |
| Budget management API/UI + CAS drafts + auth/CSRF | **KEEP, simplify wording later if needed** | Feature trực tiếp B02/B08. Stale/double-save controls có mục đích, không phải chứng cứ over-engineering chỉ vì component dài. | UI thật đã có; activation/readiness contract phải đổi đồng bộ. Auth/CSRF/identity and real shipping E2E. |
| Durable adapters/single writer/safe fallback/backup | **KEEP invariant; scope changes carefully** | Upstream SQL.js debounce không đồng nghĩa durable charge. Không cần rewrite DB từ zero, nhưng bỏ durable boundary sẽ đổi B07. | Global driver/shared key CRUD đã dùng; affects ordinary requests. SQL.js/native/Bun/better/Windows compatibility tùy support đã duyệt, không blanket waive. |
| Sidecar coverage/tombstones/generation/reconciliation | **CONDITIONAL SIMPLIFICATION** | B01/B07 cần retained identity/detected-failure safety, nhưng fresh contract không đòi riêng second-file receipt protocol/restore model. Có thể thiết kế DB-centric policy nếu chấp nhận thay old guarantees. Chưa chứng minh smaller replacement. | `driver`, adapters, key CRUD/import/export/backup/schema verifiers đều phụ thuộc. Không xóa file sidecar hoặc rollback DB; cần migration preservation/fault tests và owner disposition. |
| Degraded-storage unlimited continuation + fresh persisted read-only image | **STRONG SIMPLIFICATION CANDIDATE** | `chat-accounting.js:57–69,136–145`; `persisted-accounting-authority.js:14–64` phục vụ tiếp tục khi recording hỏng, không phải minimum block-next. Alternative: budget-controlled path fail closed khi storage unhealthy. | Existing old policy có exception cho unlimited identified keys; chưa được user bỏ. Cần quyết định behavior khi storage hỏng, guard ordinary compatibility, rồi mới remove dedicated fallback branches. Không được tháo mọi durability logic cùng lúc. |
| Broad config snapshots and duplicate selection authority | **SIMPLIFY AFTER TRACE** | `persisted-chat-authority.js:24–70` đọc toàn bộ nodes/connections/settings/combos/aliases và veto khi material đổi; `service.js:15–17,48–56` thêm config revision. Relevant policy/credential revalidation cần, nhưng unrelated changes cũng có thể invalidate in-flight authority. Alternative: selected-dependency versions + current gate. | Không gọi đây là bug hay performance measurement. Credential refresh/account-failure acknowledgement hiện patch exact material; thay versioning phải preserve ACL/proxy/token drift và final dispatch atomicity. |
| Catalog sync + scheduler + coverage dashboard | **OPTIONAL FOR FRESH CONTRACT** | Master đã có pricing/manual settings. Local reference resolver+snapshot cần; automatic models.dev acquisition/schedule/status UI không bắt buộc để chặn theo key. | Resolver, pricingRepo/UI, imports/startup hiện đọc synced state. Tách optional source, giữ last-known rates/manual precedence; không xóa synced pricing đang lưu hoặc làm model đang priced thành unpriced. |
| Native Responses/embeddings accounting generic coverage | **SELECTIVE REUSE / OUTSIDE TARGET COVERAGE** | Responses primitives dùng cho Codex nên không loại theo tên. Standalone embeddings coverage không thuộc Claude Code/Codex budget target mới. | Tránh unconditional E1/embeddings wiring; retained old scope cần disposition. Mọi route còn reachable với budget key phải được account hoặc từ chối rõ trước POST; bỏ positive coverage không được mở đường bypass. Không xóa generic parser/transport có native consumers. |
| Evidence collectors/login/one-shot/waves/B02 observer | **NOT SHIPPING FEATURE** | Nằm dưới `scripts/accounting`/offline tests; trợ giúp evidence, không phải thành phần budget tối thiểu. | Chỉ role/path classification, không certify scripts hay đọc captures. Không thêm callsite/polling vào runtime. Giữ archive ngoài critical delivery path; không thực thi/cleanup tự động. |
| Historic plans/receipts/proof campaigns | **ARCHIVE/REUSE, NOT ACCEPTANCE QUEUE BY DEFAULT** | 912 plan files làm diff rất lớn; không phải runtime footprint. Re-running chỉ để có tổng xanh không cải thiện product. | Giữ receipt provenance; selected original reds thật sự liên quan không bị xóa/waive. Native later-read discriminator và mọi historical timing context không phải invariant tiền tệ mới chỉ vì được ghi trong plan. |
| Runtime host paths, SQL.js wasm tracing, ordinary Codex invocation fix | **SEPARATE COMPATIBILITY WORK** | Một số thay đổi sửa packaging/ordinary inference, không phải feature budget dư. Codex fix ở working tree giữ per-invocation state và compact intent. | Không bỏ chung với accounting; phải test/cherry-pick độc lập nếu rebuild. Không nhận mọi dirty code là đã proven tốt. |

### Hai điểm cần nhấn mạnh

**Không có bằng chứng đã xây hard-cap/reservation không cần thiết.** `budget-gate.js` ghi thẳng pending không reserve; behavior hiện tại khớp block-next theo known recorded spend.

**Có một hệ reliability/control-plane lớn hơn minimum feature**, nhưng nhiều phần có provenance yêu cầu cũ. Chẳng hạn `legacy-design-contract.md` giữ all-provider/embeddings, coverage-gap continuation, pricing sync và restore/identity protections; D1–D4 yêu cầu graph refusal. Audit không thể gọi chúng là assistant tự bịa, cũng không thể lấy chúng làm immutable product necessity sau khi user đang yêu cầu xem lại.

## 6. Native Claude/Codex: integration gap cụ thể

### N01 — Pipeline được reuse nhưng behavior accounting không identical

- Native Codex `open-sse/executors/codex.js:294–301` đi qua Base executor và bỏ ordinary `_peekSseTransientError`; ordinary path vẫn dùng peeker/retry ở `:319–347`.
- Accounted boundary đọc raw SSE/JSON trước translation, giữ terminal cho settlement ACK (`accounted-base.js:44–106`, `accounting-responses-stream.js:85–114`). Không phải service inference riêng, nhưng là selected protocol behavior riêng cần test.
- Vì vậy “giữ pipeline” là mục tiêu kiến trúc, không có nghĩa có thể giữ nguyên peeker và thêm telemetry callback cuối cùng mà mọi retry đều được account đúng. Cần một raw owner hoặc observer tại đúng reader và attempt boundary.

**Khuyến nghị:** giữ core attempt+dispatch seam; giảm duplication ở provider adapters khi có evidence. Không tạo thêm generic retry subsystem trước khi so sánh sự khác nhau thực tế. Không tuyên bố ordinary retry đã đáp ứng accounting-owned retry.

### N02 — Strict profiles có thể chặn valid ordinary traffic

- `accounting-codex-usage.js:6–13` yêu cầu explicit `cache_write_tokens`, cached và reasoning counters; omitted fields không được tự coi zero.
- `accounting-claude-usage.js:32–42` yêu cầu explicit cache tiers ngay cả ở initial usage; `accounting-claude-request.js:23–39` chỉ nhận text/client-function slice, không nhận mọi thinking/media/extension field ordinary executor xử lý.
- `accounting-responses-usage.js:56–86` validator không nhận reasoning-history item trong input. Đây là cơ sở kỹ thuật của encrypted-history gap, không phải test gap đơn thuần.
- `accountingProfiles.js:3–11` danh sách model là PRIVATE integration, **không phải producer eligibility list**.

**Khuyến nghị:** tách rõ “cần guard tính phí đúng” với “replicate toàn bộ request schema”. Không nới unknown/missing thành zero. Việc chấp nhận omitted counter, bỏ field hay giảm model/history scope cần contract/profile evidence hoặc quyết định owner cụ thể. Rewrite từ master không làm biến mất các unknown này.

### N03 — Rủi ro rollout là global coupling dù enforcement OFF

`driver.js:53–67` luôn cài writer/coverage/bindings/lifecycle khi khởi tạo DB. `apiKeysRepo.js:35–40,108–116` xác minh bindings ngay cả ordinary key lookup; pricingRepo và startup cũng dùng durable plumbing. Do đó **enforcement OFF không có nghĩa develop không làm thay đổi behavior ngoài budget**.

Điều này không tự chứng minh lỗi/security vulnerability, nhưng là lý do cần rollout/compatibility test và không merge/reset theo một diff tổng. Tách foundations đã dùng toàn DB khỏi native pending experiment sẽ ít rủi ro hơn xóa toàn bộ.

## 7. Tiếp tục hay làm lại?

| Phương án | Giữ được gì | Rủi ro / fails first | Đánh giá |
| --- | --- | --- | --- |
| Tiếp tục nguyên plan cũ | Toàn bộ scope/proof history | Cứ phải đóng các nghĩa vụ rộng trước khi feature hẹp sử dụng được; lặp nghiên cứu không cung cấp producer facts | **Không đề xuất làm mặc định.** Cần product disposition cho scope thay vì recook. |
| **Giữ core, tách scope, đơn giản hóa có chọn lọc** | Key ledger/money/policy/calendar/API/UI/security và useful transport/usage primitives | Activation/native profile vẫn chưa ready; removal của degraded mode/sidecar phải có decision/migration | **Đề xuất hiện tại.** Architecture gần mục tiêu; delivery gap không được giải bằng bỏ code wholesale. |
| Rebuild từ master với behavior tương đương | Baseline inference sạch; có thể thiết kế boundaries ít coupled hơn | Phải làm lại identity, durable writes, idempotency, UI/auth, usage adapters; unknown provider semantics vẫn còn; history/migration chưa được giải | **Chưa justified.** Chỉ chọn nếu bounded dependency design chứng minh selected reuse đòi rewrite gần toàn bộ, không vì thấy 1.179 file diff. |

**Better approach:** thay vì chọn nhị phân “giữ tất cả develop / bỏ tất cả”, dùng master làm baseline so sánh và extract một feature slice từ các foundations phù hợp. Hiện chưa cần tạo worktree/branch mới để đưa ra kết luận này; khi implementation được duyệt có thể dùng worktree sạch để kiểm chứng selected port mà không phá develop.

## 8. Hướng tiếp theo sau audit — chưa được triển khai

1. **Owner disposition ngắn cho đúng scope cần đổi, không hỏi lại key/block-next.** Chốt điều gì của old broad contract không còn thuộc target; ưu tiên quyết định storage-unhealthy continuation, optional pricing-sync/embeddings coverage, exact native supported composition và unknown-usage UX. Với feature/route không triển khai accounting, vẫn phải giữ explicit refusal cho budget key trước POST; không giảm scope bằng cách để request rơi vào ordinary path. Đây không phải blanket waiver cho safety/retry/known spend.
2. **Một design delta cho production activation + minimal native integration.** Dùng source/case inventory hiện có; liệt kê entrypoints và exact guards cần nối, split reusable vs optional dependencies. Không lặp E0 hoặc broad audit. Nếu không có delta mới ready, báo đúng blocker.
3. **Khi implementation được duyệt:** bắt đầu bằng vertical acceptance nhỏ nhưng thật: budget save trên shipping route → Claude/Codex supported request → original-key settled debit → next dispatch zero-POST refusal, kèm retry/refresh và ordinary-key controls. Không đánh đồng compatible dummy-chat fixtures với native producer eligibility.
4. **Simplify sau khi giữ được invariant bằng tests**, không xóa DB/sidecar hay các safety guard trước rồi mới tính migration. Port sang master sạch chỉ là phương án validation nếu dependency surface thực tế cần; không reset develop.

Gate tối thiểu của future delivery vẫn gồm valid usage semantics/cost mapping, attempt idempotency, original identity/price/window, no bypass và durable known truth. Tên milestone, exhaustive artificial mutations hay mọi unknown tương lai không tự là product requirement. Các old reds/retained scope chưa được disposition vẫn báo open, không được đổi N/A bằng báo cáo này.

## 9. Verification và giới hạn

- Đã đọc implementation các seam nêu trên, selected master snapshots và develop/working-tree deltas; đã đọc test bodies cho activation, management security và budget loopback, cùng representative assertion/title inventory cho ledger/coordinator/native suites.
- `tests/unit/budget-activation-boundary.test.js:20–39` **chủ ý asserts không có shipping activation**. `key-budget-management-security.test.js:28–39` asserts production finite PUT 409 và fixture finite PUT 200. Đây là test intent được tìm thấy, **không phải run/pass trong audit**.
- Không chạy unit/integration/browser tests, build/server, live inference/refresh, source web research hoặc old campaigns. Không inspect private DB/config/credentials/captures/generated/session contents.
- Baseline hash verification chỉ áp dụng các paths được liệt kê; supplemental sources/CLI được hash khi được thêm vào scope, không giả vờ toàn bộ được đóng băng từ lúc đầu. Không chứng nhận không có thay đổi ngoài manifest.
- Không có independent full-code/security certification. Advisor review dùng concise supplied facts/draft và không thay thế kiểm chứng runtime.
- Validation output và quyết định review được ghi trong [validation.json](./validation.json) sau khi hoàn tất.

## 10. Câu trả lời trực tiếp cho owner

**Bạn không cần làm lại Claude Code/Codex integration từ đầu để có budget. Phần trước đây có xây rộng hơn nhu cầu hiện tại, đặc biệt reliability exceptions, optional pricing/coverage tooling và quy trình acceptance; nhưng key-budget core đang đúng hướng. Đề xuất giữ core, làm rõ những scope có thể bỏ, rồi hoàn thiện activation/native integration có giới hạn. Chưa đề xuất xóa develop.**

Giữ hoặc bỏ từng cơ chế phải preserve B01–B08 và có migration/validation tương ứng. Đây là recommendation hoàn tất audit, không phải feature hoàn tất hay release approval.

## 11. Owner decision sau báo cáo — clean branch, selective port

Owner đồng ý hướng tích hợp có chọn lọc nhưng chọn thực hiện trên **branch mới từ master đã sync remote** thay vì tiếp tục trực tiếp ở develop. Owner không muốn worktree riêng; dùng checkout hiện tại sau bước bảo toàn WIP. Những quyết định này supersede status “candidate/chưa chọn branch strategy” trong phần so sánh lịch sử, không thay đổi các invariant và giới hạn bằng chứng.

- Develop là donor/reference được giữ nguyên, không reset/xóa. Không mang toàn bộ foundations vào chỉ vì commit có sẵn.
- Mỗi slice cần requirement Bxx, dependency list, lý do port/adapt thay vì cách nhỏ hơn, và checks trong môi trường mới. Static review không phải portability proof.
- Không thực hiện chiến lược “implement hết rồi nhập develop”; chọn phần reusable khi thiết kế từng slice và chỉ viết phần thiếu.
- Phải bảo toàn tracked/untracked source trước switch; checkout/branch mới không tự sạch. Method WIP commit/scoped stash cần được phê duyệt nếu chưa có authority; không blanket stash/add generated/session/private artifacts.
- Mọi route ngoài positive coverage vẫn cần explicit refusal cho budget key; native monetary/failed-usage/retry evidence gaps không tự biến mất khi đổi branch.
- Chỉ update docs và sync inactive master trong handoff này. Phiên mới sẽ lập implementation plan trước; chưa switch, triển khai, migration hoặc activation.

Baseline sync kết quả thực tế và hướng resume được ghi tại [branch-handoff.md](./branch-handoff.md). Không dùng audit cũ để chứng nhận code upstream mới chưa đọc.
