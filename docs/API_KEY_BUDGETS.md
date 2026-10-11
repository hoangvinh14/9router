# API key budgets and reference accounting

> **Implementation in progress; not enabled.** This document currently describes
> inactive storage/accounting/pricing services and management preparation, not
> a released budget feature. Routing hooks, certified usage, recovery/management
> interactions, runtime parity and release gates must pass before enabling
> accounting. No startup or HTTP endpoint initializes `ledgerStartedAt` or
> activates enforcement. A stored timestamp alone does not certify protection.

## Approved behavior

Budgets apply to identified gateway API key IDs for **chat and embeddings**,
including billable fallback/retry/fusion attempts. Monetary values are reference
or virtual USD costs, **not provider invoices**; OAuth/subscription traffic is
not automatically free. No-key/CLI compatibility and image/audio/video/search/
fetch are outside enforcement. Require API keys if all chat/embedding traffic
must be attributed.

Weekly and monthly limits operate together, with Monday 00:00 and day 1 00:00
boundaries in `Asia/Ho_Chi_Minh`. Either exhausted window denies a new attempt.
This is a recorded-spend gate, **not a hard cap**: concurrent/in-flight work can
overshoot. Pending intents are not reservations. Attempts belong to their start
window; settlement after reset does not move old spend to a new window.

`null` means unlimited; zero means deny. Budget/pricing changes never clear
settled spend. Unresolved usage has unknown cost, not zero, and blocks budgeted
admissions across resets until audited recovery. Estimates are never exact
monetary debits. Pre-activation usage history is not charged retroactively.

## Certified live-stream candidate and local deadlines

The currently instrumented raw OpenAI-format chat slice is still gated by explicit
provider/schema approval; it is not certification of all compatible providers or
native formats. Successful finish/usage/DONE frames remain withheld until valid
raw usage, genuine DONE, clean EOF, durable completion ACK and trusted request-local
terminal authorization. Estimated or diagnostic usage never grants this authority.

The existing 30-second idle watchdog now spans local delivery, including downstream
backpressure and the EOF completion/authorization wait. It is not reset at EOF or
ACK. The separate 5-second absolute post-DONE transport deadline ends at clean EOF;
comments do not extend it. These are local delivery deadlines, not persistence
transaction timeouts or guarantees that foreign work has stopped.

Failure, caller abort, downstream cancellation or idle expiry may terminate local
stream delivery while the original terminal operation is still running. The first
terminal payload/promise stays authoritative and is submitted only once; late
rejection is observed without private diagnostics or retry. A local error/cancel
acknowledgement is **not** a durable ledger ACK, readiness certificate or permission
for a successor attempt. If an exact success was already claimed, a delivery timeout
does not rewrite its usage or make the upstream attempt free. Already-forwarded
deltas cannot be recalled; no further successful terminal bytes are released.

This bounds the local wait only. Persistence, authorization or upstream cleanup may
outlive it; crash recovery and current admission/coverage checks remain independent.
Buffered panel collection still requires its own durable settlement before judge
admission. No production rollout is authorized by these focused checks.

## Storage foundation

One writer process per canonical `DATA_DIR` is supported. The writer lock is
acquired before writable adapter loading, migrations, settings or analytics.
A second process cannot bypass this by using an unlimited/no-key request. Do not
run clustered SQL.js writers or share the directory across machines/containers.

Native adapters verify WAL with `synchronous=FULL`. SQL.js durable transactions
export to a same-filesystem temporary file, fsync it, atomically rename it and
fsync its directory before acknowledging. Uncertain writes poison the open
handle; do not treat its mutated RAM as persisted truth. A failed coverage
sidecar write likewise blocks that store until restart/operator review.

Amounts are integer nanoUSD (10^-9 USD), transported as decimal strings. Ledger
spend is separate from usage/log retention. API key deletion retains opaque HMAC
bindings and does not delete policies, attempts or audit history. A deleted
secret cannot be reimported under another ID; an old ID cannot be rebound to a
new secret. Retired identities are not automatically reactivated by restore.

### Internal grouped-write candidate (not production activation)

The current delivery candidate retains the default synchronous inference path.
A request-local `queued: true` test option exercises bounded FIFO group commits:
accepted members receive results only after their own outer durable transaction
ACK; installed rows or a later reopen never reconstruct a lost ACK. Member-local
refusals do not grant unlimited gap exceptions. Genuine recording failures still
require the separate durable coverage-gap acknowledgement.

