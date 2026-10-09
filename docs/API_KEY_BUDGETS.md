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
