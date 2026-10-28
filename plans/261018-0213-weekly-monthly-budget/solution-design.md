# P4 — Solution design

Planning clarification; chưa implementation hoặc acceptance. Reuse [contract P4](./plan.md) và [exact legacy contract](../261018-0213-api-key-budget-roadmap/references/legacy-design-contract.txt), không thay support/activation contract.

## 1. Current evidence / ownership

| Current source | Đã có | P4 bổ sung |
|---|---|---|
| `src/lib/db/schema.js`, `src/lib/db/migrations/003-accounting-policy.js`, `src/lib/db/helpers/accounting-policy.js` | Nullable weekly/monthly nanoUSD, version ≥1, explicit policy initialization/validation | CAS update; không tạo table/migration/backfill mới nếu schema không đổi |
| `src/lib/db/repos/api-key-accounting-repo.js` | Indexed ledger, immutable intent, original snapshot, state/CAS recovery, `sumSpendSync` BigInt | Count/projection queries và bounded window history; không lấy tiền từ usageDb |
| `src/lib/accounting/service.js` | Queue/group durable intent/terminal ACK; authorize tại begin, mutation và pre-POST | Same-transaction budget gate + sync dispatch recheck, shared typed refusal |
| `src/lib/accounting/persisted-chat-authority.js` | Policy trong revision; persisted identity/ACL/route verification | Giữ fail-closed khi policy drift; không dùng stored `unlimited` cũ để gap-bypass |
| `src/sse/services/chat-accounting.js`, `src/sse/handlers/chat.js` | Fixture-only activation, own receipts/sinks; generic 503 catch | Preserve typed trusted local errors đến selected native boundary |
| `open-sse/utils/accounting-transport.js` | WeakSet local refusal; synchronous assertion ngay trước invoke | Reuse, không thêm budget repo import hoặc key state trong engine singleton |
| `src/lib/auth/managementGuard.js` | JWT/direct stamped loopback, Origin/authority checks | Reuse cho budget routes và named key-CRUD prerequisite |
| `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`, `components/KeyAccessControls.js` | Key CRUD, immediate ACL updates/toggle, tunnel UI | Compose budget panel, tách state và version; không rewrite page/tunnel |
| `tests/fixtures/accounting/chat-loopback.js`, `tests/browser/pricing-acceptance.mjs` | Actual handler→dummy POST; isolated browser/real API pattern | P4 fixture web adapter và actual browser-to-inference acceptance |

Old candidates lấy bằng immutable Git object `d515fb4927ed45a5853104406cd0fecca549c04c`: `src/lib/apiKeyBudget/windows.js`, `management.js`, `managementHttp.js`, `errors.js`, `src/shared/utils/budgetManagementDraft.js`, `src/shared/components/ApiKeyBudgetPanel.js`, tests budget-policy/windows/draft/browser. Chỉ tham khảo/port chọn lọc; không apply stash hoặc đưa old service/auth/schema vào song song.

## 2. Money và calendar

- Ingress PUT chỉ `weeklyLimitUsd`, `monthlyLimitUsd`: `null` hoặc plain decimal string không dấu/exponent/whitespace, tối đa 9 chữ số thập phân. `"0"` hợp lệ; reject number, empty string, negative, NaN/Infinity, precision dư và amount > `9000000000000000` nanoUSD ($9,000,000). UI giữ draft string; không `parseFloat`, không dùng `||` với zero.
- Canonicalize sau validation bằng BigInt/rational utilities hiện có. DB chỉ convert mỗi validated amount trong safe bound sang Number. Aggregate spend không bị giới hạn theo single amount và không convert Number; wire money luôn decimal string.
- Fixed timezone `Asia/Ho_Chi_Minh` UTC+07:00; UTC calendar arithmetic trên shifted clock, không host-local dates hoặc rolling 7/30 ngày. Không cho user đổi timezone. Weekly Monday 00:00, monthly day 1 00:00; trả UTC ISO `[startAt, resetAt)`.
- `spent` = sum `settled`/`waived` cost theo **apiKeyId + startedAt** trong window. `not_dispatched` không charge; pending/unresolved không gán zero. `remaining=max(limit-spent,0)`; unlimited remaining/limit = null; `overshoot=max(spent-limit,0)` riêng. Progress derived/clamped chỉ để hiển thị, không là admission truth.
- Không cron reset, xóa ledger, reprice history hoặc counters tiền thứ hai. Window mới tự được chọn bởi clock. UI có current windows và bounded previous-window summary từ ledger để thấy late settlement/overshoot kỳ cũ; previous weekly/monthly là calendar window ngay trước current, không arbitrary unbounded analytics.
- Một clock capability nội bộ cấp cho budget/service composition để intent `startedAt`, gate và projection dùng cùng instant canonical. Test clock chỉ ở fixture/process runner; không accept time từ client body/header, không dùng fake global timers làm mất network deadlines. Không đổi exact-money rounding.

