---
title: "API key quota, weekly/monthly budgets và reference pricing"
description: "Durable per-key accounting, calendar budgets cho chat + embeddings và pricing-only sync."
status: in-progress
priority: P2
effort: 88h
branch: feat/api-key-quota-budget-pricing
tags: [feature, backend, database, api, auth, frontend]
blockedBy: []
blocks: []
created: 2026-10-03
---

# API key quota, budget tuần/tháng và reference pricing

## Authority và outcome

Admin xem usage/virtual spend theo stable gateway API key ID, đặt budget tuần/tháng đồng thời, chặn attempt mới theo recorded spend và xử lý unknown usage có audit. Chat mọi format và embeddings thuộc phạm vi đã nhận, gồm retry/fallback/capacity/fusion; giá tham chiếu không phải invoice upstream.

- **Product scope/money/durability giữ nguyên; bổ sung hướng I/O đã chốt:** [design contract](./design-contract.md), [brainstorm/13 AC](../reports/brainstorm-261003-1455-api-key-quota-budget-pricing.md), [validation decisions](./reports/validation-session-01.md).
- **Execution authority:** roadmap Gói A–E trong file này. Sáu phase cũ giữ technical requirements/acceptance details, không phải backlog thực thi song song. Không bỏ criteria của phase khi chuyển sang gói.
- **Constraints:** direct execution; giữ intentional dirty work; disposable HOME/DATA_DIR và dummy credentials; production enforcement **OFF**. Không commit/push/publish/production activation hoặc live billable provider calls từ việc tổ chức lại này.
- **Checkpoint authority (user-approved, updated at OAuth continuation):** branch `feat/api-key-quota-budget-pricing`; user permits commit and push if needed for verified feature WIP and related dependencies/tests/docs. Exclude `.pi/`, secrets, DB/logs/build output and unrelated work. This supersedes older no-new-commit/no-push restrictions only; no merge/release/production activation or B–E closure authority. No new commit/push was performed in this OAuth continuation.
- **Non-goals:** reservations/hard cap, daily/rolling budgets, billing portal, multiwriter/cluster, automatic out-of-band antirollback; không metering các endpoints image/audio/video/search/fetch. Không đổi routing preference hoặc upstream credential quota.
- **Acceptance của tổ chức lại:** một backlog hiện hành, mỗi remaining item có gói chủ quản và exit evidence, một gói active, lịch sử tách riêng; không biến scoped pass/explicit deny thành whole-feature DONE.
- `effort: 88h` là estimate gốc, không phải ETA còn lại. Không suy phần trăm hoàn tất từ test counts.

<a id="current-delivery-roadmap"></a>

## Roadmap — hoàn tất một tính năng rồi mới chuyển

| Gói | Kết quả phải giao | Trạng thái hiện hành | Dependency để đóng |
|---|---|---|---|
| A — Reference pricing | Admin quản lý giá; inference nhận immutable, validated price snapshot | **Đã đóng theo sequential delivery**. Current25file547/547 + lint/whitespace0; fullbuild b219bbefc verified/source/artifacts/configrestore; exact-build browser b6e2e1e46 real7groups/intercepted19checks/pageErrors[]. Failed receipts giữ nguyên. [Closure/limitations](./reports/package-a-closure.md); không all-product/all-adapter certification | Foundation hiện có; closing API/UI/restart/consumption evidence |
| B — Durable inference accounting | Mọi billable attempt trong chat/embeddings thuộc scope được ghi đúng key/usage/giá | **Đang làm**. A đã đóng; thực thi finite family/seam backlog B và durable-ACK group commit, không coi narrow pass/refusal là coverage | A cho consumption pricing; verified ownership/durability tại consumer |
| C — Weekly/monthly budgets | Policy → request gate → ledger → dashboard → reset/restart khép kín | Có code/evidence; còn integrated acceptance | A + B cho full supported inference coverage |
| D — Recovery và vận hành | Operator reconcile/restore/retry an toàn, audit không mất và allowance không reset | Có code/evidence; còn procedures/runtime/ACK acceptance | B + C; reuse existing recovery prerequisites ngay khi consumer cần |
| E — Nghiệm thu toàn sản phẩm | Full regression/security/adapters/docs và đủ 13 AC | Chưa đóng; không có rollout authority | A–D đóng, cross-feature acceptance |

