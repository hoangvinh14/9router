# Chat lifecycle execution — 2026-10-27

This record continues the [accepted execution design](../261018-0213-durable-chat-accounting/design-preparation.md)
on `feat/durable-chat-accounting`, base `4cb4f80ecc5f629cd7d08c2167a443892ad38f2f`.
The user invoked cook `--auto`, approved narrow explicit policy classification
and persisted authority, and requested continued completion. No commit, push,
merge, production activation, live database mutation or external inference was
performed. The two named prerequisites are accepted in the
[persisted-authority](./implementation-261027-0850-persisted-authority.md) and
[transport](./implementation-261027-0903-transport-boundary.md) receipts.

## Result and boundary

The actual app→core→Default/Base→native localhost→ledger path now owns JSON
and SSE attempts. A private fixture WeakMap is the only activation route;
client fields and environment cannot enable production accounting. Stable key,
explicit policy, ACL, route, credentials, proxy and schema authority are checked
at the owned boundaries. Every actual POST requires its own delivered intent
ACK, a final persisted proof and synchronous single-use dispatch consumption.
Accounting refusal escapes retry, refresh, cooldown and combo catches.

Raw JSON is bounded and read once before translation, replayed after its own
terminal ACK. The strict explicit-details profile maps cache reads and included
reasoning into the existing exact-money calculation and original snapshot.
Unsupported cache-write declarations invalidate exact evidence; zero write/tier
counts are limited to this profile. Missing or conflicting usage stays unknown
with null cost. Failed HTTP exact usage is charged before ordinary fallback.

SSE uses one incremental fatal UTF-8 reader with bounded frame/terminal state.
Deltas may pass; mixed delta/finish events are split. Finish and DONE require
complete usage, protocol completion and own terminal ACK. Already-read trailing
evidence is rejected at DONE; the reader is cancelled without an unbounded
drain. EOF/stall/cancel/failed ACK errors the wrapper, so existing native error
terminal formatting runs without a successful translator flush. Raw-byte
activity, rather than emitted frame activity, feeds the unchanged stall
watchdog; protocol completion clears that timer while awaiting the ACK.

Healthy checks use fresh owned reads plus schema verification; every native
POST still requires a persisted proof. Degraded checks always use the verified
read-only persisted path. Continuation needs explicit unlimited policy and the
independent delivered sidecar gap ACK. Ordinary poisoned getters and writer
exclusion remain intact. Account-failure metadata changes are acknowledged only
when their exact expected projection matches; unrelated changes deny successors.
Receipt sinks survive app/context disposal for late exact usage and conflict
handling.

## Functional evidence

All actual-flow suites use disposable actual Node SQLite and SQL.js adapters,
backups before mutations and real localhost/proxy POST counters. Commands use
`npm --prefix tests test -- <named files>` with 120-second process bounds and
unchanged per-test limits. Source was one serial owner.

| Verification | Result / receipt |
|---|---|
| JSON raw normalization/cache price | 17 passed; `/tmp/9router-p3-json-normalization-261027.log` |
| JSON expanded app flow | 76 passed; `/tmp/9router-p3-json-controls-261027.log` |
| Native truncated JSON, both adapters | 2 passed; `/tmp/9router-p3-json-truncated-261027.log` |
| SSE parser, ACK barrier, UTF-8, CRLF/multiline, duplicates/conflicts/EOF/bounds | 19 passed; `/tmp/9router-p3-sse-parser-repaired-261027.log` |
| Parser plus raw-byte watchdog and stall cleanup | 21 passed; `/tmp/9router-p3-sse-watchdog-261027.log` |
| SSE actual app/cache/reopen/ACK/drift/proxy/two-key/abort | 32 passed; `/tmp/9router-p3-sse-loopback-261027.log` |
| SSE plus abort during ACK, fresh degraded unlimited/gap ACK, lost intent, oversized frame | 40 passed; `/tmp/9router-p3-sse-controls-261027.log` |
| Accounting coordinator/ledger/exact-money/coverage/identity/import/lifecycle/migration, native abort terminal, completed Responses usage, golden response stream | 100 passed in 11 files; `/tmp/9router-p3-final-foundation-261027.log` |
| Affected request authority, Base retry/Antigravity hook, strict proxy/Qoder replay, key access/handlers, account fallback and combos | 151 passed, 2 verified baseline mismatches; `/tmp/9router-p3-json-affected-261027.log` |

Cache matrix observes no-hit, partial/full cached reads, distinct/zero/absent
cached rates, original-rate drift and reopened costs. Expected nanoUSD values
are 1200000/900000/450000/800000/1200000. Tests assert normalized raw counters,
null costs on unknown evidence and absence of `ledgerStartedAt` after reopen.
JSON covers own held/lost intent/terminal/gap delivery, schema/config drift,
actual account/combo successors, local refusal isolation, shared-executor keys,
late duplicate/conflict receipts and restart recovery. SSE reuses that admission
owner and separately proves actual successful direct/proxy/degraded streams,
terminal gating and cancellation.

