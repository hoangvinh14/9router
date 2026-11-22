# Phase 03 — Retained Claude/Codex scope, retry/refresh và ordinary parity

Status: pending. Priority: P1. Depends on: phase02 + exact applicable producer evidence. Target C1–C4 không được đóng bằng chỉ C0.

The internal C0 JSON path has passed packaged browser, durable debit and restart checks. For the next candidate, collect the exact model and authentication contract, retained request and output shapes, source-backed usage category rules, applicable tariff and terminal evidence on success and failure. The [support manifest](./references/phase01-support-manifest.json) records the outstanding evidence for C1-C3. The current registry admits only the internal C0 path. C4 has no eligible predecessor in this phase yet.

**First-party Messages SSE checkpoint.** The native usage accumulator now checks ordered start, delta and stop before the existing stream settlement method can write a terminal. D01 still applies to missing counters on a complete sequence. Offline checks passed 104/104 primitives and ledger, 3/3 executor and 8/8 composed C0. Raw SSE framing, retained tool/thinking fidelity, partial-error cutoff and shipping admission are open. [Research and remaining checks](../reports/research-261122-1350-anthropic-sse-finality.md).

**Raw SSE response handler.** The internal Anthropic accounting branch parses complete named frames through the existing disconnect-aware pipe. It waits for settlement before forwarding `message_stop`, forwards a native error frame and ends on that frame, and emits an SSE error for malformed or interrupted streams and failed acknowledgements. Incomplete streams do not produce a terminal debit in this slice. Primitive and pipe checks cover UTF-8 and CRLF fragmentation, multiline data, malformed frames, EOF, reset, native error, cancellation and acknowledgement ordering.

### Offline SSE success composition

A trusted fixture opts in to SSE when constructing the accounting context for the selected Anthropic profile. The app's Messages route still constructs the default JSON context. In composition, setting the request's `stream:true` and SSE Accept header on a JSON context returns 503 with zero transport preparations, intents and POSTs.

The fixture runs the real chat candidate, core streaming handler, disconnect pipe, native frame parser and SQLite ledger. It substitutes the public profile bootstrap, the endpoint destination, ordinary translation/transform dependencies and ordinary usage telemetry. The TLS variant uses the real direct transport redirected to a controlled loopback HTTPS server. The text-only stream passes through byte-for-byte. When the client sees `message_stop`, an independent read-only SQLite connection sees one terminal for the original key at **105,900 nanoUSD** from one POST. The next call at that limit returns 503 and adds zero POSTs and zero terminals.

Pinned Node v24.21.0 passed `run-core.mjs` **12/12**, `run-default-fidelity.mjs` **11/11** and `run-pure.mjs` **108/108** under `tests/fixtures/budget/`.

### Offline SSE tool and thinking response fidelity

The real response handler preserves fixture frames byte-for-byte, including thinking deltas, signatures, opaque redacted thinking, client tool IDs and split tool-input JSON. The successful response records exactly one provider-reported debit of **105,900 nanoUSD** from one invocation. An HTTP 200 stream with a native `overloaded_error` forwards that error, uses one POST and one intent, records zero terminals, and does not try a second combo member.

