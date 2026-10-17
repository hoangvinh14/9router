# Proposal — đối chiếu nested queued runtime Vitest / Node

Ngày: 2026-10-17. Trạng thái: **DESIGN COMPLETE / EXECUTION NOT AUTHORIZED**.

User đã chọn phương án A và yêu cầu brainstorm ngay. Tài liệu này chốt thiết kế; không phải runner đã được implement, parity đã được kiểm chứng động hoặc quyền chạy diagnostic. Không mở lại các quyết định product đã chốt.

## 1. Contract

- **Outcome:** phân biệt ảnh hưởng của harness tổng thể tới nested-positive trước khi chọn sửa harness hoặc implementation; không chỉ đạt HTTP200.
- **Constraints:** source/queued authority/SQL/transport/assertions và các boundary không đổi; collector1000ms/quorum2/grace5ms; test/hook deadlines, cancellation và late-owner lifecycle giữ nguyên; dummy loopback/disposable HOME/DATA_DIR; giữ failed receipts và unrelated WIP.
- **Non-goals:** production optimization, public queued activation, benchmark certification, production-build acceptance, whole B closure, redesign writer/collector hoặc chứng minh historical5vs4 bằng run khác.
- **Acceptance của thiết kế:** mechanism và parity obligations cụ thể, falsifiable hypotheses, scope/budget/artifacts/stop conditions hữu hạn. Những phần cần implementation để xác minh phải đánh dấu chưa chứng minh, không trình bày feasibility như kết quả chạy.

Handoff: [nested-runtime-brainstorm-handoff](./nested-runtime-brainstorm-handoff-20261017.md). [Detailed authority/diagnostics](./base-post-intent-authority-20261016.md). [Design contract](../design-contract.md), [plan](../plan.md), [acceptance](./acceptance-closure-matrix.md).

## 2. Evidence đọc trực tiếp trong phiên brainstorm

1. `src/sse/handlers/chat.js:116` gọi `createRequestAccounting(request)`; `src/lib/apiKeyBudget/requestAccounting.js:48` mặc định queued=false. Production endpoint thông thường không đối chứng được queued fixture.
2. `tests/unit/accounting-queued-fusion-app.test.js:15–85`: engine acquisition, provider URL, native proxy observer, usage stubs, combo/core observers và request-accounting wrapper. Accounting wrapper gọi actual với queued=true, giữ exact handle, rồi hold delivery. Không thay bằng fake ledger/row ACK.
3. Fixture `:105–177`: setup imports, resetModules, global adapter reset, real importDb/pricing/combos seed và setup importActual; `:229–255` drain owners trước close/remove DB. `:379–430` là selected deliver body, bao gồm held pending/three originals và final identities/money assertions.
4. `src/lib/apiKeyBudget/requestAccounting.js:23–44,63–67` dùng private WeakMaps cho provenance/authority. `open-sse/config/accountingGeminiOwnedRequestOwner.js:6–14` có dynamic back-edge về issuer. Không được tạo hai actual issuer instances bằng URL aliases hoặc importActual bypass.
5. `src/lib/db/driver.js:7–8,19–23,138–146`: global adapter state, Node>=24 bỏ better-sqlite3, getAdapter vẫn assert ownership. `engineAcquisition.js:32–41` phân biệt missing engine với fatal factory errors; loader phải preserve.
6. `open-sse/services/combo.js:506–539,620–623`: collectPanel/timers; nhánh inner là một panel của outer. `:665–673` single successful answer có thể phát sinh fresh regeneration, không phải outer judge.
7. `.pi/fusion-app-continuation-20261016/nested-isolated-http.config.mjs`: child vẫn phải chờ parent chạy fixture.network/assertions/response generation. Không tái sử dụng topology này như independent responder proof.
8. `open-sse/config/appConstants.js:209` dùng createRequire(import.meta.url). Native loader tại source URL giữ đường tìm package/resource tốt hơn copy/bundle tùy tiện.
9. Local capability inspection: Node **v24.21.0**, node:module.registerHooks là function, process.sourceMapsEnabled=false. Đây chỉ là API availability, chưa chứng minh loader sẽ chạy được toàn graph.
10. Installed assertion/spy helper packages `@vitest/expect` và `@vitest/spy` đều **4.1.11**. Có thể thiết kế reuse để tránh tự thay comparator/spy, nhưng standalone initialization parity chưa được kiểm chứng.
11. Fresh read-only reconciliation: HEAD `094e2d61ecaeb424a7dff12a9ba9b54e43da51d1`; tất cả **1866** entries trong candidate-v2-inputs.json khớp, missing0/changed0. Đây là preservation, không functional verification; chưa re-certify riêng mọi untracked/protected report ngoài dictionary.

## 3. Chọn mechanism: native loader, không bundle

### Hai lane

