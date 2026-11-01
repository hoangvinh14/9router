---
phase: 3
title: "Actual-boundary, durability và budget acceptance"
priority: P2
dependencies: [1, 2]
effort: "Chưa estimate; không dùng historical runtime estimate"
---

# Phase 3 — Actual-boundary, durability và budget acceptance

## Goal

Chứng minh R1 selected native Responses hoàn chỉnh trên Linux Node SQLite + SQL.js, không chỉ parser/refusal. Native JSON, SSE→SSE và SSE→JSON đều phải đi real loopback transport đến isolated upstream, ghi đúng ledger và own ACK. Production OFF, parent X1 vẫn OPEN sau child acceptance.

## Files ownership

Paths relative `/home/gmo/projects/9router/`:

- Create `tests/unit/responses-accounting-loopback.test.js`: actual route/Default/Base/raw boundary và retry/proxy/ACL controls.
- Create `tests/unit/responses-budget-loopback.test.js`: threshold/increase/rollover/two keys/ACK race/API projection.
- Create `tests/unit/responses-accounting-restart.test.js`: actual-process interruption/reopen/late idempotency trên hai adapters.
- Modify `tests/fixtures/accounting/responses-loopback.js`; create `tests/fixtures/accounting/responses-process.mjs` nếu current process fixtures chưa parameterize protocol được an toàn.
- Modify `tests/fixtures/accounting/chat-module-loader.mjs` chỉ nếu new process runner cần alias interop; không chạy Vitest loader trick như bằng chứng production serving.
- Modify phase-owned runtime files ở phases trước **chỉ** để fix failure cause có receipt/test; không bắt đầu E1/R2/R3/R4 tại đây.
- Create implementation receipt trong `plans/reports/`; update child phase state và R1 row trong owner map sau acceptance. Không đóng X1 envelope hoặc R.

## Acceptance matrix — mỗi row phải có named case/receipt

| Group | Positive / controls | Mechanical pass |
|---|---|---|
| Native flows | Actual upstream JSON → native JSON; upstream SSE → client SSE; upstream SSE → client JSON | Dummy socket count>0, URL `/responses`, actual body/profile/credential correct; native JSON counters/details/total unchanged (no +2000/filter loss), converter preserves terminal status/output/error/usage details; one settled row per POST/cost matches independent fixture calculation |
| Money | cached/reasoning subsets, explicit zero, original rate; non-2xx/failed/incomplete valid usage | Exact nanoUSD string, no float/estimates, error protocol unchanged; duplicate same usage no extra debit |
| B1 | Abort/network absent, valid usage-before-cancel/EOF, malformed/conflicting, completed absent | Only interrupted+absent unrecorded/no blocker; valid observed usage charged once; independent safety not waived |
| ACK/order | Hold intent and terminal ACK; visible-row/read copied ACK; write failure; commit-success + delivery-loss; late duplicate/conflict | No POST before own intent ACK; no success terminal/successor before own terminal ACK; committed spend survives lost delivery/reopen; same-ticket retry idempotent, no inference replay; post-commit conflict cannot erase known spend; no error→absent downgrade |
| Retry/fallback | Base retry + next account (finite attempts), selected auth-refusal/retry seam, threshold reached by failed priced predecessor | #attempts=#actual inference POSTs; predecessor debit/ACK before next; reached threshold blocks successor; refresh credential mutation without persisted authority is refused |
| Authority | Key deactivate/delete/rotate, ACL/alias/model/node apiType/connection/proxy drift during await/queue | No future POST after drift; original attempt can settle exact evidence; two-key isolation; client usage/key ID cannot mint authority |
| Transport | Direct and saved strict HTTP proxy loopback; unavailable proxy, target/wire/header changes, abort/timeouts | Intended proxy positive CONNECT+POST; no silent direct fallback or credential cross-origin; current selected security controls unchanged |
| Durability | Process restart after committed spend, pending interrupted owner verified dead, observed usage written before crash, lost volatile evidence case | Known spend/snapshot/bindings persist, no double charge; no invented charge from crash ambiguity B1; independent detected write/coverage failure stays safe |
| Budget | Weekly/monthly independently `spent>=limit`, both together, null/0, increase, timezone rollover, simultaneous admissions before either settles | Denied request zero POST; increase no reset; Monday/month start HCM; 0 stays blocked; late usage charges original attempt window; both concurrent eligible POSTs may overshoot, exact sum persists and next POST blocks; no reservations/hard-cap claim |
| Default behavior | Same requests without fixture association, missing/invalid key/ACL, Chat and conversion consumers | No new ledger debit/production activation, native baseline envelope/status preserved; existing guarded behavior unchanged |
| Cache/bypass | Source inventory no response cache found in selected path; bypass/local hit controls if encountered | Zero inference POST → zero new attempt/debit, never recharge translated/cached usage; discovered cache engine requires named seam before support |