A trusted SSE context rejects tool definitions, adaptive thinking, and structured history with signed thinking and an `is_error: true` tool result before preparing transport or recording an intent. Positive request round-trip, Chat/Responses conversions, usage cutoff after a failed or interrupted stream, and runtime admission remain open. The response fixtures use synthetic signatures and payloads. They establish outbound fidelity, while the provider contract requires returning complete thinking and opaque redacted data unchanged with the tool continuation. [Anthropic thinking contract](https://platform.claude.com/docs/en/build-with-claude/thinking#preserving-thinking-blocks) · [Failure evidence](../reports/research-261122-1350-anthropic-sse-finality.md#follow-up-on-mid-stream-errors).

Pinned Node v24.21.0 passed `run-composed.mjs` **13/13** and `run-composed.mjs --tls` **13/13**.

## Files / ownership

Review/adapt candidates (root `/home/gmo/projects/9router`): `open-sse/config/accountingProfiles.js`, `executors/{base,codex,accounted-base,index}.js`, `utils/{proxyFetch,accounting-transport,accounting-responses-stream,accounting-responses-usage,accounting-codex-usage,accounting-codex-wire,accounting-claude-request,accounting-claude-usage,accounting-claude-stream,accounting-claude-wire}.js`, `handlers/chatCore.js` + streaming/nonStreaming/sseToJson consumers, `transformer/streamToJsonConverter.js`, `src/sse/services/{chat-accounting,tokenRefresh}.js`, `src/lib/accounting/{persisted-chat-authority,codex-price-authority,claude-price-authority}.js`, request translators nếu missing fidelity, `src/app/api/v1/responses/compact/route.js` early refusal. Tests chọn từ donor native+refresh suites, M ordinary suites; new per-layer replay tests khi missing.

Không whole-file overwrite M proxy/base/translator. Codex invocation-local state fix T được review/port độc lập và test ordinary compact/concurrency; không biến ordinary compact thành supported budget compact.

## Steps / gates

- [ ] Admit C1–C3 exact cells lần lượt. Anthropic API key và Claude OAuth là hai producer/auth contracts, không suy API docs thành subscription guarantee. Snapshot reference mapping `codex→openai`, `claude→anthropic` theo existing precedence; endpoint identity không tự đổi pricing namespace.
- [ ] Retain supported text/reasoning/client function definitions/calls/results, history/thinking/error-tool semantics. Encrypted continuation và required Chat/Responses/Messages conversions giữ obligation; validate original structured intent **trước** lossy transforms/stripping. Không count encrypted bytes, strip opaque continuation hoặc đổi is_error để làm validator pass. Missing source-backed fidelity → exact cell BLOCKED, không accepted narrower profile.
- [ ] Single raw owner observes Responses/Claude usage/events trước translation, forced SSE→JSON conversion không debit lần hai. Usage reported vs estimated vs unknown riêng; cache read/write/tier/reasoning subset/inclusion chuẩn theo accepted profile. D01: omitted/null/new unknown category đóng góp 0 có nhãn, không giả là provider-reported zero, giữ phần đã biết; tránh đếm trùng aggregate và TTL.
- [ ] Preserve original stable key/price/startedAt window across reactive/proactive refresh, account retry và client cancel/disposal. Refresh HTTP traffic là auth, không inference debit; persisted credentials transition phải đúng selected account và own ACK. False/throw/lost ACK/stale concurrent rotation → no successor, không adopt arbitrary resnapshot.
- [ ] Implement/reconcile retry state machine **every actual POST**: predecessor terminal classified+durable own ACK → fresh selection/current budget/ACL/price/window/credential/transport check → new intent own ACK → successor POST. No retry after downstream publication. Duplicate callback same attempt idempotent; two real attempts cùng requestId không bị dedup thành một.
- [ ] Base HTTP/network/URL retry, Codex SSE transient retry, core refresh, app account fallback và M proxy stale-socket replay có fixtures riêng với wire/attempt counters. Unknown delivery không free replay. Nếu low-level replay không own monetary lifecycle thì refuse/disable **chỉ accounted invocation** hoặc đưa replay dưới same owner có attempt mới; ordinary freshness vẫn giữ. Nếu adapter internal replay không thể intercept bằng fresh gate+durable own attempt ACK, bắt buộc disable replay cho accounted invocation hoặc block affected budget-key route trước POST; không chỉ liệt kê test rồi coi boundary khả thi. TLS insecure fallback/redirect không accepted cho selected budget path.
- [ ] Positive failed/incomplete/late usage và SSE retry cần P2 finality/cutoff evidence, không suy `[DONE]`/downstream EOF là đủ. Giữ error status ngay cả khi đã settle valid cost. Không retry trước own ACK, không open-ended tail draining và không second peeker.
- [ ] Alias direct accepted canonical target được xét; unsupported combo/nested/Fusion/smart/capacity/premiums/tools/media/compact phải refuse toàn graph trước first inference/helper/remote fetch; no silent member filtering. Tagged accounting refusal không provider cooldown/error fallback.

## Test matrix / pass conditions

| Test seam | Oracles |
|---|---|
| Each C1–C3 ingress/output | Actual dummy TLS native endpoint/auth/model/body + correct JSON/SSE output + exact original-key attempt/cost once |
| HTTP 401/403 proactive/reactive refresh | Separate auth-call counter, exact persisted transition; held/lost/false ACK **0 successor POST**; no fake inference row for refresh |
| HTTP/network/Base URL fallback | N actual exposed POSTs ↔ N attempt IDs, predecessor own ACK ordering; fresh gate can stop attempt N+1 at threshold |
| SSE transient/native failure | Producer-eligible failure cost once, no premature successor/unseen-tail guess; after publication no retry. Missing P2 = positive row blocked, not passed |
| M stale socket/fresh socket | Direct & saved strict CONNECT fixtures; actual undici/raw dispatch count, no two POSTs on one ticket; preserved ordinary retry behavior |
| Two keys/accounts/invocations | Distinct costs/tokens/sessions out-of-order; key A price/period/account never becomes B; ordinary compact overlaps standard without URL state bleed |
| Cancel/dispose + late usage | Dispatch permission dies; retained valid received late evidence charges original context once, never creates successor; explicit B1/E2 undercount branch separate |
| Original intent unsupported | 0 POST/0 debit through aliases/compact reconstruction/combo/classifier/paid tools/premiums even if transform would strip fields |

Reuse selected donor suites only after reading assertions and matching current input hash; M `passthrough-done-sentinel`, proxy keepalive, Claude header/cloaking/translator controls are independent compatibility evidence. Old named timing/native sensitivity reds remain open until characterized/fixed or exact owner disposition, not waived by fresh branch. Final completion of phase requires retained positive cells delivered or **explicit owner amendment**, not merely safe refusal.