The two unchanged `combo-autoswitch.test.js` failures were compared with exact
base `4cb4f80`: line42 expects search detection that baseline disables; line71
expects the same array reference although baseline returns an equal new sorted
array. Neither production behavior nor assertions were changed to hide them.
These are reported baseline limitations, not a green affected-suite claim.

## Red history and cause-aligned repairs

Cook failed-verification counsel preceded diagnosis/repair. No deadlines,
concurrency, durability or fresh authority guards were relaxed.

1. First app loopback: 36 failed/8 passed. Property-order-dependent equality,
   omitted combo callback capability and missing returned binding were repaired
   with semantic comparison and forwarding; next run44 passed.
2. Expanded successor controls:54 passed/4 failed. Fixture empty content needed
   the actual incomplete finish trigger; generic400 does not account-fallback.
   Controls now exercise real incomplete content and account-credit402; routing
   classifiers stay unchanged. Exact owned metadata uses semantic equality.
3. Node account successor:61 passed/1 failed. Native rows use null prototypes;
   symmetric structured clones preserve semantic exact-delta comparison.
4. A403 control legitimately invoked three existing OAuth refresh waits and hit
   the unchanged5s test bound. Actual account-credit402 isolates the intended
   account successor, with2/2 passing. Accepted app flow then62 passed and later76.
5. Initial SSE generator invocation used unavailable `python`; Vitest found no
   test file. Available `python3` generated the file in a separate successful
   command. This was an invocation failure, not parser evidence.
6. Fragment fixture advanced beyond EOF and produced infinite empty chunks.
   The120s process bound stopped the run after two passing cases. Clamp final
   advancement and use EOF >= length; narrow4 fragment cases and then19/21
   parser cases passed. Parser limits and deadlines were unchanged.
7. Native measurement import preflight exposed aliased directory resolution
   (`@/models`), then CommonJS named exports from `node-machine-id`. Fixture-only
   loader/index resolution and an interop shim forwarding the real package
   functions repaired both. The successful import preflight made zero POSTs and
   did not prewarm the measured process. Production imports were unchanged.

## Review and final gates

The independent JSON read-only review found no confirmed security/correctness
issue, and identified missing oversized/truncated/abort controls; these were
added and passed. The cook live-diff simplify gate ran read-only across the
JSON/SSE owners because source ownership remains serial. It found no meaningful
behavior-preserving simplification. It identified missing null-body205 replay;
that was repaired alongside204/304, retaining unknown evidence. No simplifier
edits were applied. `git diff --check` is clean. Final replay controls, lint,
build and measurement results are appended below after completion.

## Finite measurement

[Machine receipt](./measurement-261027-chat-accounting.json) and
[runner](../../tests/fixtures/accounting/measure-chat-accounting.mjs) retain the
workload and reached cells. The plan specifies24 distinct cells and100 requests
per cell, but also4800 total. Two fully measured repetitions reconcile those
figures; there is no warmup or discarded first run. JSON/SSE × off/on ×
Node/SQL.js × concurrency1/4/16, fixed hello payload plus fixed-width trace user,
fixed raw cache usage and rates, actual app/native localhost, observability
consistently disabled. Analytics, admission guards and deadlines are unchanged.
Cold module import and fixture setup are reported separately. Queue samples
are explicitly observed at own ACK, not claimed exact peak queue telemetry.
Commit groups count actual ledger mutation members inside successful durable
transactions; each completed cell reopens its adapter and checks exact cost,
usage, identity and absent activation. Only the external300s bound stops the
run; no changed deadline, prewarm or numeric overhead threshold is invented.

## Measurement termination and reached results

The single run exited124 at its300-second external bound. The unmodified machine receipt contains1600 completed requests in16 cells, all16 reopened and verified. Cell17 (first repetition, SQL.js JSON on, concurrency4) was initialized without persisted sample results; its actual completed count is unknown. The remaining3200 planned requests have no completed receipt evidence. No second run or performance diagnostic was started. Combined acceptance remains **unaccepted**.

The runner did not save its final failure/elapsed/resource stanza. Timeout is not successful cleanup evidence. A subsequent escalated host-process check for the exact measurement Node/timeout command returned no surviving process. The empty attributable data root `/tmp/9router-chat-measure-sndj5S` and one attributable fixture artifact `/tmp/9router-accounting-7eI8XN` were inspected; the latter has no writer lock and is retained as an unfinished-run artifact. No prefix-wide deletion, replacement writer or owner-record removal was performed. Raw receipt and log are unchanged.