Healthy queued admission re-reads caller binding, settings, original connection,
selected pool, policy, pricing and coverage in the same synchronous mutation
boundary. For the narrow Base OpenAI/DeepSeek fixture path, prepared credentials,
Authorization and provider overrides must also match persisted authority before
enqueue and at dequeue. This is not complete URL/proxy/OAuth or provider-family
certification. Selected HTTP(S) pool candidates additionally compare the original
resolved proxyOptions with the saved active pool before enqueue and at dequeue;
Base uses the same detached options for POST. Fixture HTTP CONNECT loopback tests
cover two-key intent/settlement ordering and changed-pool zero-tunnel/zero-POST
refusal. Fresh selected-pool equality alone never authorizes an older route.
Saved global/legacy HTTP(S) policy is also compared with the original prepared
route before enqueue and at dequeue. The queued Base candidate requests the
single-POST transport contract with redirects refused: owned HTTP loopback tests
cover saved global/legacy CONNECT, no direct replay after proxy failure, and a
307 response producing no second POST. Original bounded proxy-environment values
are equality evidence, not routing permission; they are checked before enqueue,
at dequeue and immediately before native dispatch, including after dispatcher
acquisition yields. Tests cover changes during queue wait and after intent ACK;
the dispatcher-yield control uses a mock and is not socket proof. Changes after
intent ACK leave a durably unresolved attempt rather than discarding that intent.
Scoped affected Base/ACK, Node/SQL.js storage and proxy-consumer regressions pass
on the proxy/environment, runtime-equality and Base-config revisions, in separate
complete scoped receipts. The queued prepared wire includes explicit original
runtime transport (or null), counted in retained bounds. A supplied descriptor
must exactly match a registry OpenAI transport and its URL; injected descriptors
are refused rather than rebuilt. Canonical DefaultExecutor positive coverage uses
mock POST only, not a live provider. Null runtime evidence does not certify an
arbitrary custom executor URL/config or provider-node. The newer Base-config
candidate retains the original transport projection and URL index; registry
projection and exact constructed URL must match at enqueue/dequeue. Test fixtures
replace only the registry module for their owned endpoint, never add production
URL exceptions; native fetch and exact CONNECT target guards remain real. This
projection is not complete executor/transform/header or provider-node authority;
original detached registry evidence is now revalidated at single-POST entry and
after dispatcher acquisition, immediately before native POST. Native tests cover
registry changes after intent ACK: no tunnel/POST and one unresolved terminal.
Dispatcher-yield registry changes and caller-input detachment use mocks, not
socket proof. Frozen transport values share the counted prepared wire instead of
retaining another deep copy across queue wait. Those scoped candidate/affected
receipts predate a newer complete-header/immutable-wire revision. The newer slice
requires exact complete protocol/registry/runtime/token/override headers and the
original stream flag. The entire prepared wire is detached and frozen before
exposure; POST uses its same immutable headers/proxyOptions. Mock and native HTTP
CONNECT tests verify attempted header mutation during queue wait cannot replace
the original Authorization; exact intent and settlement ACK controls pass.
Current immutable-wire boundary111/111 and affected239/239 receipts pass in
separate finite partitions; one saved-mock suite overlaps, not350 unique tests.
Affected scope is default synchronous Base/ACK, owned Node/SQL.js queued
request/service/queue/policy and strict/replay/helper proxy consumers. This is not
full provider or adapter acceptance. Native untrusted TLS controls failed1/2:
direct rejects, but proxy case after module reset resolved through an insecure
TLS retry. The isolated proxy case passes in a fresh worker (one selected, one
filtered); explicit mock reload fails, confirming previous policy-wrapper capture
inside the singlePost native-call seam. The repair candidate records only owned
published wrappers in an HMR-safe WeakMap and reuses their captured original
transport on re-evaluation; foreign replacements are not unwrapped. Default
fallback policy remains unchanged, and this is not same-process sandboxing.
The current reload-safe gate passes51/51 tests across8files, no skips, with
lint/whitespace passing: both combined native untrusted TLS cases now reject,
zero upstream POST, sole unresolved terminal/no gap, without resetting native
fetch between module evaluations. Three mock controls also verify one native
call/no insecure dispatcher, repeated-evaluation success and external replacement
capture. Current affected regressions pass265/265 across16files, no skips:
Base/ACK103, Node/SQL.js service/request/queue/policy65, proxy consumers97 including
normal strict forwarding and startup instrumentation; all partitions/whitespace
pass under unchanged internal deadlines. This repairs the scoped reload seam.
Earlier immutable111/affected239 receipts predate this repair. The explicit-only
owned CA/hostname fixture passes4/4, no skips, lint/whitespace passing, via
`bash tests/helpers/run-accounting-verified-tls.sh`. CA trust is supplied only at
child Node startup, never installed on the machine; generated keys/certificates
were removed. Direct and proxy matching certificates make one POST with original
Authorization, own pending intent and settled200000nanoUSD. Trusted-CA wrong
hostname fails exactly ERR_TLS_CERT_ALTNAME_INVALID, zero POST/sole unresolved/no
gap. This is narrow positive verified TLS/hostname evidence, not general TLS
acceptance. Saved-global/legacy vs environment proxy/bypass precedence gate
passes55/55 across4files, no skips, lint/whitespace passing. Three native competing
route controls prove savedglobal proxy ignores env bypass, savedglobal NO_PROXY
direct ignores env proxy, and legacy precedes valid savedglobal/environment;
owned non-forwarding trap receives zero requests, one actual POST and exact
settlement in each case. This is not complete environment-routing precedence.
Native false-abort controls pass within61/61 across4files, no skips,
lint/whitespace passing. After own intent ACK but before dispatch: exact false
reason, not_dispatched/aborted, zero POST/tunnels. Abort from actual upstream POST:
exact false reason, sole unresolved/aborted, one POST/no replay. Neither creates a
gap; no claim of stopping foreign upstream work. Native held-terminal ACK,
synthetic lost owner-handle delivery preventing successor retry, and original
price after upstream-side pricing edit pass within45/45 across4files, no skips,
lint/whitespace passing. Native success is held until queued terminal completion;
lost owner delivery after real settlement prevents successor429POST; stored
original price still debits200000nanoUSD after upstream-side pricing mutation.
Installed rows do not recover lost ACK; this is not crash/storage-uncertainty
certification. Native raw JSON cache/reasoning controls pass within46/46 across
4files (overlapping prior controls): inclusive input100/read40/write10/output50/
reasoning20 with rates1/2/.25/1.5/3 debits195000nanoUSD; explicit cache zero170000;
documented input/output fallback200000. Contradictory cache subsets produce
unresolved/null cost, never estimated exact/free, with own terminal ACK/no gap.
This is narrow OpenAI-shaped native evidence, not all schemas, cache TTL/tier or
provider pricing acceptance. Buffered native SSE/unknown-terminal key-isolation
passes within43/43 across4files: complete raw cache/reasoning settles195000;
missing DONE/conflicting usage retains only diagnostic counts/unresolved, never
money. Exact response bytes preserved. Budgeted unknown blocks its same-key
successor POST; independent key still admits/settles200000. Native writes may be
TCP-coalesced; decoder split coverage is separate. Native live terminal ACK/EOF/
cancel controls pass within104/104 across4files (native17/service16/helper59/
parser12), no skips, lint/whitespace passing. Nonterminal delta is delivered but
finish/usage/DONE bytes wait while its queued terminal is held pending, then
settled200000. Missing DONE errors delivery and preserves observation only with
unresolved/null cost. Downstream reader.cancel(false) gives one unresolved/
aborted owner, one POST/no replay/gap. Explicit late ACK is observed separately:
local error/cancel is not durability. Not app/full-family acceptance, foreign
upstream cancellation, power loss or new throughput evidence.
Explicit service-only sync-vs-queued Node/SQL.js I/O measurement
passes8/8pairedcases (64attempts, two keys, widths1/16, histories0/256, fresh DB,
fixed exact usage/rates, no-op analytics). Exact ledgers match. Burst outercalls
and SQL.js image publications fall128→8, image bytes about93.7% less. Width1 saves
no commits and queued elapsed is slower in all four samples. Burst elapsed is
mixed for Node, faster in both SQL.js samples, with higher queued ACK latency.
Only one sample/scenario; sync per-call time omits pre-invocation wait, not matched
arrival latency. CPU, RSS endpoints and often-unsampled event-loop data are not
peak heap/fairness or deployment acceptance. Separate diagnostic counters pass8/8
pairs: per64attempts coverage384→576, spend-window reads128→256, health640→1088
(width1)/968(width16), both adapters. Burst grouping saves commits, not fresh
checks: original capture plus fresh dequeue validation remain required. Inclusive
timings overlap/add overhead and cannot replace the uninstrumented receipt or
authorize spend cache, weaker health checks or fsync.
Broader TLS/env-routing precedence,
OAuth, complete URL/config authority and broader transport acceptance remain open.
Production app handlers do not select this option.

The post-checkpoint API-key native Responses candidate adds a separate bounded
prepared protocol wire for its fixed Responses URL; Chat Completions base URL
is config equality only, not native Responses route construction authority.
Original serialized text-only body/model/mode, credentials, complete headers,
config projection, persisted overrides, proxy environment and saved route are
checked before enqueue and at fresh dequeue; POST uses detached frozen values.
Dispatch validates original schema/config/body at entry and after dispatcher
acquisition. Candidate116/116 across4files and dispatch/affected89/89 across6files
pass with no skips/lint/whitespace0. Retention/authority22/22 across3files also
passes: five original200k bodies admit/settle104000 each, sixth is refused by the
1MiB serialized queue ceiling; token/header/body model/tools/config/settings drift
refuses before intent/POST/gap. This is not total retained heap measurement.
Those receipts overlap and must not be summed as unique coverage. Mock dispatch
is not socket evidence. Native HTTP24/24 across3files passes (Responses4/Base17/
reload3), no skips/test/lint/whitespace0: own pending intent at POST, immutable
original headers/body and stored-price104000 despite pricing changes, held
terminal ACK, dequeue credential drift zero POST/intent, and307 one POST with sole
unresolved terminal. Only fixture module replacement permits owned loopback URL;
production fixed-route authority/native fetch remain unchanged. No TLS/OAuth or
all-Responses certification. Native Responses liveSSE/legacy owner70/70 across
2actualfiles passes (native6/legacy64), no skips/test/lint/whitespace0: delta can
pass while completed bytes wait for own terminal ACK, then unchanged wire and
settled104000; missing completed EOF errors delivery then explicit terminal ACK
is observed with sole unresolved/null/no gap. The requested parser filename was
wrong; this exit0 receipt does NOT cover that absent third file. Correct parser
coverage separately passes66/66 in exactly1file/no skips (test exit0; no lint
step in this unmodified-parser gate); it does not repair the prior declared-file
omission retroactively. Shared owner regression passes138/138 across3files/no skips (Base99/legacyACK4/
Codex35), test/whitespace0, no lintstep in this unmodified-owner gate. All current
Responses-slice gates are consumed; this is not Package B or full-family closure. Receipts overlap previous controls;
not70new unique tests or full stream/schema/adapter acceptance. Default
synchronous Responses/Codex contracts stay unchanged; queued Codex/OAuth, general
tools/stateful/tier requests and full Responses acceptance are not delivered by
this narrow slice. Production remains synchronous/OFF.

