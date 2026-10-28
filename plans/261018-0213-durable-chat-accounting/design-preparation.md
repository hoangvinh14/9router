# P3 execution boundary

Source base: `4cb4f80ecc5f629cd7d08c2167a443892ad38f2f`. Reuse the outcome,
constraints, non-goals and acceptance in [the plan](./plan.md). The user invoked
`--auto` and selected explicit policy classification plus verified read-only
persisted authority as a prerequisite. That decision permits implementation;
it does not certify the implementation or activate accounting.

## Order and ownership

One serial source owner. First close the [named prerequisite](../261023-0739-p3-chat-dispatch-prerequisites/plan.md),
then JSON, then SSE using the same attempt lifecycle, then combined acceptance.
No parallel edits to shared Base, transport, DB or handler files. X5 retains
the rest of its transport/routing inventory; P4 retains budgets/calendars/UI.

The prerequisite has two boundaries: explicit policy/persisted authority, then
per-actual-POST transport admission. Neither depends on P3. Both prerequisite phases are accepted with October 27 actual-adapter/transport
evidence; their receipts retain historical failures and cause-aligned repairs.

| Owner | Exact responsibility |
|---|---|
| App request in `src/sse/handlers/chat.js` and a new `src/sse/services/chat-accounting.js` | Extract the actual client key using `extractClientApiKey`; verify stable identity/binding independently of nullable ACL context; own request-local context, current route/credential/pool proof and disposal. No client header/body can opt in. Use internal disposable-fixture injection only. |
| P2 `src/lib/accounting/service.js` | Original price snapshot, queue application authority, own durable intent/terminal receipts, single-use dispatch consumption and retained late terminal sink. Do not create another money formula. |
| `open-sse/executors/base.js` and new `open-sse/executors/accounted-base.js` | One attempt for each actual generation POST, including existing status/network/URL retries. Settle predecessor before retry hook/backoff/successor admission; preserve original timeout starting point. All state stays in invocation closures, not cached executors. |
| `open-sse/utils/proxyFetch.js` | After DNS/dispatcher/module awaits, synchronously validate selected wire and consume that POST's permission immediately before exposure. Redirects cannot silently replay. TLS/proxy/MITM retries require distinct attempt ownership, not reuse of consumed receipts. Preserve no-hook behavior. |
| New `open-sse/utils/accounting-openai-usage.js` | Normalize complete raw evidence for one explicitly selected profile; reject missing/conflicting/unsafe counts. Return evidence to P2; never estimate or price. |
| JSON raw reader before `nonStreamingHandler.js`/`error.js` | Own the body once, normalize raw successful/failed HTTP usage before analytics/translation, await terminal ACK, replay the body to existing consumers. Bounded bytes and cancellation. |
| New `open-sse/utils/accounting-openai-stream.js`, `stream.js`, `streamHandler.js`, `chatCore/streamingHandler.js` | Observe complete raw frames, pass content deltas, hold meaningful finish/DONE success until exact protocol evidence and own ACK. Preserve a single native error terminal and prevent flush/watchdog from synthesizing success after refusal. |
| `open-sse/handlers/chatCore.js`, app account loop and `open-sse/services/combo.js` | Recognize local accounting refusal before network retry/token refresh/cooldown/model fallback. Preserve real upstream empty-content fallback after predecessor settlement. |

Current seams require changes: Base wraps `proxyAwareFetch` in retry catch;
proxy fetch can resend after awaits; core turns executor exceptions into 502
and swallows refresh failures; combo catches exceptions and continues. Analytics
completion is unawaited and estimates/buffers counts. None is an own settlement
barrier. Standalone/default/no-key controls must exercise these owners too.

## Selected protocol evidence

Initial fixture profile: OpenAI Chat Completions **with explicit usage detail
counters**, carried by a persisted `openai-compatible-*` chat node/connection
and a real native localhost upstream. This is a strict profile, not a claim
that any compatible provider has these semantics. Canonical Default executor
behavior needs a separate affected control with unchanged registry URL/headers.

Raw JSON and complete SSE usage objects require safe nonnegative integer
`prompt_tokens`, `completion_tokens`, `total_tokens`,
`prompt_tokens_details.cached_tokens` and
`completion_tokens_details.reasoning_tokens`. Total equals prompt+completion;
cached is a subset of prompt; reasoning is included in completion. Missing
details are unknown for this strict profile, including otherwise plausible
no-hit responses. Explicit zero is evidence for zero. Duplicate identical
complete usage is idempotent; conflicting observations are unresolved, not summed.

The profile does not bill or expose prompt-cache creation/tier counters.
That is an explicit fixture/protocol contract to verify at adapter selection,
not a parser-wide assumption. Normalize `cacheWrite=0`, and explicit zero tier
counts when the original snapshot requires them, only under this selected
profile. A response declaring cache-write/tier evidence outside that contract
must be unresolved. A provider with billable writes requires a separately
specified adapter and raw fields; do not label its missing counts zero.

