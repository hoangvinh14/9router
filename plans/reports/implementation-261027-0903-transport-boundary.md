# Per-POST transport prerequisite — 2026-10-27

Branch/base unchanged from the [persisted-authority receipt](./implementation-261027-0850-persisted-authority.md). Changes remain uncommitted; activation OFF.

Base accepts an internal invocation-local accounting capability. Each actual native fetch, relay POST, TLS resend, proxy/direct fallback and MITM bypass obtains its own ticket. Immutable request/environment values are compared after dispatcher/DNS/module/admission awaits. Synchronous final checks consume the ticket immediately before native invocation. Instrumented redirects are manual. No-hook retry/proxy behavior remains covered separately.

Accounting exceptions are privately marked and escape transport/Base retry/fallback catches. Response observation is outside the network-error catch, preventing a failed terminal ACK from invoking a second failure sink. Header notification clears Base's original connect timer before body/terminal observation; its start time remains unchanged. Before-consumption refusal is not dispatched; invocation uncertainty remains unresolved even on synchronous native failure. The instrumented MITM branch explicitly binds the resolved IP with the original TLS servername, retains native certificate validation and AbortSignal, and returns one Response body.

## Failed checks and cause-aligned corrections

- Sandbox run: 17 listener failures, `listen EPERM 127.0.0.1`, before functionality. Required counsel confirmed an environment restriction; the identical bounded command was authorized with loopback networking. No test guard changed.
- First actual run: 17 failures/2 unhandled rejections. The fixture incorrectly called fresh persisted authority inside P2's active writer transaction. Counsel verified the incompatible boundary. The helper now checks current healthy transactional connection/credentials inside P2, then separately asserts the persisted proof/credentials outside the transaction before receipt consumption. Error-aware gate races and finally releases prevent hidden early rejection/timeouts. Adapter/service guards remain strict.
- Expanded resend run: 32 passed/2 failed. Its predecessor assertion used an unordered `SELECT state` after the successor was inserted. Counsel verified the identity ambiguity. It now retains the first receipt ID and checks that exact predecessor unresolved and exact successor pending before the second POST; no production change was required.

Historical logs remain `/tmp/9router-p3-transport-261027.log`, `...-loopback-261027.log`, and `...-resends-261027.log`.

## Current evidence

```sh
timeout --kill-after=5s 120s env DATA_DIR=/tmp/9router-p3-transport-final-261027 npm --prefix tests test -- unit/accounting-transport-boundary.test.js > /tmp/9router-p3-transport-final-261027.log 2>&1
```

**42 passed, 34.22 seconds**, unchanged five-second individual limits. Actual Node SQLite/SQL.js ledgers and localhost upstream/proxy/TLS fixtures prove direct and saved-proxy success; held intent/terminal; lost delivered intent ACK despite visible pending row; key/credential/node/pool/settings/environment drift; lazy dispatcher await; abort before/after intent; two keys on one executor; status and proxy/direct successors; TLS fallback; relay; redirect refusal; and intended MITM IP/certificate hostname/body. The connect deadline control holds terminal observation beyond its configured original connect timeout and still reads the body successfully.

The four named affected suites (`base-executor-retry`, `antigravity-retry-hook`, `strict-proxy-enforcement`, `qoder-proxy-replay`) passed **33 tests**, 4.53 seconds; log `/tmp/9router-p3-transport-affected-261027.log`. Final ESLint on all three changed source modules and the expanded test passed (exit 0), log `/tmp/9router-p3-transport-final-lint-261027.log`. Review was inline against the phase's transport inventory and receipt/timeout contracts; counsel was read-only, not an independent full implementation audit.

All listeners/sockets were disposable and closed in finally/afterEach. No development server/watchers or external inference were used. This accepts the transport seam, not P3 raw usage, exact settlement, unlimited gap continuation, JSON/SSE or full X5 transport inventory. Those remain next.
