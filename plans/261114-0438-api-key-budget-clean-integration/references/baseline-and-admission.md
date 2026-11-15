# Baseline delta và selective-port admission

Planning-only, 2026-11-14. Paths dưới đây tính từ repo root `/home/gmo/projects/9router` (prefix này áp dụng cho mọi file table). Đây là **candidates**, không toàn bộ files đã review/approve để port. Trước sửa engine đọc `open-sse/AGENTS.md`, trước architecture đọc `docs/ARCHITECTURE.md` cùng SQLite correction trong root instructions.

## 1. Provenance không được trộn

- **M:** master candidate `1855aa44473e88feac9d3f131b9c0c5fc9706b68`, shipping baseline cho inference/SQLite/manual pricing.
- **D:** committed develop `08ee1a74954c5fe7a1659a6473e57b6b1ea9059b`; `git show D:path` có thể đọc lại sau switch.
- **T:** tracked working-tree modification so với D; chỉ recover từ preservation SHA sau phase 00, không gọi là “develop đã có”.
- **U:** untracked source/docs/tests; không có Git blob ở D. Phải preserve trước, rồi source from preservation SHA.
- Audit cũ đối chiếu master `1fe586bb…`, không chứng nhận M. Planning xác nhận source bodies selected core: `service.js`, `chat-accounting.js`, `budget-management.js`, `budget-gate.js`, migration004; master keyAccess/key repo và raw delta snippets bằng `git show/diff`. Các dependency khác là audit/candidate evidence, cần body review khi admit.

## 2. Upstream delta kể từ audit baseline

Read-only `git log/diff old-master..M`, 68 commits; không fetch mới. Không full upstream security audit. Những seam ưu tiên:

| File/seam master thay đổi | Delta nhìn thấy / tác động kế hoạch |
|---|---|
| `open-sse/executors/base.js` | `forceFreshSocketByUrl`; 502/network retry dùng fresh socket. Mỗi actual POST/replay phải có attempt mới+fresh gate, không copy older D Base lên |
| `open-sse/utils/proxyFetch.js`, `config/runtimeConfig.js` | package undici rawFetch, direct/proxy dispatcher, TLS curve, stale-socket direct replay trong `fetchWithTlsFallback`, proxy-capable adapter branch. Mock `global.fetch` không bao phủ toàn wire. Accounting phải intercept trước **mọi actual dispatch**, không chỉ một outer call |
| `open-sse/utils/claudeCliVersion.js` + proxyFetch | `ensureClaudeCliVersion` background call, `applyClaudeCliVersion` header mutation. Final wire authority phải xét effective headers sau mutation hoặc refuse selected path; sandbox chặn background internet. Không disable ordinary feature globally |
| `open-sse/handlers/chatCore.js`, `utils/toolDeduper.js` | truyền `messages` vào dedupe; giữ upstream fixes, kiểm tra tool result/history không bị lose khi port |
| `open-sse/utils/stream.js` | suppress duplicate `[DONE]` và trailing sentinel framing. Reconcile với pending Responses→Chat converter fixes; downstream DONE không đồng nghĩa monetary finality |
| `providers/registry/{claude,codex}.js`, `providers/pricing.js`, `services/provider.js`, `src/sse/services/model.js` | Model IDs/UA/Claude dynamic catalog/bare-model fallback và price data drift. Exact manifests chốt từ M, không copy list D hoặc auto-enroll new models |
| `translator/request/{claude-to-openai,openai-to-claude}.js`, `translator/concerns/*`, `utils/claudeCloaking.js` | Tool reference/cloaking/cache/thinking/is_error preservation thay đổi. Revalidate required direct/conversion paths, không assume schema compatibility |
| `package.json`, `next.config.mjs`, CLI/runtime helpers | Runtime install/undici compatibility/build changes. Giữ master dependency versions; chỉ port SQL.js tracing/host path patch nếu missing và có affected test |
| `tests/__baseline__`, master test additions | Baseline providers/aliases, proxy stale sockets, DONE, Claude headers/cloaking/new models cần ordinary controls trên revision mới |