- **A — Vitest control:** original fixture + một external transform giới hạn observation. Một selector deliver, một worker, một process mới mỗi sample.
- **B — native Node diagnostic:** Node registerHooks resolver/load hooks; chạy fixture-derived setup/body/teardown, không Vitest runner, Vite transform server hoặc Vite stack mapper. Giữ pinned assertion/spy leaf packages nếu standalone integration parity đạt.

Vì vẫn reuse assertion helpers, tên chính xác là **Node không dùng Vitest runner/Vite runtime**, không phải không có bất kỳ package @vitest nào. Không sửa Error.prepareStackTrace hoặc tắt source-map của lane A. Native source-map policy/stack handler phải được ghi nhận; khác biệt là biến thử nghiệm, không bị che giấu.

### Fixture-derived, không viết một test dễ hơn

Generator chỉ lấy các đoạn cần thiết từ frozen fixture: fixture state, required factories, setup, configureNestedFusion, request helper, selected deliver callback, teardown. Ghi source span/hash cho từng đoạn; transformations phải match một lần và fail khi anchor lệch. Không tạo generic Vitest emulator và không tự port toàn suite.

Selected callback phải giữ toàn bộ assertions trước/sau release và finally. Mọi binding sửa đổi được liệt kê; không bỏ assertion SQL khỏi network callback hoặc di chuyển sang afterEach. Reuse đúng matcher/spy implementation/version thay vì thay toEqual bằng comparator khác. Standalone helper state/plugin initialization phải được review và kiểm tra bounded micro-controls trước request matrix; nếu không tương đương thì dừng, không tự viết matcher mới cho qua.

### Resolution và exact module identity

- Resolver canonicalize `@/`, `open-sse/`, relative extensionless imports theo repository aliases; allowlist mapping rõ ràng, không đoán mọi unknown import.
- Actual modules giữ filesystem origin để relative imports, createRequire và resource paths đúng. Không bundle/copy toàn app; external dependencies giữ cùng installed resolution và Node conditions.
- Mỗi project module có đúng một actual instance trong mỗi graph generation. Mock facade là URL riêng; chỉ importActual của fixture/observer bypass facade, không làm toàn dependency graph bypass mocks.
- Các imports đi tới cùng target phải canonicalize về cùng actual hoặc facade theo mock table. Không thêm query-string ngẫu nhiên vào mỗi call. Circular imports/back-edges phải map về cùng issuer; facade exports phải khớp mock factory, không tự mở thêm exports để chữa cycle.
- `vi.resetModules` không được thay bằng no-op chỉ vì mỗi sample có process riêng: fixture đã import graph trước reset. Dùng graph generations cho project modules, cập nhật generation đúng tại reset; dependencies ngoài repo không nhân bản tùy tiện. Core/combo/requestAccounting observers tiếp tục resolve actual current generation mỗi invocation như fixture, không cache closure để giảm overhead.
- `global._dbAdapter`, catalog globals, driver/error class/authority identities phải kiểm tra consistency trong current generation trước request. Không add public provenance bypass. Nếu graph-generation emulation không giữ được behavior thì report parity blocker, không bỏ reset hay đổi original fixture.

### Thay mock có kiểm soát

| Seam | Lane B dự kiến | Bằng chứng parity cần có |
|---|---|---|
| engineAcquisition | Delegate actual, native engine env như A | Assert actual node:sqlite; không fake ownership/durability |
| providers config | Exact factory overlay, live getter URL | Same exports/transport properties; dummy loopback only |
| proxyFetch | Native actual fetch + same refusal observer | Same proxy settings/bypass/routing gate; không mock network |
| usageDb | Cùng no-op/legacy spy exports | No legacy accounting call; không ghi HOME thật |
| combo/core | Cùng promise observer/owners tracking, resolve actual current graph | Không thêm/bỏ await hoặc biến detached owner thành awaited collector |
| requestAccounting | Cùng options queued:true, current driver, ctx wrapping và hold callbacks | Exact issued handles/private maps remain actual; pending row không cấp ACK |
| assertions/spies | Cùng pinned leaf implementation và needed state | Matcher/call-count/reset semantics giữ; chưa verified standalone |
| module reset | Generation switch theo đúng setup order | Single current issuer/Error graph; no stale executor/provider URL |
| deadlines/cleanup | Same test20s; hook budgets lấy từ effective pinned config | Timer boundaries trước setup/body/teardown đúng; timeout không success, drain không bị lược |

Đây là obligations cho implementation, **không phải các hàng đã pass**.

## 4. Topology, observations và environment

Giữ original HTTP server **cùng process với app** trong cả hai lane. Không lấy isolated-child variant làm control, không thêm independent responder: thay topology đồng thời sẽ mất khả năng phân biệt runtime harness.