For input=1000/output=100/reasoning=0 and rates input=1/output=2/cached=0.25,
costs are: no hit `1200000`, read=400 `900000`, read=1000 `450000` nanoUSD.
Read=400 with explicit cached=0 costs `800000`; absent cached rate falls back
to input and costs `1200000`. These are expected ledger observations after
reopen, not parser-generated prices. Price drift after intent cannot replace
the original cached/input/output rates. Cache creation and reasoning use the
existing P2 fallback/inclusion contract. No response cache is introduced.

## Observable acceptance matrix

Every actual-flow row runs with Node SQLite and SQL.js disposable databases,
schema/data backups before mutations, and real localhost POST counters. Fault
injection controls ACK delivery, not a fake ledger or fake positive socket.

| Gate | JSON and SSE observations |
|---|---|
| Intent ACK | Held intent blocks POST; lost delivered ACK blocks POST even if row persisted; abort before application records no intent. |
| Current authority | Disable/delete key, replace credential, change node/override/pool/environment/routing while intent or dispatcher awaits: no invalid POST. Matching controls actually POST through direct and saved HTTP proxy. |
| Cache | Explicit no-hit, partial/full read, distinct/zero/missing rate, original-rate drift, missing details, invalid subsets and conflicting usage; compare raw bytes, normalized counters and reopened exact cost. Cache write/tiers zero/N/A is profile-limited as above. |
| Failure and successor | Failed HTTP exact usage charges original price before status/URL/account/model/refresh successor; unknown usage remains null, not free. Each resend has its own intent. No local refusal becomes cooldown or fallback. |
| Durability/isolation | Two keys interleave on one executor; copied/duplicate/conflicting receipts cannot debit or dispatch again; dispose does not erase late sink; crash/reopen pending recovery and late exact observation preserve identity and price. |
| SSE terminal | Fragmented UTF-8/multiline/CRLF/trailer, missing DONE/usage, conflicting duplicate, held/lost settlement, stall/abort/cancel: content may pass, successful finish/DONE may not pass before ACK. No synthesized success on failure. |
| Unlimited recording failure | Fresh persisted explicit-null policy plus current identity/schema/route and independent gap ACK precede continuation. Held/failed gap ACK gives zero successor POST; bad owner/schema/sidecar/maintenance/config never uses exception. Fresh degraded request and existing sink are separate controls. |
| Preserved behavior | Upstream 200 empty content still settles and falls back; no-key/default/strict proxy/auth/ACL/translator behaviors stay valid. Local bypass is zero upstream and not usage evidence. |

## Commands and finite bounds

New suites: `tests/unit/chat-accounting-json.test.js`,
`tests/unit/chat-accounting-stream.test.js`,
`tests/unit/chat-accounting-loopback.test.js`. Shared actual fixture additions
belong under `tests/fixtures/accounting/`; use current adapter factories,
ownership, backup and lifecycle utilities. Do not reuse historical harnesses.
Each new suite starts with a 120-second process bound and existing per-test
limits; define the hypothesis and expected observations before each diagnostic.

Affected files to invoke by name after touched callers are known:
`accounting-{coordinator,ledger,exact-money,coverage,identity,import,lifecycle,migration}.test.js`,
`base-executor-retry.test.js`, `antigravity-retry-hook.test.js`,
`strict-proxy-enforcement.test.js`, `qoder-proxy-replay.test.js`,
`key-access.test.js`, `key-access-handlers.test.js`,
`account-fallback-4xx.test.js`, `combo-routing.test.js`,
`combo-autoswitch.test.js`, `openai-responses-completed-usage.test.js`,
and `translator/golden-response-stream.test.js`. Run via
`npm --prefix tests test -- <exact named files>` in finite groups. The initial
baseline and unresolved red receipts are in [the execution receipt](../reports/implementation-261023-1430-durable-chat-accounting.md).
Lint changed modules and build when handler/public caller changes land.

Final measurement: JSON/SSE × off/on × Node/SQL.js × concurrency 1/4/16,
100 requests per cell, fixed payload and upstream behavior. A single bounded
run has 4800 requests and a 1200-second wall limit, explicitly approved by the
user on October 27 after the original 300-second run retained 1600 completed
requests. The request deadlines, workload, concurrency and guards are unchanged.
The 24 distinct cells run twice at 100 requests per cell, with no discarded
repetition. Report cold startup
separately, then p50/p95 total/TTFT/terminal delay, throughput and queue/commit
counts. No warmup, altered deadlines or claimed numeric pass threshold.
Stop on unmet functional invariants, leaks, guard changes needed to finish or
unexplained failures; preserve partial measurements as reached/unreached.

Rollback keeps schema, bindings, policies, gaps and ledger intact, and removes
only internal fixture injection/hooks. It never clears poison/gaps or reopens
a writer. Production activation remains OFF throughout.
