---
title: "Actual end-to-end và affected acceptance"
status: completed
---

# Phase 3 — Actual end-to-end và affected acceptance

Depends on completed [phase2](./phase-02-management-ui.md). The original command matrix below is retained as the planned contract; actual commands/results are reconciled in the [acceptance trace](../reports/verification-261028-p4-acceptance-trace.md) and [phase2 receipt](../reports/implementation-261028-p4-phase2-progress.md). Latest build uses `NEXT_DIST_DIR=.next-budget-freshness`, browser commands set `BUDGET_STANDALONE=$PWD/.next-budget-freshness/standalone` and `PLAYWRIGHT_BROWSERS_PATH=/home/gmo/.cache/ms-playwright`. Both adapters passed19 final checks, including actual concurrent POST overshoot and null-cost unresolved usage screenshots; separate actual detached shipping smoke passed8. Full same-base CI comparison includes import failures and has no newly unexplained failure; suites remain red. The [performance review](../reports/verification-261028-p4-performance-review.md) records observed overhead and the scoped retain-design decision after the480-request ABBA repeat; it is not a production bound. Final affected controls passed726/726 across45 files with zero skips. Security-first parent source review, advisory review with disclosure limits, trace and P5 handoff are reconciled in the [completion receipt](../reports/implementation-261028-p4-completion.md). Phase3 is complete within these boundaries; production remains OFF. Do not substitute helper-only proof for actual HTTP/browser.

## Complete vertical flow

- [x] Disposable DATA_DIR và selected-profile loopback dummy only; clean owner/sidecar, hai keys với policies khác nhau, exact pricing fixture. Block external network, redact artifacts; không dùng live credentials/upstream hoặc real `~/.9router`.
- [x] Actual browser login → Endpoint UI → guarded finite PUT/version → actual chat HTTP handler/core/transport → dummy generation POST → own durable terminal ACK → panel GET exact spent/remaining → next request429 trước POST. Assert ledger reload, original price, key-ID attribution, counts và actual upstream POST count.
- [x] Repeat JSON/SSE, Node SQLite và SQL.js. Both-window cases: weekly-only exhausted, monthly-only, both với different reset; zero policy requiresPolicyChange/advisory Retry-After; no-store/native code/requestId/CORS và no false successful stream terminal.
- [x] Two-key concurrent traffic: keyA exhausted/unresolved không block/charge keyB. Same-key live pending may both POST; exact overshoot hiển thị và next blocked. Không reservation hoặc tiền lấy từ usage projection.
- [x] Browser lower/raise/null/re-enable và key disable/re-enable không reset spend. Policy hold race refuses stale request; existing terminal sinks persist exact usage theo old snapshot bất kể edits. ACL allowed/denied vẫn đúng; concurrent ACL/budget dirty state không mất.
- [x] Restart **cùng** DB/policy/sidecar/binding material và process mới: threshold vẫn block; pending từ owner đã chết được recover unresolved; không tạo clean artifact hoặc stamp ledgerStartedAt để pass. Không force-orphan process còn live.
- [x] Clock-controlled week/month boundary: POST-before-reset/settlement-after-reset → previous-window charge/overshoot; next-window remaining đúng. Held finite intent trước reset/chưa POST → not_dispatched/budget_window_changed; rollover chỉ ở unlimited dimension/null-null không calendar-deny; new request window mới. Matrix tháng ngắn/leap/year/timezone không sleep dài. Restart với clock control phải preserve fixture recording lifetime, không reset policy/history.
- [x] Unknown usage→null-cost/unresolved, finite blocked qua reset/restart; null/null continuation theo đúng P3 guard, bật limit lại vẫn blocked. Internal audited resolver chỉ dùng trong disposable fixture để prove reopening sau correction/waiver; không claim recovery UI/P5 complete.
- [x] Auth/Origin/peer security matrix phase2 qua real HTTP; no bypass bằng forged budget code/headers hoặc key/CLI token. Native other protocols vẫn outside selected acceptance, không báo all13AC green.
- [x] Keyboard/mobile screenshots với labels/focus/errors, inactive/null/0/overshoot/unresolved; no browser console error, no secrets/prompt trong budget artifacts. Production standalone riêng không có fixture association, finite PUT409/no public enable và normal no-key behavior còn đúng.

## Planned commands / evidence discipline

Root dependencies trước tests dependencies; không dùng hardcoded tests npm test script. Long tests/build/browser chạy background với finite timeout; lưu exit code/output/revision/adapter và failed evidence. Newly named test files phải được tạo trong phase1/2 trước khi chạy, không dùng zero-test green.

