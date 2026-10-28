---
title: "Guarded budget API và key UI"
status: todo
---

# Phase 2 — Guarded budget API và key UI

Depends on accepted [phase1](./phase-01-start.md), gồm harness feasibility. [Solution](./solution-design.md) quy định exact API, inactive semantics và state ownership. Full recovery UI vẫn P5; không thêm production activation.

## Outcome / file ownership

Admin thực sự edit policy trên disposable fixture, xem ledger projection/threshold; UI production truthful inactive. ACL/key toggles giữ behavior/state riêng và cùng security boundary.

| Owner | Work |
|---|---|
| `src/app/api/keys/[id]/budget/route.js` (new) | GET/PUT shared management guard, exact input/status/no-store |
| `src/lib/accounting/budget-management.js` (phase1 composition) | Current identity/policy/health/projection, CAS service; private fixture readiness |
| `src/app/api/keys/route.js`, `src/app/api/keys/[id]/route.js` | Named security prerequisite: auth-first GET/POST/PUT/DELETE, Origin mutations, preserve response contracts |
| `src/shared/components/ApiKeyBudgetPanel.js` (new) | Two windows, previous-window summary, exact draft editor, warnings/status/accessibility |
| `src/shared/utils/budgetManagementDraft.js` (new) | Pure string draft/null/validation/no-op/conflict state |
| `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` | Compose per-key panel; preserve ACL/key/tunnel UI, no shared stale overwrite |
| `tests/unit/accounting-budget-management.test.js`, `budget-management-draft.test.js`, `key-budget-management-security.test.js` (new) | Route/repo/security/draft actual cases |
| `tests/browser/budget-panel.mjs` (new), phase1 web fixture | Real UI+API editor and ledger data, no mocked response acceptance |

Không sửa KeyAccessControls contract để nhét budget state; nếu cần tweak chỉ accessibility/presentation có explicit regression tests. Không copy old monolithic management/recovery service.

## Tasks

- [ ] Inventory actual key API consumers trước guard change (dashboard, cli-tools, scripts/tests). Record shapes/auth compatibility; conflict cần giải quyết bằng supported authenticated management flow hoặc STOP/escalate, không thêm CLI-token exemption.
- [ ] Apply `authorizeManagement(request)` trước params/key lookup/privileged read; mutation `authorizeManagement(request,{mutation:true})` trước body/write. GET listing không còn bỏ request arg. Error/deny/success no-store; preserve default-key creation, key reveal response, ACL validation và deleted identity retention.
- [ ] Implement actual GET/PUT budget route theo solution: exact decimal-string/null body, full replacement, CAS expectedVersion ≥1, no-op with current version, stale409, unknown404, invalid400, unavailable503. Actor/readiness từ server; không trust body/headers hoặc prefix-only JWT.
- [ ] Test finite PUT production inactive →409 accounting_not_ready/no write; null/null disable allowed only healthy active retained identity/current version. GET phân biệt stored policy với enforcementActive false; không tự stamp ledgerStartedAt. Fixture finite PUT phải actual durable success và actual chat gate nhìn policy mới.
- [ ] Test missing/corrupt policy503 không initialize lại; inactive/retired PUT409, retained tombstone GET không secret. Existing gap/maintenance không bypass; unresolved cũ giữ và block finite admission, không biến save thành recovery.
- [ ] Build panel/draft bằng string, explicit unlimited toggle,0 khác empty/missing. Display reference cost/soft threshold/no hard cap, both windows/reset/timezone, pending/unresolved unknown, coverage start/scope/health/inactive, overshoot và previous window summary.
- [ ] Separate keyed state/request sequence cho budget và ACL. Test ACL save while budget dirty, budget save while ACL changes, toggle/re-enable, late responses/key switch, two tabs stale version, network/durable failure. No optimistic success trước own durable response; 409 giữ draft và yêu cầu review/reload.
- [ ] Loading/error/poll/focus refresh không xóa draft; health fetch failure hiển thị unknown/stale, không remaining0/free/allowed giả. Server clock authoritative; browser timezone chỉ là display, không tính gate.
- [ ] Keyboard labels, tab order, focus recovery, error announcement, mobile viewport; zero/unlimited/inactive/recovery warning readable. Không tạo nút reset-spend/waive giả; P5 link chỉ khi actual recovery destination tồn tại, nếu chưa thì plain explanation.

## Security matrix (actual route + trusted server HTTP)

- [ ] Valid dashboard JWT allowed; absent/invalid session, gateway API key và CLI inference token denied. Remote login-disabled vẫn denied. Verified direct loopback + requireLogin=false allowed; forged real-ip/forwarded-host/Host/x-9r headers, proxied local hop, DNS-rebinding denied.
- [ ] JWT cross-origin mutation, missing Origin, `Sec-Fetch-Site: cross-site` denied trước body/read/write; same-origin allowed theo existing guard. Không tự relax guard để browser test pass.
- [ ] Auth-first probes chứng minh unauthorized malformed body/unknown ID không gọi privileged reads/writes. GET/PUT errors và denied responses no-store.
- [ ] No raw key/provider credential/prompt/headers/HMAC material trong budget payload hoặc logs. Numeric aggregate >safe integer vẫn exact wire string.
- [ ] ACL vẫn enforce inference, accessRestricted/accessAllow không mất khi budget edits; key auto-provision/reveal/toggle/delete và cli-tools relevant flow có affected evidence.

## Exit / verification

- [ ] Focused management/draft/security và existing management guard/identity/import tests pass; all security failures no privileged side effect.
- [ ] Browser thực sự lưu finite policy qua API fixture, UI reflect reload và ledger spend từ actual chat POST; production smoke vẫn inactive/reject finite save.
- [ ] UI keyboard/mobile/ACL+budget interleaving/two keys đã có assertions/screenshots; no console error/secret artifacts.
- [ ] Route/panel không expose fixture capability hoặc activation flag, no unrelated auth/tunnel rewrite. Ghi receipt và commands trước phase3.

Phase này chưa tự đóng P4: combined restart/calendar/refusal/affected/build còn ở [phase3](./phase-03-acceptance.md).