## 3. Enforcement: gate ở đâu, dùng thời gian nào?

```text
request/key/ACL/route authority
  → quick eligibility check (không phải permission)
  → queue
  → existing serialized durable transaction:
       fresh identity/policy/coverage/health
       capture admittedAt once → calendar windows
       read spend + unresolved → allow?
       insert pending(startedAt=admittedAt, original price)
  → own intent ACK
  → sync final assertion:
       fresh persisted identity/policy/route + health
       same calendar window IDs as intent?
       fresh recorded spend + unresolved
       consume once (last fallible operation)
  → invoke upstream (không await giữa assertion và invoke)
  → own exact/unresolved terminal ACK → eligible response/terminal
```

### Window rollover giữa intent và POST

**Chọn refuse stale finite intent, không đổi startedAt.** Nếu final assertion thấy window của **bất kỳ dimension có limit non-null** đã khác lúc intent, trả terminal local `503 api_key_accounting_unavailable` với reason `budget_window_changed`; chứng minh chưa invoke và finalize `not_dispatched` bằng own terminal ACK. Dimension unlimited không gây rollover refusal; null/null vẫn record theo startedAt mà không calendar-deny. Không tự re-date intent, không dùng kỳ mới gate rồi debit kỳ cũ và không thêm automatic retry. Client có thể tạo request mới. Đây là safe rare refusal qua reset; attempt đã dispatch trước reset vẫn settle kỳ cũ như bình thường.

Quick check/queued write dùng current windows; chỉ actual mutation cấp `startedAt`, không giữ enqueue timestamp. Final sync gate cùng finite windows của intent, refresh recorded spend ngay trước consume. Serialization dựa existing **single gateway writer process cho mỗi DATA_DIR**, không support worker/cluster thứ hai; ownership phải được xác minh. Toàn bộ final authority/budget check → consume → invoke nằm trong cùng synchronous event-loop turn, không await/yield/callback có thể mutate policy xen giữa; durable policy writer dùng cùng adapter/coordinator. Policy update đã commit trước assertion phải refuse old authority; update sau invoke không thể revoke POST đã exposed, chỉ chặn successor và vẫn giữ terminal sink. Nếu runtime có writer khác có thể interleave, topology unsupported/unavailable, không dùng “sync” làm proof multi-worker atomicity. Một peer settlement sau intent có thể làm request này bị refuse trước POST; live pending không reserve tiền và không block request khác. Hai requests đều POST trước settlement có thể overshoot không giới hạn bởi một request. Không serialize network để giả hard cap.

### Status/precedence

1. Invalid/missing identity/binding/schema/owner, maintenance, corrupt required sidecar/config: deny unavailable; không gap exception.
2. Recording/storage unhealthy hoặc unresolved global/key coverage gap: finite policy fail closed. Unlimited continuation chỉ đúng P3 rule: verified explicit unlimited + independent own gap ACK khi recording-only failure. Không coi gap hay `ledgerStartedAt` là activation proof.
3. Với **bất kỳ limit non-null**, mọi row `state='unresolved'` của chính apiKeyId trong ledger recording lifetime đều block, kể cả kỳ cũ; global/key unresolved coverage gaps xử lý ở mục2. Row pending live không nằm trong unresolved filter; restart orphan pending → unresolved trước phục vụ. Trong fixture chưa có public `ledgerStartedAt`, tất cả attempt fixture sau khởi tạo là lifetime, không filter `NULL` thành “không có unresolved”. Production history trước activation không tự backfill debit. Unresolved chỉ hết khi late exact evidence settle thành công, hoặc internal audited CAS exact correction/cost correction/explicit waiver; không có timer/limit-edit/reset auto-clear. P4 chưa có public recovery UI, nên finite key có unknown có thể bị block vô thời hạn tới recovery P5; UI phải nói rõ và production vẫn OFF.
4. Finite window exhausted khi `spent >= limit`, gồm limit zero khi chưa spend. Weekly/monthly OR; return cả blocked windows. `null/null` không block vì unresolved/spend; vẫn record và giữ strict ownership/health/gap rules.
5. Sau eligibility mới resolve/verify price và selected-profile support: missing price candidate-local; unavailable/unresolved/exhausted terminal, không model/account cooldown hoặc fallback vòng quanh.

