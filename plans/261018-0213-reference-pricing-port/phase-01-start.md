---
title: "Dependency check và baseline"
status: done
---

# Dependency check và baseline

## Outcome
Có port manifest nhỏ, test lanes rõ và không kéo accounting WIP vào pricing. Đây là prerequisite thực thi, không là một vòng nghiên cứu không điểm dừng.

## Inputs đã xác minh
- Master `87a74e1b`; feature source `3a4955a0`; WIP stash `d515fb49…`. Xem full SHA ở roadmap.
- Master có `src/lib/db/repos/pricingRepo.js`, `src/app/api/pricing/route.js`, pricing page/modal và `src/lib/auth/{dashboardSession,trustedPeer}.js`.
- Master chưa có `src/lib/pricing/` và `tests/browser/`. Source cũ đọc bằng `git show`, không restore tree.
- `src/lib/db/driver.js` current fallback không có durable accounting health contract của branch cũ. `schema.js` hiện version 2 với accessRestricted/accessAllow; không hạ version/ghi đè ACL.

## File ownership
<!-- Updated: Validation Session 1 - reports-only ownership và explicit seam manifest/stop gate -->
Phase này chỉ được thêm report/test baseline artifacts, comparator wrapper và synthetic fixtures tại plan-owned `reports/`; không sửa `tests/` hoặc production files. Khi user cho implement, tạo nhánh feature trước changes. Nếu comparator gốc cần fix, liệt kê exact comparator/test delta trong manifest phase 2 và review trước khi chạy; phase 1 không có ngoại lệ tests-only. Phase 2 manifest phải liệt kê source/test files cụ thể; không wildcard checkout. Không ghi raw key/credential/log content vào report.

## Steps
1. Reconcile HEAD, WIP, stash object và new changes; giữ ignored environment/deps, không giả sạch nghĩa đúng deps. Đọc package manifests/current installed tools; không tự install/update version.
2. Đọc old closure và bodies: pricing money/validation/catalog/resolver/cache/scheduler, guards, repo, DB revision/migrate/adapters và hai UI consumers. Liệt kê imports rồi chia reuse/adapt/replace/hold.
3. Trace current legacy callers: pricing API; `src/lib/db/repos/usageRepo.js`; reexports `src/lib/db/index.js`/`src/lib/localDb.js`; page `src/app/dashboard/settings/pricing/page.js` và `src/shared/components/PricingModal.js`. Search thêm import/call sites tại execution revision, kể cả dynamic imports. Đây không phải exhaustive transitive inventory đã chứng nhận.
4. Ghi quyết định từng seam, exact files và verification tests trong manifest trước source edits:
   - Pricing-only constants/client-safe decimal helper/draft không import request accounting; revision mutation/rollback/reopen/cache eligibility. `canMemoizePricing` absence chỉ tắt cache, không tự chứng minh durable/healthy read.
   - Persistence ACK/reopen/failure của catalog, overrides và schedule. SQL.js hiện debounce100ms; transaction success/dirty RAM không là durable last-good. Không tạo ledgerStartedAt hoặc kéo accounting writer vào chỉ để có health method.
   - Raw pricing writers `src/lib/db/index.js` import và `src/lib/db/migrate.js`; export/import policy cho referencePricing catalog/status/schedule mới; giữ upstream ACL round-trip. Named affected tests tối thiểu cần xét: `tests/unit/db-sqlite-vs-lowdb.test.js`, `tests/unit/db-concurrent.test.js`, `tests/unit/key-access-migration.test.js` và legacy usage pricing. Không broad restore redesign; thiếu safe policy là blocker, không âm thầm mất state/invalidation.
   - Route management guard + `custom-server.js` socket/authority provenance, gồm old extra stamps chưa có current wrapper; session/trustedPeer helpers và `.env.example` nếu giữ configured management-origin. Không bypass để bare next dev có Host-only quyền admin.
   - Scheduler default OFF, serving-only startup integration (candidate `src/shared/services/initializeApp.js`), enable/disable serialization/restart/cleanup, không fetch ngay hoặc cần ledger ownership giả. GET/POST/PUT sync contract ở phase 2.
   - Nếu bounded design không giữ đủ persistence/auth/revision/adapter invariant: **STOP, P1 BLOCKED**, ghi named prerequisite để user duyệt; không sửa source, tự mở P2, bỏ adapter/support hoặc waive obligation. Manifest là gate thực thi, không được coi feasibility đã chứng minh từ validation docs.
