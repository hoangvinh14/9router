---
title: "P1 — Port reference pricing độc lập"
description: "Tái sử dụng A đã đóng trên nền mới, không kéo toàn accounting vào pricing."
status: done
priority: P1
effort: "Ước lượng lại sau phase 1, không dùng 88h cũ"
branch: feat/reference-pricing-port
tags: [pricing, migration, security, dashboard]
blockedBy: []
blocks: [261018-0214-accounting-foundation]
created: 2026-10-18
---

# P1 — Port reference pricing độc lập

## Contract
- **Outcome:** quản trị reference prices qua page/modal/API; validated sync/override/persistence và immutable exact snapshot interface cho accounting sau này.
- **Constraints:** giữ numeric legacy price-map contract, decimal lexical precision, explicit zero, original source/units/mapping revision; auth/CSRF/SSRF; upstream provider/ACL/schema mới. Không assume adapter seam cũ tồn tại.
- **Non-goals:** ledger/debit/budget, routing/executor hooks, broad writer/restore redesign, live catalog fetch, tiếp tục matrix/performance diagnostic cũ, production activation.
- **Acceptance:** real API/page/modal/offline/restart và exact snapshot/mapping tests trên revision port; focused+affected regression, security review; không có missing obligation trong pricing-only scope. Protocol-specific rates X1–X4 giữ riêng.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Dependency check và baseline](./phase-01-start.md) | Complete — conditional Linux R7 seam recheck |
| 2 | [Port pricing, persistence và API](./phase-02-port-and-api.md) | Complete — source/integration barriers verified |
| 3 | [UI và nghiệm thu pricing](./phase-03-ui-and-acceptance.md) | Complete — conditional Linux build/browser/container acceptance |

## Execution checkpoint — 2026-10-18 (`--auto`)

- User authorized execution; local branch `feat/reference-pricing-port` created from the verified base. Phase 1 performed reports-only dependency inspection and finite current-adapter probes.
- **P1 BLOCKED / U1 gate failed:** current shared writer/adapter topology cannot supply the required durable publication and healthy-read contract through a pricing-only wrapper. See [phase-1 dependency gate and conditional manifest](./reports/phase-01-dependency-gate-20261018.md).
- Named prerequisite for user approval: **DB-SAFETY-PRICING — shared single-writer ownership + durable publication/healthy-read adapter primitives, without ledger/accounting**. Not automatically opened or implemented; phases 2/3 remain unstarted. The CLI has no blocked status, so frontmatter remains `in-progress` while this explicit checkpoint owns the blocked disposition.
- Source, `tests/`, dependencies, index, old branch and stash unchanged; only plan/report artifacts and harness task metadata added. No product completion or historical A evidence reused as current acceptance.
- Phase-1 investigation concluded with failed dependency gate. Single current baseline: **84 passed / 2 failed across 8 files (86 assertions, no pending/todo)**; both usage-count failures retained with source-only triage, not attributed to the pricing storage defect without proof. Report-script lint remains inconclusive after timeout. No second test run.

## Historical prerequisite continuation — superseded
User separately approved design+implementation of DB-SAFETY-PRICING after the historical phase-1 stop. [Prerequisite plan](../261018-0749-db-safety-pricing/plan.md) now owns shared DB source/test edits; the earlier source-unchanged/no-second-run statements describe the original reports-only phase, not this continuation. Current [disposition](../261018-0749-db-safety-pricing/reports/current-disposition.md): R3 available-runtime controls pass, combined117assertions115pass2baselinefailureidentities; missing Bun/better/Windows evidence and overall acceptance remain open. No installed runtime/support reduction approved. The historical blocked disposition and “phases 2/3 unstarted” statement were superseded by the conditional Linux R7 continuation below. No commit/push/activation.

## Current R7 continuation — conditional Linux accepted
User explicitly selected conditionalLinux development acceptance of disclosed independentreview/caughtinnerRELEASEcoverage gap; [exact policy](../261018-0749-db-safety-pricing/reports/r7-conditional-linux-acceptance.md). R7full149/focused60/lint/LSP and actualbetter/Bun sourcebound checks passed. [P1 recheck/executable manifest](./reports/p1-r7-recheck-and-port-manifest.md) closes bounded dependency gate for implementation, not pricing functionality/release. Originalfailedgate/reds remain historical; supersedes old BLOCKED statements above.

Phase2 purecore started: pricing-owned constants, decimalMoney, rateValidation and boundedlexicalcatalogparser; new pricing-decimal-money suite. First frozenfivefiletest `bf890ef02` completed PASS8/8 and lint `b7de97ce9` completed exit0fivefiles, sourcehashes verified and rawreceipts archived; activeLSP5clean0diagnostics. Offline/disposable root `/tmp/9router-pricing-core-a1mbb7gg`. [Source manifest](./reports/pricing-core-stage1-source.json). Unwiredstage2 adds exactmapping/validation/resolver/memo and revisioninstaller with Node/SQLjs tests, frozen13file[manifest](./reports/pricing-core-stage2-source.json). Tests `b950ca8a7` completed PASS28/28 across4files; lint `b84cca248` completed exit0 across13files, hashes verified and receipts archived. ActiveLSP8newpaths clean0diagnostics. Independent catalog/schedule stage3 `b77e2e4ce` tests and `b223afa69` lint await nativecompletion on frozen21filemanifest/no polling; no migration/repo/API/UI/serving scheduler consumerchanges yet. Later revision/committedview/importordering proofs required before consumers. No shutdown/newdelegation/runtimeinstall/liveDocker/commit/push. Windows/release/independentreview limits retained.

