# Chat accounting acceptance continuation

This record continues the [original receipt](./implementation-261027-chat-lifecycle.md)
and [diagnosis](./debugger-261027-1324-chat-acceptance.md). The user authorized
completion and explicitly raised only the measurement wall bound to 1200
seconds. Production activation, budgets and release remain outside this work.

## Functional closure

Fresh selected JSON/SSE controls passed **159 tests** on actual Node SQLite
and SQL.js, with native localhost POSTs. Named affected consumers passed **126
tests in 11 files**; foundation passed 78 and authority/coverage passed 79.
The 53 changed/new JS modules passed lint. Sources and deadlines are retained
in `/tmp/9router-p3-chat-final-controls.log`,
`/tmp/9router-p3-consumers-1342.log`, `/tmp/9router-p3-foundation-final.log`,
`/tmp/9router-p3-identity-batch.log` and
`/tmp/9router-p3-final-lint-1342.log`. The separate harness cleanup patch also
passed its focused lint. Two earlier unrelated combo-autoswitch assertions
were reproduced on the exact base and remain historical baseline failures.

Independent acceptance review found additional evidence gaps. The new
`chat-accounting-final-controls.test.js` passed **26 tests in 57.12 seconds**
with unchanged test limits and production retry delays. It proves actual
post-dispatch terminal publication failure followed by held/lost independent
gap ACK, key-specific gap/binding isolation after reopen, exact HTTP 503
settlement before native retry, network-reset unresolved predecessor before
retry, concurrent unknown/null-cost and known-key rows after reopen, and late
exact settlement after duplicate/conflicting callbacks with the original
snapshot retained through price drift. Native one-byte UTF-8/CRLF/multiline
SSE writes complement deterministic parser split controls; TCP receive chunk
boundaries are not asserted. Read-only independent review found no blocking
defect. Logs: `/tmp/9router-p3-additional-controls.log`; focused lint is separate.

The selected Default compatible-chat profile uses API-key authentication and
one URL. OAuth refresh and multi-URL fallback are not claimed as selected-profile
exact-usage acceptance. Their broader per-POST ownership remains covered by
native prerequisite controls and owned by the transport inventory. A network
reset before headers provides unknown usage, not fabricated exact evidence.
Injected storage failure can also refuse ordinary analytics writes; test logs
retain those errors. Some fixture-close logs observe existing unawaited
analytics after ownership release; successful accounting assertions do not
certify those analytics writes.

## Complete finite measurement

[Raw receipt](./measurement-261027-1342-chat-accounting.json): **4800 requests,
48 completed/reopened cells, 662.977 seconds, exit 0**. Each of 24 distinct
JSON/SSE × off/on × Node/SQL.js × concurrency 1/4/16 cells has two measured
100-request repetitions, no warmup/discard. Cold module import was 1587.2ms;
fixture setup is reported per cell. Workload, native upstream, request
deadlines, observability setting, analytics, authority and durability guards
were unchanged. The original partial 300-second receipt is preserved.

Every cell observed 100 native POSTs and reopened the actual adapter. All 2400
accounting rows were settled at 900000 nanoUSD with cacheRead=400; off cells
had zero accounting rows. All checked activation markers were absent. Every
accounting lane ended with zero queued members/bytes and no poison. Observed
queue high-water at ACK was zero; this sampling does not establish the true
peak between ACKs. Instrumentation counted 4800 ledger-associated durable
groups, 2400 intent INSERT statements and 2424 terminal-pattern UPDATE
statements. These are matched statements inside completed transactions,
including possible zero-row UPDATEs, not extra debits or successful-transition
counts. Exactly 2400 settled rows were verified.

Cleanup independently closed fixture/default adapters, removed disposable
data and exited normally without a cleanup failure. The pre-exit resource
snapshot lists closing network handles; it is not a zero-handle observation.
The receipt retains one suppressed `console.error` count without its text;
this does not invalidate checked ledger invariants or establish an error-free
run. A separate eight-request diagnostic passed all eight combinations and
reopen/cleanup controls in 8.367 seconds. It captured exactly one console-error
entry during fixture setup: Node's `MODULE_TYPELESS_PACKAGE_JSON` warning when
loading the existing ESM source under a package without a module type. No
application error was captured. This reproduces a warning consistent with the
count; the original suppressed text cannot be recovered with certainty.
Artifacts: `/tmp/9router-p3-error-diagnostic.json` and
`/tmp/9router-p3-error-diagnostic.log`. It does not replace the full receipt.
No numeric overhead threshold was agreed.

## Build and remaining gates