| Engine | Protocol | Accounting | Concurrency | Total p50/p95 ms | TTFT p95 ms | Terminal delay p95 ms | Requests/s | Ledger commit groups |
|---|---|---|---|---|---|---|---|---|
| node | json | off | 1 | 47.4/101.2 | 101.1 | 5.9 | 17.05 | 0 |
| node | json | off | 4 | 195.5/458.3 | 458.3 | 64.1 | 17.14 | 0 |
| node | json | off | 16 | 572.8/3411.5 | 3411.5 | 255.1 | 15.41 | 0 |
| node | json | on | 1 | 247.1/497.8 | 497.8 | 177.0 | 3.27 | 200 |
| node | json | on | 4 | 942.2/1347.7 | 1347.7 | 352.2 | 4.18 | 200 |
| node | json | on | 16 | 3743.1/16657.0 | 16657.0 | 1913.5 | 3.23 | 200 |
| node | sse | off | 1 | 42.5/173.4 | 171.5 | 4.9 | 16.39 | 0 |
| node | sse | off | 4 | 176.9/287.7 | 286.4 | 65.7 | 19.81 | 0 |
| node | sse | off | 16 | 723.3/2983.5 | 2981.3 | 321.8 | 16.41 | 0 |
| node | sse | on | 1 | 232.3/415.8 | 411.8 | 78.0 | 3.91 | 200 |
| node | sse | on | 4 | 821.0/2595.8 | 2594.1 | 474.6 | 3.69 | 200 |
| node | sse | on | 16 | 2528.1/14387.7 | 14386.3 | 1241.6 | 4.16 | 200 |
| sqljs | json | off | 1 | 47.6/162.5 | 162.5 | 3.4 | 15.41 | 0 |
| sqljs | json | off | 4 | 191.1/266.7 | 266.7 | 69.7 | 15.55 | 0 |
| sqljs | json | off | 16 | 419.2/2574.7 | 2574.6 | 267.8 | 16.32 | 0 |
| sqljs | json | on | 1 | 322.2/828.5 | 828.5 | 125.2 | 2.49 | 200 |

Cold native module import was1812.6ms. Cold fixture timings, observed queue sizes, actual group members and reopened controls remain in the machine receipt. No missing cell is extrapolated, no overhead threshold is invented, and no authority/durability guard was removed to fit the bound. Independent final lint/build checks continue separately from this stopped measurement phase.

## Final independent gates and disposition

- Final raw normalization/cache/replay: **20 passed**, including native null-body
  HTTP 204/205/304 (`/tmp/9router-p3-json-replay-261027.log`).
- Canonical Default/OpenAI URL, bearer/no-key headers, untouched native body
  ownership and compatible-node chat/responses selection: **14 passed in 2
  files** (`/tmp/9router-p3-default-compatibility-261027.log`). These regression
  controls intercept the network layer; actual localhost positives remain
  separate evidence.
- Final 30-module integration/fixture lint and canonical Default test lint:
  **exit 0** (`/tmp/9router-p3-chat-final-lint-261027.log`,
  `/tmp/9router-p3-default-lint-261027.log`). Relative documentation links and
  `git diff --check` are valid.
- Build command:
  `timeout --kill-after=10s 300s env DATA_DIR=/tmp/9router-p3-chat-build-261027 NEXT_DIST_DIR=.next-chat-accounting-261027 npm run build`.
  It exited **124** at the bound. Next 16.3.8/webpack only reached
  `Creating an optimized production build ...`; diagnostics identify
  `buildStage: compile`. No `BUILD_ID` or standalone completion artifact exists.
  No compiler error was reported, and no evidence establishes a font, network
  or source defect. The isolated output, trace, diagnostics and log are retained.
  Postbuild/startup smoke was not reached. No speculative repair or rerun was
  made after failed-verification counsel.
- Host-visible reconciliation found no measurement Node/timeout command and no
  process carrying both this build's exact `NEXT_DIST_DIR` and `DATA_DIR`.
  Process cleanup is verified for these invocations; that does not manufacture
  the missing measurement finalizer/cleanup stanza.

**P3 remains in progress and combined acceptance is unaccepted.** Functional
JSON/SSE implementation is reviewable; build completion and the full 4800-request
measurement are unverified. The accepted finite protocol stopped these runs;
no deadline, concurrency, authority proof or durability guard was weakened.
Further verification needs a separately bounded approach. Missing results
cannot be extrapolated or marked complete. Broader providers/transports,
Bun/better/Windows accounting, budgets and release/activation retain their
existing owners. No commit/push/merge, production opt-in or activation metadata
was introduced.