## Dependency boundary
<!-- Updated: Validation Session 1 - manifest/stop gate, reports-only và explicit API/revision scope -->
Old `referenceResolver` imports accounting rate/config modules; `snapshotMemo` expects optional `canMemoizePricing`/health; scheduler cũ gắn ownership/maintenance. Phase 1 chỉ ghi artifacts/wrapper/fixtures trong plan-owned `reports/`, không sửa production hoặc `tests/`. Chốt minimal pricing-owned projection/protocol và exact file/test manifest cho persistence/ACK/reopen, revision/raw import/migrate/export policy, management guard/custom-server authority stamps và serving startup; không copy nguyên driver/service/initializeApp. Nếu không giữ đủ invariant bằng bounded design thì **STOP/P1 BLOCKED** + named prerequisite cho user duyệt; không tự mở P2, giảm adapter support hoặc claim P1 DONE. Cache chưa chứng minh eligibility thì không cache; dirty SQL.js RAM/transaction success không là durable last-good. Feasibility vẫn là phase-1 gate chưa được chứng minh từ docs.

## API / revision scope đã chốt
- `/api/pricing` GET/PATCH/DELETE giữ numeric provider/model map response; exact metadata/snapshots tách riêng. Không thêm PATCH CAS hoặc expectedRevision/header bắt buộc.
- `/api/pricing/sync` GET status (không fetch), POST manual fixed-source sync (không source/options/query), **PUT `{schedulerEnabled:boolean}`** cho scheduler; auth/CSRF trước privileged access/body, bounded body/error/redacted status và configured/running distinction. Scheduler opt-in24h/default OFF, serving-only reconcile không immediate startup fetch.
- `/api/pricing/coverage` GET là reference coverage, không usage certification. Stale revision409 thuộc **coverage pagination**, client restart; immutable prior snapshots/concurrent-write correctness không đồng nghĩa same-model PATCH CAS.

## Reuse
Nguồn `3a4955a0`: `src/lib/pricing/*`, `src/lib/db/pricingRevision.js`, pricingRepo/API/UI/draft/tests. Đọc từng body/dependency trước port. Rate schema embedded/modalities là obligation phân owner, không import toàn engine chỉ để link. Old A closure là historical evidence, không current port pass.

## DONE / handoff
Phase 3 có closure receipt: file list, current revision, verified adapters, API compatibility/security, real browser/restart evidence, unchanged inference/ACL. Consumer mới P2 sẽ kiểm chứng snapshot→intent→settlement; P1 chỉ chứng minh snapshot interface và immutability bằng contract tests. **Không claim inference accounting đã được port.**

