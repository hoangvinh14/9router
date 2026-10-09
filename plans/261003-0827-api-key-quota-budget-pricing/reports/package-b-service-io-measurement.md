# Package B service-only I/O measurement — not performance acceptance

## Receipt and declared workload

`b9e413eaa` completed exit0: **8/8 paired cases, 1 explicit-only fixture file, no skips**, TEST/LINT/WHITESPACE_EXIT0. Artifacts: `/tmp/9router-accounting-service-io-measure-n7Z8fw/{results,measurement}.json`, `verbose.txt`, `lint.txt`, `whitespace.txt`.

`tests/unit/accounting-group-io-benchmark.fixture.js`, run with `tests/helpers/accounting-benchmark.vitest.config.js`, deliberately stays outside ordinary suite discovery. Sixteen measured scenarios: synchronous and queued service for NodeSQLite/SQL.js, history0/256 settled attempts, width1/16, 64 new attempts per mode. Each scenario has a fresh owned disposable DB, two alternating keys, fixed exact1M input tokens and rates1/2, both weekly/monthly policies10000USD, fixed clock, no-op analytics in both modes. Setup/seeding excluded; resolver warmed. Mode order alternates across cases, **one sample each**, same live process and filesystem; this is not replicated statistical matching or deployment traffic simulation.

Predeclared invariant checks passed: each ledger is exactly settled with separate per-key counts, cost1,000,000,000nanoUSD per attempt, healthy storage, matching final sums. Empty history final64,000,000,000nanoUSD; history256 final320,000,000,000nanoUSD. Sync has128 successful outer durable calls per64 attempts; queued width1 also128; queued width16 has8. SQL.js image publications equal commit count. No production activation, live provider, routing change, spend cache, database change or weakened fsync/PRAGMA.

## Observed results

Times are milliseconds. Admission/terminal percentiles measure each call through its own returned ACK; queued time includes waiting behind same-turn peers. Sync operations run sequentially, so **sync per-call latency excludes time spent behind earlier calls before invocation**. They are not equivalent end-user arrival-to-completion percentiles. Total finite workload elapsed is comparable within the stated sequential/burst fixture, with the order/warm-process confounds above.

| Adapter | History | Width | Elapsed sync → queued | Durable calls | Admission p95 sync → queued | Terminal p95 sync → queued |
|---|---:|---:|---:|---:|---:|---:|
| NodeSQLite | 0 | 1 | 888.9 → 1626.8 |128 →128|11.4 →26.2|9.5 →13.4|
| NodeSQLite | 0 | 16 |598.6 →708.8|128 →8|6.9 →130.8|6.2 →54.6|
| NodeSQLite |256|1|868.0 →1322.0|128 →128|12.5 →20.7|6.6 →8.6|
| NodeSQLite |256|16|1020.8 →913.8|128 →8|16.4 →184.8|7.9 →55.3|
| SQL.js |0|1|2057.7 →2932.6|128 →128|24.4 →39.0|21.3 →31.9|
| SQL.js |0|16|3092.4 →1222.7|128 →8|84.3 →253.8|39.9 →140.5|
| SQL.js |256|1|3588.5 →4221.1|128 →128|69.9 →57.9|43.5 →38.6|
| SQL.js |256|16|3211.7 →1721.8|128 →8|53.0 →349.3|30.4 →135.6|

SQL.js successful published image bytes:

| History | Width | Sync bytes | Queued bytes |
|---|---:|---:|---:|
|0|1|35,356,672|35,356,672|
|0|16|35,512,320|2,244,608|
|256|1|73,654,272|73,654,272|
|256|16|73,908,224|4,644,864|

Burst commit/publication count reduction is **93.75%**, with image bytes about93.7% less. These are adapter publication bytes, **not native WAL/checkpoint/fsync counts or system-wide physical disk writes**. SQL.js burst elapsed ratios queued/sync0.395/0.536; Node0.0-history burst1.184 (slower), history256 burst0.895 (faster). Width1 elapsed ratios queued/sync1.830/1.523 Node and1.425/1.176 SQL.js: all slower, no commit reduction. Do not report a universal throughput win or hide low-load overhead.

Raw artifact includes CPU user/system, p50/p95/p99, throughput, and RSS endpoints. CPU is mixed/not monotonic improvement. RSS endpoints rise through the shared process and are not peak heap/queue-retained bytes. Event-loop delay often has **no sample**; available samples mostly reflect an entire synchronous/microtask workload stall (roughly0.6–3.6s), not a reliable distribution or evidence of fair event-loop scheduling. No zero-delay claim from unsampled0max. Fixture promises/microtasks do not simulate independent request arrival or sustained production load.

## Status and next bounded diagnostic

This proves matched **scoped ledger outcomes and commit/image reduction**, not latency/throughput acceptance. Deployment thresholds remain unsettled. It does not authorize switching app handlers to queued, enlarging thresholds, timer batching, skipping fresh gates, weakening ACK/health/ownership/sidecar checks, or adding spend cache.

Diagnostic `b5da2ea8d` **PASS8/8pairedcases/no skips**, TEST/LINT/WHITESPACE_EXIT0, `/tmp/9router-accounting-service-read-diagnostic-M0mFIa/{results,measurement}.json`. Same workload plus get/all SQL-text-only(no params), health and coverage.status counters; timings are inclusive/overlapping and add instrumentation overhead, **not substituted for the original performance receipt**. Both adapters show the same structural count pattern per64attempts:

| Counter | Sync | Queued width1 | Queued width16 |
|---|---:|---:|---:|
| coverage.status |384|576|576|
| health |640|1088|968|
| get, empty history |1218|2112|1992|
| get, history256 |1216|2110|1990|
| all |192|384|384|
| spend-window SELECTs (subset of all) |128|256|256|
| _meta value SELECTs (subset of get) |576|832|832|
| original attempt SELECTs (subset of get) |320|320|320|
| policy SELECTs (subset of get) |128|192|192|

Source read of service.js confirms enqueue monetary capture uses gate/price/binding, then fresh dequeue repeats gate/price/binding and request/wire authority when supplied. Terminal re-reads original persisted snapshot at dequeue. Burst grouping reduces durable calls, **not freshness checks**. Coverage and metadata reads dominate several inclusive counter timings; spend-window reads grow with history. Inclusive coverage time contains nested adapter reads, so summing these would double-count. Counters do not prove which health/schema/owner check can safely be eliminated; no production optimization, derived spend-cache or authority reuse is approved from this observation. Required later: replicated fresh-process order-balanced measurements, arrival-to-ACK latency, isolated queue-delay/retained peak costs, sustained/low/burst workload, genuinely large ledger, all applicable adapters, production analytics, app/wire and full runtime/build/browser regression. Exact safety and all13AC remain mandatory; B open and enforcement OFF.
