---
handoff-version: 1
generated: 2026-10-18T11:51:48+07:00
generator: ak:handoff@2.1.0
focus: "Quay lại roadmap mới và bắt đầu P1 khi được yêu cầu"
workspace: /home/gmo/projects/9router
branch: master
head: 87a74e1bda3677193c6f71a7e2100c90311f0689
---

# HANDOFF: API key budgets — roadmap mới, P1 chưa bắt đầu

## Mission and current status

Focus: "Quay lại roadmap mới và bắt đầu P1 khi được yêu cầu".

**Outcome:** hoàn thành reference pricing, durable per-key accounting, weekly/monthly budgets và recovery bằng những slice có đầu ra độc lập trên master mới; không tiếp tục monolithic plan cũ.

**Done:** stash toàn WIP cũ, chuyển master/pull fast-forward; tạo roadmap và các plan con, trace đủ 13 AC, chi tiết P1 và kiểm tra tài liệu.

**Remaining:** P1 chưa thực thi. Đủ điều kiện bắt đầu **phase 1 dependency/baseline**, chưa đủ evidence để bỏ qua phase này và port code ngay. Các plan sau là outline/envelope, không executable implementation plan toàn khối.

Latest user request chỉ là tạo handoff để quay lại khi cần. Không phải yêu cầu triển khai, tạo branch hoặc chạy tests ngay. Không dispatch. Priority: P1. Chưa có ETA đáng tin; estimate 88h cũ đã lỗi thời.

## Scope and guardrails

- **Workspace:** `/home/gmo/projects/9router`.
- **In scope khi user yêu cầu thực thi:** P1 reference pricing port, bắt đầu dependency/baseline; minimal pricing-owned file manifest, sau đó API/persistence/UI/acceptance.
- **Out of scope P1:** ledger/budget/debit/provider hooks, generic writer/restore redesign, matrix/runtime comparison cũ, production activation, metering standalone media/search/fetch.
- **Constraints:** giữ nguyên full product contract/13 AC; exact nanoUSD/BigInt/rational, explicit zero khác missing, immutable original price; own durable ACK và single writer không được giảm khi đến accounting; upstream ACL/schema/routing phải giữ.
- **Safety boundaries:** không whole-apply/pop/drop stash, whole-directory checkout/cherry-pick checkpoint khổng lồ, reset/clean/force-push. Không sửa code trực tiếp master. Không live billable/catalog fetch, production DB operations, commit/push/merge/activation hoặc delegation từ handoff này. Không đọc/copy secrets vào reports.
- Khi execution được yêu cầu: dùng disposable HOME/DATA_DIR, dummy loopback/fixed source fixtures, review actual adapter/runtime/tool availability; tests/build dài chạy background theo harness. Không install/update dependency/runtime ngầm.
- Auth/CSRF/trusted socket headers/catalog SSRF/strictProxy và key isolation không được waive để port nhanh. Default OFF không tự chứng minh startup/schema an toàn.

## Current state

**Observed read-only 2026-10-18 11:51 +07:**

| Field | Value |
|---|---|
| Branch | `master` |
| HEAD | `87a74e1bda3677193c6f71a7e2100c90311f0689` |
| origin/master cached ref | cùng SHA; không fresh network check trong handoff |
| Old feature branch | `feat/api-key-quota-budget-pricing`, HEAD `3a4955a0336f970505c325b0faf892f5397c93bb` |
| Saved WIP stash commit | `d515fb4927ed45a5853104406cd0fecca549c04c` |
| Working tree | tracked/index không có diff ở cuối planning; handoff probe status chỉ `?? plans/` |
| Changed files | không tracked changes được status báo |
| Untracked files | `plans/` — roadmap/child plans/references/journal; trước handoff35files, handoff này thêm1file |
| Intentional local modifications | yes — docs chưa commit; phải giữ khi tạo feature branch |

Master package version0.5.104. Chưa tạo `feat/reference-pricing-port` (tên proposed trong metadata). Không có product gate được launch trong planning/handoff. Ignored environment/dependencies không nằm stash và chưa được xác minh khớp package mới. Không mở real DB.

Stash chứa tracked production2/test4 unaccepted authority repair, latest plan checkpoint/local reports, .pi matrix/diagnostics, fusion deterministic tests và unrelated Kimchi/snapshot/research WIP. Dùng immutable stash SHA, không tin ordinal `stash@{0}` mãi cố định. `stashSHA^3` chứa untracked tree; tracked modifications ở main stash tree. Không áp lại lên master.

## Decisions and rationale