## Execution status — 2026-10-22
Phase 2 is closed. Its source-bound and affected-consumer barriers passed, including the final exact editor projection refinement; see [phase-02-port-and-api.md](./phase-02-port-and-api.md). Phase 3 is closed within conditional Linux development acceptance: host and Docker builds completed, 16 browser checks and three container smoke groups passed, with exact persistence/scheduler restart, direct pricing security review and owned-process cleanup. See the [closure receipt](./reports/pricing-browser-20261022/disposition.md#container-acceptance-and-closure). Existing prerequisite limits and dependency/build warnings remain disclosed; no accounting or production activation is claimed. Historical validation and prerequisite-stop notes above remain historical and do not override the current phase table.

[Roadmap và common failure protocol](../261018-0213-api-key-budget-roadmap/plan.md); [contract](../261018-0213-api-key-budget-roadmap/references/legacy-design-contract.md). Không bắt đầu code từ yêu cầu tạo plan này; branch trong metadata là proposed, chưa tạo.

## Validation Log

### Session 1 — 2026-10-18
- **Trigger:** user yêu cầu `validate` plan này; chỉ validation/docs, không authorize implementation.
- **Verification Results:** Standard (3 phases; Fact Checker + Contract Verifier), 30 claims checked — **Verified: 26 | Failed: 2 | Unverified: 2**. Source/path/contract verification, không phải runtime/test pass.
- **Evidence:** [Claim matrix và consumer inventory](./reports/validation-20261018.md). Current HEAD `87a74e1bda3677193c6f71a7e2100c90311f0689`; old-source citations thuộc `3a4955a0336f970505c325b0faf892f5397c93bb`.
- **Initial failures (historical, resolved below):** F1 thiếu PUT schedule handler/consumer trong phase 2; F2 phase-1 reports-only ownership mâu thuẫn comparator-fix permission.
- **Initial unverified (historical):** U1 feasibility của bounded persistence/revision/auth/startup seams; U2 stale-revision boundary chưa phân biệt coverage pagination với PATCH CAS. Sau quyết định: U1 còn mở, U2 đã chốt.
- **Verification Results sau propagation:** cùng sample30, **Verified: 29 | Failed: 0 | Unverified: 1 (U1)**; F1/F2 đã sửa theo quyết định, U2 đã định nghĩa coverage409/no PATCH CAS. Không biến U1 hoặc bất kỳ runtime gate nào thành pass.

#### Questions & Answers
1. **[Architecture]** Plan chưa nêu method điều khiển scheduler, nhưng page cũ gọi PUT /api/pricing/sync với {schedulerEnabled:boolean}. Bạn muốn chốt contract nào?
   - Options: Giữ PUT cũ (Recommended) | Thiết kế endpoint riêng
   - **Answer:** Giữ PUT cũ (Recommended).
   - **Rationale:** giữ page→PUT→schedule persistence/restart contract; GET/POST không đủ cho scheduler UI.
2. **[Scope]** Phase 1 đang vừa giới hạn ghi trong reports/ vừa cho phép sửa comparator ở tests/. Bạn muốn giải quyết quyền sở hữu file thế nào?
   - Options: Giữ reports-only (Recommended) | Cho ngoại lệ tests-only
   - **Answer:** Giữ reports-only (Recommended).
   - **Rationale:** phase1 wrapper/fixtures/integrity checks chỉ trong reports; comparator source fix nếu cần phải là exact reviewed phase2 manifest delta.
3. **[Risk]** SQL.js hiện lưu trễ và thiếu seam bền vững của nhánh cũ; guard/startup/import cũng cần đối chiếu. Bạn muốn phase 1 xử lý gate này ra sao?
   - Options: Manifest rồi stop gate (Recommended) | Tách prerequisite plan ngay
   - **Answer:** Manifest rồi stop gate (Recommended).
   - **Rationale:** không assume durableTransaction/health/auth stamps hiện hữu; chốt bounded design/files/tests, infeasible thì P1 BLOCKED + named prerequisite, không waive support hoặc tự mở P2.
4. **[Contract]** Cụm 'stale revision conflict' trong phase 2 nên áp dụng cho boundary nào? Source cũ có coverage-pagination 409 nhưng chưa có PATCH CAS.
   - Options: Coverage 409, chưa CAS (Recommended) | Thêm PATCH CAS vào P1
   - **Answer:** Coverage 409, chưa CAS (Recommended).
   - **Rationale:** coverage pagination409 và immutable prior snapshots/concurrent-write correctness không tự tạo PATCH expectedRevision/CAS interface.

#### Confirmed Decisions / Impact on Phases
- Phase1: reports-only; exact persistence/revision/raw-writer/export-import/auth-wrapper/startup file/test inventory + stop gate. Bổ sung named DB pricing/concurrency/ACL import affected tests để xét.
- Phase2: explicit GET/POST/PUT sync contract; no PATCH CAS; coverage pagination409; giữ dirty-state/durable-read distinction và manifest prerequisite.
- Phase3: draft helper và page PUT consumer; configured/running/error UI; coverage409 restart; compiled wrapper auth/normalization, durable restart và affected-consumer evidence.
- Custom input: không có; user chọn cả4 recommended options trong một interview.

#### Action Items
- [x] Sửa F1/F2 và propagate4 quyết định sang cả3 phases.
- [x] Định nghĩa U2 boundary không thêm PATCH CAS.
- [ ] U1: khi được authorize phase1, chứng minh bounded seam design/feasibility hoặc report P1 BLOCKED + named prerequisite. Chưa chạy phase1/baseline/source edits.

#### Whole-Plan Consistency Sweep
- Files reread: `plan.md`, `phase-01-start.md`, `phase-02-port-and-api.md`, `phase-03-ui-and-acceptance.md`.
- Decision deltas checked:4 (sync PUT, reports-only ownership, manifest/stop gate, coverage409/no PATCH CAS); reconciled findings:F1/F2/U2. Initial matrix/failures giữ historical, không overwrite thành runtime pass.
- Unresolved documentation contradictions:0. U1 vẫn là execution dependency chưa chứng minh, không phải đã resolve bằng sweep.
- Local checks: all4 files frontmatter/links/fences/whitespace +8 contract/ownership/status assertions PASS; `ak plan validate <absolute-plan-dir> --json --no-interactive`: valid=true. CLI chỉ check format, không runtime/semantic acceptance.
- Tracked product/index unchanged; HEAD vẫn `87a74e1bda3677193c6f71a7e2100c90311f0689`. Markdown LSP từng incomplete/marksman silent, không dùng làm bằng chứng clean; local deterministic checks ở trên đã chạy.

- **Disposition:** không chạy tests/build/browser/network/DB hoặc sửa production code; validation không authorize implementation. Chỉ phase1 có thể là next bounded execution sau yêu cầu riêng; phase2/3 vẫn gated bởi U1.

<!-- slug: reference-pricing-port -->