A later **unaccepted queued Codex OAuth candidate** has separate fixed native
Responses SSE evidence, never API-key validation as OAuth authority. Test-first
`b83b31fd4` failed0/3 (test1/lint/white0): actual owner refused queued work,
but direct admission accepted missing wire; account-dequeue assertions were not
reached. That failed receipt remains preserved. Candidate binds persisted OAuth
connection/token/full provider-specific account data/session, complete original
headers, current config/model/text schema, saved route and environment; plain
inputs guarded before cloning/headers/serialization and actual frozen POST uses
same original evidence. Mandatory Codex wire applies even unlimited; no refresh,
retry, route rebuild, general OAuth or production activation authority.
`b3ed2301d` passes76/76 across five exact files/no skips (test/lint/white0,
180s/outer220s); mock original pending→104000 settlement, missing-wire refusal
and account drift at dequeue now reached and passed. This overlaps legacy
consumers, not76unique new coverage. Test-only frozen-original/account precedence,
programmable-input, seven drift and dispatch entry/post-yield controls passed
in `b5ccf7c00`:52/52 five exact files/no skips, test/lint/white0 (180s/outer220s).
That is mocked fetch/dispatcher evidence, not native socket or general OAuth
approval. Retained-byte and stale-token dequeue controls passed in `bbd817cbf`:
28/28 three exact files/no skips, test/lint/white0 (120s/outer160s): five200k
original body ACKs settle104000 each/fivePOSTs; sixth queue refusal/no gap,
300k bound and stale-token refusal before POST/intent/gap without refresh/rebuild.
Serialized limits are not total heap/throughput guarantees; overlapping receipts
are not summed as unique coverage. Native owned HTTP gate `bcce0c6e2` passed
22/22 three exact files/no skips, test/lint/white0 (180s/outer220s): original actual
OAuth headers/body/pending/original104000price after edit, completed bytes wait
own ACK, stale-token dequeue refusal and307onePOST/soleunresolved/no replay.
Only test candidate AND registry module replacements grant owned loopback;
no production route/TLS exception or live provider call. Test-only EOF missing
completed/explicit unresolved own ACK control passed in `bd478cd51`:106/106
three exact files/no skips, test/lint/white0 (180s/outer220s; native5/legacy35/
Responses parser66). EOF delivery error is not ACK: explicit queued terminal ACK
was separately awaited, sole unresolved/null/onePOST/no gap verified. Overlapping
receipts are not unique coverage or full-family certification. Shared affected
regression `b92781b68` passed217/217 across five exact files/no skips,
test/white0 (240s/outer280s; Base99/ACK4/Responses64/embeddings34/queued durability16).
No lint step for unchanged consumers. Production modules stayed fixed through
both receipts; all current Codex candidate/mock/plain/dispatch/retention/native/
shared gates are consumed. This is a narrow full-native/text-only fixed-route
original OAuth wire slice, not general Codex, lite/compact, refresh/retry or
Package B closure. The original failed0/3 receipt remains failed. Next finite B
work moves to a distinct missing family seam, not indefinite fixture expansion.
Refresh, TLS and broader-family acceptance
remain open; no claim of a hostile same-process sandbox or generic mutable-header
original-token certification. App remains synchronous/OFF.

