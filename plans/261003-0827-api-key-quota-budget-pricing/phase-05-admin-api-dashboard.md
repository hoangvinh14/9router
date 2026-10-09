---
title: "Phase 5: Management API, key dashboard và recovery"
status: in-progress
priority: P1
effort: 16h
depends_on: [1, 2, 3, 4]
---

# Phase 5: Management API, key dashboard và recovery

> **Technical reference, không phải backlog song song.** [Roadmap Gói A–E](./plan.md#current-delivery-roadmap) phân ownership: pricing API/UI thuộc A; key budget/usage UI thuộc C; recovery API/UI/operator flows thuộc D; integrated acceptance thuộc E. Checklists giữ accepted requirements; historical preparation/pending statements không buộc xây lại surfaces đã có.

<!-- Updated: Validation Session 1 - JWT/trusted-loopback guard, gap recovery, changed-only pricing overrides -->

## Outcome

Admin cấu hình tuần/tháng, xem virtual spend/usage/reset và xử lý unresolved có audit. Client key không sửa limit hoặc xem dữ liệu key khác. Pricing page sync/override có provenance/health, không thành billing portal.

## Current delivery state — existing API/UI cần integrated acceptance

Inactive budget/accounting/usage/recovery và pricing endpoints/editor/panel đã có implementation; scoped actual HTTP/JWT/persistence/authority negatives và intercepted desktop/mobile UI có evidence. Không mô tả management là chưa bắt đầu hoặc xây lại các surfaces này.

ActualtwoPOSTledger→existingmanagement status/usage/listing/signedJWTroutefunction+
CSRF/authbeforeDB/redaction/independentmanualexactrecovery/originalprices/immutable
committedreceipt replay `b37eff873` **68/68 exact6,0skip/todo,lint/whitespace0**.
NotactualHTTPtransport/UI acceptance. Newboundedglobalgap GET/waiverPOST
`/api/accounting/gaps` optionaladminrecoveryonly(notactivation/maintenance-release),
strictNULLscope/targetgeneration/auditbeforeindependentsidecarACK/redactedreceipts;
`b42e6be7f` **40/40 exact6,0skip/todo,lint/whitespace0**, Node/SQLjs oldcommittedfailedACK
→newerlatch/retry negatives. Maintenance-release API candidate nowadded afterstorage
prerequisites, notacceptedwire/UI: POST `/api/accounting/maintenance/release` strict4
fields/serveractor/existingauthCSRFguard, noactivation/gapclear/policymutation.
`b0e64ed05` **85/85 exact7,0skip/todo,lint/whitespace0** NodeSQLjs JWTbeforeDB/changedintent409/
failedACK503/replay/newmaintenanceretained/redaction/no-store; storagetargetACK
implementation additiveprotectedsidecarhistory≤1000/no pruning, coverageidentity+target
 generation+domainseparatedpayloadhash boundcommittedaudit, historicalreplayread-only
leaveslatermaintenanceunchanged. `b979929c4` **95/95 exact7,0skip/todo,lint/whitespace0**.
`baf0003a0` exact5 **85pass/2fail**, 0skip/todo, lint/whitespace0: all8Node/SQLjs
actualSIGKILL cases pass; capacity1000bothadapters failedSTACK_TRACE_ERROR duration
9201/9449ms. Failureartifacts retained; O(n²)historypreservation scan discovered→
validateduniqueopIDMap+sameexactserializedrowcomparison O(n), Advisorcheckpoint not
independentpatchapproval. `b26ea26b5` exactsame5 **86pass/1fail**, lint/whitespace0;
verboseconfirmsNodecapacitytimedout5000ms/duration8127,SQLjscapacity4137pass/all8crashpass.
`b4bbaea3e` selecteddiagnosis **1pass/1timeout,22selectionskips**: NodeBufferdeepmatch
4444+1828ms dominates setup57/denial69/replay57ms; SQLjs1666+967ms. Temporarytiming
removed; only2capacityBufferassertions native.equals(bytes).toBe(true) preservesexact
length+bytes/samesnapshots/observationpoints. `ba638249b` **87/87 exact5,0skip/todo,
lint/whitespace0**, capacityNode462ms/SQLjs301ms, all8actualSIGKILLpass;
unchanged1000/deadlines/audit-replayguards, originalsretained. No timeoutincrease or
reducedcapacity; selecteddiagnosticnotacceptance. Capacitysynthetichistory not
1000realACKcertificate. `b3635f3d9` **89/89 exact5,0skip/todo,lint/whitespace0**: twoNodeactualmanaged
restorebefore/afterreleaseaudit snapshots retainexternalACKhistorybackupbytes/globalgap/
newmaintenance; snapshotwithoutoriginalaudit cannotretrofitreceipt orclearmaintenance.
Notretainedinitializationintentrestore/allruntimecertificate. Downgradeprohibition and
HTTPauthority exposure gates remain. Nullableabsence+audit alone
cannotcertify originalrelease orlaterlatchreadiness; oldcompletedreleaseswithoutACK
cannotretrofit. Downgrade/coherentbundleantirollbacknotcertified.

GlobaloperatorUI candidate `GlobalAccountingPanel.js` hookedexistingEndpoint keymanager
(not surface rebuild): namedfocus-trappedmodal/loadingerrors/OFF/no-readiness language,
explicitreviewcheckbox/globaltarget/reason/evidence, singleinflight guard, exactURLstrict
immutabletablocalretry state retainedbeforePOST/no auto-submit/storagedeny0POST, receipt
scope/gen/action/op/timestamp validationbeforecleanup (echoonly/mismatcheddeny). Historical
ACKnotcurrenthealth certificate. `b41894d7f` **76/76 exact6,0skip/todo,lint/whitespace0**
draft+route/crash/restore contract. Renderedfixture `tests/browser/global-accounting-panel.mjs`
nowadded desktop/mobile/focusrestore/Tabtrap/busyEscape/retry/mismatch/storagefailure0POST/
historicalACKnewmaintenance, notyetexecuted. Runnerfreshness checksallglobalinputs.
`bc7e8c20a` new79filepredeclaredstableintegratedsweep+sameinputsdiagnosticbuildrunning;
no observedresult/newbuildacceptanceyet. Source/tests/config/scripts/runnersheldstable.
Actualrendered/HTTPserver/fullsecurity acceptance stillrequired; 2autoswitchreds notwaived.

Remaining delivery: global gap/maintenance operator scope acceptance, actual existing-attempt recovery/immutable receipt replay và usage/spend/status từ integrated Phase04 ledger; auth/CSRF/redaction, ambiguous retry, real UI/API keyboard/mobile acceptance. Empty-ledger HTTP và intercepted UI không đủ chứng nhận các luồng này. Có thể tiếp tục operator prerequisites độc lập; final integrated acceptance phụ thuộc actual lifecycle, không artificial whole-phase restart. Theo [current roadmap](./plan.md#current-delivery-roadmap); non-null policy vẫn409 khi accounting not ready, enforcement OFF đến rollout gate.

## File ownership

Mọi path expand từ `/home/gmo/projects/9router/`.

| Action | Path | Change |
|---|---|---|
| Create | `src/app/api/keys/[id]/budget/route.js` | GET/PUT limit decimal validation + version, window status. |
| Create | `src/app/api/keys/[id]/usage/route.js` | Paginated ledger usage + provider/model breakdown. |
| Create | `src/app/api/keys/[id]/accounting/route.js` | Pending/unresolved inspection, no sensitive payload. |
| Create | `src/app/api/keys/[id]/accounting/[attemptId]/resolve/route.js` | Admin recovery/waiver idempotent + CAS + audit. |
| Create | `src/app/api/keys/[id]/accounting/gaps/resolve/route.js` | Audited coverage-gap reconciliation, CAS/operationId/evidence; global gap requires scope-wide reconciliation, không clear vì sửa một key. |
| Create | `src/lib/apiKeyBudget/managementAuth.js` | Shared route-level dashboard JWT hoặc verified loopback login-disabled guard + mutation Origin/CSRF checks, reject inference tokens. |
| Create | `src/app/api/pricing/sync/route.js` | GET health/coverage, POST fixed-source sync. |
| Modify | `src/app/api/pricing/route.js` | Price provenance/validation; preserve existing override consumers. |
| Modify | `src/app/api/keys/[id]/route.js` | Guard ID updates/deletion compatibility, không cascade ledger. |
| Modify if needed | `src/app/api/settings/route.js` | Validated optional pricing-sync schedule; timezone not mutable v1. |
| Modify | `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` | Existing key manager hooks budget component. |
| Create | `src/app/(dashboard)/dashboard/endpoint/components/ApiKeyBudgetPanel.js` | Editor, progress/reset/scope/coverage, usage drilldown + unresolved recovery. |
| Modify | `src/app/dashboard/settings/pricing/page.js` | Sync/source/update timestamps, unknown vs explicit free, override precedence. |
| Modify | `src/shared/components/PricingModal.js` | Submit changed overrides only, untouched save no-op, remove override/inherit, decimal draft/missing != zero; reset dùng effective API response. |
| Modify only if tests reveal gap | `src/dashboardGuard.js` | Keep existing trusted management mode; ensure new nested paths not public bypass. |
| Create | `tests/unit/api-key-budget-management.test.js` | Auth/CSRF/schema/redaction/races. |
| Create | `tests/unit/api-key-budget-error-contract.test.js` | OpenAI/Claude/Gemini JSON and stream error compatibility. |

## API contract

Follow [design contract](./design-contract.md): scope list `chat,embeddings`, timezone/reset UTC, decimal money strings, `ledgerStartedAt`, coverage, pending/unresolved/overshoot, enforcement state. No raw key fields in new responses or URL/query params. Shared route-level guard trước body/read/write/fetch: valid dashboard JWT hoặc verified loopback + requireLogin=false, không CLI inference token/gateway key/anonymous remote. Mutation phải Origin/CSRF-safe cả JWT lẫn local; Host/forwarding headers không chứng minh loopback. Gap recovery endpoint có key/global coverage status, evidence/reason/operationId/expectedVersion+generation; freeze affected unrecorded admissions hoặc generation CAS, audit durable trước sidecar ack, global latch không clear bởi một key waiver. Usage cursor bounded default 50/max 200; model/provider filters validated and parameterized SQL. PUT version mismatch 409; failed recovery version/operation conflict 409.

## UX outline

```text
API key: [name]  [active]     Reference cost • chat + embeddings only
Weekly:  [off / limit $____]    $spent / $limit  [progress]  reset Mon ...
Monthly: [off / limit $____]    $spent / $limit  [progress]  reset 1st ...
Status: allowed / budget-exceeded / accounting-unresolved / storage-error / coverage-gap / maintenance
Coverage: metered since ...; gaps/reconciliation ...; legacy analytics not charged
[Usage by model/provider] [Unresolved attempts N] [Save limits]

Recovery drawer: provider/model/time/outcome + original pricing snapshot
[exact usage / audited cost correction / explicit waiver] reason [____]
[confirm] -> version checked + append-only audit, never delete history
```

- Label “reference/virtual cost, không phải hóa đơn upstream”; OAuth/subscription vẫn tiêu hao quota.
- Null unlimited và zero deny phân biệt rõ. Save UI không optimistic reset spent. Remaining clamp zero nhưng overshoot amount hiện riêng. Unknown amount hiển thị “chưa xác định”, không `$0.00`.
- Warning khi bật strict budget: provider không gửi exact usage có thể block key, cần admin recovery. No-key/CLI inference và non-chat modalities không enforce; muốn mọi traffic covered phải yêu cầu API key, vẫn không bao phủ excluded modalities.
- Loading/error/empty/disabled/expired-window/unresolved/storage/**coverage-gap/maintenance** states, keyboard accessible editor/dialog, responsive mobile. Gap blocks budget activation; display durable coverage interval và audited reconcile/waiver warning, không pretend exact historical spend. Poll bounded/no secret in client console.

## Implementation checklist

- [ ] Write auth and schema tests trước endpoints: anonymous, dashboard JWT, trusted local management requireLogin=false, malicious remote Host/Origin, client gateway key, CLI inference token, cross-key access. CLI inference token và anonymous remote login-disabled **must deny**, trusted local verified peer allowed, JWT cross-origin mutations deny. Existing guard prefix alone không là proof (`dashboardGuard.js:187,232` allows broader access); route-level shared guard authoritative, giữ unrelated management compatibility.
- [ ] Implement query/status/update endpoints; validate null/zero/decimal bounds, rejected arbitrary field/timezone reset controls. ID not secret; SQL placeholders; no arbitrary fetch URL.
- [ ] Recovery transaction uses original price snapshot/exact counts hoặc explicit audited amount evidence; operationId replay idempotent, resolutionVersion protects races. Admin reason mandatory, waiver confirmation separate; no delete/rewrite audit API.
- [ ] Pricing sync manual + schedule opt-in 24h/default off. Reuse scheduling/init conventions after source inspection, single-writer single-flight, last-known-good/override survives sync failure. Không expose arbitrary catalog URL.
- [ ] Pricing page + PricingModal là hai existing `/api/pricing` consumers; keep numeric map GET/PATCH/DELETE shape, metadata qua sync/status. Modal chỉ PATCH **changed model override objects**, đủ required rates/explicit optional fallback theo complete-source resolver, không sparse field merge giữa sources; opening/saving untouched tạo zero overrides. Add explicit remove override/inherit sync, zero retained, missing not coerced zero, decimal strings giữ UI precision trước validated ingress. Reset renders DELETE response effective synced prices, không hardcoded bundled defaults. UI tests: edit one model -> sync updates other models; no-op save -> zero writes; inherit -> synced rate; explicit zero -> valid zero.
- [ ] Integrate editor/drilldown/recovery in existing Endpoint page and sync controls in pricing page. API key lifecycle secrets existing page may still show; new tracking APIs/components must not add raw-secret serialization.
- [ ] Add shared 429/503 client envelopes, `Retry-After` calendar, requestId/error code, CORS exposure/no-store; stream terminal tests for format-native errors. No upstream-account cooldown on local errors.
- [ ] Browser test with mock/temp DB on desktop/mobile: both limits, exhaustion, reset, lowering budget, unknown-cost warning, recovery, sync offline/override precedence. Capture screenshots and accessibility/console evidence.

## Verification gate

```bash
(cd tests && npx vitest run unit/api-key-budget-management.test.js unit/api-key-budget-error-contract.test.js)
npx eslint 'src/app/api/keys' src/app/api/pricing src/app/api/settings/route.js 'src/app/(dashboard)/dashboard/endpoint' src/app/dashboard/settings/pricing/page.js src/shared/components/PricingModal.js src/lib/apiKeyBudget/managementAuth.js src/dashboardGuard.js
```

Pass: new tests green; responses/logs with seeded raw key contain **zero matches** outside existing authorized key lifecycle response; cross-key/client mutation unauthorized; no CSRF tunnel bypass; duplicate recovery not double-debit; status header/native envelopes accepted by mocked OpenAI/Anthropic/Gemini clients. UI screenshots/test evidence required before done, not just JSX lint. Include new coverage-gap recovery and pricing no-op/inherit UI/API fixtures; route-level guard tested through actual endpoints, spoofed peer/CLI/remote login-disabled fetch/write-count=0.

## Security và failure protocol

Do not rewrite whole auth, secret storage or X-Forwarded-For handling. Audit all new management paths and catalog SSRF surfaces. Stop nếu unauthorized mutation/redaction/race fails; don't suppress tests or call waived usage exact. Admin waiver has privilege and trace, không exposed as client self-service credit.