Account refresh không được mock thành authority được duyệt: dynamic apiKey selected R1 không tự support OAuth mutation. Negative mutation control bắt buộc, valid failed predecessor trước retry bắt buộc. OAuth-positive thuộc R2/R3; không report refresh toàn hệ pass từ negative R1 test. Node API scope/adapter scope phải ghi như vậy trong receipt.

## Accepted fixture evidence

Final gate `b047216d6`733/73342suites498.92s,0failed/pending/todo; NodeSQLite+SQLjs actual cases,1661source/input hashes unchanged, exact42suite collection and733assertions inspected. Original comparator0; scoped lint0,LSP15clean. [Case/adapter evidence map](./references/r1-acceptance-evidence.md) and [durable evidence bundle](../reports/evidence/261031-r1-native-responses/) hold raw results/manifests/invocation/identities/checksums. ParentX1/R and other owners OPEN. E1 is next bounded hydration handoff only, not auto-implementation or a completed child. Historical real DB access uncertainty and legacy presentation persistence exclusion remain as recorded in receipt.

## Tasks

- [x] Chuẩn bị current-source preflight: exact revision + dirty paths, Node/Vitest/adapter versions, temp data roots, finite dummy-only network allowlist, per-gate fail-fast deadlines và cleanup. Không đọc `~/.9router`/DB thật/real credentials.
- [x] Viết failing actual cases cho matrix, rồi fix cause trong owner files. Assert ledger identity/cost/attempt sequence và native output cùng test, không dùng requests count hoặc test count thay accounting coverage.
- [x] Run từng adapter actual-process restart, kiểm tra DB lock/single writer/sidecar protection; inject failure vào **own** callback delivery và publication, không forge durable ACK bằng query row.
- [x] Run budget projection/guarded API integration qua disposable fixture; reused UI/CLI consume same projection vẫn regression test. Không mở finite PUT production; no new UI design required cho protocol-only slice.
- [x] Preserve explicit B1 raw-evidence + retained-late-sink regression gates (`b1-usage-evidence.test.js`, `b1-late-chat-sink.test.js`); assert original-window budget projection after late settlement on both adapters, not merely stored startedAt. Native JSON paired associated/unassociated cases live in `responses-accounting-json.test.js`; converter direct/two-caller compatibility in `responses-stream-to-json-contract.test.js`, actual native consumer cases in `responses-accounting-consumers.test.js`.
- [x] Run affected consumer set + no-regression comparator với explicit result path. Check report totals/collection errors/new tests thật sự executed. Comparator source dùng `/app/` name split: nếu current environment lệch path cần report limitation và inspect raw failed tests; không normalize IDs để che regression hoặc chỉ dựa comparator xanh.
- [x] Review security, resource bounds và independent expected money. Record failures/changes/reached/unreached; no retries by raising timeouts or dropping assertions.
- [x] Review receipt/phase consistency, mark R1 only khi toàn AC pass; handoff E1 as next bounded child to hydrate per map, **không** auto-implement hoặc tạo quyền follow-up từ child R1.

## Verification commands — execution checkpoint

**Safety amendment:** all application runtime tests must run from repository root through `node tests/fixtures/accounting/run-isolated.mjs <unit paths>`. Do not run ordinary Vitest against accounting fixtures. Private runner supplies disposable pre-import roots, filesystem/network namespaces and JSON report; it preserves only isolated artifacts. See [receipt](../reports/implementation-261031-r1-native-responses.md) for historical unisolated uncertainty and actual result paths.