Chỉ in-memory bounded stage marks, flush sau drain; cùng transform cho hai lane tại collector start/end, fixture intent/completion delivery, actual POST receipt, app result và owners drain. Không thêm DB query/stack formatting trong critical path. Existing selected assertions vẫn nguyên vị trí. Không import profilers hoặc bật FUSION_APP_TIMING diagnostic wrappers; không reuse dispatch-spans guard instrumentation nặng.

Mốc authoritative: phân biệt actual ctx promise delivered với wrapper owner-delivered sau hold. Record inner intent hold/release, completion owner delivery và outer dispatch; originalPrice/ledger checks là assertions gốc, không thay bằng event labels.

Mỗi sample fresh process/HOME/DATA_DIR, same cwd, Node binary, dependencies, NODE_ENV và proxy env policy. Giữ setup-only imports sẵn có; không thêm inference/network/ledger warm-up. Không chạy production mode ở B khi A chạy test mode. Vitest-specific env/runtime flags là khác biệt được record; không giả lập blanket VITEST=true hoặc đổi app branch ngầm.

No live providers. Chỉ metadata allowlisted; không trace header/body/credential/SQL bindings hoặc dump environment. Fixture bodies chứa dummy data nhưng vẫn không cần đưa vào trace.

## 5. Preflight trước matrix (cần quyền implementation riêng)

1. Freeze source/test/helpers/config/dependency versions và current protected WIP hashes; so với historical dictionary, dừng nếu drift chưa reconcile. Không restore hoặc overwrite user's changes.
2. Implement diagnostic artifacts duy nhất trong `.pi/nested-runtime-comparison-20261017/`; không sửa src/open-sse/tests hoặc deadlines.
3. Static extraction/transform manifest: selected source spans, exact exports, alias map, identity policy, effective config/deadlines. Có source→generated diff và hashes. Không production build.
4. Tối đa một lượt parity validation hữu hạn: pure matcher/spy positive+negative controls, resolver/generation/cycle identity controls, fixture selection/phase-order inspection và import/setup capability checks trong disposable environment, **zero handleChat/request dispatch**. Inventory controls phải khóa trước launch. Không mất thời gian tuning variants; thất bại thì dừng sửa/chạy vòng tiếp để xin scope mới.
5. Preflight import/setup probes được đếm/receipt riêng, không gọi là zero execution và không tái dùng process/DB của probes cho matrix. Không warm-up samples. Probe setup writes nếu cần chỉ disposable DB, không production. Trước matrix phải chứng minh đúng config budgets; không đoán hook timeout từ test timeout.
6. Review generated runner/diff và parity results. Có thể hoàn thành bước này rồi yêu cầu duyệt matrix, không cần brainstorm lại phương hướng.

Giới hạn: static inspection hoặc zero-request preflight không chứng minh toàn bộ behavioral parity. Matrix là nơi kiểm tra actual ACK/POST/money; nếu xuất hiện mismatch mới, kết quả invalid/inconclusive, không chứng minh production failure.

## 6. Ngân sách matrix đề xuất — chưa được chạy

- Một scenario duy nhất: `nested inner judge own intent delivery revalidates authority before POST: deliver`.
- Một adapter: asserted node:sqlite. SQL.js vẫn là nghĩa vụ acceptance riêng, không scope waiver.
- **Tối đa 4 inference requests theo A1 → B1 → B2 → A2**; không concurrency, mỗi sample process/DB mới.
- Mỗi sample một selected test/request; không retry tự động. Ordinary readiness failure có receipts/invariants an toàn cho phép hoàn tất remaining scheduled slots; integrity/semantic failure dừng ngay.
- Hook/test deadlines preserve effective original config, collector1000/quorum2/grace5; wrapper watchdog tối đa300s/sample như stage runner cũ, chỉ containment, không kéo dài test/hook. Khi watchdog thắng: fail/incomplete receipt, dừng matrix, cleanup chỉ owned child processes.
- Không CPU profile, bổ sung optimization variant, thay source-map flag để kiếm xanh hoặc thêm repetitions nếu noisy. ABBA giảm một phần order effects, không làm bốn sample thành thống kê production.

## 7. Evidence, hypotheses và decision table

**H1:** harness tổng thể góp phần quyết định vào positive readiness failure. **H2:** phần công việc còn lại vẫn quá chậm trong fixture1000ms khi không có Vitest runner. **H3:** interaction/noise/parity mismatch không cho attribution đáng tin.

Mỗi sample phải có per-assertion reached/unreached/failure status (không đổi assertion execution), monotonic boundary trace, exact model/attempt identities, final JSON, terminal exit, own cleanup/drain status và before/after hashes. Raw trace IDs request-local, không authority secrets. Output B là native result JSON, không giả là Vitest JSON. Parent supervisor ghi terminal receipt ngay cả khi test body không hoàn tất; missing body JSON không phải pass.