`src/lib/db`, `src/sse/handlers/chat.js`, `src/sse/services/tokenRefresh.js`, `custom-server.js`, `open-sse/executors/codex.js` không có delta old-master→M trong scoped check; **không có nghĩa đã review/certify toàn bộ**. M đã có access ACL/key lookup/SQLite fallback, không rebuild chúng.

## 3. Admission record bắt buộc cho mỗi slice/hunk

Trước code, ghi record cạnh phase evidence: `Bxx → exact source SHA/path/hash + M destination → direct imports/transitive closure → selected symbols/hunks → port/adapt/new → smaller alternative và invariant comparison → schema/data/global ordinary effects → evidence+test selectors → owner reviewer → rollback`. Quyết định **cả dependency closure**, không chỉ main file.

- Nếu dependency đã ở M, giữ implementation M trừ khi chỉ ra missing invariant.
- Pure helpers/tests nhỏ phù hợp thì port cùng test sau review. File coupled thì adapt symbol/hunk; không whole-file restore lên upstream-changed file.
- New code chỉ cho seam thiếu sau so sánh donor; không duplicate service/ledger/raw owner/pricing engine.
- Không `git merge develop`, không cherry-pick large coupled commit; `git restore --source=preservation -- path` chỉ cho exact reviewed **new** files không overwriting M và có dependency record. Tự restore một existing file không thay admission review.
- Dependency closure kéo startup/global DB/optional scheduler/provider khác ngoài requirement: stop, tách boundary hoặc đưa alternative/decision. Không đặt arbitrary file-count threshold thay review.

## 4. Candidate file/dependency ownership

Action C=create if absent on M; A=adapt targeted hunks; K=keep M. Phases tuần tự, nên shared files chỉ có một owner tại một thời điểm.