The next distinct Grok CLI family has production reasoning-summary/encrypted
continuity and request/session/turn identity transformations; these must not be
stripped to reuse Codex/OpenAI authority. Credits-ratio quota frames are not
per-attempt exact token/money proof. The shared Responses SSE parser currently
accepts message items only, despite JSON terminal validation already accepting
reasoning. Test-first `b5b5d972c` failed10pass/2fail of12 in exactly1file/no
skips (90s/outer120s, test1/lint/white0). Positive and missing-completed cases
reject at the first reasoning item; early negative catchall passes do not prove
later checks. Failed receipt remains preserved. Candidate adds an explicit
boolean `allowReasoning` opt-in ordered summary lifecycle with raw text/item/
encrypted-content/output equality and genuine completed EOF usage. Negative
controls now must pass their complete valid prefix before each intended fault.
`b4d7b9c9e` passed177/177 across four exact files/no skips (180s/outer220s,
reasoning12/parser66/Codex35/Responses64, test/lint/white0). Positive reasoning
and missing-completed cases reach the lifecycle; each negative confirms its
valid prefix before the intended fault. Default parser remains closed; no Grok
owner or provider route is activated. Test-only summary/encrypted byte bounds,
encrypted identity and shared stream own-ACK/authorization gate `bc54d261f`
failed94pass/1fail of95 in four exact files/no skips (180s/outer220s,
test1/lint/white0). Reasoning17/18 and parser66/nativeCodex5/nativeResponses6
pass; held-ACK case failed initial delta-delivery assertion, before ACK/auth
checks. Upstream `pull()` was an eager-prefetch signal, not proof of downstream
delta delivery. Failed receipt remains preserved; no observed terminal leak or
money defect is inferred. Fixture-only repair uses the actual consumer's delta
read as barrier, assertions/deadlines unchanged. `b284e04c4` passes95/95 in the
same four exact files/no skips (reasoning18/parser66/nativeCodex5/nativeResponses6,
180s/outer220s, test/lint/white0), artifact
`/tmp/9router-responses-reasoning-delivery-xdkaaZ/results.json`. Consumer delta,
EOF, own ACK and authorization are now observed in order before exact terminal
bytes release; missing completed separately observes null/network_unknown ACK.
Both earlier failed receipts remain preserved. Current prerequisite gates are
consumed; mock shared owner controls are not actual DB/POST or provider usage
acceptance. Grok Build original+actual owner test-first gate `b54af2d8e`
failed0/3 in one exact file/no skips (90s/outer120s, test1/lint/white0), artifact
`/tmp/9router-queued-grok-cli-before-Zt2clO/results.json`. Positive stops at
current Base unsupported refusal; direct missing wire even unlimited is admitted;
metadata control stops at wrong expected error code, so later transform/ledger
assertions are not covered. Failed receipt remains preserved. Fixture-only
correction uses `BUDGET_ERROR.UNSUPPORTED`; corrected red gate `b3e16c2ed`
failed1pass/2fail of3 in one exact file/no skips (90s/outer120s,
test1/lint/white0), artifact
`/tmp/9router-queued-grok-cli-contract-before-jzBWdl/results.json`. Metadata
checks now reach zero transform/POST/intent/gap/machine/refresh; positive Base
unsupported and missing-wire admission remain red. Both receipts are preserved.
An internal queued-only `grok-build` text-only candidate now retains original
AND actual body, forces only the production reasoning summary/encrypted include
overlay, validates current fixed URL/registry/client config and request-local
session/request/monotonic-turn identity, persisted OAuth token/full provider data
and device identity/full headers/config/environment/saved routes. It requires
prepared wire even unlimited and independently binds service endpoint/provider/
model/connection. Actual frozen POST uses strict single-POST entry/post-yield
validation and explicit raw reasoning parser opt-in. Legacy executor transforms,
shared mutable header state and machine acquisition are not called in this mode;
missing persisted device is unsupported, not fallback permission. Unsupported
original fields are refused, never stripped. Model aliases/effort, tools,
encrypted input continuity, alternate identity forms, refresh/retry and production
eligibility remain outside this initial candidate. `b3cba2469` passes72/72 in
five exact files/no skips (newGrok3/legacyGrok23/queuedCodex19/request14/service13,
180s/outer220s, test/lint/white0, dummy HOME/DATA_DIR, mock transport), artifact
`/tmp/9router-queued-grok-cli-candidate-duQ95f/results.json`. Original pending,
strict POST/reasoning/include/raw104000 and missing-wire/unlimited refusal plus
unsupported metadata zero transform/POST/intent/gap all reach assertions/pass.
Earlier reds remain preserved; overlapping counts are not unique acceptance.
Test-only authority expansion now selects Grok20 (frozen actual after caller
mutation, nine original drifts, four programmable guards, device dequeue drift,
absent device no fallback, same-executor concurrent request/session/turn identity,
original three) and strict dispatch18 (valid,15 entry refusals,2 post-yield
refusals). `b3507702e` passes65/65 with Codexdispatch15/envdispatch4/plain8
(five exact files/no skips,180s/outer220s, test/lint/white0), artifact
`/tmp/9router-grok-cli-authority-dispatch-aTklBl/results.json`. Frozen POST,
nine drift/four programmable checks, persisted device dequeue, absent device and
same-executor concurrent identity/monotonic turns all reach assertions/pass;
strict dispatch entry/post-yield controls pass with no native claim. Current
authority gates are consumed, not65 new unique tests or full family acceptance.
Test-only retention expansion23 adds100k original+100k actual bodies: five own
ACKs at104000 each/five POSTs, sixth queue-ceiling refusal;140k pair command bound
before intent/POST/gap; stale token dequeue without refresh/rebuild.
`b6578c49f` passes32/32 Grok23/preparedbounds3/groupplain6 (three exact
files/no skips,120s/outer160s, test/lint/white0, dummy HOME/DATA_DIR, mock network),
artifact `/tmp/9router-grok-cli-retention-Y3VuLI/results.json`. Five own ACKs,
sixth refusal,140k pair bound and stale-token assertions all reach/pass.
Same-turn actual admission has no import await; no batching or ceiling change.
Serialized limits are not total heap or throughput proof. Production stays fixed
since72 candidate. Dispatch header checks are not generic
mutable original token/device equality; frozen actual owner plus enqueue/dequeue
provide full original-header protection. Current mock/authority/retention gates
are consumed; overlapping counts are not unique/full-family acceptance.
`accounting-queued-grok-cli-loopback.test.js` adds five real native HTTP controls:
original OAuth/device/client/session/request/turn headers, original+actual body
reasoning/include and own pending/original104000 after upstream price edit;
reasoning summarydone/encrypted/completed held through own queued terminal ACK;
missing completed delivery error followed by separate explicit unresolved ACK;
stale persisted token/device dequeue;307 one POST/no replay. Only Vitest candidate
AND registry replacements grant the exact owned loopback route; production URL
and TLS remain unchanged. `b1d4ab02f` passes44/44 native5/dispatch18/reload3/
reasoning18 (four exact files/no skips,180s/outer220s, test/lint/white0,
dummy HOME/DATA_DIR, real fetch/proxy/saved NO_PROXY), artifact
`/tmp/9router-grok-cli-native-TtmSbk/results.json`. All five native assertions
reach/pass including original actual headers/body/pending/price104000, held
terminal ACK, separate unresolved ACK, dequeue identity refusal and sole POST307.
Current candidate/authority/retention/native gates are consumed; overlapping
receipts are not new unique/full-family acceptance. Shared affected gate
`b88d61bb6` passes294/294 in seven exact files/no skips: Base99/ACK4/
Responses64/Codex35/embeddinglifecycle34/actualqueueddurability16/singlePOST42
(240s/outer280s, TEST/WHITE0, no lint step for unchanged consumers, isolated
HOME/DATA_DIR), artifact `/tmp/9router-grok-cli-shared-impact-1RutnN/results.json`.
All current narrow Grok candidate/authority/retention/native/shared gates are
consumed; overlapping receipts are not unique/full-family or B closure.
Active LSP six paths sequential5000ms clean/0diagnostics is not security audit,
build or runtime acceptance. No TLS/refresh/general provider certification or
Grok activation. Next distinct GitHub cached/direct Responses inspection shows
accounting is dropped by direct-method destructuring, raw SSE is translated before
an accounting owner, and POST lacks strict single-POST contract; direct Messages
and400 escalation require separate owners/attempt authority. Copilot's preferred
token is separate from GitHub accessToken and persists in providerSpecificData.
New `accounting-queued-github-responses.test.js` selects three test-first controls
for explicit native fixed Responses SSE with cached route: own pending/strict
POST/original Copilot token/raw104000 terminal, missing wire even unlimited,
unsupported original metadata cannot bypass owner. `b9ee5e072` failed0/3 in
one exact file/no skips (90s/outer120s, test1/lint/white0), artifact
`/tmp/9router-queued-github-responses-before-9e1b6k/results.json`. Positive
reaches direct legacy POST but redirect is undefined; pending/raw terminal later
assertions are not covered. Missing wire unlimited is admitted and unsupported
metadata reaches direct generation. Receipt preserved/consumed before edits.
An internal queued native Responses text-only registered-GPT candidate now uses
separate fixed-URL/config/client/header authority and a request-local UUID;
preferred Copilot token must equal persisted providerSpecificData.copilotToken,
with GitHub accessToken independently equal to persisted OAuth authority. Five
credential fields/full provider data, canonical headers, overrides, config,
environment and saved routes are bounded/frozen/counted. Entry precedes cached
routing/Claude/sanitize/escalation branches; no translator or cached-route
permission substitutes for original schema. Mandatory wire even unlimited,
independent service binding and strict POST entry/post-yield validation apply.
Complete config plain-data guard precedes extra route reads. Default synchronous
GitHub behavior unchanged; no actual app queued activation or token fallback.
`b99813443` passes58/58 in five exact files/no skips (newGitHub3/routing5/
Grok23/request14/service13,180s/outer220s, test/lint/white0, dummy HOME/DATA_DIR,
mock transport), artifact `/tmp/9router-queued-github-responses-candidate-8Fv9vG/results.json`.
All three original controls reach own pending/strict POST/original Copilot token/
raw104000 terminal, missing-wire unlimited and unsupported metadata refusal
before POST/intent/gap. Failed0/3 receipt preserved, not retroactively accepted.
Test-only expansion19 adds frozen actual after caller mutation, eight original
drifts, four programmable guards, persisted Copilot-token dequeue drift without
GitHub-token fallback, absent runtime Copilot token refusal and concurrent unique
UUIDs without route-cache mutation. New dispatch15 covers valid strict POST,
12 entry refusals and2 post-yield refusals. `b16f3b692` passes64/64 with
Grokdispatch18/envdispatch4/plain8 (five exact files/no skips,180s/outer220s,
test/lint/white0, dummy HOME/DATA_DIR, mocked dispatcher/network), artifact
`/tmp/9router-github-responses-authority-dispatch-xekPz9/results.json`.
All frozen POST/drift/programmable/dequeue/no-fallback/UUID and entry/post-yield
assertions reach/pass. Current candidate/authority gates consumed; overlapping
counts are not unique/full-family acceptance. Test-only expansion22 adds five
200k retained original wires with own104000 ACKs, sixth queue-ceiling refusal,
300k command bound before admission/intent/POST/gap, and persisted GitHub-token
dequeue drift without reconstructing the Copilot wire. `b3c685096` passes31/31
GitHub22/preparedbounds3/groupplain6 (three exact files/no skips,120s/outer160s,
test/lint/white0, dummy HOME/DATA_DIR, mock network), artifact
`/tmp/9router-github-responses-retention-rfijCp/results.json`. All retention and
stale GitHub-token assertions reach/pass. Same-turn real
admission has no import await; no batching/ceiling change. Serialized bounds are
not heap/deployment throughput proof. Production fixed since58 candidate. Dispatch header allowlist/presence/fingerprint
is not generic mutable original-token equality; frozen actual owner and enqueue/
dequeue carry full original-header protection. Current candidate/authority/
retention gates consumed; overlapping receipts are not unique/full acceptance.
New `accounting-queued-github-responses-loopback.test.js` adds five real native
HTTP controls: actual original Copilot fingerprint/body/own pending/price104000
after upstream price edit; completed bytes held through own queued ACK; missing
completed delivery error followed by separately awaited unresolved ACK; stale
preferred Copilot token dequeue;307 exactly one POST/no replay. Only candidate
AND registry module replacements grant the exact owned route; production URL/TLS
unchanged, real fetch/proxy/saved NO_PROXY. `ba38256c4` passes89/89 native5/
dispatch15/reload3/parser66 (four exact files/no skips,180s/outer220s,
test/lint/white0, isolated HOME/DATA_DIR), artifact
`/tmp/9router-github-responses-native-gnKRu2/results.json`. All five native cases
reach actual original fingerprint/body/pending/price104000, held own ACK,
separate unresolved ACK, stale token dequeue and307 sole POST/no replay assertions.
Current candidate/authority/retention/native gates are consumed; overlaps are not
unique/full acceptance. Shared affected `bfdfb6077` timed out at240s
(TEST124/WHITE0, outer280s), artifact
`/tmp/9router-github-responses-shared-impact-NEsdbN/`. No results.json or
terminal test summary was produced; verbose log contains206 completed-pass
lines (Base99/Responses64/Codex35/embedding8), no completed failure lines.
This is incomplete execution evidence, not seven-file acceptance. Failed receipt
preserved; no production change inferred from timeout. Same seven selected files
now run as `b86aac717` in three sequential finite180s partitions (outer580s):
base99; Responses64+Codex35; ACK4+embeddinglifecycle34+actualqueueddurability16+
singlePOST42, separate JSON/log per partition plus WHITE. No lint step for
unchanged consumers, isolated HOME/DATA_DIR, no assertion/hook/test-timeout change.
`b86aac717` passes all three partitions99/99,99/99,96/96:294/294 across
exactly seven distinct files/no skips, TEST each/WHITE0, artifact
`/tmp/9router-github-shared-partitions-bfhuMJ/{base,responses,transport}.json`.
The earlier240s timeout remains incomplete; later passes do not rewrite it.
All current narrow GitHub native Responses candidate/authority/retention/native/
affected gates consumed; overlaps with preceding gates are not summed unique
coverage, full GitHub or B closure. Production remained fixed since58 candidate.
No TLS/general GitHub/Chat conversion/escalation/Messages/refresh approval.
Next distinct inspection is GitHub Messages: ordinary Claude-name route translates
OpenAI→Claude, strips internal tool map, dispatches direct POST without accounting,
and translates raw Claude SSE before ownership. It destructures away accounting;
this cannot reuse Responses evidence or API-key Anthropic headers. A separate
internal native-Claude/text-only owner requires its own original+actual body,
preferred persisted Copilot token and GitHub OAuth identity, client UUID/fingerprint,
raw Claude parser before any conversion, and fixed Messages route. This does not
approve ordinary OpenAI→Claude conversion, beta/tools or OAuth refresh.
New `accounting-queued-github-messages.test.js` adds three test-first controls:
explicit native body (actual only stream:true overlay), original Copilot fingerprint,
own pending/strict POST/raw106500 terminal without legacy translation; missing
wire even unlimited; unsupported original metadata cannot be erased by conversion.
`b4924dc79` FAILED1pass/2fail3tests/exact1file/no skips (90s/outer120s,
TEST1/LINT0/WHITE0), `/tmp/9router-queued-github-messages-before-PZBDPW/results.json`.
Positive enters denied legacy Messages method before POST/pending/terminal checks;
metadata resolves legacy generation, so later zero POST/intent/gap checks unreached.
Missing wire refuses under existing Responses-only GitHub validator, not Messages
owner acceptance. Red receipt consumed/preserved before implementation.
Internal candidate now adds `accountedGithubMessagesCandidate.js` (registered
Claude native text-only, original+actual only stream:true overlay), separate
six-field Messages dispatch and eight-field queued wire with exact five credential
fields. Same canonical Copilot fingerprint is reused as data, never Responses URL/
schema authority. Both persisted tokens/full provider data/config/original+actual
body/full headers/UUID/environment/saved routes are retained, counted and frozen;
service independently binds native Messages/chat/provider/model/connection.
`accountedGithubMessages.js` enters before legacy Claude translation, owns raw
Claude SSE using the existing strict parser and shared terminal-ACK stream, sends
one redirect:error POST with entry/postdispatcher validation, no token fallback/
refresh/retry. Ordinary synchronous routes unchanged (unused method parameters
removed only). `bea096239` PASS57/57 across five exact files/no skips:
Messages3/routing5/GitHubResponses22/request14/service13 (180s/outer220s,
TEST/LINT/WHITE0, scoped nine-path ESLint, isolated HOME/DATA_DIR, mocked network),
`/tmp/9router-queued-github-messages-candidate-CYWAmx/results.json`.
All original three tests reach own pending/strict POST/full Copilot/body/raw106500
terminal, missing wire even unlimited and metadata zero POST/intent/gap assertions.
Red1/3 remains failed, not retroactive coverage or full Messages/B acceptance.
Test-only Messages3→22 adds frozen actual after caller mutation; nine original
Copilot/GitHub token/connection/original+actual body/config/UUID/header/endpoint
drifts; five programmable body/accessor/toJSON/credential/proxy/config guards;
both persisted tokens at dequeue/no refresh/rebuild; missing selected token/no
fallback; same-executor concurrent UUIDs/no cache mutation. Dispatch17 adds valid
POST/14 entry refusals/two postdispatcher route/body refusals. `bf3e45160` PASS66/66
across five exact files/no skips Messages22/dispatch17/Responsesdispatch15/env4/
plain8 (180s/outer220s, TEST/LINT/WHITE0, two-test ESLint, isolated HOME/DATA_DIR/
mock dispatch), `/tmp/9router-github-messages-authority-dispatch-uyeGwC/results.json`.
All frozen/drift/programmable/dequeue/no-fallback/concurrent/entry/postyield checks
reach/pass. Current candidate/authority gates consumed; overlaps not unique/full
acceptance. Test-only Messages22→24 adds five100k original+100k actual pairs with
own106500 ACKs/five POSTs, sixth queue ceiling refusal, and140k pair command bound
before admission/intent/POST/gap. `b3993301c` PASS33/33 Messages24/preparedbounds3/
groupplain6 (three exact files/no skips,120s/outer160s, TEST/LINT/WHITE0,
changed-test ESLint, isolated HOME/DATA_DIR, mocked network),
`/tmp/9router-github-messages-retention-FIjA34/results.json`. Five pairs own106500
ACK/five POSTs, sixth refusal/no gap and140k preadmission bound reach/pass.
Real same-turn admission has no import await; no batching/ceiling/deadline changes.
Serialized ceilings are not total heap or performance proof. All current
candidate/authority/retention gates consumed; overlaps not unique/full acceptance.
New `accounting-queued-github-messages-loopback.test.js` has six owned native HTTP
controls: actual Copilot fingerprint/original+actual body/own pending/original106500
after price edit; message_delta/stop held through own ACK; missing message_stop
separately awaits own unresolved ACK; both persisted token dequeue drifts;
307 sole POST/unresolved/no replay. Candidate AND registry replacement grants only
owned route, real fetch/proxy/saved NO_PROXY; production URL/TLS unchanged.
`b010dd9b5` PASS26/26 across three actual files/no skips native6/dispatch17/
reload3, `/tmp/9router-github-messages-native-NV4MjH/results.json`,
TEST/LINT/WHITE0 (180s/outer220s, lint new test, isolated HOME/DATA_DIR).
All six native cases reach/pass own pending/original106500 after price edit,
immutable original POST/body, held Delta/Stop ACK, missing-stop separate unresolved
ACK, both stale token dequeue and307 one POST/no replay. Declared fourth file
`unit/accounting-claude-sse.test.js` does not exist; receipt remains incomplete
for that declared scope and supplies no parser coverage, despite exit0.
`b3f367182` PASS158/158+99/99+99/99+96/96=452/452 across nine distinct
exact files/no skips, all four TEST exits/WHITE0 (four sequential finite180s
partitions/outer760s, no lint for unchanged consumers, isolated HOME/DATA_DIR),
`/tmp/9router-github-messages-shared-partitions-GNTgwt/{claude,base,responses,transport}.json`.
Actual helper `accounting-claude-sse-usage.test.js` has55 tests, not anticipated32;
Anthropicowner103→claude.json, Base99→base.json, Responses64+Codex35→responses.json,
ACK4+embedding34+actualqueueddurability16+singlePOST42→transport.json.
No assertion/hook/test-deadline changes; earlier missing scope is not retroactively
repaired by later coverage. Production fixed since57 through all receipts.
All current narrow GitHub native Messages candidate/authority/retention/native/
helper/affected gates consumed; overlaps not summed unique/full GitHub/B closure.
Next distinct seam is GitHub Chat→Messages conversion: ordinary OpenAI-shaped
request is translated to Claude (including generated cache_control/tool map), raw
Claude SSE is then converted to OpenAI. Native original-body proof does not cover
original Chat authority, conversion erasure or output ACK ordering through the
translator. Original+converted pinned evidence and an owner before translation
are required separately; inspection/test-first only until its own receipts.
Inspected full GitHub route, translator dispatch and OpenAI→Claude request core:
prepareClaudeRequest generates1h cache_control on last system block even without
an explicit system message. Preserve it; never strip TTL to reuse the native5m
candidate. New `accounting-queued-github-chat-messages.test.js` has three controls:
original+converted frozen wire with raw pending/strict POST/106500 settlement
before Chat response conversion, generated1h system cache policy preserved;
missing wire even unlimited; original unsupported metadata cannot be erased.
`b51719de6` selects this exact file/three anticipated tests (90s/outer120s,
test/lint/white, isolated HOME/DATA_DIR/mock network). No production conversion
implementation or acceptance yet; production held fixed through red receipt.
Active LSP6 paths sequential5000ms clean/zero diagnostics, not security audit or
build/runtime certification. Generic POST header
presence/fingerprint is not arbitrary mutable original-token equality; frozen
actual owner plus full enqueue/dequeue header equality carries that protection.
A separate persisted cross-session task receipt `bb5c8b4f9` was discovered in
`.pi/tasks/...-3678932/`: completed before Messages source changes,67/67 across
five exact files/no skips, TEST/LINT/WHITE0,
`/tmp/9router-github-responses-authority-dispatch-PS7eZQ/results.json`.
GitHub22/dispatch15/Grokdispatch18/env4/plain8 overlaps earlier authority/retention;
not post-Messages source validation or additional unique/full-family acceptance.
Translated/synthetic completed events cannot become raw accounting evidence;
genuine completed EOF and usage/output equality remain required. No live provider
or OAuth discovery calls, and production modules remain fixed through the gate.

