# P3 final build and acceptance

The user requested continuation after the proposal to give the dependency
collector one isolated build bounded at 900 seconds. That run uses
`.next-chat-final-261028` and disposable data, without profiling, source
exclusions, dependency changes or relaxed request/test/accounting guards.
Log: `/tmp/9router-p3-final-build-261028.log`.

The [previous acceptance record](./implementation-261027-1342-chat-acceptance.md)
owns 185 passing selected chat controls, 126 affected-consumer controls,
foundation/authority tests, scoped lint and the complete 4800-request
measurement. Source has not changed since that evidence; final packaging
and disposable standalone acceptance completed the remaining closure gates.

Historical red receipts remain unchanged. No commit, publication or production
activation is part of this continuation.

## Exit-obligation reconciliation

| Obligation | Evidence and boundary |
|---|---|
| Named prerequisites | [Persisted authority](./implementation-261027-0850-persisted-authority.md) and [per-POST transport](./implementation-261027-0903-transport-boundary.md) accepted on both actual adapters; no writer-authority bypass. |
| Intent and terminal ACK ownership | 185 selected JSON/SSE controls include held/lost delivered ACK, actual post-dispatch recording failure, independent gap ACK, abort and late settlement. Visible persisted rows never substitute delivered ACK. |
| Current authority and successful dispatch | Request-authority controls and actual direct/proxy flow controls cover held-await drift and matching successful POSTs. Invocation-local state isolates shared executors and two keys. |
| Raw usage and original pricing | Actual selected-profile cache matrices reopen raw/normalized counts and exact original-rate cost for no/partial/full cache read, zero/missing rates and drift. Missing/conflicting evidence remains unresolved/null-cost. Cache writes/tiers are explicitly absent under this strict profile; broader providers remain separate work. |
| Failure, retries and retained callbacks | Actual exact HTTP 503 and unknown network-reset predecessors finish before native retry; duplicate/conflicting/late callbacks and reopened key-specific gaps retain identity and original price. Broader OAuth/multi-URL ownership is prerequisite transport evidence, not selected-profile usage acceptance. |
| Native SSE terminal and cleanup | Parser and actual-flow suites cover UTF-8/CRLF/multiline fragments, held/lost settlement, trailer/EOF/stall/abort/cancel and native failure without synthesized success. Native TCP receive split boundaries are not asserted. |
| Affected consumers | 126 passing controls in 11 files, 78 foundation, 79 authority/coverage/request, 25 schema negatives and two reopen controls; lint passed for touched modules. Two unrelated combo-autoswitch failures were reproduced on exact base and remain qualified in earlier receipts. |
| Finite measurement | [Durable raw receipt](./measurement-261027-1342-chat-accounting.json): 4800 completed native requests, 48 reopened cells, 662.977 seconds; no prewarm, guard or request-deadline changes. The previous acceptance record owns metrics and sampling/log limitations. |
| Packaging and runtime | Production build and independent disposable standalone smoke passed. The reviewed smoke copies the package outside the repository, GETs rendered CSS, exercises host-path candidates, loads packaged SQL.js/WASM and verifies Node adapter startup and DB reopen. |
| Scope and activation | Production remains OFF, with no ledgerStartedAt activation. P4/P5, provider/endpoint inventory, Bun/better-sqlite3/Windows accounting and release remain their existing owners. |

## Final build and smoke

`npm run build` completed with exit 0 within the authorized 900-second bound,
including compilation, TypeScript, 152 static pages, final dependency tracing
and postbuild asset copying. Its output is `.next-chat-final-261028`; no tracing
exclusions, instrumentation or dependency changes were added for this run.
Build worker contention messages remain in the log: concurrent build workers
were refused by the single-writer guard on the disposable build database.

The 120-second-bound standalone smoke completed with exit 0. The
[durable receipt](./verification-261028-1243-chat-standalone.json) records a
package copied outside the repository, packaged SQL.js/WASM export/reopen,
successful health and authenticated login, Kiro POSIX APPDATA fixture import,
absent Cursor/Cowork candidates, login rendering and CSS served over HTTP.
The child log confirms `node:sqlite`; after SIGTERM (expected child exit 143),
read-only reopen found zero accounting attempts and no `ledgerStartedAt`.
There was no writer acquisition/interruption error during single-process
runtime. The retained module-type warning concerns existing ESM source under
an untyped package; no runtime application initialization error was observed.

The child stopped, port 20139 was free, the exact build-process inspection
returned no processes, and disposable smoke data/package were removed.
Logs: `/tmp/9router-p3-standalone-smoke-261028.log` and
`/tmp/9router-p3-standalone-server.log`. The reviewed runner is
`/tmp/9router-p3-standalone-smoke.mjs`.

All scoped P3 acceptance obligations now have evidence. This closes the
selected strict compatible-chat JSON/SSE slice on Node SQLite and SQL.js;
it does not close the whole roadmap or authorize production activation.
Plan files and the rebuilt index report **completed, 4/4 phases, 21/21 tasks**.
