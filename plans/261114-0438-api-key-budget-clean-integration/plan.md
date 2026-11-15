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

**Current continuation:** owner đã authorize sync master, tạo integration branch trong checkout hiện tại và tiếp tục tự động trong phạm vi plan. Phase00 transition đã verified; xem [execution record](./references/phase00-execution.md) và [fresh integration baseline](./references/integration-baseline.json). Không deploy/push/live inference/đụng dữ liệu hoặc dịch vụ thật. Các đoạn planning/Validation Session 1 bên dưới là chronology, không phủ nhận authority mới và không cấp thêm producer/policy/sandbox authority. `blockedBy: []` không có nghĩa positive slice ready.

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
| [01 — support & boundary design](./phase-01-scope-and-boundaries.md) | Exact cells/evidence, policy decisions, identity/durability/ACK/no-bypass design, per-slice admission | 00 | in-progress / partial; [boundary design](./references/phase01-boundary-design.md), no eligible cell |
| [02 — first real vertical slice](./phase-02-first-vertical-slice.md) | API/UI → shipping ingress → actual native dummy TLS POST → durable exact debit → next **0 POST** | 01; evidence/policy cho selected cell | pending / producer-gated |
| [03 — retained native compatibility](./phase-03-native-retry-and-compatibility.md) | Codex + Anthropic API-key + Claude OAuth, retained ingress/history/functions, retry/refresh/fallback | 02; applicable producer gates | pending |
| [04 — identity, faults & migrations](./phase-04-integrity-and-migration.md) | Cross-key/concurrency/restart/window, fault injection, old donor schema/retention/platform validation | 03 | pending |
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
- Entry hiện tại: phase01 design/admission sau phase00 verified; phase02 positive vẫn producer/policy/sandbox gated. Không deploy/activate/push từ plan này. [Archive map](./references/archive-reference-map.json) disposition các historical links không restore, không biến receipts cũ thành acceptance trên integration.

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

