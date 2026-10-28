# Durable chat accounting: preparation and execution receipt

Invocation: `ak-cook --auto plans/261018-0213-durable-chat-accounting/plan.md`.
Source: `4cb4f80ecc5f629cd7d08c2167a443892ad38f2f`; working branch
`feat/durable-chat-accounting`, based on `develop`. Environment: Linux,
Node `v24.21.0`, npm `11.19.0`, Asia/Ho_Chi_Minh; report language English.

## Outcome and boundary

Execute the existing P3 contract: actual app/core/Base JSON and SSE dispatch,
own intent and terminal acknowledgements, raw exact usage including provider
prompt cache, original price and restart evidence. Preserve auth, ACL, proxy,
abort, retry and empty-content fallback behavior. Public activation,
`ledgerStartedAt`, live inference/data, budgets UI, other provider families and
Git publication are outside this delivery.

The supplied plan contains only a preparation phase. Existing uncommitted
cache requirements and the earlier brainstorm are retained. No stash is applied.
The source in `d515fb4927ed45a5853104406cd0fecca549c04c` is an unaccepted
candidate; its test names and implementation are evidence for cases to port,
not evidence that current P3 works.

## Bounded baseline protocol

Hypothesis: current P2 own-ACK/exact-money primitives and the selected Base,
proxy, key-access and account-fallback consumers pass independently before
introducing P3 hooks. Expected observation: all named existing tests pass with
disposable accounting databases and no live upstream. One invocation, 90-second
wall bound, no server/watchers, no prewarm or timeout increase. A failure is
retained and classified before any retry; baseline green cannot establish P3
dispatch, cache mapping, SSE terminal or unlimited-continuation acceptance.

Command (repository root):

```sh
timeout 90s env DATA_DIR=/tmp/9router-p3-baseline-261023 npm --prefix tests test -- unit/accounting-coordinator.test.js unit/accounting-ledger.test.js unit/accounting-exact-money.test.js unit/accounting-coverage.test.js unit/base-executor-retry.test.js unit/antigravity-retry-hook.test.js unit/strict-proxy-enforcement.test.js unit/qoder-proxy-replay.test.js unit/key-access.test.js unit/key-access-handlers.test.js unit/account-fallback-4xx.test.js
```

Result: exit 1; 10 files passed, one failed; 165 tests passed, one failed in
23.78 seconds (Vitest `4.1.11`). The first `qoder-proxy-replay` case hit its
existing 5-second test timeout. The failure includes dynamic executor import
and first lazy proxy-dispatcher import, under eleven-file parallel transform
load (35.79 seconds aggregate transform, 44.52 seconds aggregate import).
This is a red baseline, not a P3 regression: runtime source is unchanged.
Raw output: `/tmp/9router-p3-baseline-261023.log`. No result is inherited from
P2's historical receipt.

One follow-up diagnostic changes the workload to **only** the existing Qoder
file: hypothesis is import contention, not proxy replay behavior. Expected
observation: six cases pass within unchanged 5-second per-test limits. Bound:
one 30-second invocation; no prewarm, source edit, increased timeout or repeat
matrix. A pass only establishes this isolated control, not an all-green combined
baseline; failure ends this diagnostic as inconclusive.

```sh
timeout 30s env DATA_DIR=/tmp/9router-p3-qoder-261023 npm --prefix tests test -- unit/qoder-proxy-replay.test.js
```

Result: six passed in 5.66 seconds, with unchanged five-second limits.
This isolated control does not replace the red combined baseline. Raw output:
`/tmp/9router-p3-qoder-261023.log`.

## Confirmed preparation constraint

`src/lib/accounting/service.js` checks `db.health().healthy` before admission
and completion. Its callback is a required synchronous fresh-authority
capability; it does not classify unlimited keys or authorize continuation.
`src/lib/db/accounting-coverage.js` can independently latch a gap, but that
acknowledgement alone does not prove current policy, identity, schema or route.
`src/lib/db/adapters/sqljsAdapter.js` deliberately refuses `get/all` through
`assertHealthy` after uncertain persistence. At initial inspection the schema
had no budget-policy table, and source had no persisted request/selection proof
module. The subsequent candidate adds policy and reader primitives only.

