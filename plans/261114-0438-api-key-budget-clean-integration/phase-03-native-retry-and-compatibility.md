# Phase 03 — Retained Claude/Codex scope, retry/refresh và ordinary parity

Status: pending. Priority: P1. Depends on: phase02 + exact applicable producer evidence. Target C1–C4 không được đóng bằng chỉ C0.

## Files / ownership

Review/adapt candidates (root `/home/gmo/projects/9router`): `open-sse/config/accountingProfiles.js`, `executors/{base,codex,accounted-base,index}.js`, `utils/{proxyFetch,accounting-transport,accounting-responses-stream,accounting-responses-usage,accounting-codex-usage,accounting-codex-wire,accounting-claude-request,accounting-claude-usage,accounting-claude-stream,accounting-claude-wire}.js`, `handlers/chatCore.js` + streaming/nonStreaming/sseToJson consumers, `transformer/streamToJsonConverter.js`, `src/sse/services/{chat-accounting,tokenRefresh}.js`, `src/lib/accounting/{persisted-chat-authority,codex-price-authority,claude-price-authority}.js`, request translators nếu missing fidelity, `src/app/api/v1/responses/compact/route.js` early refusal. Tests chọn từ donor native+refresh suites, M ordinary suites; new per-layer replay tests khi missing.

Không whole-file overwrite M proxy/base/translator. Codex invocation-local state fix T được review/port độc lập và test ordinary compact/concurrency; không biến ordinary compact thành supported budget compact.

## Steps / gates

- [ ] Admit C1–C3 exact cells lần lượt. Anthropic API key và Claude OAuth là hai producer/auth contracts, không suy API docs thành subscription guarantee. Snapshot reference mapping `codex→openai`, `claude→anthropic` theo existing precedence; endpoint identity không tự đổi pricing namespace.
- [ ] Retain supported text/reasoning/client function definitions/calls/results, history/thinking/error-tool semantics. Encrypted continuation và required Chat/Responses/Messages conversions giữ obligation; validate original structured intent **trước** lossy transforms/stripping. Không count encrypted bytes, strip opaque continuation hoặc đổi is_error để làm validator pass. Missing source-backed fidelity → exact cell BLOCKED, không accepted narrower profile.
- [ ] Single raw owner observes Responses/Claude usage/events trước translation, forced SSE→JSON conversion không debit lần hai. Usage reported vs estimated riêng; cache read/write/tier/reasoning subset/inclusion chuẩn theo accepted exact profile. Omitted/null/new category không zero tự động.
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
