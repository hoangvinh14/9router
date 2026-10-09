# Planning validation và evidence

## Execution status

- Planning-only, 2026-10-03. Source HEAD `a99cf57239ff778b61e434c2786009d5ed1c412c`, branch `master`; working tree có `?? plans/` trước khi bắt đầu, không sửa/xóa report có sẵn.
- HOLD SCOPE: giữ toàn bộ chat+embeddings/weekly+monthly/reference pricing. Scope chạm >8 files do schema, adapter durability và nested dispatch; chia 6 phase tuần tự vì các gate tiền/auth không an toàn để overlap writers. Không thêm billing/reservation hoặc broad model/capability catalog sync; phase 02 đồng bộ **pricing-only catalog**.
- Auto route: hard-depth planning dựa brainstorm + source scout + targeted source fetch; không gọi researcher/planner/reviewer subagents, không thực hiện independent 4-persona review. Chủ động tự rà soát 4 lens và dùng Advisor; không coi self-review là review độc lập.
- Runtime tests/build/lint **chưa chạy** vì không triển khai source. Các lệnh phase là acceptance tasks tương lai. Gate thực hiện tại planning chỉ format/path/link/consistency.

## Source evidence inventory

| Claim | Evidence | Result |
|---|---|---|
| Stable key ID tồn tại, validate chỉ boolean | `src/lib/db/repos/apiKeysRepo.js:4`, `:69` | Verified. |
| Ledger chưa tồn tại, schema v1 | `src/lib/db/schema.js:6`, `:114` | Verified. Table names mới marked proposed. |
| Pricing override/default baseline có sẵn | `src/lib/db/repos/pricingRepo.js:50` | Verified; synced namespace chưa có. |
| Analytics save fail-open và raw key grouping | `src/lib/db/repos/usageRepo.js:242`, `:312`, `:640` | Verified; không dùng làm gate. |
| SQL.js deferred persistence/failure swallow | `src/lib/db/adapters/sqljsAdapter.js:22`, `:36`, `:109` | Verified; durable flush/health latch bắt buộc. |
| Migration versioned -> sync -> legacy import | `src/lib/db/migrate.js:246`, `:249`, `:255` | Verified order; backfill phải chạy sau import. Line positions có thể thay khi implement. |
| Chat core initial và refresh retry | `open-sse/handlers/chatCore.js:376`, `:445` | Verified; hook chỉ top-level sẽ thiếu retry identity. |
| Base và Codex retry nội bộ | `open-sse/executors/base.js:100`, `:109`; `open-sse/executors/codex.js:277`, `:295` | Verified; toàn specialized-executor inventory vẫn là implementation preflight. |
| Embeddings hiện chỉ lưu success exact usage | `src/sse/handlers/embeddings.js:130`, `:133`; `open-sse/handlers/embeddingsCore.js:97` | Verified; missing/failure accounting phải bổ sung. |
| Stream estimator có thể overwrite observed usage | `open-sse/utils/stream.js:233`, `:394` | Verified; raw exact usage phải tách khỏi client estimate/buffer. |
| Key manager ở route group dashboard | `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js:251` | Verified; không dùng nhầm `src/app/dashboard/endpoint`. |
| New nested management prefix cần auth tests | `src/dashboardGuard.js:54`, `:64`, `:229` | Verified guard intent, không proof new endpoints secure. |
| Baseline comparator hardcode `/app/` | `tests/__baseline__/verify-no-regression.mjs:17` | Verified; normalize/test path trước trusting gate. |
| models.dev reachable nhưng HTTP client-sensitive | GET `https://models.dev/api.json` browser-grade thành công; Python urllib HTTP 403 | Partial: schema sample observed; full mapping/units/coverage chưa chứng minh, explicit phase 02 gate. |

## Critical validation answers

User answered 3 questions trong phiên lập plan:
1. Spend mới từ lúc ledger hoạt động; lịch sử analytics cũ không debit. Các identified unlimited keys cũng được ledger tracking kể từ coverage start.
2. Missing exact usage => unresolved, không estimated charge; block budgeted key cho tới recovery có audit.
3. Missing pricing/storage => fail-closed budgeted traffic; retain valid stored prices khi sync fails.

Không còn câu hỏi sản phẩm bắt buộc cho roadmap. Timezone mutation không expose v1, price source chosen models.dev first với coverage verification phase. Các parameter kỹ thuật proposed rõ trong design; không giả rằng catalog/dispatch toàn bộ đã verified.