**A đã đóng; chỉ B active.** C–E pending; toàn sản phẩm chưa DONE và production enforcement OFF. Foundation và scoped milestones đã có không bị reset vì đổi tổ chức.

### Checkpoint cho phiên mới — 2026-10-11

- **Current B execution detail:** [remaining delivery packets](./reports/package-b-remaining-work.md). B không được coi là gần DONE từ test counts; còn provider/format owners, generations/app routing, unhealthy/transport, grouped consumer integration và integrated acceptance.
- **Đã đạt gần nhất:** Gemini embeddings public synchronous narrow path + internal queued path có guarded original wire/SQL selection/exact issued provenance/own intent+completion ACK/original-price/cancellation/budget-crossing evidence. Node83/83 và SQL.js83/83 cùng4files; native39 thực sự dùng SQL.js. Không generic/OAuth/tools/pool/full-family approval; public entry vẫn synchronous, default OFF.
- **Gate đã kết thúc FAILED:** `b4b3130c0` — current shared service/context/wire impact1607pass/1fail,77unique files/22partitions, no pending/todo. Independently checked1349current hashes unchanged; lint/whitespace0. Sole failure `accounting-queued-saved-proxy-loopback.test.js:201:84`, saved-global-proxy precedence expected trapHits0 got1; responseOK/posts1 passed before failure, later tunnel/ledger/gap assertions unreached. Historical exact port attribution remains unproven; reproduced fixture lifecycle mechanism and focused repair are recorded in Q below. Cloud worker explicitly excluded, not pass. This original gate remains FAILED, not a current running task or restart instruction; no duplicate fullgate.
- **Packet Q hiện đã khép kín finite slice (không Bclosed):** saved-proxy lifecycle root mechanism reproduced with owned port reuse (18/1 before cleanup); test-only real ProxyAgent teardown drain repaired19/19, affected original4file partition `b1751b3c5`26/26/current1349hashstable/lint+whitespace0. Production unchanged; original77file gate remains FAILED, not relabeled allgreen. Exact historical port attribution unavailable. [Investigation/evidence](./reports/saved-proxy-lifecycle-investigation.md). Current **F**: bounded exact failed-HTTP Messages seam closed after fullvalidation/redaction/distinctfailedterminal repair, `b5ad9d4fa`198/198 then `bf705853d`538/538/exact19files/5partitions/current1349hashstable/lint6+white0. [Messages evidence/retained reds](./reports/messages-failed-http-continuation.md). Broader beta/OAuth/1hTTL and fulltools obligations remain, not wholeF/B approval.
- **Latest F slice closed:** internal queued live declared client tools from text history, strict bounded toolJSON/UTF8/genuineEOF/ownACK/authorization; default helper text-only for app/synchronous/GitHub, buffered queued still denied. `ba00f1f7c`158/158 exact4files/native28/raw14/dispatch13/core103; `b6974831c`258/258 exact12files/4partitions,1350stablehashes/lint8+white0/LSP8clean. [Live-tool evidence/retained3/9+154/4reds](./reports/messages-live-tools-continuation.md). No wholetools/app/family completion. **Next distinct F seam: original+wire client tool_use/tool_result text histories**, then remaining accepted families; all13AC retained. **Superseded by0832 continuation:** that internal queued text-history seam is now closed; native `b67ecfaf1`35/35 and shared `b54a41ea4`243/243 exact11files,1351stablehashes/lint9+white0. [History evidence/retained reds/cold fixture repair](./reports/messages-tool-history-continuation.md). Default app/sync/GitHub stays text-only. Next Messages work: production beta/OAuth/1hTTL protocol/usage/rate authority, not stripping semantics to fit fixtures; F/B still open.
- **Paused for user-requested context clear:** latestgate completed/consumed; no feature background task pending. Documentation only in this capture; no new source/test/gate/activation/commitpush. Separate [cache miss investigation](../reports/cache-miss-investigation-20261011-pi-9router.md) now includes106k/108k/172k/132k recurrence; rootcause/billingunknown, no runtimeconfig change or feature scope diversion.
- **Current continuation after0907:** [pinned beta handoff](../handoffs/api-key-budget-messages-beta-20261011-0907.md). Finite API-key queuedlive production-registry beta slice closed after separate terminalauthority repair; native183/183 + impact512/512 exact20files/5lanes/1352stablehashes/lint12white0/LSP6clean; [beta evidence/retained reds](./reports/messages-beta-continuation.md). No fullbeta/OAuth/thinking/publicapp/1happroval; F/B remainopen. Next1h usage + original tiered reference rate/snapshot, then OAuth. **0832 continuation (historical):** [tool-history handoff](../handoffs/api-key-budget-tool-history-20261011-0832.md). User confirmed prior writer stopped; direct execution resumed and history seam closed with scoped evidence. No task pending after consumed impact. **Handoff để clear context (historical first-next-action):** [fresh continuation contract](../handoffs/api-key-budget-context-reset-20261011-0801.md). Phiên mới đọc handoff → plan → remaining packets; chỉ đọc report lịch sử tại đúng seam cần tiếp tục.
- **Current continuation after1000:** [cache-tiers handoff](../handoffs/api-key-budget-messages-cache-tiers-20261011-1000.md) supersedes0907 first-next-action. Finite queuedAPIkeybeta1h raw/originalmanualrate/snapshot/recovery seam delivered; `b903d00eb`980/98048files then finalnestedguard `bc95cebb8`496/49620files,1355stablehashes/lint19white0. [Tier evidence/retained7/7+72/1reds/limits](./reports/messages-cache-tiers-continuation.md). Other485unchangeddirectinput checks reused, notnewfull981/transitiveclaim. UI6thratecolumn currentbuild/browser acceptance pending; LSP19has3inconclusive, notallclean. Next F AnthropicOAuth originalcredential/transform/generated1h/beta/refresh authority; F/Bopen, all13AC/defaultOFF unchanged. No activefeaturegate after consumedfinalreceipt.
- **Current after OAuth continuation:** [OAuth handoff](../handoffs/api-key-budget-messages-oauth-20261011.md) supersedes1000 first-next-action. Separate internal queued original/actual OAuth transform/generated1h/client-tool projection/strict refresh-CAS owner delivered. `b01a899aa`49/49 native29/projection4/real Node+SQL.js storage16; latest `b2724f2d8` **FAILED465pass/1fail**,20exactfiles/no pending,SQL.js native29/29,1360stablehashes/lint12white0. Sole catalogued legacy gotScraping header-forwarding failure retained, not relabelled green. [Evidence/retained reds/security limits](./reports/messages-oauth-continuation.md). Public app remains synchronous/OFF; thinking/server-tool/media/additional beta/app paths and other F obligations remain. No activefeaturegate after consumedreceipt.
- **Current thinking continuation:** [thinking evidence](./reports/messages-thinking-continuation.md). Internal queued OAuth explicit thinking/signed-history preservation/raw signature lifecycle delivered; native124/124 then affected `b48acd699` **FAILED506pass/1fail**,24exactfiles/no pending,SQL.js native35/35,1361stablehashes/lint16white0. Same catalogued gotScraping baseline only, retained FAILED. LSP7:1clean/6inconclusive, not allclean. Public/API-key beta thinking, original redacted history/media/server-tool/app/other F remain open; next inline media boundary. No gate running; OAuth handoff first-next-action is superseded by this entry, not its evidence. F/B still active.
- **Latest inline media continuation:** [media evidence](./reports/messages-inline-media-continuation.md). Internal queued OAuth original/actual inline image/document/tool-result image delivered under unchanged262144-byte capture/queue bounds. Native77/77 then `b9878e088` **FAILED532pass/1fail**,25exactfiles/no pending,SQL.js native41/41,1363stablehashes/lint18white0; same catalogued gotScraping baseline retained. URL/file/citations/servertools/API-key/publicapp/other F and G/T/I/V remain; F/Bopen. No feature gate running. Checkpoint commit/push preparation authorized, not completion/release.
- Scope/design/all13AC không thay đổi; no delegation/live billable calls/activation authorization. Latest user commit/push authority is stated above; older checkpoint-only restrictions are historical.

