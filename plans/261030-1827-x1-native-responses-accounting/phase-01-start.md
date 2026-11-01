---
phase: 1
title: "Authority, strict usage và raw JSON"
priority: P2
dependencies: []
effort: "Chưa estimate; conditional pricing gate"
---

# Phase 1 — Authority, strict usage và raw JSON

## Goal và prerequisites

R1 dynamic compatible `apiType=responses` có protocol-bound attempt cho raw JSON success/failure mà không nới Chat guard. Đọc [protocol contract](./references/responses-contract.md), [owner map](./references/x1-owner-map.md), B1 và `open-sse/AGENTS.md` trước code. Source baseline `18a27a1b` phải được recheck; giữ unrelated workspace changes. Không activation ngoài disposable fixture.

## Phase 1 scoped completion checkpoint

Selected Linux JSON milestone complete: isolated gate239/239 across14suites (`b7bea1103`) plus supplemental16/16 (`b16502762`), lint exit0 and LSP9/9clean. Raw actual JSON/native fidelity/pricing/own-ACK/drift controls pass on Node SQLite/SQL.js. Queue/copied-receipt protection is inherited service/transport coverage; broader actual retry/fallback/restart/budget matrix remains Phase3, not claimed here. Full R1 remains unaccepted. Earlier safety-stop history follows. Historical focused gate 224/224 and scoped lint exit0 did not clear a discovered fixture-isolation escape. User authorized continuation; **fixture isolation and asynchronous teardown safety** now passes current-source4/4 (`b1113bf65`) and Advisor review for future Linux runs via the isolated runner only. Legacy presentation persistence excluded; real ledger/price/transport active. Phase 1 resumes there. Historical real-database access/mutation cannot be excluded; no real-data inspection/remediation performed. [Receipt, existing results and remaining gates](../reports/implementation-261031-r1-native-responses.md).

## Files ownership

Paths relative `/home/gmo/projects/9router/`; Modify chỉ khi cần, Create là proposed file chưa tồn tại:

| Action | Path | Trách nhiệm |
|---|---|---|
| Modify | `src/lib/accounting/persisted-chat-authority.js` | Narrow protocol-aware candidate selection; Chat default unchanged, persisted wire credentials/model/proxy guards |
| Modify | `src/sse/services/chat-accounting.js` | Select protocol profile/wire expectations, fixture-only activation, same own-ACK/late sink |
| Modify | `src/sse/handlers/chat.js` | Bind resolved candidate/ingress context nếu cần; keep pricing identity distinct |
| Modify | `open-sse/executors/base.js` | Chat-only include_usage mutation; selected Responses dispatch strategy |
| Modify | `open-sse/executors/accounted-base.js` | Select raw JSON extraction/observation theo protocol, preserve response bytes/status before retry |
| Modify | `open-sse/handlers/chatCore/nonStreamingHandler.js` | Preserve exact native JSON usage on accounting-associated Responses path; no +2000 buffer/field loss |
| Inspect; Modify only if needed | `open-sse/utils/usageTracking.js` | Shared buffer/filter consumer impact; prefer narrow bypass in native handler, no global behavior change |
| Create | `open-sse/utils/accounting-responses-usage.js` | Strict raw native profile; không estimates/defaults |
| Create | `open-sse/config/accountingProfiles.js` | Profile/terminal/admission constants nếu chưa có equivalent; không duplicate enums |
| Create | `tests/unit/responses-accounting-usage.test.js` | Exact profile/negative dimensions/duplicate/conflict |
| Create | `tests/unit/responses-accounting-json.test.js` | JSON ticket/ACK/order, native errors và pricing compatibility |
| Create | `tests/fixtures/accounting/responses-loopback.js` | Extend/reuse bounded fixture plumbing, native route + persisted responses node |

Không đổi ledger schema/service/migrations mặc định. Nếu protocol-aware authority cần extraction, chỉ factor nhỏ common implementation, không copy toàn persisted projection hoặc đổi selection algorithm. Keep public fixture helpers backwards-compatible. Schema/endpoint redesign cần prerequisite đã review, không lén đi cùng.

## Tasks (test-first)