Required positive: held inner intent trước app response; trước release originals3settled200000/innerpending/noinnerPOST; sau release inner ownPOST→completionACK→outer admission; fixture-judge content; models a,b,c,innerjudge,outerjudge đúng5; one request/distinct attempts/own sinks/original200000 per attempt và legacy0. Không đếm năm POST fallback như đúng5models.

| Quan sát | Kết luận được phép / bước kế tiếp |
|---|---|
| A1,A2 fail cùng boundary; B1,B2 đầy đủ positive; parity không sai | H1 được hỗ trợ cho scenario này. Đề xuất sửa harness cụ thể; chưa chứng minh Vite/source-map riêng là cause hoặc production đạt SLA |
| A và B cùng fail cùng boundary | Bỏ Vitest chưa đủ. Giữ blocker; chưa được quy lỗi cho ownership hoặc cho phép bỏ guard |
| Cả hai đều pass | Không tái hiện blocker trong phép đo; không giải thích historical failures, không acceptance replacement |
| Mixed results, boundary khác, hoặc B fail/A pass | Inconclusive/runner issue; không chọn optimization từ một sample |
| Module identity/options/assertion order/config khác | Invalid comparison; không dùng timing để kết luận |

Stop ngay nếu source drift, authority/cleanup invariant vi phạm, ngoài-loopback dispatch, thiếu JSON/receipt, budget hết hoặc parity sai. Không tự thêm một phép đo thứ năm.

## 8. Trade-offs và better approach

- **Native loader (chọn):** giữ file origin, dependencies và source dễ audit; tránh bundling/schema changes. Giả định: mock/reset/module identity emulation bounded và chính xác. Hỏng trước ở cycle hoặc standalone helper/reset semantics. Chi phí chủ yếu là diagnostic loader, không sản phẩm.
- **Prebundle/copy app:** đơn giản entrypoint hơn nhưng import.meta/resources/dynamic imports/identity dễ đổi; giả định bundle giữ toàn graph semantics. Hỏng trước ở package/resource resolution hoặc duplicate issuer. Không chọn.
- **Next production build + endpoint:** gần deployment hơn nhưng hiện queued injection/ACK barriers không tồn tại tại public entry. Giả định có equivalent private injection seam đã verified; hiện chưa có. Hỏng trước ở việc đo nhầm synchronous path hoặc mở public activation. Không chọn cho experiment này.

**Better approach:** cụ thể hóa phương án A bằng native loader thay vì xây production bundle trước. Evidence: queued được fixture-inject, source có private WeakMaps và createRequire(import.meta.url). Delta: đo same internal queued graph dưới native module execution, không mở endpoint/activation. Cost: loader/facade/parity work hữu hạn. Không claim hướng này đã được dynamic-proven.

Không phát triển mini test framework đa dụng. Nếu cần sửa authority/collector hoặc dựng loader quá rộng để giữ parity, dừng và báo không khả thi trong scope; không biến diagnostic thành một platform project.

## 9. Artifact scope và security

Proposed artifact root: `.pi/nested-runtime-comparison-20261017/` gồm frozen-input/transform/parity manifests, fixture-derived module, native loader/facades, Vitest observation config, bounded supervisor và per-sample JSON/receipts/traces. Có thể gộp helper files; không edit frozen production/test bytes. Source maps không phải quyền đọc/upload private paths; không upload raw artifacts.

Giữ riêng stale-authority patch trong `requestAccounting.js`/`accountedBase.js`. Scoped direct-socket receipts không đóng native/SQL.js actual-app positive, Gemini missingJSON, unhealthy/Base partial receipts hoặc original bytewise. Patch **UNACCEPTED WIP**, Bonly/all13ACOPEN/C–Epending/enforcement/public/synchronousOFF. Proposal không phải security certification.

## 10. Quyết định thực thi cần duyệt — không brainstorm thêm từ đầu

Khuyến nghị bước tiếp theo: **cho phép implement diagnostic runner và đúng một lượt parity preflight zero-inference**, sau đó trình artifact/diff/results và dừng trước matrix. Nếu parity fail, báo nguyên nhân và dừng; không nối variants. Nếu pass, operator chỉ cần duyệt matrix4slots đã mô tả, không mở lại outcome/constraints.

Unresolved (discoverable khi implementation, không bắt user đoán): standalone helper initialization; exhaustive alias/cycle identity behavior; exact effective hook/config budgets và zero-inference probe inventory; generated-graph parity at actual dispatch. Các điểm này là pending evidence, không lý do trì hoãn đề xuất mechanism.

**Trong phiên này:** chỉ đọc source/artifacts, inspect Node module API, reconcile1866hashes và ghi proposal; không runner/build/test/profile/request, không production/test edits, không delegation/commit/push/live calls/DB operations.