| Slice / B | Source provenance & destination candidates | Dependency closure / smaller alternative / exit |
|---|---|---|
| Exact money/windows/policy B02/B03/B05 | D C `src/lib/accounting/{exact-money,budget-policy,budget-windows,budget-gate,budget-projection,budget-errors}.js`; D C `src/lib/pricing/decimalMoney.js` | Test pure helpers; reuse M pricing input formats, không float-sum analytics; freeze original startedAt and HCM window |
| Ledger/durability/identity B01/B05/B07 | D C `src/lib/db/repos/api-key-accounting-repo.js`, `helpers/{api-key-bindings,accounting-policy}.js`, accounting migrations; A `schema.js`, migrations index/driver, adapters, `repos/apiKeysRepo.js`, backup/import callers | `attempt-payload`, coordinator, durableFile, writerOwnership, coverage/lifecycle dependencies không optional nếu used. So sánh minimal bounded DB-centric solution với existing sidecar trước admission; never strip sidecar trước alternative chứng minh equivalent/approved change |
| Pricing snapshot B05/B06 | D C selected `src/lib/pricing/{referenceResolver,catalogMapping}.js`; T/U native price authorities | Chốt actual imports (resolver kéo snapshot/revision/catalog repos); manual precedence/current stored synced values không mất. Không auto-import scheduler/UI. Không reprice old attempts |
| Server identity + activation B01/B03/B08 | A M `src/sse/services/keyAccess.js`, `src/dashboardGuard.js` integration nếu cần; T A `src/sse/handlers/chat.js`, `src/sse/services/chat-accounting.js`, `src/lib/accounting/{service,persisted-chat-authority}.js`; D C `src/lib/auth/managementGuard.js` | Master access context `null` cho unrestricted/unknown chỉ là ACL, **không authenticated accounting identity**. Server resolve exact active row kể cả unrestricted key. Fixture WeakMap không phải shipping activation. Smaller production adapter reuse selected lifecycle, không duplicate auth/router |
| Management B02/B08 | D C `src/app/api/keys/[id]/budget/route.js`, `src/shared/components/ApiKeyBudgetPanel.js`, A `src/lib/accounting/budget-management.js`, M endpoint page + key CRUD routes | Guard/session/trustedPeer/custom-server/CLI managementSession closures phải review. CAS+bounded body/no-store/readiness; không dùng inference key làm admin |
| Transport/raw owner B04/B05/B06/B08 | D/T A `open-sse/executors/{base,accounted-base,index}.js`, `handlers/chatCore.js`, `utils/accounting-transport.js`, Responses framer/parser/converters/stream consumers | Reconcile M hidden replay/header writes; one owner before translation; all actual exposures need ticket/ACK. No telemetry callback as debit; no tee/second raw peeker |
| Codex native + ordinary compatibility B04/B06 | T A `open-sse/executors/codex.js`, `config/accountingProfiles.js`; U C `utils/accounting-codex-{usage,wire}.js`, U C `src/lib/accounting/codex-price-authority.js`; U tests | Request-local invocation state pending patch separate from accounting activation. Exact effective request/profile and price proof, no regex model eligibility |
| Claude/Anthropic native B04/B06 | U C `open-sse/utils/accounting-claude-{request,usage,stream,wire}.js`, `src/lib/accounting/claude-price-authority.js`; M Default executor adapt only when needed | Both API key and OAuth need own evidence; allowlist/request validator cannot silently reject retained thinking/history. Accounted Responses primitives not sufficient for Messages usage |
| Refresh/retry B04/B05/B08 | T A `src/sse/services/tokenRefresh.js`, `chat-accounting.js`, `open-sse/handlers/chatCore.js`, Base/Codex/proxyFetch | Persist exact transition+own ACK; fresh selection/current policy; HTTP errors/SSE errors/native failure cutoff before successor; preserve ordinary retry freshness |
| No-bypass routes B03/B08 | T A `src/app/api/v1/responses/compact/route.js`; A all reachable `src/app/api/v1/**/route.js`, `src/app/api/v1beta/models/[...path]/route.js`, alternate aliases/rewrites and helper dispatch seams identified phase01 | Reject unsupported budget-key path before reconstructing Request, remote fetch/classifier/inference. Non-inference endpoints classified explicitly; no unconditional generic embargo on ordinary key |
| Tests/packaging B01–B08 | D/T/U selected accounting unit+dummy HTTP fixtures, M ordinary suites, new shipping-ingress E2E tests | Do not blindly port full tests/offline/scripts/captures; freeze exact per-phase manifest; sandbox runner code review before execution |

Các tên mới dự kiến (chưa tồn tại, không khẳng định existing API): `src/sse/services/budget-admission.js` (server-only common admission), `tests/unit/budget-production-admission.test.js`, `tests/unit/budget-shipping-vertical.test.js`, `tests/unit/budget-route-coverage.test.js`. Chỉ tạo nếu phase01 chứng minh không nên đặt seam ở module hiện có. Không client-controlled headers/body/env fixture activation.

<!-- Updated: Validation Session 1 - extend minimum admission for approved D01–D04 -->

**Session 1 admission delta:** minimum unresolved-recovery API/UI and same-ID rotation are newly approved missing shipping seams, not existing APIs to restore. Reuse `service.resolveAttempt`/`resolveAttemptSync` for unresolved with auth/audit/CAS; exact endpoint/actions/path list must be frozen in phase01. Keep B1/E2 unrecorded outside required manual recovery. Rotation needs explicit binding-generation/history design because donor `validateKeyBindings` rejects changed fingerprint; enumerate key CRUD/import/export/backup/restore consumers before adapting. D03 permits removing dedicated unlimited degraded-continuation branches only after dependency/invariant review; D05 sidecar replacement is still unapproved. Revalidate startup recovery under exclusive writer acquisition/final-close write-lane stop, never reclassify a live owner.

## 5. Read-before-port checklist

Read body của destination M, donor SHA body, direct imports và all callsites/dispatch counts; xác nhận migration order và optional dependency behavior. Đối chiếu test titles/assertions, không chỉ filenames. Mọi fresh SHA/change đều invalidate affected evidence; không sửa historical receipts/known-fails để làm xanh. Newly supported route/model chỉ vào manifest sau exact producer+integration checks.