### Preflight hữu hạn trước Gói A

Đây là đối chiếu read-only/documentation, không mở đợt foundation hoặc provider implementation:

- [x] Đối chiếu dispatch inventory với source thành finite transport/protocol-family backlog B: [execution preflight](./reports/execution-preflight.md). Discovery không phải coverage certification.
- [x] Gán remaining phase/AC criteria vào A–E, phân biệt implementation và acceptance trong cùng [preflight](./reports/execution-preflight.md); giữ original criteria/failed receipts, không hydrate stale checkboxes thành missing code.
- [x] Chốt A closing tasks với named dependency/exit evidence trong [preflight](./reports/execution-preflight.md). **Preflight kết thúc; A đã đóng, B active, không tiếp tục audit vô hạn.**

Unknown có thể đọc source để giải quyết không phải product decision. Chỉ hỏi khi có lựa chọn thực sự đổi contract/support/safety; không tự cắt supported scope.

## Hướng I/O/cache đã chốt — pricing memo xong, group commit còn mở

**Ưu tiên throughput bằng group commit có ACK**, không buffer tiền trong RAM rồi trả success trước flush. Nhiều operations chia sẻ một commit; own intent ACK trước POST, own settlement/gap ACK trước eligible terminal. Queue bounded/short wait, transaction ngắn, fresh gates sau queue wait; giữ riêng identity/attempt/price/CAS/abort. Exact math/round một lần mỗi attempt, không mỗi batch.