## Adversarial self-review (không độc lập)

| Lens / Severity | Evidence | Risk | Resolution đưa vào plan |
|---|---|---|---|
| Failure / High | `sqljsAdapter.js:36` | RAM commit được analytics coi success, mất tiền khi kill/disk error. | Durable flush ack, fsync/rename/health latch, ownership và kill tests phase 01. |
| Assumption / High | `chatCore.js:445`, `base.js:109`, `codex.js:295` | Một handleChatCore không bằng một billable attempt. | Required dispatch inventory và per-network optional hooks phase 04. |
| Security / High | `usageRepo.js:640`, `dashboardGuard.js:229` | Secret có thể nằm trong object bucket keys; nested guard chưa test. | Stable-ID stats boundary, seeded-key leak tests, admin/CSRF/CLI-client auth cases phase 03/05. |
| Failure / High | `stream.js:394`, `embeddings.js:133` | Missing usage biến thành estimated/free hoặc không row. | Exact/raw sink + cross-window unresolved block và audited recovery. |
| Assumption / Medium | `verify-no-regression.mjs:17` | Comparator path assumption tạo baseline mismatch hoặc evidence sai. | Synthetic regression/path tests và pre-change comparator audit phase 06. |
| Scope / Medium | `pricingRepo.js:50`, `open-sse/providers/pricing.js:401` | Broad catalog/pattern pricing/capability import thêm scope, đoán free/wrong price. | Pricing-only, explicit mapping, pattern guess không authoritative cho enforced key. |

## Advisor plan review

Advisor `9router/cx/gpt-6-astra` responded during planning. Review accepted: no-hard-cap disclosure; durable intent before fetch; ambiguous vs known non-dispatch lifecycle; single-writer durability contract; unresolved survives window rollover; exact BigInt math/token inclusion; admin audit and full dispatch inventory. Đây là advisory review từ draft/context, không source validation/test attestation.

## Advisor completion review

Advisor phản hồi lần hai: revalidate sau final edits; clarify pricing-only vs broad model catalog sync; native durability phải có settings/crash evidence, SQL.js parent fsync; uncertain intent recovery không refund; dispatch coverage là release blocker. Đã phản ánh contract; effort 88h ghi provisional. Thêm consistency fix: ledgerStartedAt stamp lúc full recording activation, không schema installation.

## Whole-plan consistency checklist

- Six sequential phases, no dependency cycles; future source overlap intentional sequential handoffs, not parallel file ownership.
- Consistent missing usage policy = unresolved, không estimated debit; waiver audited, không silently free.
- Consistent `ledgerStartedAt`, no legacy debit, budget toggles no reset, fixed explicit timezone, startedAt window attribution.
- Canonical money nanoUSD, price snapshot immutable; all errors distinguish terminal from candidate-local, no provider cooldown.
- No billable paths silently exempt; future inventory explicitly required, popular scope paths must covered before phase 04 done.
- All new source files/table/API names labeled create/proposed; only existing Modify targets should be mechanically checked now.
- Planned verification commands not reported as executed. Adapter/topology coverage not inferred from fallback runtime alone.
- No HTML/wiki/GitHub requested; none generated or published. No implementation/commit/push authorized in this task.

## Executed planning gates

- Final source-path/link sweep: 15 local links, 40 unique existing Modify paths, 6 phase dependencies, effort sum 88h; 0 missing paths/links/dependency issues. Proposed Create files và wildcard specialized-executor ownership không claimed existing.
- `ak plan validate plans/261003-0827-api-key-quota-budget-pricing --json`: valid=true, errors=null.
- `ak plan reindex --apply --json`: recognized store `9router/261003-0827`, 6 phases. CLI không cập nhật Phases table bằng add-phase/reindex; table đã reconcile theo phase files sau inspection live behavior.
- Session todo mirror: phase-level implementation tasks pending, linked to durable phase files; source checkboxes remain unchecked. Không mark phase implemented vì plan authoring complete.
- Local journal created: `plans/journals/2026-10-03-plan-api-key-quota-budget-pricing.md`. AgentWiki publish skipped (không được yêu cầu).
- Source implementation tests/build/lint: not-run; no source edits. Full dispatch inventory/catalog unit coverage/adapter evidence là acceptance gate tương lai, không planning proof.