| Decision | Rationale / alternative rejected |
|---|---|
| Fresh master + selective port | Upstream67commits/264paths từ nền cũ;23overlap feature paths. Merge/rebase toàn WIP hoặc cherry-pick ba checkpoint trăm files không thu hẹp scope. Không rewrite từ đầu. |
| Roadmap tổng + outcome slices | Old A–E đã từng tái tổ chức nhưng B vẫn quá lớn. Chỉ P1 chi tiết, các envelope phải chia từng owner/composition trước code. |
| P1→P2→P3→P4→P5 | Pricing→ledger/durability tối thiểu→một chat flow→budget UI→recovery. Cho phép scoped DONE sớm, không claim full product release. |
| X1–X6 giữ remaining coverage | Responses/embeddings, Messages, Gemini/media/tools, specialized/OAuth/binary, routing/transport/unhealthy và fusion giữ nguyên nghĩa vụ; không cắt scope để xanh. |
| P1 dependency gate | Old resolver imports accounting config/rates; cache expects optional adapter eligibility; scheduler gắn ownership. Phải tìm minimal seam, không kéo toàn driver/accounting vào pricing. |
| Giữ ACL upstream | Master schema version2 có accessRestricted/accessAllow và KeyAccessControls; key UI/migration/import/dispatch port không ghi đè các quyền này. |
| Không chạy tiếp old diagnostic | Matrix chưa launch, nested-positive/performance chưa accepted. Setup12PASS/pure18PASS không product acceptance. Trên nền mới chỉ điều tra nếu current obligation cần, một hypothesis và finite stop. |

User đã xác nhận hướng chia nhỏ, yêu cầu tạo plan và hỏi readiness. Assistant trả lời đủ bắt đầu P1 phase1, **chưa có user execution request sau đó**. Không cần routine product brainstorm hoặc thêm một vòng plan trước phase1; nếu phase1 thấy authority/scope change thật thì xin quyết định riêng.

## Work performed

- Stash tracked/untracked WIP rồi `git switch master` và `git pull --ff-only origin master`: fast-forward từ a99cf572 lên87a74e1b; feature branch không đổi.
- First stash command timeout60s chưa lưu; background retry Git exit0 nhưng task metadata ENOENT do `.pi/tasks` cũng được stash. Đã độc lập xác minh stash object/retained paths và clean workspace; **không phải product/test failure**, không cần rerun stash/job.
- Tạo13plan folders bằng `ak plan create`/`add-phase`, `AK_NO_AUTO_UPDATE=1`. Roadmap + P1–P5 + X1–X6 + R. P1 có3phases; future outline phases chỉ chuẩn bị scope, không triển khai toàn envelope.
- Copy exact old contract và latest stash checkpoint thành `.txt` references có provenance wrapper; không restore old code hoặc biến chronology thành next commands.
- Viết scope-map13AC/old packet mapping, migration baseline/validation; tạo local journal qua CLI, reindex local plan store và pin roadmap current. Không Git commit.
- Direct review phát hiện baseline draft dùng `pricing-route.test.js` chỉ có Git cũ; sửa command sang current pricing-Minimax/key-access/key-access-migration. Các test paths port tương lai ghi rõ chưa tồn tại master.
- Thêm handoff này theo yêu cầu. Không thay plan status hoặc hydrate implementation như đã bắt đầu.

0 redactions applied. Chỉ Git identities/path/contract và kết quả checks, không env values/raw diagnostics/credentials.

## Verification

| Check | Command / method | Outcome | When |
|---|---|---|---|
| Plan format | `ak plan validate <dir> --json --no-interactive` |13/13valid; format-only | Planning2026-10-18 |
| P1 parse | `ak plan parse ...reference-pricing-port --json` |3phases/10exit checkboxes/pending; không product percentage | Planning |
| Whole-doc sweep | Python read33MD, relative links/dependency DAG/placeholders/13AC | no broken links/cycles/placeholders;13AC mapped | Cuối planning |
| Original contract preservation | Compare Git3a4955a0 exact bytes | SHA256 `2b186040564ffbc826d2f9e865da75c7b09a345a343bb3ac7fa109ad667ceacf` | Planning |
| Latest old checkpoint | Compare stashd515fb49 exact bytes | SHA256 `9d739f1877cf8896ce38da479ca50cad3d9093402f6709672d9635131c8cb3ed` | Planning |
| Source/index/refs | Git diff/index/status/rev-parse | source/index unchanged,35untrackedfilesallplans/; HEAD/stash as above | Cuối planning |
| Handoff live state | rev-parse inside/root/branch/HEAD, status --short, feature/stash/origin cached refs | master87a74e1b, only??plans/, feature+stash preserved |11:51+07 |

**Not run:** product baseline/focused/full tests, build, browser, installs, new comparator synthetic controls, DB/crash/restore, matrix/CPU/performance/inference. Lý do: planning và handoff only, không execution. Marksman silent/inconclusive không clean certificate; không independent/delegated security review claim.

## Open risks and blockers