A sở hữu cache validated immutable prices theo committed revision; B sở hữu group coordinator + cache accounting; C kiểm tra budget theo acknowledged ledger, derived spend cache chưa được chốt (benchmark trước); D crash/adapter/recovery parity; E matched I/O/throughput/latency acceptance. Không giảm WAL/FULL/fsync, không thêm Redis/DB/reservations. [Chi tiết protocol và finite tests](./reports/io-group-commit-cache-design.md), [OmniRoute comparison](../reports/omniroute-budget-pricing-performance-comparison.md). Không benchmark/gain/completion claim từ docs.

## Gói A — Reference pricing hoàn chỉnh

**Outcome:** pricing page và PricingModal quản lý reference prices; inference tiêu thụ snapshot đúng, không reprice attempt đang chạy.

**Reuse:** resolver/precedence, decimal ingress/BigInt, manual/synced/bundled mapping, bounded fixed-source sync, default-OFF scheduler, editor và coverage evidence đã có. Không xây lại.

**Closing tasks:**
- [x] Đối chiếu complete-source precedence/mapping/explicit zero/unknown và snapshot consumption với các owner families trong inventory; B sở hữu integration của owner mới.
- [x] Hoàn tất real API → pricing page + PricingModal: changed-only overrides, untouched save no-op, inherit/remove khác zero, reset dùng effective prices.
- [x] Hoàn tất offline/degraded/last-known-good và opt-in scheduler flows; không fetch catalog trên inference request.
- [x] Memo validated immutable price snapshots theo committed pricing/mapping revision + exact provider/model/endpoint; invalidate sau successful writes/reopen/health loss, không parse/hash catalog lặp khi unchanged. Preserve zero/fallback/provenance/precision/security.
- [x] Nghiệm thu auth/CSRF, fixed URL/redirect/payload/prototype guards, decimal preservation, persisted state và docs của pricing.

Current exit evidence/limits: [package-a-closure.md](./reports/package-a-closure.md). Node/SQL.js focused tests và Node real browser không certify Bun/better/fullproduct; D/E giữ obligations.

**DONE:** các closing tasks có implementation + relevant focused/API/UI/consumption evidence; không có known missing case thuộc A. Strict cached69 overprecision degradation được giữ đúng contract, không cần fetch/round/prune để xanh. Không yêu cầu implement B để chứng minh lại arithmetic đã đạt.

## Gói B — Durable accounting cho toàn bộ phạm vi inference đã nhận