The next narrow queued Gemini API-key candidate binds original native
model/action URL, text-only serialized body (without internal model/stream), mode,
registry config, complete x-goog-api-key headers, overrides/environment/saved route.
Missing Gemini wire is now refused even for unlimited keys; original evidence is
revalidated before enqueue, at dequeue and at dispatch entry/postdispatcher await.
Default synchronous Gemini calls remain unchanged. Candidate77/77 across4files,
dispatch44/44 across5files and retention24/24 across3files pass with no skips and
test/lint/whitespace0. Retention controls admit/settle five original200k bodies at
124000nanoUSD each, reject sixth at the serialized queue ceiling, and refuse
original token/header/tools/internal-model/config/settings/mode-URL drift before
POST/intent/gap. Receipts overlap, not summed unique coverage or total heap proof.
Dispatch uses mocks. NativeHTTP13/13 across3files passes (Gemini4/Responses6/
reload3), no skips/test/lint/whitespace0: original native header/body, ownpending,
original124000 price despite upstream change, heldterminalACK, dequeue credential
drift zeroPOST/intent,307 onePOST/soleunresolved. Candidate constant and registry
module are replaced only in test for owned HTTPloopback; native fetch/proxy stays
real, savedNO_PROXY direct, no production endpoint exception. New native Gemini
SSE gate fails91pass/2fail93tests: both SSE controls denied at admission before
POST/terminal checks; legacy47 and parser40 pass. Source comparison identifies
missing stream Accept in complete expected header validation. Receipt preserved,
repair not yet applied while sharedowner gate reads production; no SSE acceptance
inferred from prior JSON/mock passes. Targeted original/missing/wrong Accept
controls fail1pass/2fail (3selected/13intentionallyfiltered): correct original
Accept wrongly denied, missing Accept evidence wrongly admitted, wrong value
refused. Actual frozen POST still carries original Accept; this is incomplete
original-header evidence validation, not observed altered native header. Failed
missing-Accept case does not reach later zeroPOST/row assertions. Both failed
receipts remain. Pre-repair sharedowner regression passes241/241 across4files
(Base99/ACK4/Codex35/Anthropic103), no skips/test/whitespace0; no lintstep and not
post-repair evidence. After all gates ended, validator now adds expected stream
Accept before persisted overrides, matching original builder order. Affected-authority
regression passes65/65 across5files (dispatch11/request14/actualservice16/
Responses11/Basewire13), no skips/test/whitespace0, no lintstep. Full queued/
native/legacy/parser repair passes109/109 across4files (queued16/native6/legacy47/
parser40), no skips or filters/test/lint/whitespace0. Original SSE Accept admits
and settles124000; missing/wrong evidence refuses zeroPOST/intent/gap. Native
delta passes while finish/usage frame waits for own queued ACK, then unchanged
wire/exact124000; missing finish EOF errors delivery, explicit terminal ACK is
observed separately with sole unresolved/null/onePOST/no gap. Prior failed receipts
remain failed. This repairs the scoped SSE header defect; not full Gemini/OAuth,
TLS, adapter/power-loss, app/runtime or performance acceptance. No OAuth/envelopes/tools,
TLS, arbitrary endpoint or full Gemini acceptance. App stays synchronous/OFF.