- [x] **Re-characterize và freeze scope:** trace real `/v1/responses` ingress, Default/Base actual POST, retry counts, final body, response path. Record supported text/function-tool set và forbidden billing declarations theo contract. Scan all ledger endpoint consumers. Không port historical `accountedResponses` không có trong source.
- [x] **Pricing gate:** add failing tests resolver→snapshot→cost→ledger→reopen→projection cho `endpoint=chat` và native Responses counters. Verify endpoint label không tuyên bố upstream Chat. Nếu không compatible, STOP ghi named prerequisite; không thêm enum/migration bừa.
- [x] **Raw usage tests:** safe integer totals/subsets, zero usage explicit, duplicate identical và conflicting; missing cached/reasoning fields, malformed/estimated/overflow, cache-write/tool/media billing declarations không bị swallow. Native root usage only; translated client usage không thẩm quyền.
- [x] **Admission tests:** final wire text-only/function tools eligible; hosted tools/media/files/background/unknown options reject trước POST. Test client-supplied usage/keyId/profile/flags không activate/mint permission. Disallowed route/wire override, apiType drift, key/ACL/revoke/connection/pool drift chặn actual dispatch.
- [x] **Implement strategy seam:** parameterize protocol selection private/closed set; keep Chat profile and expected URL unchanged. Responses expected `/responses` and body.model đúng resolved candidate; don't inject Chat `stream_options`. Preserve credential raw-header behavior without weakening persisted checks.
- [x] **Implement raw JSON boundary:** parse bounded UTF-8 body before normalization/error parse, settle root usage success/non-2xx; replay exact bytes/status/headers cho consumer. JSON read/parse/malformed classification không recatch DB terminal failure thành absent.
- [x] **Native JSON consumer fidelity:** test-first through actual handler: accounting-associated native Responses output preserves `input_tokens`, `output_tokens`, `total_tokens`, both detail objects and explicit zero exactly. Bypass legacy +2000 buffer/filter only for the privately bound selected native accounting composition; no client flag/header or new activation switch. Ledger still uses raw upstream evidence, never consumer output. Pair with unassociated native request baseline tests; shared Chat/conversion/default behavior unchanged. If native JSON returned despite upstream stream:true enters streaming consumer, trace and fix that selected composition too, not just the isolated nonstream helper.
- [x] **Order/ACK controls:** terminal hold prevents returned JSON/successor; copied/stale ACK/read-visible row không đủ. Queue/post-await drift/revoked key/missing rates means zero POST. No accounting association means old production behavior unchanged.
- [x] **Actual JSON positive ngay phase này:** responses fixture sends native JSON from real dummy socket dù translated request có stream:true; assert URL `/v1/responses`, final native body/auth test secret, one attempt, exact nanoUSD, original key/price/time, consumer JSON giữ native fields. Refusal-only/unit mock không pass phase.

## Verification — future implementation commands, chưa chạy trong planning

Run from repo root; commands bounded bằng process timeout và suite count, không live credentials:

```bash
cd tests
NODE_OPTIONS=--max-old-space-size=4096 timeout 180s npx vitest run unit/responses-accounting-usage.test.js unit/responses-accounting-json.test.js unit/accounting-exact-money.test.js unit/accounting-ledger.test.js unit/accounting-persisted-authority.test.js unit/default-executor-accounting-compatibility.test.js unit/chat-accounting-json.test.js unit/accounting-transport-boundary.test.js
```

New suites must enumerate Node SQLite + SQL.js where DB involved; do not silently skip unavailable adapter. Run DB-independent profile cases once. Resolve test isolation/module-loader from existing chat fixtures; no stubbing actual upstream dispatch in positive acceptance. Every held gate has fail-fast timeout and cleanup of sockets/readers/DB/tmp directory/global adapter, kể cả failed assertion.

## Exit / security / risk

- [x] Raw JSON positive + negative/order tests pass, existing selected Chat regressions unchanged; attach exact revision/commands/adapters/cost assertions.
- [x] Pricing identity compatible hoặc named prerequisite resolved bằng evidence, không unresolved schema choice.
- [x] Native JSON counters/details/zero match upstream exactly in associated path; unassociated baseline remains unchanged, proven through actual consumer rather than helper-only tests.
- [x] Không production activation, raw client keys/token/prompt/body logs mới, cross-key authority hoặc weakened proxy/SSRF. Test secrets chỉ trong fixture; redact request captures khi đưa vào receipt.
- [x] Chưa claim R1 SSE/forced JSON/full X1 DONE. Handoff Phase 2 với profile/eligibility strategy và known failed receipts.

<!-- Updated: Validation Session 1 - exact native JSON usage, explicit consumer ownership and paired baseline controls approved -->

Failure protocol: dừng phase khi exact authority/price/own ACK không chứng minh được; record reached/unreached. Không tăng timeout, nới profile bằng default zero, bỏ guard hoặc chuyển malformed sang B1 absent chỉ để xanh.