Policy drift sau hold: current P3 authority hashes policy; **giữ refusal** (`503` unavailable + bounded reason `policy_changed` nếu phân loại chắc chắn), không silently refresh cùng request hoặc reuse cached unlimited. Request mới đọc policy mới. Toggle key/ACL/config drift tương tự giữ current denial. Settlement/late sink **không** chạy budget admission gate: acknowledged POST được ghi tiền dù key disabled, limit null, policy version đổi, exhausted hoặc reset. Cleanup failure không được nuốt typed original refusal; own terminal ACK failure ưu tiên unavailable vì storage không chắc chắn.

## 4. Errors và Retry-After

Dùng trusted local typed error/metadata + existing WeakSet provenance, không nhận `error.code` hoặc JSON/header từ upstream làm authority. `chat.js` hiện flatten 503 phải được sửa trên selected boundary. Không mở native Anthropic/Gemini/Responses coverage từ P4; broader native adapters thuộc X/R.

| Case | Status / code | Metadata |
|---|---|---|
| Exhausted | 429 `api_key_budget_exceeded` | server requestId, timezone, blocked windows/resetAt; `requiresPolicyChange=true` nếu có zero limit |
| Unknown money | 503 `api_key_accounting_unresolved` | Không Retry-After giả; recovery required |
| Storage/authority/rollover | 503 `api_key_accounting_unavailable` | Safe bounded reason; không leak SQL/credentials/body |
| Missing price | 503 `model_pricing_unavailable` | Candidate-local, giữ existing safe fallback rules |
| Unsupported profile | 503 `model_accounting_unsupported` | No budgeted POST; không claim coverage mới |

- Prestream selected OpenAI envelope giữ `message/type/code/param` + requestId/timezone/reset metadata; `Cache-Control: no-store`, `X-Request-Id`, `Retry-After` và CORS expose headers. Không replace unrelated existing CORS headers.
- Positive-limit exhaustion: `Retry-After=max(1, ceil((max(blocked.resetAt)-now)/1000))`. Khi tuần reset nhưng tháng chưa reset vẫn block. Không hứa tự mở nếu unresolved/gap xuất hiện sau đó.
- Zero limit: để giữ both-window legacy header contract, vẫn trả reset/Retry-After cùng công thức, **chỉ advisory earliest calendar recheck, không phải guaranteed unblock**; thêm requiresPolicyChange và UI “0 chặn cho đến khi sửa policy”. Giữ quyết định này trong tests/docs, không quảng cáo zero tự reset. UI/test client không auto-retry inference chỉ vì header hết hạn; boundary qua reset phải vẫn429 cho tới policy đổi.
- Already-started SSE: không đổi HTTP status/header muộn; native error terminal giữ code/requestId và reset metadata khi có; không emit finish/DONE success. Failed-HTTP usage exact vẫn charge trước successor gate. Upstream giả JSON code giống budget không được biến thành local terminal hoặc bỏ accounting.

## 5. Management API / policy updates

`GET /api/keys/[id]/budget` và `PUT` cùng route-level `authorizeManagement`; auth/Origin trước privileged params lookup/body/read/write. GET no-store; PUT cũng no-store; không permissive cross-origin management CORS. Guard deny responses cũng no-store.

PUT body exact shape:

```json
{"weeklyLimitUsd":"10.000000001","monthlyLimitUsd":null,"expectedVersion":1}
```

- Full replacement hai limits, không nhận `apiKeyId`, `actor`, time, coverage, state hay extra fields từ body; id từ validated path. Không upsert missing policy: absent/corrupt initialized policy → 503, unknown id →404. Create-key/init policy vẫn P2/P3 ownership.
- CAS `WHERE apiKeyId=? AND version=?`, version increment và updatedAt trong existing durable transaction. Stale expectedVersion →409 `budget_policy_conflict`, no mutation. Validation 400, durable failure 503; success chỉ sau own durable completion. Exact unchanged payload với current expectedVersion là no-op (giữ version); stale version vẫn409. No allowance reset hoặc deletion.
- Active retained identity mới được PUT; inactive/retired →409 `api_key_inactive`. GET tombstone retained ID read-only không secret; truly unknown404. Toggle/re-enable không tạo policy mới.
- **Production inactive:** GET trả stored policy/projection + `enforcementActive:false`, `ledgerStartedAt:null` nếu chưa active và scope warning. PUT chỉ cho null/null (disable) khi health/identity/CAS hợp lệ; bất kỳ finite target, kể cả0, →409 `accounting_not_ready`. Không lưu finite draft rồi imply enforcement. UI disable finite submit, không optimistic “enabled”.
- **Isolated fixture:** server-owned private capability cung cấp selected-scope readiness/clock để actual PUT finite và inference dùng chung lifetime. Capability này chỉ thay accounting readiness/clock, không thay authentication, Origin/CSRF, ownership, active identity, price hoặc policy checks; negative HTTP tests phải prove null/null cũng không bypass guards. Không chỉ đọc timestamp làm ready. Fixture có `coverageStartedAt` riêng, `scope=selected compatible chat fixture`, không stamp public ledgerStartedAt. Global/key gap hoặc maintenance ngăn finite enable; old unresolved không xóa và admission trả503 sau khi lưu finite policy.
- Response tối thiểu: apiKeyId/active/retired, version/updatedAt/timezone/serverNow, weekly/monthly `{startAt,resetAt,limitUsd,spentUsd,remainingUsd,overshootUsd,exhausted}`, previousWindows summaries, pending/unresolved counts toàn lifetime + per-current-window, health/gap/maintenance summary, ledgerStartedAt/fixture coverage start, scope/reference label, enforcementActive và eligibility/block reason riêng. Known spent không đồng nghĩa total known khi có unknown rows.
- Không đưa raw gateway/provider key, prompt, headers, binding/HMAC secret, connection data hoặc full SQL/audit payload vào projection/log. Existing key reveal response là riêng, không mở rộng vào budget route.