Queued standard API-key Messages candidate retains original serialized request
AND actual forced-stream body. Equality permits only the stream:true overlay;
transforms cannot erase unsupported original work. Both representations are
bounded/counted along with immutable headers/token/config/overrides/env/routes;
checked before enqueue/dequeue and dispatch entry/postdispatcher await. Missing
Messages wire refuses even unlimited. Candidate135/135 across4files and dispatch
53/53 across5files pass, no skips/test/lint/whitespace0. Retention26/26 across3files
also passes: five original100k+actual100k body pairs admit/settle106500 each, sixth
refused at queue ceiling;140k pairs exceed command bound before intent/POST;
eight original drift cases refuse zeroPOST/intent/gap. Serialized-data limit is
not total heap or performance proof; receipts overlap. Native HTTP13/13 across
3files passes (Messages4/Gemini6/reload3), no skips/test/lint/whitespace0: actual
original APIkey/version/Accept/no-beta headers/body with ownpending intent,
original106500price despite upstream changes, heldterminalACK, dequeue drift
zeroPOST/intent and307 onePOST/soleunresolved. Native fetch/proxy stays real with
savedNO_PROXY direct; exact fixed loopback URL and standard headers come only from
fixture candidate/registry module replacements. Native liveSSE141/141 across
3files passes (Messages6/legacy103/helper32), no skips/test/lint/whitespace0:
message_start can pass while terminal message_delta/message_stop waits pending
for own queued ACK, then unchanged wire/exact106500. Missing stop EOF errors
delivery then explicit terminal ACK is separately observed with sole unresolved/
null/onePOST/no gap. Receipt overlaps previous controls; not141new tests, arbitrary
fragmentation or full Messages acceptance. Sharedowner regression passes185/185
across4files (Base99/ACK4/Codex35/Gemini47), no skips/test/whitespace0; no lintstep
in this unmodified-owner gate. All current Messages gates are consumed, but this
is not full protocol/provider or Package B closure.
Standard headers come ONLY from test registry-module replacement. Production
beta headers are not removed or automatically downgraded; this is not beta/OAuth,
general tools/TTL, arbitrary endpoint or full Messages acceptance. App sync/OFF.

**2026-10-11 continuation (internal queued API-key only):** a separate
`native-claude-beta-sse` mode retains exact production-registry beta flags and
full original/actual wire; ordinary app/synchronous/GitHub helpers stay unchanged.
It now admits supported top-level 1h cache controls only with an original explicit
manual `cache_creation_1h` USD/1M reference rate. Missing 1h is unavailable, not
input/5m fallback or a guessed multiplier; models.dev flat `cache_write` does not
supply this rate. Blank editor field means unavailable; explicit zero stays zero.
Observed `cacheWrite5m` + `cacheWrite1h` must equal aggregate `cacheWrite`; input
includes all cache subsets, and summed BigInt component cost rounds once per
attempt. A requested 1h snapshot requires observed split for both automatic
settlement and later exact recovery. Missing/invalid raw details stay unresolved,
never inferred from request TTL. Management/recovery/projection preserve counts
and original debit. Own delivered intent/terminal ACK and fresh beta terminal
credential/wire authority remain mandatory. Mixed TTL longer-first is validated;
nested tool-result 1h markers are refused as undocumented cache breakpoints.
Scoped gates: 980/980 across48files, then final guard496/496 across20files;
1355stable inputs/lint19/whitespace0. No full F/B/product, OAuth/generalbeta,
publicapp, all-adapter/build/browser/performance certification. Added pricing
column has source/API/draft evidence only; current-build browser acceptance and
three inconclusive LSP path probes remain explicit limitations. See
[cache-tier continuation](../plans/261003-0827-api-key-quota-budget-pricing/reports/messages-cache-tiers-continuation.md).