- **Type: risk. Owner: P1 executor. Impact:** pricing không drop-in vì old accounting/adapter dependencies. Phase1 minimal manifest/isolation quyết định có thể port an toàn; nếu cần shared topology/authority redesign thì block affected phase, không mở rộng ngầm.
- **Type: risk. Owner: P1 executor. Impact:** dependencies/runtime/browser availability chưa kiểm tra sau pull. Baseline có thể environment-blocked; report thay vì install/version đổi ngầm hoặc đoán pass.
- **Type: risk. Owner: verification. Impact:** current `tests/__baseline__/verify-no-regression.mjs` splits filename bằng `/app/`; local paths khác. Chứng minh comparator bằng synthetic pass→fail/missing-input controls trước no-regression claim; không rewrite known-fails để xanh.
- **Type: blocker cho full product, không chặn bắt đầu P1 phase1. Owner: future X3/X6/R. Impact:** old bytewise/performance/nested-positive và unaccepted authority repair còn mở. Old A closed historical; B/C/D/E và integrated13AC chưa accepted. Không reset failure thành pass bằng di chuyển nhánh.
- **Type: risk. Owner: future inventory owners. Impact:** upstream Bedrock/MiniMax/Nous/new embedding/ACL/routing phải được inventory; không auto-skip vì không có branch cũ, không claim support chỉ từ default base.
- **Type: authorization boundary. Owner: user. Impact:** muốn implement cần yêu cầu thực thi mới; handoff capture không auto-start code/test. Không commit/push/merge/activate từ yêu cầu đó nếu chưa được phép riêng.

## Exact next actions

1. **First safe step** — đọc roadmap và P1 bên dưới, rồi đối chiếu `Current state` bằng Git read-only trong workspace; bảo toàn docs untracked. Xác minh full HEAD/feature/stash SHAs. Nếu có changes/new activity thì reconcile trước, không reset/stash lại tùy tiện.
2. Nếu user chỉ quay lại review/status: báo P1 chưa bắt đầu và dừng ở read-only. Nếu user yêu cầu triển khai: kiểm tra nhánh proposed chưa tồn tại, tạo feature branch từ verified master bằng `git switch -c feat/reference-pricing-port`. Nếu branch đã tồn tại, inspect thay vì overwrite. Không áp stash.
3. Đọc `CLAUDE.md`, P1 phase01 và liên quan current source/old closure từ Git. Reuse settled contract; không đọc toàn chronology hoặc tự launch old matrix. Xác minh package/tool/runtime availability; đọc bodies trước edit.
4. Hoàn tất **P1 phase1**: minimal reuse/adapt/replace/hold manifest; resolve pricing-owned constants/cache revision/adapter eligibility/scheduler/auth seams; named affected consumers và baseline commands trên current tests. Disposable HOME/DATA_DIR, actual adapter assertion, no live fetch/inference. Nếu scope không tách an toàn được, report concrete blocker/prerequisite thay vì kéo whole B vào P1.
5. Chỉ sau phase1 exit đạt mới phase2 API/persistence và phase3 UI/acceptance theo plan. Update plan/live todo status khi thực sự bắt đầu/đóng; không completion từ test count hoặc old evidence.
6. Có thể dùng invocation sau **khi user đã yêu cầu thực thi**, không chạy trong handoff capture:
   ```text
   /ak:cook /home/gmo/projects/9router/plans/261018-0213-reference-pricing-port/plan.md
   ```
   Không thêm `--auto` trừ khi user yêu cầu autonomous execution. Gate failure: cause-aligned fix có chứng cứ hoặc stop/report; không identical rerun-for-green/harnesschain/deadline weakening.

## Source pointers

- Roadmap: `plans/261018-0213-api-key-budget-roadmap/plan.md`.
- Next plan: `plans/261018-0213-reference-pricing-port/plan.md`.
- Next phase: `plans/261018-0213-reference-pricing-port/phase-01-start.md`.
- Details: `phase-02-port-and-api.md`, `phase-03-ui-and-acceptance.md` trong P1 directory.
- Contract/provenance: `plans/261018-0213-api-key-budget-roadmap/references/legacy-design-contract.md`, `legacy-design-contract.txt`, `legacy-checkpoint.txt`, `migration-baseline.md`, `scope-map.md`, `validation.md`.
- Local journal: `plans/journals/2026-10-18-split-api-key-budget-delivery-on-updated-master.md`.
- Current code: `src/lib/db/repos/pricingRepo.js`, `src/app/api/pricing/route.js`, `src/lib/db/driver.js`, `src/lib/db/schema.js`, `src/lib/db/repos/apiKeysRepo.js`, `src/sse/services/keyAccess.js`, `src/app/dashboard/settings/pricing/page.js`, `src/shared/components/PricingModal.js`.
- Repo instructions: `CLAUDE.md`; `open-sse/AGENTS.md` trước mọi engine edit. `docs/ARCHITECTURE.md` stale ở DB JSON/provider inventory; current source và CLAUDE.md ưu tiên.
- Old A closure, read-only:
  ```bash
  git show 3a4955a0336f970505c325b0faf892f5397c93bb:plans/261003-0827-api-key-quota-budget-pricing/reports/package-a-closure.md
  git show d515fb4927ed45a5853104406cd0fecca549c04c:src/lib/apiKeyBudget/requestAccounting.js
  git ls-tree -r --name-only d515fb4927ed45a5853104406cd0fecca549c04c^3
  ```