5. Thiết lập test command dùng Vitest **ở `tests/`**, disposable HOME/DATA_DIR, loopback/fixed fixtures; chạy current affected baseline một lần nếu deps có sẵn. Full suite chỉ khi impact justification; không live/provider/catalog requests.
6. Comparator hiện tại split path bằng `/app/` (`tests/__baseline__/verify-no-regression.mjs`); local repo không cùng prefix. Dùng controlled wrapper/fixtures trong `reports/` để kiểm tra path identity và synthetic pass→fail/missing/collection-unreached trước khi dùng kết luận; raw comparator exit0 không đủ. Không sửa comparator/known-fails trong phase 1. Nếu wrapper không đủ, ghi exact tests-only fix vào manifest phase 2; baseline chưa có comparator đáng tin thì báo incomplete/blocker, không claim no-regression. Thiếu JSON/collection/body-unreached là incomplete, không pass.

## Execution result — 2026-10-18

**P1 BLOCKED; phase 2 not authorized past this failed gate.** Reports-only inspection/probes completed on unchanged base `87a74e1b`; branch `feat/reference-pricing-port` created. [Dependency decisions, conditional manifest and probe evidence](./reports/phase-01-dependency-gate-20261018.md) name the required **DB-SAFETY-PRICING** prerequisite. SQL.js delayed whole-image writes/no health or durable ACK and absent pre-open ownership make a pricing-only durability wrapper insufficient. Native current PRAGMA is NORMAL. Do not import old accounting driver or drop adapters to proceed.

One baseline run concluded **FAILED: 84 passed / 2 failed / 86 assertions across 8 files**, no pending/todo. Both reached failures are usage-count assertions in `db-concurrent.test.js`; see the report receipt/source-only triage. No rerun or source repair. The checkboxes below remain unchecked: the executable safe manifest/feasibility gate failed, and the baseline is not passing. The baseline execution/evidence obligation is recorded as fulfilled in the report, not misrepresented as a green acceptance checkbox. A completed investigation is not a passed implementation dependency.

## R7 dependency recheck — supersedes historical stop
User explicitly accepts DB prerequisite for conditionalLinuxdevelopment with disclosed independentreview/testcoverage limitations. [Accepted policy](../261018-0749-db-safety-pricing/reports/r7-conditional-linux-acceptance.md). [Exact P1 manifest](./reports/p1-r7-recheck-and-port-manifest.md) now names boundedfiles/tests/security/import/revision/scheduler seams. Gate passes for stagedimplementation; consumerobligations must be proved before API/UI acceptance, not assumed from architecture. Originalbaseline/failedgate preserved; sourceboundR7affected149includes originalusageassertions unchangedPASS. No comparator edits or runtimeinstallation. Phase2purecore started, not finalpricingapproval.

## Historical exit at original stop
- [ ] Manifest có minimal source/test set, consumers, dependency decisions và safe rollback path; các inherited guards không bị bỏ.
- [ ] Baseline hoặc environmental blocker có evidence; không cài deps/đổi runtime ngầm; không lặp green.
- [ ] Scope phù hợp P1; nếu shared durability/topology change không tách nhỏ được thì P1 blocked và report đúng prerequisite. Không tự mở P2 khi P1 blocked.

## Lệnh tham chiếu — chỉ chạy khi được yêu cầu implement
```bash
git show 3a4955a0336f970505c325b0faf892f5397c93bb:plans/261003-0827-api-key-quota-budget-pricing/reports/package-a-closure.md
# Tại tests/, sau khi xác minh files/deps tồn tại; dùng HOME/DATA_DIR disposable:
npx vitest run unit/provider-pricing-minimax-m3.test.js unit/key-access.test.js unit/key-access-migration.test.js --reporter=json --outputFile=/ABSOLUTE_DISPOSABLE_DIR/pricing-baseline.json
```
Ba test paths trên tồn tại master, chỉ là baseline seed liên quan pricing/ACL, không exhaustive pricing/DB baseline. `pricing-route.test.js` và các suites port khác chưa tồn tại master. Manifest phase 1 chốt affected baseline bổ sung trước port, không dùng baseline của code cũ thay baseline mới.