Six host-path fixture tests and their six-module lint passed. The initial
fixture import failure and stale baseline lint directives are preserved in
the diagnosis. The 300-second build with the host-path repair compiled,
generated 152 static pages and stopped during final trace collection. No
standalone completion is inferred. Its output and log remain intact.
The next isolated 300-second diagnostic also stopped at its bound. Compiler
NFT completed in 11.831 seconds with no root globs. The actual final collector
at Next's `collect-build-traces.js:261` had 342 inputs and progressed from 126
reads/6.1MB to 10400 reads/78.2MB. Its three-second CPU profile shows NFT AST
analysis. Observed globs belong to current chunks and installed dependencies;
no retained unrelated artifact or host-config root glob was observed. Build
logs retain worker initialization contention on the disposable shared build
DB; writer guards were not relaxed. No standalone completion is inferred.
The user was asked to approve a separate finite 900-second build bound;
standalone smoke and final closure remain pending actual completion evidence.

## Measurement table

Latency/TTFT/terminal-delay columns show the range across the two repetitions,
not an incorrectly pooled percentile. Throughput combines 200 requests over
the sum of both measured cell durations, excluding cold fixture setup.

| Engine | Protocol | Accounting | c | Total p50 ms | Total p95 ms | TTFT p95 ms | Terminal p95 ms | req/s |
|---|---|---|---:|---:|---:|---:|---:|---:|
| node | json | off | 1 | 29.8–40.3 | 55.8–56.1 | 55.7–56.1 | 4.0–5.7 | 25.17 |
| node | json | off | 4 | 149.3–157.3 | 278.3–327.0 | 278.3–327.0 | 52.3–54.5 | 21.14 |
| node | json | off | 16 | 494.7–588.2 | 2069.7–2658.0 | 2069.5–2658.0 | 236.0–279.8 | 22.32 |
| node | json | on | 1 | 148.6–154.1 | 268.8–287.1 | 268.8–287.0 | 27.7–33.6 | 5.98 |
| node | json | on | 4 | 575.6–617.7 | 847.7–1252.8 | 847.7–1252.7 | 222.7–313.7 | 6.21 |
| node | json | on | 16 | 1980.6–2003.1 | 9107.6–9978.7 | 9107.5–9978.7 | 928.2–964.6 | 5.76 |
| node | sse | off | 1 | 33.1–38.4 | 56.9–83.9 | 52.7–82.3 | 3.5–5.7 | 23.39 |
| node | sse | off | 4 | 157.1–163.4 | 244.2–269.1 | 242.4–268.2 | 56.0–84.8 | 22.12 |
| node | sse | off | 16 | 310.7–553.7 | 1721.6–2591.4 | 1720.4–2589.7 | 148.3–249.1 | 25.68 |
| node | sse | on | 1 | 154.6–161.6 | 230.8–278.0 | 228.2–275.4 | 29.2–61.2 | 5.68 |
| node | sse | on | 4 | 583.8–645.0 | 1092.9–1162.8 | 1090.9–1160.1 | 251.7–259.1 | 5.84 |
| node | sse | on | 16 | 1674.8–1865.2 | 7818.2–9546.5 | 7816.3–9544.1 | 740.0–929.8 | 6.17 |
| sqljs | json | off | 1 | 38.9–39.1 | 56.2–138.1 | 56.2–138.0 | 3.5–4.0 | 20.23 |
| sqljs | json | off | 4 | 140.3–208.0 | 183.0–482.0 | 183.0–482.0 | 50.1–106.8 | 19.80 |
| sqljs | json | off | 16 | 530.5–566.1 | 1945.4–2684.6 | 1945.4–2684.6 | 252.9–304.3 | 21.74 |
| sqljs | json | on | 1 | 237.7–246.8 | 427.7–512.6 | 427.7–512.6 | 55.9–61.7 | 3.53 |
| sqljs | json | on | 4 | 883.3–964.9 | 1481.3–1575.4 | 1481.3–1575.4 | 409.0–480.5 | 4.00 |
| sqljs | json | on | 16 | 2360.7–3196.2 | 12968.2–15342.0 | 12968.1–15342.0 | 1157.9–1733.4 | 3.84 |
| sqljs | sse | off | 1 | 40.1–40.5 | 86.3–105.7 | 84.7–104.0 | 3.4–3.4 | 20.39 |
| sqljs | sse | off | 4 | 133.1–174.2 | 364.0–377.0 | 362.7–374.7 | 51.5–70.2 | 21.11 |
| sqljs | sse | off | 16 | 499.8–670.3 | 2109.0–2990.9 | 2107.8–2989.6 | 262.4–346.6 | 18.69 |
| sqljs | sse | on | 1 | 247.8–276.3 | 446.1–724.6 | 443.1–722.5 | 59.5–93.6 | 3.23 |
| sqljs | sse | on | 4 | 947.9–1048.4 | 1607.6–1637.2 | 1604.5–1634.1 | 378.5–427.5 | 3.81 |
| sqljs | sse | on | 16 | 2409.5–3007.1 | 12631.7–15720.8 | 12630.6–15719.0 | 1402.8–1639.4 | 3.84 |