The internal queued embeddings candidate separately binds the fixed OpenAI
embeddings endpoint and registry media configuration, not Chat Completions URL
assumptions. API-key/text input only; original and actual serialized bodies,
headers/token, saved route and environment are counted/frozen before owner
exposure. Dispatch checks schema/config/body through dispatcher acquisition.
Queued refresh is not supported; legacy synchronous/refresh behavior is retained.
Initial candidate regression failed62/64 because a new static proxyFetch import
published its global wrapper during app-handler re-import and replaced test fetch.
The queued-only transport import repair passes64/64 across4exactfiles/no skips:
queued3/request14/service13/lifecycle34, test/lint/whitespace0. Failed receipts
remain retained. This is mock admission/immutable POST/2000nanoUSD/dequeue drift
proof, not native/retention/full embeddings acceptance. Direct self-review then
found original serialization happens before plain-data guarding; original toJSON
and accessor refusal controls failed3pass/2fail: both new cases returned success;
assertions after rejection were not reached. Receipt retained. Separate dispatch
regressions pass50/50 across5exactfiles (embeddings13 plus37 existing protocol/env
controls), no skips/test/lint/whitespace0; mocks are not socket evidence. After
both gates ended, queued core now snapshots plain original work before input read
or adapter transform; direct owner also guards original/actual bodies before
serialization. The unchanged red assertions plus direct-owner, proxy/getter and
unsupported schema controls now pass within80/80 across5exactfiles/no skips:
queued11/lifecycle34/service13/request14/plainpayload8, test/lint/whitespace0.
No programmable callback/trap runs, no POST/intent/gap for the refused controls;
old failure remains retained. This is scoped plain-data repair, not hostile
same-process sandboxing or native/full embeddings acceptance. Original/actual
serialized retention and credential/header/schema/config/settings/endpoint drift
controls pass29/29 across3exactfiles (queued20/bounds3/groupplainpayload6), no
skips/test/lint/whitespace0. Earlier28/29 failure is retained: concurrent owner
imports did not prove simultaneous queue occupancy. A fixture-only admission
barrier now enqueues six unchanged original100k+actual100k pairs in one turn;
five ACK/settle2000each, sixth queue refusal/no gap. The140k body pair exceeds the
command bound; seven authority drift cases refuse before POST/intent/gap. This
changes no production batching or ceilings. Limits are serialized plain-data
bounds, not total heap or performance certification. Native HTTP loopback
passes21/21 across3exactfiles (native5/dispatch13/reload3), no skips/test/lint/
whitespace0, with native fetch/proxy real and exact route permitted only by
candidate/registry test-module replacements. Original Bearer/body/pending intent,
original2000 after upstream pricing edit, held own terminal ACK and dequeue drift
zeroPOST/intent/gap are verified. Both307 policies make one POST/sole unresolved/
null/no gap: unlimited returns502 after ACK; budgeted raises accounting unresolved.
Earlier18/20 failure remains retained (cold hook timeout and wrong unlimited
rejection expectation), not erased by current pass. Shared Base/ACK/Codex,
queued-durability and single-POST consumer regression passes196/196 across5exact
files/no skips (Base99/ACK4/Codex35/queued-durability16/singlePOST42), test/whitespace0;
no lint step in this unmodified-consumer gate. All current embeddings-slice gates
are consumed. Overlapping receipts are not summed as unique coverage. This is not
Package B closure or full embeddings/TLS/OAuth/adapter/runtime acceptance. No production arbitrary-URL
exception or OAuth-refresh permission. Production handlers remain sync/OFF.

Limits of 128 queued commands/1 MiB retained plain data and 32 commands/256 KiB per
group are provisional conservative serialized-data ceilings, not total JavaScript
heap measurements or throughput tuning. Prepared credential/header/proxy/environment
and runtime/Base-config equality data is request-local and counted in these bounds; it must
not be logged or persisted in ledger/management output. Per-attempt half-up cost rounding and original
persisted price snapshots are unchanged; terminal projection follows durable ACK.
No spend-cache, weaker fsync/PRAGMA or production rollout is authorized.

### Ownership recovery

On Linux, automatic stale-owner recovery requires verified PID incarnation and
boot identity plus proven process death. PID reuse, malformed locks, unavailable
liveness information, or an interrupted acquisition gate are operator recovery
conditions—not permission to delete a lock after a timeout. Graceful stop with
pending owned attempts retains the owner record until the process is dead.
Recovered pending work becomes unresolved; a crash before actual fetch cannot
be assumed nonbillable without independent evidence.

Never remove ownership artifacts while any writer is live. Take a backup,
verify process identity and stop all writers before operator lock recovery.
Automatic recovery on other operating systems remains unsupported; verify
platform fsync/adapter runtime gates before production enablement.

## Explicit offline policy initialization (preactivation only)

An explicit operator CLI now exists; it is **not activation** and does not install
routing hooks or set `ledgerStartedAt`. Its bounded verification is in progress.
Do not invoke it on production until the integrated release gates pass.

```sh
node scripts/api-key-policy-init.mjs initialize <existing-DATA_DIR> node:sqlite <actor> <reason>
node scripts/api-key-policy-init.mjs recover <existing-DATA_DIR> node:sqlite
# sql.js is the other explicit engine; it requires a standalone image without WAL/SHM/journal.
```

Stop all cooperating writers first. The command acquires exclusive ownership;
there is no startup repair, migration, HTTP initializer, or automatic engine
fallback. The retired in-process initializer refuses before any DB interaction.
Fresh initialization accepts only a supported pristine preactivation store and
preserves existing restrictions. Schema validation requires the complete exact
canonical accounting and pricing-revision trigger definitions (name, table and
SQL bytes); missing, changed or extra triggers deny without installer repair.
Pricing triggers only advance the revision on pricing/catalog kv mutations;
policy initialization/recovery does not change prices, revision or activation.
Historical interrupted stores without a recorded intent remain fail-closed; the
command cannot retrofit an intent.

`DATA_DIR/.accounting-policy-init-intent.json` is retained after success. It binds
one operation to exact logical pre/post database state, protected sidecar bytes,
and a committed audit receipt. Explicit recovery resumes only that recorded
transition; later database changes or mixed artifacts deny. Recovery re-establishes
durability acknowledgements rather than inferring a past ACK from matching data.
Speculative prediction uses a rolled-back savepoint; intent publication precedes
**committed policy mutation**, not every speculative SQL write.

Intent and coverage contain secret binding material. Never publish them. The
current protection gate requires effective-UID ownership and no group/other POSIX
mode permissions; it does not audit ACLs. Unsupported protection semantics deny.
Do not chmod, delete sidecars, or replace intent to force recovery to pass. If
connection cleanup cannot be confirmed, exclusion is retained until proven owner
death; a reported failure is not authorization for a competing writer.

Process SIGKILL tests are not hardware-power-loss proof. This transition protocol
has no external anti-rollback watermark: restoring an older coherent whole bundle
is not detectable automatically. Managed backup/restore integration with retained
intent remains a release gate, not certification supplied by this CLI.

## Configuration export/import versus physical backup

`exportDb()` / `/api/settings/database` produce **configuration**, not a complete
accounting backup. Version/coverage metadata explicitly declares
`completeBackup:false`; exports may contain existing credentials and must be
handled as sensitive files. Do not distribute them as tracking reports.

Configuration import preserves accounting tables, policies, audit, activation
metadata and external coverage. It rejects ID/secret collisions before deleting
config rows. All payload SQL/serialization constraints are preflighted before
cross-file retirement. A crash after external retirement but before database
commit is deliberately fail-closed and may need operator reconciliation; this
is not a cross-file atomicity guarantee. Deleting or importing config is not a
budget reset or accounting restore.

Physical backups must include:

- SQLite database with accounting/policies/audit/meta/key bindings.
- `DATA_DIR/.accounting-coverage.json` with protected HMAC material, gaps,
  maintenance, retained retirement bindings, and maintenance-release ACK history.
- Retained `DATA_DIR/.accounting-policy-init-intent.json`, if present, with the
  corresponding DB/coverage bundle; it is sensitive and not a freshness witness.
- Managed-restore manifests/pre-restore artifacts when recovery is in progress.

The managed-restore consumer now captures a private, unique bundle generation with
protected historical intent when present, explicit presence/absence, hashes and a
last-published completion marker bound to its operation/coverage generation. The
archived intent is never copied into or adopted as live authority; missing/changed
live intent or ambiguous archived entries deny. Generic lightweight migration backup
still captures DB/coverage only. Scoped same-directory tests, including process death
and explicit offline retry, have passed; self-contained transfer/new-directory,
antirollback, power-loss and complete runtime acceptance remain release gates.

The sidecar is sensitive local material, even though tracking API responses
expose only redacted coverage metadata. Keep backups owner-readable and offline.
Lightweight migration backups omit requestDetails, not ledger history. SQL.js
backups use real exported files, not an assumed host file from virtual ATTACH.
Verify each artifact with an independent reopen/integrity check.