The accepted unlimited exception therefore cannot be implemented by treating
unrestricted ACL as unlimited, reading failed RAM, reusing a gap-status return
as dispatch permission or making recording failure permanently fail closed.
A scoped policy/current-persisted-authority prerequisite is required alongside
the transport prerequisite. The preparation phase explicitly requires stopping
when runtime/protocol dependencies remain unclear. Writer topology and authority
were assessed before adding the named prerequisite.

The user selected the narrow classifier plus read-only persisted proof. The
[prerequisite design](./planner-261023-1430-p3-authority-prerequisite.md) found
that adapter-private deny-only fingerprints can preserve freshness without a
new writer. The roadmap's writer-authority stop clause applies to P1's dependency
check, not a blanket P3 prohibition. There is no remaining product decision.

## Prerequisite first verification

The named [prerequisite](../261023-0739-p3-chat-dispatch-prerequisites/plan.md)
now has initial policy/adapter implementation. One focused run of
`accounting-policy-classification.test.js` and
`accounting-persisted-authority.test.js`, bounded to 120 seconds, returned
15 passes and two existing-5-second-timeout failures in 18.38 seconds. Both
failures were Node cases: old-policy-schema refusal (5068 ms) and pre-release
publication failure (5471 ms). There was no assertion mismatch or SQLITE_BUSY
in the output. Raw log: `/tmp/9router-p3-prerequisite-261023.log`.

The cook failed-verification counsel checkpoint ran before further edits or
diagnosis. Counsel found no retained native reader across savepoint/commit in
source and distinct fixture directories; timing alone cannot distinguish
filesystem latency from SQLite locking (busy_timeout is also five seconds).

One diagnostic traced only sync/lock/open/close syscall names, paths and
durations, without payloads. Hypothesis: fsync latency versus SQLite lock wait;
expected evidence: slow syncs or repeated failed fcntl attempts with sleeps,
attributable to fixture files. Bound: one 120-second run, unchanged workload,
concurrency and five-second per-test limits, with no prewarm. Tracing pass is
not replacement acceptance; if neither cause is established, stop the
diagnostic as inconclusive. No deadline, freshness or durability guard is relaxed.

```sh
timeout --kill-after=5s 120s strace -ff -ttt -T -yy -e trace=fsync,fdatasync,fcntl,nanosleep,clock_nanosleep,openat,close -o /tmp/9router-p3-prerequisite-261023-syscalls env DATA_DIR=/tmp/9router-p3-prerequisite-261023 npm --prefix tests test -- unit/accounting-policy-classification.test.js unit/accounting-persisted-authority.test.js > /tmp/9router-p3-prerequisite-261023-diagnostic.log 2>&1
```

Result: 13 passed and four timed out, exit 1, in 35.00 seconds. Tracing
required sandbox escalation. Across the recorded processes, 8197 `fcntl`
calls had no failed lock attempts; 527 fsyncs took 4.703 seconds in aggregate,
with a maximum of 0.615 seconds. Slow syncs were observed, but the full cause
of the timeouts remains inconclusive. Tracing changes execution overhead and
does not establish a replacement acceptance result. Logs and syscall traces
remain under the `/tmp/9router-p3-prerequisite-261023-*` paths above.

Execution stopped before transport/JSON/SSE under the finite protocol. No
deadline, concurrency, durability or freshness guard was changed. No broad
affected suite, build, proof performance or actual POST acceptance was reached.
No server or watcher was started, and the bounded runners completed.

## Review and resumed work

Syntax passed for all 15 changed/new JavaScript files on October 23. The first
lint invocation was blocked before execution by a context hook; a subsequent
npm-based lint process had no recoverable completion receipt after session
resume. Neither was counted as lint acceptance.

The user resumed work on October 26. A scoped inline source review found that
adapter engine-close failure did not invalidate a retained recording-failure
proof. The installed lifecycle already refuses close while poisoned; the
repair also makes the adapter-only boundary deny after a failing engine close.
This source change and its current verification are recorded in the
[continuation receipt](./implementation-261026-1757-durable-chat-accounting.md).
Historical red results remain part of this receipt.
