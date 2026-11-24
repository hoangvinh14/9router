---
title: "API-key budget — clean integration từ synced master"
description: "Bảo toàn WIP trong cùng checkout, rồi selective port các vertical slices đáp ứng B01–B08 từ develop."
status: in-progress
priority: P1
effort: "Chưa ước lượng đáng tin trước dependency/evidence gates; không cam kết ETA"
branch: feat/api-key-budget-integration
integrationBranch: feat/api-key-budget-integration
baseline: 1855aa44473e88feac9d3f131b9c0c5fc9706b68
tags: [feature, api, database, auth, critical]
blockedBy: []
blocks: []
created: 2026-11-14
---

# Implementation plan — API-key budget, clean integration

## Cách tiếp tục đã chốt — 2026-11-24

Owner yêu cầu tự triển khai liên tục trong phạm vi đã chốt cho đến khi đạt các tiêu chí nghiệm thu của plan. Tự thực hiện, kiểm thử, sửa lỗi có thể xử lý, cập nhật plan, rồi commit và push phần đã kiểm chứng lên nhánh tích hợp theo quyền đã cấp. Báo mốc trung gian trong lúc làm và tiếp tục ngay các việc đã được giao.

Chỉ dừng chờ owner khi có quyết định quan trọng cần duyệt, chẳng hạn đổi phạm vi, đổi hành vi tính hoặc chặn budget, triển khai lên instance thật hay thao tác lên dữ liệu thật. Trước khi hỏi, hoàn tất phần việc độc lập còn làm được và nêu rõ quyết định cùng ảnh hưởng của nó. Khi một bước gặp lỗi hoặc thiếu bằng chứng, xử lý trong phạm vi hiện có và tiếp tục phần độc lập. Nếu mọi đường đều bị chặn, báo rõ nguyên nhân và điều kiện để làm tiếp. Đoạn này là chỉ dẫn thực thi hiện hành cho mọi phase. Các mốc và yêu cầu xác nhận lịch sử không mở lại quyết định đã chốt.

**Current continuation:** owner đã authorize sync master, tạo integration branch trong checkout hiện tại và tiếp tục tự động trong phạm vi plan. Phase00 transition đã verified; xem [execution record](./references/phase00-execution.md) và [fresh integration baseline](./references/integration-baseline.json). Owner đã authorize commit và push phần hoàn tất lên nhánh tích hợp. Deploy, live inference và sử dụng dữ liệu hoặc dịch vụ thật nằm ngoài lần nghiệm thu offline này. Các đoạn planning/Validation Session 1 bên dưới là chronology, không phủ nhận authority mới và không cấp thêm producer/policy/sandbox authority. `blockedBy: []` không có nghĩa positive slice ready.

## Phạm vi đã chốt — 2026-11-23