```bash
node tests/fixtures/accounting/run-isolated.mjs unit/accounting-fixture-isolation.test.js unit/responses-accounting-usage.test.js unit/responses-accounting-json.test.js unit/responses-accounting-json-boundary.test.js unit/responses-accounting-pricing.test.js unit/responses-accounting-late-sink.test.js unit/responses-accounting-stream.test.js unit/responses-accounting-consumers.test.js unit/responses-stream-to-json-contract.test.js unit/responses-converter-callers.test.js unit/responses-accounting-loopback.test.js unit/responses-budget-loopback.test.js unit/responses-accounting-restart.test.js unit/responses-accounting-final-controls.test.js
```

Affected minimum, sau đó expand theo actual imports/diff, không raw all-suite “all green” claim:

```bash
node tests/fixtures/accounting/run-isolated.mjs unit/chat-accounting-json.test.js unit/chat-accounting-loopback.test.js unit/chat-accounting-stream.test.js unit/chat-accounting-stream-loopback.test.js unit/chat-accounting-final-controls.test.js unit/chat-budget-loopback.test.js unit/chat-budget-process-restart.test.js unit/chat-budget-pricing-fallback.test.js unit/accounting-persisted-authority.test.js unit/accounting-request-authority.test.js unit/accounting-budget-gate.test.js unit/accounting-budget-projection.test.js unit/accounting-crash.test.js unit/accounting-transport-boundary.test.js unit/default-executor-accounting-compatibility.test.js unit/b1-ledger-disposition.test.js unit/b1-usage-evidence.test.js unit/b1-late-chat-sink.test.js unit/budget-activation-boundary.test.js unit/key-budget-management-security.test.js unit/openai-responses-nonstream.test.js unit/openai-responses-terminal-event.test.js unit/openai-responses-completed-usage.test.js unit/openai-responses-usage-pivot.test.js unit/openai-responses-completion-watchdog.test.js unit/responses-abort-terminal.test.js unit/github-responses-routing.test.js unit/embeddingsCore.test.js
# Read the exact isolated JSON report path from the runner's terminal output.
# Then run the static comparator from repo root; never invent/normalize IDs.
node tests/__baseline__/verify-no-regression.mjs /tmp/<actual-isolated-root>/sandbox/artifacts/results.json
```

Timeout hoặc collection error không là known-fail exemption. Expected-red ngoài affected scope theo root CLAUDE.md; không include `embeddings.cloud.test.js` làm missing cloud acceptance. Nếu affected baseline đỏ từ trước, giữ raw receipt và adjudicate đúng test identity, không nói affected passed.

Build/serving: nếu thay route/runtime bundling, dùng fresh disposable `DATA_DIR`, unique build output và bounded port từ current serving fixture preflight; record exact commands trước launch. Không chạy build/server với production data hay dùng `.next-*` artifacts cũ làm current-source evidence. Broader shipping/UI/browser/all-adapter release acceptance vẫn ở R, không prerequisite giả cho pure parser test và không được claim complete tại đây.

## DONE / stop

- [x] Tất cả R1 matrix rows có intended positive + meaningful negative trên Node SQLite/SQL.js; no skipped/unreached mandatory gate. Output Native JSON/SSE/forced JSON đúng, money exact, own ACK proven.
- [x] Affected suite + collection/report integrity inspected; zero unadjudicated regression, security notes và bounded-resource cleanup evidence.
- [x] Receipt nêu production OFF, Linux/selected token-only limitations, crash undercount/in-flight overshoot accepted; R2–R4/E1–E4/C1 broader closure còn OPEN.
- [x] Phase/index/map statuses truthful; không new recovery product, no real DB/activation/commit/push/deploy.

<!-- Updated: Validation Session 1 - exact native fields, direct converter/two-caller controls and B1 evidence/late-sink regression gates approved -->

STOP khi raw authority/unit không đủ, protocol contradiction, pricing identity gate fail, adapter unavailable, transport safety fail hoặc own ACK không được delivered. Record exact failed case và decision; không chọn fallback miễn phí/estimate để vượt gate.
