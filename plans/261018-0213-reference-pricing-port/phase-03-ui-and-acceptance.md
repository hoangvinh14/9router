---
title: "UI và nghiệm thu pricing"
status: done
---

# UI và nghiệm thu pricing

## Outcome
Pricing page + PricingModal phản ánh persisted/effective state chính xác, P1 đóng bằng evidence mới không phụ thuộc hoàn tất toàn bộ accounting.

## Historical evidence (2026-10-19; superseded by 2026-10-22 closure)
Phase2 exact-editor refinement broad regression PASS275/275 across26files; current source-bound receipt in reports/pricing-editor-view-affected/. Stage8 UI implemented using pricing-owned constants only: exactstring draft, changed-only complete model edits, optionalblank/zero/inherit distinction, failclosed loading/reset refresh, scheduler configured/running/configurationSaved state, coverage409 explicitrestart and keyboard/dialog controls. Focused `b6eaeaa79` PASS27/27 across3files,0failed/pending/todo; source/helperhashesmatch ([receipt](./reports/pricing-ui-stage8-tests/receipt.json)). This is draft/helper/API proof, not renderedbrowser proof. UI lint `bc6911a45` completed PASS for5paths; source-bound receipt archived. ActiveLSP5paths8auxiliarystylefindings,2confirmedclean/1push-onlyinconclusive, notallclean.
Compiled build, disposable standalone startup, authenticated API/page smoke, and exact pricing restart persistence now pass on server 167; rendered browser/Docker acceptance remains unverified. Historical pre-server-167 attempt (2026-10-20) failed missing declaredoptionalAWSdependency; it is superseded for build status by the server-167 receipt. User approved disposable staging dependency setup only; setup and corrected actual isolation preflight passed, version/integrity/fulltree/source hashes verified before build. Newly manifested staging build `b34837935` then FAILED124. Both archived exitrecords124; Next16.3.8 log ends at Creatingoptimizedproductionbuild, no completion. Rawcollector printed completedindex then10stimeout; separate30spostrunverification timedoutwithoutoutput. Postrun archive-copy/source/helper/dependency integrity, artifactcompletion and residualprocessstate remain unconfirmed; no watchdoglayer/OOM/rootcause asserted. Counsel preceded each diagnosis; no buildretry/budgetincrease/sourcehelperrepair/processsignals. [Disposition](./reports/pricing-staged-build-attempt1/disposition.md) and latest checkpoint are authoritative. Cached Chromium version works but launch diagnostic timedout/noCDP; browser inconclusive, no sandboxdisable/install/retryloop. No intended rootdependency/liveDocker/data changes or shutdown-flow changes; postrun equality is not claimed. Further execution needs an explicit approved, materially justified diagnostic plan.

## Browser continuation — 2026-10-22

Playwright and matching Chromium are now installed. Real browser checks found a scheduler restart initialization defect and a transparent modal caused by absent theme tokens. Both fixes are implemented; startup/schedule tests pass 9/9 and touched-file lint passes. The combined rebuild and all 16 real-browser checks now pass, including compiled scheduler restart, exact persistence, fixture-backed malformed/offline last-good, security denial, keyboard/mobile, and no accounting activation. The isolated Node 22 Alpine source-image build completed (exit 0); its better-sqlite3 container passed all three smoke groups, including exact pricing and scheduler persistence across stop/start. Phase 3 is complete within the accepted conditional Linux development scope. See the [browser disposition and archived failed attempts](./reports/pricing-browser-20261022/disposition.md).