Dùng SQLite hiện có của 9Router. Mỗi API key bắt đầu ghi chi phí từ khi bật budget, với lịch sử và số đã dùng của tính năng bắt đầu từ 0. Dashboard hiển thị hạn mức, số đã dùng và số còn lại. Khi chi phí đã ghi đạt hoặc vượt hạn mức, request kế tiếp bị chặn trước POST upstream. Phạm vi triển khai và nghiệm thu loại bỏ nhập hoặc chuyển đổi dữ liệu từ schema budget thử nghiệm v2–v4 của nhánh develop. Docker nội bộ dùng lại volume SQLite hiện có, tự sao lưu đầy đủ trước lần nâng cấp đầu, chạy migration hiện có của 9Router rồi thêm các bảng budget. Lần khởi động sau kiểm tra schema và đọc tiếp dữ liệu đã ghi. Ca nghiệm thu từ database có key sẵn đã kiểm chứng số dư ban đầu bằng 0, một khoản mới và chặn sau khi khởi động lại. [Kiểm chứng SQLite hiện có](./phase-04-integrity-and-migration.md#success-evidence).

Đơn giá dùng để trừ budget được đồng bộ từ nguồn bên ngoài. Giá nhập tay trên dashboard không ảnh hưởng budget. [Nguồn đơn giá và tiêu chí nghiệm thu](./phase-03-native-retry-and-compatibility.md#nguồn-đơn-giá-budget--quyết-định-2026-11-23).

## Thứ tự triển khai đã xác nhận

1. **`9router-2` (20133).** Ưu tiên Codex OAuth `gpt-6.2-sol` qua `/v1/responses` streaming. Bổ sung `/v1/chat/completions` SSE và JSON cùng API key và hạn mức.
2. **`9router` (20132).** Tiếp theo là Claude OAuth native Messages. Nghiệm thu `claude-opus-5-5` streaming có tool, thinking và cache, cùng `claude-sonnet-5` JSON qua combo đã chọn.

[Tiêu chí Phase 03](./phase-03-native-retry-and-compatibility.md#luồng-đã-xác-nhận-trên-hai-instance).

## Phạm vi model — quyết định 2026-11-24

Budget cần hỗ trợ toàn bộ model 9Router định tuyến qua Anthropic và OpenAI, gồm các kết nối API và Claude/Codex OAuth đang dùng. Các model nêu trong phần nghiệm thu là mẫu đại diện. Việc thêm model không cần sửa danh sách model trong code budget.

Tái sử dụng catalog, định tuyến và bộ đọc usage của từng giao thức. Đồng bộ giá từ nguồn bên ngoài và chọn giá theo model thực tế, loại kết nối và trường hợp tính phí. Khi thiếu giá áp dụng, báo rõ để tránh gửi request có budget mà không thể tính chi phí. Nghiệm thu phải có ít nhất một model mới được nhận qua đồng bộ giá và hai model khác nhau cùng ghi vào một budget. Các model và luồng chưa triển khai vẫn thuộc phạm vi còn mở.

## Tiêu chí còn mở sau nghiệm thu nội bộ

Bốn luồng Docker Linux amd64 đã kiểm chứng ghi chi phí theo API key và chặn lượt kế ở đúng hạn mức, kể cả sau restart. [Kết quả nghiệm thu](./phase-03-native-retry-and-compatibility.md#nghiệm-thu-claude-oauth-standard-trên-docker-nội-bộ).

- Anh tự build và nghiệm thu image Docker mới nhất. Bỏ bước này khỏi tiêu chí đóng plan của phiên triển khai theo quyết định ngày 2026-11-24. [Bàn giao nghiệm thu](./phase-05-acceptance-and-handoff.md#completion--handoff).
- Phase 03 đã kiểm chứng retry có điều kiện cho Claude/Codex, chuyển đổi hai lượt qua Chat/Responses và tính giá OpenAI API-key theo model bằng HTTPS loopback và SQLite. Các điều kiện chưa đạt gồm cutoff usage khi stream bị ngắt, proxy cho key có budget và model/tier chưa có giá áp dụng. [Bằng chứng Phase 03](./phase-03-native-retry-and-compatibility.md#nghiệm-thu-tích-hợp-ngày-2026-11-24).
- Codex Standard bổ sung Chat Completions SSE và JSON dùng chung budget với Responses. Khi phản hồi hoàn tất mà thiếu usage, tính phần ước tính có thể xác định theo cách OmniRoute và chặn theo tổng đã ghi. [Phạm vi và cách tính](./phase-03-native-retry-and-compatibility.md#chat-completions-và-usage-ước-tính).
- Ma trận runtime ngoài Docker Linux amd64 vẫn mở. Rollout trên hai instance đang chạy là quyết định riêng. [Ma trận nghiệm thu](./phase-05-acceptance-and-handoff.md#acceptance-matrix-beyond-helper-tests).

## Đối chiếu OmniRoute cho các mục follow-up

Đối chiếu mã upstream tại `474f533172b8f7cc5cebae51810237a7babed876`. Cả ba khả năng đều có trong OmniRoute ở cấp ứng dụng. Giữ các mục tương ứng trong plan, với phạm vi kiểm chứng cụ thể sau đây.

- **OAuth refresh/retry.** OmniRoute xử lý 401/403 đủ điều kiện bằng refresh rồi thử lại trong cùng luồng streaming. 9Router cần kiểm chứng hành vi tương ứng trên luồng có budget, dùng lại pipeline đang có và kiểm tra hạn mức trước lần gửi kế tiếp. [Luồng refresh và retry](https://github.com/diegosouzapw/OmniRoute/blob/474f533172b8f7cc5cebae51810237a7babed876/open-sse/handlers/chatCore/streamingResponse.ts#L688-L818).
- **Chuyển đổi giao thức.** OmniRoute chuyển Claude sang OpenAI Chat, giữ các khối thinking đã ký hoặc bị che theo phiên tool call và khôi phục khi chuyển request về Claude. Giữ mục chuyển đổi có bằng chứng này. Đường Responses có thể dùng cùng bộ dịch trung gian, với nghiệm thu riêng cho ánh xạ ID và continuity. [Lưu continuity](https://github.com/diegosouzapw/OmniRoute/blob/474f533172b8f7cc5cebae51810237a7babed876/open-sse/translator/response/claude-to-openai.ts#L42-L76) · [Khôi phục continuity](https://github.com/diegosouzapw/OmniRoute/blob/474f533172b8f7cc5cebae51810237a7babed876/open-sse/translator/request/openai-to-claude.ts#L858-L885).
- **Runtime.** OmniRoute có Docker AMD64 và ARM64, CI trên Linux và Windows, và tài liệu hỗ trợ Bun. Các nguồn này xác nhận hỗ trợ runtime của ứng dụng. Ma trận nghiệm thu budget riêng trên từng runtime vẫn chưa được đối chiếu. [Docker](https://github.com/diegosouzapw/OmniRoute/blob/474f533172b8f7cc5cebae51810237a7babed876/.github/workflows/docker-publish.yml#L286-L299) · [CI](https://github.com/diegosouzapw/OmniRoute/blob/474f533172b8f7cc5cebae51810237a7babed876/.github/workflows/ci.yml#L1070-L1078) · [Bun](https://github.com/diegosouzapw/OmniRoute/blob/474f533172b8f7cc5cebae51810237a7babed876/README.md#L1133-L1139).

OmniRoute áp dụng kiểm tra budget theo provider/model và phân loại Claude Code OAuth theo thuê bao cố định. 9Router vẫn tính giá tham chiếu cho Claude OAuth theo phạm vi đã chốt. [Kiểm tra budget theo đích](https://github.com/diegosouzapw/OmniRoute/blob/474f533172b8f7cc5cebae51810237a7babed876/src/sse/handlers/chat.ts#L1825-L1826) · [Phân loại thuê bao](https://github.com/diegosouzapw/OmniRoute/blob/474f533172b8f7cc5cebae51810237a7babed876/src/lib/usage/flatRateProviders.ts#L41-L52).

## 1. Authority và outcome

Nguồn quyết định là [brainstorm contract B01–B08, đặc biệt §8](../261113-1952-api-key-budget-scope-audit/references/brainstorm-contract.md), [handoff](../261113-1952-api-key-budget-scope-audit/references/branch-handoff.md), và [audit §§3–8/11](../261113-1952-api-key-budget-scope-audit/references/audit-report.md). Không lập lại audit cũ, không hỏi lại key-vs-account, block-vs-monitor, master-vs-develop hay worktree.

- Budget theo **stable 9Router API-key ID**, không theo tên key/login Claude/Codex.
- **Block-next theo recorded spend**, không reservation/hard cap. Request đã admitted/in-flight có thể làm vượt hạn mức. Không trừ tiền lúc intent, không reserve pending.
- Branch integration mới từ **master đã sync**, trong **checkout hiện có**. Develop giữ làm donor/rollback reference, không merge toàn bộ/cherry-pick commit coupled/viết core thứ hai rồi import lại.
- Vertical milestone đầu: management save budget → supported Claude/Codex inference qua pipeline thật hiện có → debit đúng original key/attempt/price/window một lần → request sau chạm ngưỡng có **0 upstream inference POST**. Mốc đầu không thay thế target đầy đủ.
- Mọi route/composition budget key còn dùng được phải accounted hoặc bị refuse trước POST; không rơi xuống ordinary inference khi thiếu association/parser/price/storage.

## 2. Historical planning baseline (static, local)

Current continuation: master remote fetched successfully at unchanged pin; branch transition and docs/tooling baseline commit verified. Historical table below is not current HEAD/status; see fresh baseline and phase00 execution record.

| Đối tượng | Kết quả 2026-11-14 |
|---|---|
| Checkout/HEAD | `/home/gmo/projects/9router`, `develop`, `08ee1a74954c5fe7a1659a6473e57b6b1ea9059b` |
| Local master + cached origin/master | `1855aa44473e88feac9d3f131b9c0c5fc9706b68` |
| Merge-base | `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d` |
| Divergence | master-only **68**, develop-only **21** commits |
| WIP | **42 tracked modified**, staged **0**; untracked native modules/tests/scripts/public docs và generated/session artifacts |
| Worktrees | Một checkout, trên develop; không tạo worktree mới |

Handoff ghi fetch/fast-forward master thành công ở phiên trước. Phiên này chỉ xác nhận local refs; **không chứng nhận remote hiện tại mới nhất**. Execution phải có quyền fetch và pin lại SHA; nếu đổi SHA, cập nhật [baseline delta](./references/baseline-and-admission.md) trước port. Không dùng audit manifest/validator lịch sử để chứng nhận upstream mới. Historical `planning-baseline.json` nằm ngoài 181-path preservation allowlist: không đọc/restore/certify nó. [Fresh integration baseline](./references/integration-baseline.json) thay navigation này bằng observations mới; không sửa historical evidence.

Upstream mới có fresh-socket retry/ẩn stale-socket replay, raw undici và Claude header mutation trong `proxyFetch`, retry ở `BaseExecutor`, tool dedupe/history/model/translation thay đổi, `[DONE]` fix. Đây là **integration seams phải reconcile**, không chép đè bằng develop. Chi tiết và donor matrix: [baseline & admission](./references/baseline-and-admission.md).

## 3. Lộ trình và dependencies

Một writer trong checkout. Thực hiện tuần tự; không runtime parallel writers. Phase 01 bao gồm thiết kế foundational invariants; phase 02 phải thực thi chúng cho slice đầu, không chờ phase 04 mới có durability/idempotency.

| Phase | Nội dung / exit gate | Phụ thuộc | Trạng thái |
|---|---|---|---|
| [00 — preservation & switch](./phase-00-preserve-and-switch.md) | Reviewed preservation + owner no-backup disposition cho exclusions; collision/service preflight, pin master và normal clean switch | Owner continuation authority | completed; local baseline commit `5b1fc863adac5227b6b77ad93a29c5d68cfa3835` verified |
| [01 — support & boundary design](./phase-01-scope-and-boundaries.md) | Exact cells/evidence, policy decisions, identity/durability/ACK/no-bypass design, per-slice admission | 00 | in-progress / C0 nội bộ đã được nghiệm thu, OAuth còn mở; [boundary design](./references/phase01-boundary-design.md) |
| [02 — first real vertical slice](./phase-02-first-vertical-slice.md) | API/UI → shipping ingress → actual native dummy TLS POST → durable exact debit → next **0 POST** | 01; evidence/policy cho selected cell | completed / Docker nội bộ cho C0 Messages JSON |
| [03 — retained native compatibility](./phase-03-native-retry-and-compatibility.md) | Codex + Anthropic API-key + Claude OAuth, retained ingress/history/functions, retry/refresh/fallback | 02; applicable producer gates | in-progress / OAuth retry, continuity và OpenAI API-key đã qua HTTPS loopback; còn các điều kiện ghi ở đầu Phase 03 |
| [04 — identity, persistence & faults](./phase-04-integrity-and-migration.md) | Khởi tạo budget trên SQLite hiện có, kiểm chứng tính theo key và kỳ, restart, backup/restore và lỗi lưu trữ | 03 | in-progress / đã kiểm chứng overlap qua ranh giới tháng, lỗi ghi và đồng bộ khi checkpoint WAL về DB chính trên Node 22/24, fallback SQL.js và retirement sau restore; [bằng chứng](./phase-04-integrity-and-migration.md#nghiệm-thu-ngày-2026-11-25-trên-linux-node-v24210) |
| [05 — integrated acceptance](./phase-05-acceptance-and-handoff.md) | Management HTTP/CSRF/UI, affected ordinary controls, packaging/security; release/activation separate approval | 04 | pending |

**Scope held:** không tự thêm catalog scheduler, positive standalone embeddings, provider mới, reservation engine, post-death evidence acquisition hay general security certification. Không tự bỏ safety/platform/old intended models/encrypted history/failed usage/owned retry. [Scope/guarantee dispositions](./references/scope-and-decisions.md) là acceptance authority bổ sung cho plan này, không phải backlog M1 cũ sao chép.

## 4. Trước mọi branch switch

Theo [preservation protocol](./phase-00-preserve-and-switch.md): đề xuất **reviewed preservation commit trên branch riêng ở develop HEAD**, chỉ literal allowlist đã secret-review. Develop ref giữ nguyên. Bao gồm toàn bộ reviewed tracked WIP, mọi untracked public WIP (không chỉ accounting), contract/handoff và plan mới. Không broad staging; không blanket stash `-u/-a`, force checkout, reset/clean/delete.

Generated/session/private artifacts để nguyên **không phải durable backup**. Mọi category phải có disposition; private source/config cần bảo toàn hoặc tracked sensitive material thì stop để xin approved secure handling, không commit/stash vào Git. Kiểm tra ignored/untracked file-directory/case/path collisions với target **trước** switch. Không coi tên branch mới là clean source baseline. Không switch trong khi service/writer khác còn dùng checkout mà chưa có phối hợp được duyệt.

Preservation commit khôi phục **content**, không tái tạo dirty/index state nguyên gốc; lưu original porcelain/index metadata để giải thích. Ghi preservation SHA và paths vào handoff an toàn ngoài checkout được owner chỉ định; normal switch về preservation branch để lấy content. Không `stash pop`/apply WIP vào integration.

## 5. Requirement → acceptance

| Contract | Phases | Oracle bắt buộc |
|---|---|---|
| B01 stable key identity | 01/02/03/04 | Rename không đổi spend; rotation/delete/retention explicit; key A không debit B; không raw key trong ledger/UI mới |
| B02 configure/display/reset | 01/02/05 | Authenticated shipping API/UI save+reload CAS; exact spent/remaining/HCM week-month resets; readiness thật, không fixture flag |
| B03 block-next | 01/02/03/04 | Threshold equality/above và zero-limit: **0 inference POST**; peer settled trước successor chặn; preadmitted overshoot documented |
| B04 existing pipeline | 02/03/05 | Actual ingress/core/executor/transport/translation; ordinary-key/no-key controls giữ behavior; không second raw reader |
| B05 original per-attempt debit | 01–04 | Một real POST/attempt; duplicate same terminal no double debit; conflict không replace known truth; retries không bị request-ID dedup; frozen price/key/start-window |
| B06 provenance | 01–04/05 | Usage reported/estimated tách priced/unpriced; unknown/invalid != zero; exact counter/tariff/profile evidence; reference USD != invoice |
| B07 persistence/concurrency | 01/02/04 | Durable own ACK, restart saved rows/policy, independent keys, atomic totals, adapter fault tests; process-death undercount limitation explicit |
| B08 auth/no bypass | 00–05 | Auth/CSRF/ACL/server identity, all-route zero-POST negatives, refusal terminal không cooldown/fallback, TLS/proxy/SSRF/secret controls |

## 6. Readiness, decisions, stop conditions

Có thể duyệt plan mà chưa duyệt execution hoặc proposed policy. Không re-interview các quyết định §8 đã settled. Các gate còn cần owner/evidence được liệt kê ở [decision register](./references/scope-and-decisions.md#decision-register).

1. **A0 preservation/branch/service:** owner continuation đã cho phép sync master/integration trong checkout; preservation commit + no-backup disposition cho exclusions, one-writer coordination và transition verified trong [phase00 record](./references/phase00-execution.md). Không có quyền quiesce/restart dịch vụ thật. A1 sandbox gate vẫn riêng.
2. **P1–P4 producer:** missing/omitted/null categories, failure envelope/finality/retry cutoff, exact model/auth/effective-wire/encrypted continuation, conditional tariff. Không model nào được công nhận eligible nhờ fixtures. Không lặp public research/campaign cũ khi chưa có nguồn/giả thuyết mới có tên.
3. **D-policy:** validation Session 1 đã duyệt D01/D02 fail-closed + minimal admin recovery cho unresolved, D03 fail-closed cả unlimited accounting-controlled keys, D04 verified same-ID rotation + retained history. Exact status/recovery/binding protocol vẫn phải thiết kế/verify phase01; legal retention là rollout gate. D05/D06 chưa được duyệt; không suy approval cho replacement safety mechanism hay transport coverage.
4. **Dependency closure:** nếu slice kéo toàn kiến trúc develop, dừng và đưa closure + smaller alternative; không wholesale import.
5. **Verification:** unexplained regressions, incomplete route closure, real HOME/DB/network exposure, hidden retry không own attempt/ACK, private collision hoặc data migration không reversible đều là stop.

Khi P blockers còn mở, chỉ thực hiện công việc độc lập được authorize (ví dụ preservation/design/pure helpers nếu có quyền riêng). Không gắn green fixture vào “supported Claude/Codex”; không bật finite production save trước coverage. Refusal là safety, **không delivered positive support**.

<!-- Updated: Validation Session 1 - storage facts and approved D01–D04; no execution authority -->

## 7. Validation và handoff của plan

- Các câu hỏi không blocking việc soạn plan được ghi thành approval gates, chưa quyết thay user; không yêu cầu user trả lời lại điều đã chốt.
- [Validation log](./references/plan-validation.md): historical planning checks; [Validation Log dưới đây](#validation-log) ghi questionnaire Session 1 và corrections. Không test runtime hay security sign-off.
- Future tests: sandbox external filesystem/network boundary, disposable **HOME + XDG + DATA_DIR + TMPDIR**; `usageDb.js` hiện là shim tới SQLite, usage/history/log projection theo DB dưới DATA_DIR. `dataDir.js` có fallback HOME/APPDATA khi configured path không usable; không dựa riêng DATA_DIR để isolation. No host fallback. Read [phase 05](./phase-05-acceptance-and-handoff.md) trước chạy test/build; không chạy blanket npm scripts trên host.
- Entry hiện tại: C0 Messages JSON đã qua nghiệm thu Docker nội bộ. Phase 03 đã nghiệm thu Codex Standard qua Responses SSE trong Docker nội bộ với HTTPS loopback và SQLite dùng một lần. Hai luồng Claude OAuth Standard cũng đã nghiệm thu qua HTTPS loopback, gồm budget chung theo key, từ chối fast mode và readback sau restart. Phase 03 còn các ô refresh/retry và tương thích ngoài luồng đã nghiệm thu. Deploy và activation trên hai instance hiện tại nằm ngoài nghiệm thu offline. [Archive map](./references/archive-reference-map.json) disposition các historical links không restore, không biến receipts cũ thành acceptance trên integration.

## Validation Log

### Session 1 — 2026-11-14

**Trigger:** owner invoked `validate /home/gmo/projects/9router/plans/261114-0438-api-key-budget-clean-integration/plan.md`.
**Questions asked:** 4. All four answered; no custom input. Scope: documentation validation/approved plan edits only, not execution authority.

#### Verification Results

- **Tier:** Full (6 phases), Fact Checker + Flow Tracer + Scope Auditor + Contract Verifier, performed inline; no delegated or independent security certification.
- **Claims checked:** 91 = 15 static source/structural samples per phase (90) + one storage behavioral claim.
- **Initial:** Verified 90 | Failed 1 | Unverified 0 factual claims. **After approved correction:** Verified 91 | Failed 0 | Unverified 0 factual claims. This count does not certify future code, producer semantics, platform support, route closure or runtime acceptance.
- **Failure F1:** `usageDb` HOME JSON/log behavior was stale in plan §7 / phase05. Actual pinned master `src/lib/usageDb.js:1–7` re-exports SQLite; `src/lib/db/repos/usageRepo.js:284,782–789` stores usageHistory and derives logs, `src/lib/db/paths.js:5–13` uses DATA_DIR. `src/lib/dataDir.js:7–37` still has HOME/APPDATA fallback/import-time writes, so isolation remains mandatory. Corrected here and phase05; root/architecture docs not changed.
- **Baseline:** HEAD/master/cached origin-master, merge-base, 68/21 divergence, 42 tracked modified/staged0, one worktree and 14 selected source hashes still match. Not a complete preservation certificate, remote freshness proof or runtime result.
- Detailed 90-claim sample, traced source paths, state lifetimes and explicit consumer lists: [Session 1 evidence](./references/validation-session-1-evidence.md).

#### Questions & Answers

1. **[Facts / isolation]** Cho phép sửa mô tả storage trong plan theo code thực tế: usageDb là SQLite shim theo DATA_DIR, có fallback HOME/APPDATA, đồng thời giữ nguyên sandbox isolation?
   - Options: **Sửa mô tả (Recommended)** — sửa plan/phase05, giữ isolation, không sửa runtime/root instructions | **Chỉ ghi finding** — giữ contradiction và chưa khuyến nghị implementation.
   - **Answer:** Sửa mô tả (Recommended).
   - **Rationale:** factual erratum; no reduction of filesystem/network isolation.

2. **[Policy / recovery]** Chốt D01/D02 thế nào khi đã gửi request nhưng usage bình thường bị thiếu/sai/mâu thuẫn, hoặc chưa có giá hợp lệ trước khi gửi?
   - Options: **Fail closed + recovery (Recommended)** — missing price 0 POST, malformed/normal missing usage unresolved/NULL + blocked key, minimal admin audited CAS recovery; B1/E2 interrupted-no-evidence remains unrecorded/may-undercount | **Fail closed; recovery pending** — refusal/unresolved approved but recovery design remains blocking | **Giữ D01/D02 pending** — no policy approval today.
   - **Answer:** Fail closed + recovery (Recommended).
   - **Rationale:** unknown != zero; make unresolved block operable without DB-console access. `resolveAttemptSync` exists internally but no shipping recovery caller; exact minimal endpoint/actions remain phase01 design. B1/E2 unrecorded is outside required manual recovery, not automatic free usage or a new post-death product. Preserve known spend if later evidence conflicts.

3. **[Guarantee / storage]** D03: khi recording/storage hỏng, có bỏ exception cũ cho unlimited identified accounting keys và fail closed toàn bộ accounting-controlled path không?
   - Options: **Fail closed (Recommended)** — remove dedicated unlimited continuation after dependency/migration review, no successor without durable ACK, preserve genuinely independent ordinary behavior | **Giữ unlimited exception** — retain persisted read-only authority + gap ACK dependencies/tests | **Giữ D03 pending** — old guarantee remains.
   - **Answer:** Fail closed (Recommended).
   - **Rationale:** explicit amendment of old unlimited continuation guarantee, not authority to remove unrelated durable safety or sidecar controls.

4. **[Identity / lifecycle]** D04: thay secret của key phải giữ cùng stable ID/spend qua operation riêng, hay luôn tạo key ID mới; delete/history nên được giữ thế nào?
   - Options: **Same-ID rotation (Recommended)** — verified operation preserves ID/budget/history; delete retires, no reuse/automatic purge; legal retention remains rollout gate | **New-ID replacement** — no in-place rotation, separate new budget/no transfer, old history retained | **Giữ D04 pending** — defer schema/API/lifecycle decision.
   - **Answer:** Same-ID rotation (Recommended).
   - **Rationale:** donor `validateKeyBindings` rejects a changed fingerprint; cannot claim existing updateApiKey already supports rotation. New verified atomic binding operation and stale/concurrent/fault controls must preserve existing money/history and revoke the old secret.

#### Confirmed Decisions

- F1 factual storage correction; unchanged sandbox isolation, plus disposable APPDATA on Windows.
- D01/D02 approved strict policy + minimum authenticated audited CAS unresolved recovery; B1/E2 distinction retained.
- D03 approved fail-closed all accounting-controlled keys, including unlimited; ordinary keys only unaffected where genuinely independent.
- D04 approved same-ID verified rotation and retained history; legal retention duration remains rollout gate.
- A0/A1, D05/D06, P1–P4 remain pending; no permission to commit/stash/switch/fetch/test/build/live/activate/deploy/push.

#### Action Items

- [x] Correct storage facts without weakening isolation.
- [x] Propagate approved policies/rotation/recovery to affected phase requirements, acceptance and admission records.
- [x] Trace unrecorded vs unresolved and pending-recovery ownership; require exclusive writer acquisition/final-close write-lane stop, never live-owner reclassification.
- [ ] Phase01, after phase00/authorization: freeze exact recovery endpoint/actions and rotation binding protocol, all actual consumers and test selectors.
- [ ] Obtain A0/A1 operational authority, required D05/D06 dispositions and exact P1–P4 evidence before dependent execution. No positive cell certified by this session.

#### Impact on Phases

- Phase00: unchanged; all-category preservation/secure locator/service/collision approvals still prerequisites.
- Phase01: apply approved D01–D04; specify bounded unresolved-only recovery and same-ID binding operation, owner-lifecycle/health gates.
- Phase02: minimum shipping recovery API/UI and verified rotation added as admitted new seams; strict unknown/unpriced/storage acceptance expanded.
- Phase03: existing original-context/refresh/retry/rotation guards remain; no new producer eligibility or narrower scope waiver.
- Phase04: recovery/rotation/fault/import/backup tests and live-owner exclusion explicitly required; legal retention still rollout gate.
- Phase05: SQLite facts/isolation corrected; security/UI/persistence acceptance includes recovery, rotation, finite+unlimited storage failures.
- References: decision register/admission updated; previous drafting validation marked historical where D01–D04 pending statements were superseded. Baseline JSON/source hashes unchanged.

#### Whole-Plan Consistency Sweep

- Files re-read after propagation: plan.md and all 6 phase files; static scan additionally covered decision/admission/historical validation/evidence references (11 Markdown files total).
- Decision deltas checked: 5 (storage facts, D01/D02 recovery policy, D03 storage behavior, D04 identity lifecycle, unresolved/unrecorded owner-lifecycle clarification).
- Reconciled stale references: storage description in index/phase05, D01–D04 pending authority in decision register/index, historical pending statements marked superseded; added missing recovery/rotation acceptance and owner-lifecycle requirements. No embedded SQL/API draft silently left behind.
- Mechanical checks: **28 relative links/anchors, 0 missing/invalid; 0 trailing-whitespace findings; 6/6 phases still pending**. Markdown LSP/Marksman coverage was incomplete; no clean LSP certification claimed.
- Unresolved documentation contradictions identified in this review: **0**; this is scoped manual review, not proof none can exist. Future design/evidence/authority gates remain explicit.
- Completion Advisor review applied: source samples are static observations, F1 was a documentation assumption corrected (not a runtime failure/fix); B1/E2 exemption cannot establish health/absence of faults from missing evidence. Known faults and normal missing/malformed evidence stay fail-closed.
- **Recommendation:** documentation review and approved corrections complete within reviewed scope; do not start full implementation or claim positive native support. Next input is A0/A1 scoped phase00 preservation/execution authorization + secure recovery locator; then phase01 exact protocols/manifests and applicable producer evidence. No automatic cook/switch/activation.