## Managed physical restore (operator-only, foundation API)

No dashboard physical upload/restore is exposed. The foundation module
`src/lib/db/managedRestore.js` provides explicit preparation/application functions;
a supported operator CLI/runbook integration and release verification are still
pending. Do not execute them on production while release gates are incomplete.

1. Stop new inference/admissions and drain or preserve in-flight terminal sinks.
2. `prepareManagedRestore(db, backupDirectory, reason)` fsyncs maintenance and a
   global reconciliation gap **before** any replacement, captures current
   database/sidecar backups, closes the owned adapter and writes a recovery
   manifest with hashes. Stop the writer process. Pending owned intents may
   require process death before exclusion can be reacquired.
3. Offline `applyManagedRestore(dataDirectory, snapshotFile)` acquires exclusive
   ownership, verifies recovery artifacts and the accounting snapshot, rejects
   unexpected writer changes/WAL side files, and replaces only the database.
   It never overwrites current external coverage or protected binding material
   with an old clean sidecar.
4. Restart with current sidecar. Retired keys remain disabled/tombstoned. New
   gaps and maintenance remain blocked. Missing/mismatched artifacts stay
   blocked; do not initialize a new clean sidecar to make startup succeed.
5. Audit/reconcile global and key gaps with explicit reason/evidence, generation
   CAS and idempotent operation ID. Gap acknowledgement occurs only after the
   database audit is durably committed. Failure or crash before acknowledgement
   remains blocked and replayable. A stale recovery never clears a newer gap.
6. Separately audit/release maintenance. This does **not** clear coverage gaps.
   The storage primitive now atomically retains a target-specific acknowledgement
   with the sidecar release after committing its audit. Receipt replay requires
   both the original audit and matching coverage/generation/payload acknowledgement;
   `maintenance === null` alone is never proof. A historical receipt does not clear
   or certify newer maintenance. Legacy completed releases without this ACK cannot
   be retrofitted. HTTP release exposure remains deferred pending acceptance.
   History is bounded to 1,000 releases and never pruned: capacity denies a new
   release before writing its audit, while exact historical replay remains allowed.
   There is currently no certified rotation/archival operation for a full history;
   retain all artifacts and remain blocked rather than delete receipts.
   Only then consider production admission after all health/coverage checks.

V1 does **not** automatically detect an out-of-band rollback of both database
and sidecar. Copying an old SQLite file over a live writer is unsupported.
Downgrade requires stopping the writer; do not allow an older binary to write
coverage or perform management recovery if it may discard acknowledgement history.
Read-only offline export/inspection is the only permitted older-binary use here,
not inference or sidecar mutation. No downgrade compatibility is certified. If legacy inference occurred,
record and reconcile a coverage gap before re-enabling budgeted traffic.

## Inactive management preparation

The Endpoint key manager includes a **Budget / accounting** panel keyed only by
stable ID. It explicitly reports enforcement **OFF**, recorded reference spend,
window resets, pending/unresolved attempts and coverage gaps. Valid non-null
limits are rejected with `accounting_not_ready`; the panel does not advertise
protection. Saving unlimited policy limits does not erase spending.

Privileged prepared routes are GET/PUT `/api/keys/[id]/budget`, GET
`/api/keys/[id]/accounting`, GET `/api/keys/[id]/usage`, POST
`/api/keys/[id]/accounting/[attemptId]/resolve` and POST
`/api/keys/[id]/accounting/gaps/resolve`. These require an authenticated dashboard
session or verified direct-loopback peer with login disabled, not a gateway API
key or caller-supplied Host alone. Mutations require exact Origin/Host matching;
reverse proxies rewriting the origin need `NINEROUTER_MANAGEMENT_ORIGIN`.
Maintenance permits diagnostics but denies these mutations. Error responses
are sanitized and no-store. No privileged HTTP activation is provided.

Recovery requires explicit actor/reason/evidence, expected version and an
idempotent operation ID. Exact usage is charged from the original stored price,
not the current editor price. Missing usage remains unknown until exact evidence,
explicit waiver or audited cost correction. A key-scoped gap waiver cannot clear
a global gap or release maintenance. Analytics projection failure after durable
recovery does not undo the charge/correction; bounded replay can repair it.

The panel retains an ambiguous recovery's unchanged payload/version/operation
ID in tab-local sessionStorage **before** sending it. Retry is explicit, never
automatic; do not issue a different correction because an acknowledgement was
lost. User-entered reason/evidence may be sensitive: do not include credentials,
request prompts or secrets. Closing/reopening in the same tab preserves retry;
clearing storage or changing tabs loses this local recovery contract. Verify
authoritative state/audit before reconstructing an operation. Recovery success
followed by refresh failure is not a failed recovery. A parseable successful
HTTP response alone is not an acknowledgement: the panel requires a committed
operation/key/target/action/version-bound receipt before clearing retained state.
Manual correction and waiver amounts are matched to the submitted operation.
For exact-usage recovery, the receipt's amount is server-authoritative, computed
from the committed audit's original stored price snapshot; the client validates
operation identity and decimal format, not an independently calculated charge.
Gap receipts additionally require the durable sidecar acknowledgement after the
DB audit. Empty or mismatched receipts leave the unchanged operation pending.

Usage breakdowns are **page-scoped**, use stored ledger charges, and expose
known cost separately from a null total when pending/unresolved cost is unknown.
Pricing coverage is opt-in, revision-pinned and based on effective precedence;
`virtualReference:true` / `usageCertified:false` do not certify a provider bill
or raw usage extractor. Models.dev batches with rates beyond nine decimals are
rejected unchanged; last-good remains, with no rounding or pruning.

### Pricing management and snapshot cache

Pricing CRUD, sync/schedule and coverage use the route-level management boundary:
a dashboard session or verified direct loopback with login disabled. Gateway/CLI
inference credentials and anonymous remote requests are not management authority.
Mutations require the trusted same-origin/explicitly configured management Origin;
responses are `no-store`. Proxy deployments must configure
`NINEROUTER_MANAGEMENT_ORIGIN` rather than trusting forwarded Host/Origin input.

Manual sync takes no query or payload: an empty framework body stream is checked
for bounded EOF, while any actual byte is rejected before the fixed-source fetch.
The pricing scheduler defaults off. The serving Node instrumentation hook restores
only an acknowledged opt-in schedule (not broad app bootstrap); build phases skip
it. Startup never immediately fetches, and the 24-hour interval starts when the
process configures the timer. Status reads remain observational; configured and
running are separate states, including when startup health/ownership checks fail.

Reference snapshots are immutable and memoized by adapter lifetime, committed
pricing revision, mapping revision and exact provider/model/endpoint. SQLite kv
triggers advance `referencePricingRevision` for manual/catalog mutations, including
configuration import; unrelated sync status writes do not reprice snapshots.
Health loss/reopen invalidates the memo. Transaction-local or unflushed SQL.js
reads are not cached as committed authority. Existing attempts retain their
original snapshot; no inference request fetches the catalog. This cache is not
an allowance/spend counter or a response-cache engine.

These prepared surfaces still require interaction/regression/security acceptance;
see the pricing and budget-service evidence reports for revision-bound results.

## Verification status

Implementation evidence and unresolved gates are tracked in
`plans/261003-0827-api-key-quota-budget-pricing/reports/implementation-evidence.md`.
Node SQLite and SQL.js have focused evidence; Bun and better-sqlite3 runtime
coverage is pending. SIGKILL tests demonstrate process-crash behavior, **not**
power-loss durability. No complete-feature or full no-regression claim is made.

The regression comparator now fails incomplete collection/runtime/report integrity
with exit 2 and new assertion failures with exit 1. Known assertion-only failures
may compare with exit 0; a historical missing-cloud collection error is still
incomplete, not green. For bounded runs supply an exact selected-file manifest:

```sh
node tests/__baseline__/verify-no-regression.mjs results.json scope.json
# scope.json: {"files":["tests/unit/example.test.js"]}
```

Without a manifest, exit 0 certifies only assertions present in the supplied
report. With one, missing/extra/skipped-only file targets block acceptance, but
assertion-level skips and explicitly omitted suites remain scope limitations.
Comparator fixture acceptance and the full release gate are tracked separately
in `reports/comparator-evidence.md` under the implementation plan.