**Outcome:** một client request có thể tạo nhiều upstream attempts; từng billable POST có durable intent và một terminal owner, raw exact usage + original price snapshot, settle đúng một lần hoặc unresolved đúng contract.

**Reuse:** stable identity/ledger/service, Node/SQL.js durability, OpenAI/DeepSeek chat, OpenAI embeddings, Responses JSON/SSE, Messages standard-config fixtures, Gemini native JSON/SSE và narrow Codex OAuth SSE proofs. Đây là scoped evidence, không tự approve beta/OAuth/tools/nontext/general formats hoặc all adapters.

**Execution order và exit evidence:** làm các packets **Q → F → G → T → I → V** trong [remaining work](./reports/package-b-remaining-work.md), dưới authority file này. Checklist B1–B7/B-IO dưới đây giữ đầy đủ criteria; không xem một packet/slice green là toàn Bclosed. Hoàn thiện family/seam outcome-sized, không mở audit/test vòng lặp vô hạn.

**Closing tasks (làm trọn từng family/seam đã được inventory, không một ít mỗi family):**
- [ ] B1 — Hoàn tất owners/raw schema/original-wire authority cho các supported transport/protocol families còn thiếu; định danh cụ thể ở preflight, gồm popular OAuth/specialized/binary paths thuộc contract. Không tự coi unlimited hoặc subscription là miễn accounting.
- [ ] B2 — Hoàn tất retry/refresh generation, URL/account/model/capacity/nested routing: mỗi actual generation POST một attempt; durable predecessor trước successor; không double-context/singleton key state hay local-refusal cooldown.
- [ ] B3 — Hoàn tất nested fusion/panel/judge/regeneration/late-owner và two-key concurrency races; giữ quorum/grace/ordering. Nếu nested work contract chưa rõ, giải quyết lựa chọn cụ thể, không invent fanout cap/reservation.
- [ ] B4 — Hoàn tất unhealthy-unlimited caller/config/model/selection/credentials/proxy authority ngoài narrow canonical Responses; fresh independent persisted proof và sole durable gap ACK trước dispatch. Healthy read failure không vào exception.
- [ ] B5 — Hoàn tất transport authority cần cho supported accounting: missing/lookup-failed pool, active bypass/global, disabled managed environment, no-auth/rotation/relay/SOCKS còn mở theo inventory. Không mất strict intent hoặc TLS/redirect/proxy replay protection.
- [ ] B6 — Hoàn tất native terminal/error/EOF/abort/ACK authorization và usage/pricing schema trên từng family; giải quyết hung/late owners mà không claim local cancellation đã dừng foreign work.
- [ ] B-IO — Gom accounting mutations vào bounded existing-writer group commit: own ACK trước POST/terminal, fresh gate-to-intent sau queue await, không nested per-row durable commit/deadlock; per-operation CAS/abort/duplicates và group uncertainty fail-closed. CacheRead/write đúng raw schema + original rate/fallback; local response hit0POST không recharge, actual miss/revalidation/race POST vẫn own attempt. Theo finite matrix trong I/O design, không tự thêm response-cache engine.
- [ ] B7 — Đóng dispatch inventory bằng actual-boundary tests/runtime phù hợp, original-price recovery/threshold/successor controls, secret/key isolation và docs. B sở hữu accounting path; D sở hữu full operator procedure/adapter release matrix.

**DONE:** mọi supported chat/embedding seam trong inventory hoàn tất lifecycle và relevant evidence; không known implementation gap thuộc B. Explicit pre-POST deny cho unsupported accounting là safety tạm thời, **không** coverage completion. Không phải model catalog/capability sync, không meter image generation/audio/video/search/fetch endpoints; image input trong chat không đồng nghĩa một image-generation billing feature.

## Gói C — Weekly/monthly budgets và API key UI hoàn chỉnh

**Outcome:** admin chỉnh limit và nhìn spend/remaining/reset; request bị chặn khi một trong hai recorded limits đã chạm, lỗi/header/native envelopes đúng.

**Reuse:** policy/editor/service windows/state/CAS, actual ledger/key/global UI và scoped request gates đã có.