## Steps
<!-- Updated: Validation Session 1 - explicit draft/startup consumers, PUT scheduler và coverage409 UI contract -->
1. Sau phase 2, port draft/UI tests/helper candidate `src/shared/utils/pricingDraft.js` và hai consumers: `src/app/dashboard/settings/pricing/page.js`, `src/shared/components/PricingModal.js` theo exact manifest. Changed-only complete model overrides; untouched save no-op; remove/inherit khác zero; reset dùng effective prices; missing không tự điền/persist0; preserve decimal strings trước validation. Không thêm PATCH CAS hoặc bắt buộc expectedRevision/header mới.
2. Port coverage/sync/scheduler UI trong phạm vi pricing: page GET status, POST manual fixed-source sync, **PUT `/api/pricing/sync` với `{schedulerEnabled:boolean}`**; phân biệt configured/running và configurationSaved failure, không báo enabled chỉ vì HTTP request đã gửi. Coverage revision cũ409 phải restart pagination, không trộn nhiều revision. Hiển thị virtual reference/source/staleness/missing units rõ, không quảng cáo provider accounting coverage chưa có. Keyboard/focus/input behavior và mobile horizontal scroll thuộc acceptance.
3. Port browser fixtures `tests/browser/pricing-editor.mjs`, `pricing-real-api.mjs`, `run-pricing-editor.mjs` từ Git cũ nếu phù hợp; đọc launch/env/process cleanup trước chạy. Không scripts từ repo ngoài, không arbitrary network/live catalog. Không chạy harness cũ dựa absolute /tmp evidence.
4. Focused tests rồi một affected barrier theo manifest, gồm legacy DB pricing/concurrency/import/migration/ACL và usage consumer khi seam bị tác động. Comparator wrapper/fixtures từ reports hoặc exact tests-only fix đã review ở phase 2 phải có path/pass→fail/missing/collection controls trước claim no-regression; phase 1 không sửa tests/. Build một lần với resource profile khai báo; không giữ build knob thay đổi ngoài scope. Build timeout/OOM là blocker, không quay lại vòng tuning vô hạn.
5. Actual compiled custom-server + disposable DB/browser: auth/login và verified direct-loopback/login-disabled theo declared topology; API→page/modal; overrides/zero/invalid/no-write/no-op/inherit; offline/malformed durable last-good; scheduler PUT enable→restart→disable không immediate fetch (serving startup seam theo manifest, không thay toàn initializeApp); coverage pagination stale409/restart; hostile Origin/CLI-or-gateway-only denial/auth-first và wrapper authority-normalization; mobile/keyboard; DB assertions no ledgerStartedAt/no accounting rows. Chỉ claim durability/reopen/adapters thực chứng minh; memo bypass hoặc delayed SQL.js RAM không là persistence proof.
6. Review security/compatibility diff; write concise closure receipt + known limits. Không overwrite historical failures. Chưa có P2 nên snapshot consumption là interface test, không claim actual inference settlement.

## Test entry points
Chạy từ `tests/` sau khi port files và verify dependencies:
```bash
npx vitest run unit/pricing-draft.test.js unit/pricing-crud-management.test.js unit/pricing-management-integration.test.js unit/pricing-management-peer.test.js --reporter=json --outputFile=/ABSOLUTE_DISPOSABLE_DIR/pricing-ui.json
```
Planned port targets, không phải files sẵn master. Browser command/port/home/process ownership phải lấy từ reviewed port script tại execution revision; chưa chạy scripts trong planning. Root build `npm run build`, lint trên actual changed list. Dùng background cho build/browser/tests dài, không re-run-for-green.

## DONE
- [x] API/page/modal/restart flows và snapshot contracts thực chạy trên revision mới, rõ fixture/live distinction và adapters.
- [x] Focused, actual boundary, affected consumers, lint/build và direct security review xử lý đủ; unavailable/inconclusive không ghi clean/pass.
- [x] Legacy usage pricing/ACL/provider data không regression; scheduler OFF khi kết thúc, owned processes đóng, disposable DB không là production data.
- [x] Report chỉ trạng thái P1 và dependency P2; không all13AC/whole-product/activation claim. Commit/push/merge cần yêu cầu riêng.

## Closure — 2026-10-22

The [closure receipt and acceptance matrix](./reports/pricing-browser-20261022/disposition.md#container-acceptance-and-closure) bind the final source manifest, host build, 16 browser checks, three Docker smoke groups, retained Phase 2 snapshot/affected-consumer evidence, direct security review, and cleanup. Host Node SQLite and Alpine better-sqlite3 were exercised; this adds no Windows, crash/power-loss or general graceful-shutdown certification. Known dependency/build warnings and the prerequisite's conditional acceptance remain visible in that receipt. No missing obligation remains inside the accepted P1 pricing-only scope. No production activation, commit or push.