## 6. UI composition và security prerequisite

Panel `src/shared/components/ApiKeyBudgetPanel.js` + draft utility thích nghi từ old candidate, không replace EndpointPageClient. Mỗi key có budget loading/error/version/draft riêng. ACL vẫn qua KeyAccessControls và key endpoint riêng; không gom hai writes thành transaction giả. Budget refresh/update không overwrite ACL; ACL/toggle response không discard budget draft; fetch dùng per-key identity/sequence để late key-A response không render key-B. Conflict409 giữ draft, báo reload/review, không auto-overwrite newer policy. Dirty drafts không bị polling reset; refresh projection khi mở panel/save/focus hoặc explicit refresh, không cần realtime push.

Null/zero nhập rõ ràng bằng unlimited toggle + decimal input; empty draft chưa hợp lệ không tự biến0/unlimited. Show two current windows, exact values, clamped progress + overshoot, pending/unknown riêng, previous-window overshoot, reference-not-invoice và soft-threshold warning. Inactive production hiển thị “chưa kích hoạt”, không dùng green allowed status gây hiểu nhầm. Recovery required không có nút fake clear/reset; P5 sở hữu recovery UI. Keyboard labels/focus/error announcement và mobile layouts bắt buộc.

**Named composition prerequisite:** `src/app/api/keys/route.js` GET/POST và `[id]/route.js` GET/PUT/DELETE hiện không gọi shared route-level management guard. Apply guard trước privileged access, Origin cho mutation; preserve response shapes/ACL/default-key flow. Xác định callers hiện tại (dashboard, CLI tools, test consumers) và kiểm tra compatibility; consumer cần CLI token/remote login-disabled không được âm thầm exempt. Nếu consumer contract conflict không thể giải quyết trong authenticated flow, dừng và nêu quyết định, không mở rộng auth rewrite. Không hoãn prerequisite này tới P5.

## 7. Test harness / activation boundary

- Preflight tạo runner trong `tests/fixtures/accounting/`: bind loopback random port, disposable DATA_DIR/coverage/keys, dummy upstream chỉ loopback; serve real dashboard artifact/UI và forward actual budget route + actual `handleChat` trong cùng fixture-owning process/module identity. Existing browser pricing runner là pattern isolation, không tự chứng minh P4 feasibility.
- Adapter phải construct server-owned Request rồi associate private fixture capability **trước** actual chat capture; actual management route nhận readiness từ private server-owned association. Browser/request không tự chọn accounting/clock/readiness. Guard thấy authentic socket provenance theo custom-server/trustedPeer semantics, không tin browser-injected trusted headers.
- No production source branch “if test header/env flag then activate”. Nếu bundling/module identity hoặc Next Request boundary khiến injection không thực hiện được, phase1 dừng để review test seam; không ship public fixture endpoint, monkeypatch fetch để giả tiền hoặc bypass route guard. Static/source tests và ordinary production standalone negative smoke chứng minh không có activation channel.
- Test UI dùng actual budget/key APIs và inference handler, không `page.route` giả data, không seed spent rows thay cho main E2E debit. Direct SQL seeding được phép cho focused overflow/legacy test, phải ghi khác evidence. Cross-window acceptance dùng request đã thực sự POST và delayed usage; restart cùng artifacts giữ identity/policy/ledger/sidecar. Standalone production smoke riêng chứng minh inactive, không nhầm fixture E2E với production activation.

## Remaining implementation risks

Harness seam feasibility là phase1 stop gate. Performance của BigInt scans phải đo trên workload/ledger size được ghi rõ, không bỏ fresh guard hoặc tự thêm derived cache. Bun/better/Windows và all-protocol errors/coverage vẫn P5/X/R blockers. Không có câu hỏi intent còn mở; user chưa yêu cầu implementation/activation.