- [ ] Hoàn tất policy API → key UI → actual inference → recorded spend → dashboard composition, kể cả null/zero/lower/raise/toggle/re-enable.
- [ ] Hoàn tất request qua Monday/month reset `Asia/Ho_Chi_Minh`, restart và attempt started ở kỳ cũ; unresolved không tự hết theo reset.
- [ ] Hoàn tất cả hai exhausted-window headers/Retry-After/no-store/CORS và native prestream/already-started errors; local refusal không cooldown/retry vòng quanh.
- [ ] Nghiệm thu overshoot/pending/unresolved display, indexed spend/intent/settlement overhead và concrete keyboard/mobile acceptance.

**DONE:** flow policy → inference → ledger → UI → reset/restart khép kín trên phạm vi B; pending không reservation, không hứa hard cap. D có thể dùng recovery prerequisites đã đạt mà không chờ toàn D xong.

## Gói D — Recovery và vận hành an toàn hoàn chỉnh

**Outcome:** operator xử lý unknown usage/gaps/restore với audit và original-price/idempotency, không reset allowance hoặc giả restored exact coverage.

**Reuse:** per-attempt/key/global recovery, durable audit/receipts/CAS, gap/maintenance, owned initialization/offline recovery và same-directory protected-intent restore evidence.

- [ ] Hoàn tất real management API/UI flows cho exact correction, explicit waiver, key/global gap và separate maintenance release, auth trước read/write.
- [ ] Hoàn tất natural lost-ACK/browser-crash/restart/replay và late callback/admin races; không lặp mutation ngầm.
- [ ] Xác định và verify supported managed restore destination/material lifecycle từ contract; giữ generation/tombstones/fingerprint material, ambiguous/missing artifacts stay blocked. Không phát triển generic disaster recovery ngoài scope.
- [ ] Nghiệm thu group ACK crash-before/during/after-commit/lost-ACK và replay, bounded drain; no POST trước own intent ACK/no synthetic terminal before settlement ACK. SQL.js one persist/group, actual adapters parity, không claim RAM queue survived kill.
- [ ] Khép kín healthy Bun SQLite/better-sqlite3 durability/crash/restore matrix cùng Node/SQL.js; unavailable phải là release blocker hoặc explicit support-contract decision, không silent skip.
- [ ] Đóng backup/import/export/downgrade/ownership/retention cases còn thiếu và runbook operator khớp UI/API.

**DONE:** supported procedure chạy đúng end-to-end, crash/replay giữ blocked/audit an toàn, all-adapter criteria có evidence hoặc quyết định support được user approve. Không power-loss/hardware/automatic antirollback certificate.

## Gói E — Nghiệm thu toàn sản phẩm

**Outcome:** đủ 13 AC với evidence còn hiệu lực và không còn unresolved release blockers.

- [ ] Giải quyết hoặc classify evidence-backed ba regression còn lại: `web_search → search`, Codex GPT-6 capability, OAuth refresh lead. Không bật search/change routing hoặc sửa assertion để xanh trái contract.
- [ ] Full-suite collection/runtime/report classification và comparator completeness; cloud/live credential gaps không biến thành pass. Selected union không phải full suite.
- [ ] Cross-feature/current-build/UI/runtime/performance acceptance, reuse unchanged inputs; kiểm tra affected identity readers/projections và compatibility.
- [ ] Matched group vs per-operation I/O benchmark: commit/persist calls, throughput, p50/p95/p99, event-loop delay/queue/memory và ledger equality; low/burst/sustained load, ledger sizes và adapters. Chốt workload/targets trước measurement; không claim tuning tối ưu khi chưa đo hoặc tăng deadline để xanh.
- [ ] Security tổng hợp auth/CSRF/key isolation/secret leaks/catalog SSRF/recovery audit/header/proxy; static coverage unavailable/inconclusive phải ghi rõ.
- [ ] Đồng bộ docs/changelog/runbook và trace đủ 13 AC; completion review trực tiếp, không delegated review hay advisor/provider swap ngoài authorization hiện hành.

**DONE:** A–D đóng và toàn bộ AC/compatibility/security/regression gates được xử lý, evidence links kiểm tra được. Hoàn tất plan **không** tự authorize production activation/commit/push/publish.

## Quy tắc thực thi và báo cáo