```bash
# Root; preflight baseline + affected (sau implementation chạy lại cùng commands)
(cd tests && npx vitest run unit/accounting-*.test.js unit/chat-accounting-*.test.js unit/default-executor-accounting-compatibility.test.js unit/pricing-management-*.test.js unit/pricing-crud-management.test.js unit/dashboard-guard.test.js)

# Root; focused P4 files (proposed, phải tồn tại)
(cd tests && npx vitest run unit/accounting-budget-windows.test.js unit/accounting-budget-policy.test.js unit/chat-budget-loopback.test.js unit/chat-budget-stream.test.js unit/accounting-budget-management.test.js unit/budget-management-draft.test.js unit/key-budget-management-security.test.js)

# Root; include the actual changed .js files, including new files
npx eslint src/lib/accounting/budget-*.js src/lib/accounting/service.js src/lib/accounting/persisted-chat-authority.js src/lib/db/helpers/accounting-policy.js src/lib/db/repos/api-key-accounting-repo.js src/sse/services/chat-accounting.js src/sse/handlers/chat.js src/app/api/keys/route.js 'src/app/api/keys/[id]/route.js' 'src/app/api/keys/[id]/budget/route.js' src/shared/components/ApiKeyBudgetPanel.js src/shared/utils/budgetManagementDraft.js 'src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js'

# Root; isolated build output, no production activation
NEXT_DIST_DIR=.next-budget-acceptance npm run build

# Root; new runner contract, implement/verify in phase1, then execute in phase3
BUDGET_STANDALONE="$PWD/.next-budget-acceptance/standalone" node tests/browser/budget-panel.mjs --engine=node
BUDGET_STANDALONE="$PWD/.next-budget-acceptance/standalone" node tests/browser/budget-panel.mjs --engine=sqljs
```

`BUDGET_STANDALONE` chỉ chọn test artifact trong runner; **không phải app activation switch**. Browser runner owns finite process startup/shutdown/readiness, explicit clock steps, loopback port, isolated artifacts và engine assertion; unavailable required adapter là failure/unsupported evidence, không silent skip. Runner chưa tồn tại hôm lập plan, phase1 phải chứng minh seam và ghi CLI thực tế trước downstream execution. Nếu command khác contract này, cập nhật plan + receipt trước khi coi gate passed.

Affected consumer inventory bắt buộc mở rộng theo actual edits, nhất là keyAccess/cli-tools, imports/identity, proxy/default consumers và selected SSE. Đọc exact tests hiện tại thay vì đoán path. Nếu engine .js được đổi, lint/test chúng thêm; optional live `*.real.test.js` không chạy không credentials. Production smoke dùng existing isolated browser/custom-server pattern với real management guard; không public request activation.

Full-suite regression khi implementation chạm shared key/authority/service: xuất Vitest JSON và so `tests/__baseline__/verify-no-regression.mjs` theo repo guidance. Script hiện tạo path bằng `f.name.split('/app/')[1]`: preflight xác nhận canonical names khớp `known-fails.txt` trong environment này, **không coi output pass là proof nếu names/parser sai hoặc suite import failure không được phản ánh**. Nếu normalization sai, ghi raw failures và compare same-revision pre/post affected/full baseline một cách kiểm chứng được; không sửa known-fails để giấu regression. Baseline checkout có expected failures, không yêu cầu giả all-green.

## Measurement / release boundary

- [x] Vì thêm synchronous spend reads vào each intent/final gate, so selected P3 controls với cùng workload, concurrency/deadline/guards. Ghi ledger size/window population, Node/SQL.js, latency/throughput/stages và overhead; dùng existing `tests/fixtures/accounting/measure-chat-accounting.mjs` làm baseline pattern, thêm budget workload riêng nếu cần, không tuyên bố số P3 cũ là P4 evidence.
- [x] Không có fixed performance budget mới được chốt trong plan này: regression đáng kể hoặc muốn cache/rollup → stop/review data trước kiến trúc khác, không silently relax deadlines/serialized-network behavior.
- [x] Full build + production standalone inactive smoke, dependency traces assets và guards pass. Browser harness acceptance ghi riêng, không thay standalone shipping smoke.
- [x] Review security-first: auth/CSRF/peer spoofing, state/identity/money isolation, no secret leak, fixture activation inaccessible, no routing workaround. Independent/advisory review không thay test/build.

## DONE / handoff

- [x] Trace từng obligation plan.md/solution vào actual test/assertion/receipt; liệt kê chính xác adapter, selected profile và assertions chưa reached. Mọi gate red giữ P4 open; failed evidence không bị overwrite.
- [x] Summary receipt dưới `plans/reports/` theo convention, cập nhật phase/plan status thật, roadmap P4 state nếu implementation accepted. Hiện tại clarification chỉ làm roadmap trỏ detailed plan, không mark implementation complete.
- [x] Production OFF, public coverage timestamp không stamp, recovery/restore P5 và X1–X6/R vẫn open. No whole-product AC2/3/12 hoặc all-protocol budget claim.
- [x] Handoff P5 với current policy/API/UI/error/fixture constraints và unresolved risks; không tự commit/push/merge/deploy/activate.