1. **Một gói active.** Finite preflight đã ghi trong execution-preflight; **A đã đóng, B đang làm**, C–E pending. Trạng thái: Chưa tới / Đang làm / Bị chặn (lý do) / Đã đóng. Không hydrate toàn checklist kỹ thuật thành nhiều việc đang làm.
2. **Dependency nhỏ, named consumer + exit evidence.** Hoàn thiện đúng dependency rồi quay lại gói; không mở audit toàn subsystem vì tiện tay.
3. **Phát hiện mới:** blocker gói hiện tại → xử lý; gói khác → ghi đúng chủ quản; ngoài scope → báo, không tự triển khai. Giữ nguyên accepted scope; chỉ user approve scope/support change.
4. **Verification phục vụ DONE:** focused/changed lint tại boundary; broad callers/build/runtime khi impact hoặc integrated milestone cần. Không lặp tương tự chỉ để thêm green count. Không weaken tests/deadlines/SSRF; giữ red receipts. Freeze source/tests/harness trong gates.
5. **Đã đóng không mở lại tùy tiện.** Chỉ reopen vì regression, evidence invalidated bởi relevant change, hoặc criteria gốc chưa đạt; ghi lý do và affected checks. Không claim thay đổi shared code không ảnh hưởng feature khác.
6. **Báo cáo theo deliverable:** gói/packet đang làm, closing tasks còn lại, blocker, evidence xác nhận và bước đóng tiếp theo. Test counts là supporting evidence, không completion percentage/ETA.
7. **Ưu tiên triển khai phần thiếu, không tích lũy green:** reuse evidence còn hiệu lực; focused → actual-boundary → một impact gate tại coherent milestone. Source inspection/fixture schema trước test để tránh lỗi fixture. Rerun successful broad lanes chỉ khi relevant inputs thay đổi hoặc một obligation chưa được kiểm chứng. Missing protocol authority phải báo blocker cụ thể, không đoán counters hay lặp tests vô hạn.

## AC và technical-reference mapping

| AC | Chủ quản | Technical references |
|---|---|---|
| 1 stable identity/isolation | B; D giữ binding/restore; E tổng hợp | Phases 01, 03, 04 |
| 2 dual weekly/monthly | C | Phases 03, 05 |
| 3 calendar/restart | C; D restore không reset | Phases 03, 06 |
| 4 unlimited/no-key | B; C policy; D gap reconciliation | Phases 01, 03, 04 |
| 5 chat/embedding/fallback/fusion | B | Phase 04 |
| 6 idempotency/cache/reasoning | B; A pricing; D recovery | Phases 01–04 |
| 7 concurrency/overshoot | B; C UI/performance | Phases 03, 04 |
| 8 abort/unknown/storage | B; D crash/recovery | Phases 01, 03, 04, 06 |
| 9 pricing/snapshot/mapping | A; B owner integration | Phase 02 |
| 10 migration/retention/adapters | D; B consumer prerequisites | Phases 01, 06 |
| 11 auth/leaks/no cooldown | Từng gói tại boundary; E tổng hợp | Phases 01, 04–06 |
| 12 dashboard completeness | A pricing; C budgets; D recovery | Phase 05 |
| 13 tests/lint/regression/docs | Từng gói; E cuối cùng | Phase 06 |

Technical detail links: [01 Storage](./phase-01-start.md), [02 Pricing](./phase-02-pricing-catalog.md), [03 Service/windows](./phase-03-budget-accounting-service.md), [04 Routing](./phase-04-routing-integration.md), [05 API/UI](./phase-05-admin-api-dashboard.md), [06 Verification](./phase-06-verification-rollout.md). Checkboxes/state/effort lịch sử không tự là current remaining backlog; criteria gốc vẫn bắt buộc. Nếu mapping thiếu một criterion, bổ sung vào gói chủ quản, không drop.

## Historical evidence checkpoint — không live task state

Current checkpoints/receipts nằm ở [remaining packets](./reports/package-b-remaining-work.md) và [package B execution](./reports/package-b-execution.md). Các bullets dưới đây giữ provenance; trạng thái “A chưa đóng/build đang chạy” đã được supersede, không phải restart instructions.

- Latest affected caller `b1173dfb3`: **FAILED1549/3, exact69 files/1552 complete**, lint/white0, 1507 unchanged inputs; `/tmp/9router-image-dns-caller-HtB2gJ`. Ba failures ở E vẫn unwaived; hai Codex image cases đã pass sau fixture-only DNS contract repair. Original failed gates retained.
- Image fixture controls: `bf18d19a7`13/13 và `bc225aefb`23/23. Production SSRF guard không đổi; mocked DNS/Agent không chứng nhận full socket/security.
- Strict pool conflict runtime `b556fca81`: actual Node SQLite/SQL.js6 groups mỗi engine, active1POST1CONNECT và other5denials0POSTCONNECT; build/WASM/1517stable, `/tmp/9router-proxy-policy-runtime-MXxnoD`. Normal healthy no-key auth/core HTTP pool only; no fullproxy/alladapter approval.
- Native owners/ledger/recovery/pricing có scoped evidence trong reports. Reuse chỉ khi source/input/environment liên quan vẫn hợp lệ; không rerun native prerequisites vì tổ chức lại docs.
- Current A checkpoint: scoped pricing109/109 + sync69/69 + serving-startup77/77; latest source includes startup repair not yet real-restart accepted. Two900s current-build timeouts retained; last compile succeeded13.6min then generation cut off. Cache-warm same-input build exit137; session OOM counter1/peak~11.7GiB, exact attribution unproven. Owner-approved single2worker/4GiBboundedbuild alsoexit137; OOMcounter1→2, configbyte-restored/hashconfirmed. Owner requested continue; diagnostic b57e5d678 uses sequential isolated webpack workers (default disabled by custom callback), native memory optimizations/cpus1/3GiBheap, same900s; config backed up/restore and RSS receipts required. No browser acceptance until verified build. [Build diagnosis](./reports/build-verification-diagnosis.md). Production OFF; no feature/package accepted complete.

Evidence references: [acceptance matrix](./reports/acceptance-closure-matrix.md), [remaining-delivery evidence](./reports/remaining-delivery-contract.md), [dispatch history/inventory](./reports/dispatch-inventory.md), [pricing evidence](./reports/pricing-evidence.md), [pricing coverage](./reports/pricing-coverage-inventory.md), [storage evidence](./reports/implementation-evidence.md).

<a id="validation-log"></a>

## Historical record và handoff

Validation Session 1 và toàn bộ Q&A/consistency sweep được giữ trong exact snapshot dưới đây và [source audit](./reports/validation-session-01.md). Session 1 supersedes conflicting prior planning claims, không xóa report cũ hoặc thay quyết định gốc.

[Exact original plan snapshot](./reports/plan-history-before-feature-packages.md) giữ toàn bộ checkpoint/validation/history trước lần tổ chức lại, SHA256 `4030809a06e9de2aca26baf934503bf97e2a526a8f1aeb3563240da395d1056b`. Snapshot và reports có historical pending/running statements; chúng không phải live state hoặc execution order hiện hành. Không xóa/đổi failed receipts.

Execution order cũ trong reports/phase files bị supersede bởi Gói A–E ở đây, **không** bởi thay đổi design contract. Handoff cũ [pause/resume](../handoffs/api-key-budget-pause-20261008-0515.md) là provenance, không restart instructions.

Current execution: `/ak:cook --auto` authorize direct implementation. Finite preflight hoàn tất; **A đã đóng, B active** theo [remaining delivery packets](./reports/package-b-remaining-work.md) → đóng B → C → D → E. Sau clear context bắt đầu tại [current handoff](../handoffs/api-key-budget-messages-cache-tiers-20261011-1000.md), không chạy lại foundation hoặc stale gates. Historical docs-only authorization đã được invocation này supersede, không authorize production activation/commit/push/live billable calls. Các quyết định gốc giữ nguyên: no-history debit, nanoUSD exact math, fixed timezone, no reservations, durable gap-only unlimited exception, JWT/verified-loopback management và managed restore. Không hỏi lại settled decisions.

<!-- slug: api-key-quota-budget-pricing -->
