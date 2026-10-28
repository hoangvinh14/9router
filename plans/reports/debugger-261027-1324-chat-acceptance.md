# Chat acceptance continuation

The user requested P3 completion after the previous finite measurement and
build stops. The previous receipts remain unchanged and unaccepted. This
continuation initially kept the 300-second bounds, all guards, workload and
concurrency; the later explicit measurement-only authorization is recorded below.

## Bounded diagnostic

Eight actual disposable localhost requests (four per adapter), no warmup:
`/tmp/9router-p3-profile.log`, CPU profile
`/tmp/9router-p3-profile.cpuprofile`. Node elapsed 1252ms, 1120 get/219 all;
SQL.js 1157ms, 1188 get/234 all. Wrapper timings overlap and cannot be summed.
The schema validator issues individual reads for every table/index/trigger;
each adapter read rechecks filesystem ownership. Identity also reads four
markers individually. Counsel approved batching those synchronous reads,
including sharing the freshly read schema rows with the authority digest.
No cache crosses awaits, hooks or mutations; final persisted proof stays fresh.

The instrumented build has isolated output `.next-chat-diagnostic-261027`
and disposable data, with Node diagnostic reports enabled. The previous trace
records module activity through 64 seconds but does not establish the cause of
the 300-second stop. No previous measurement/build process survived the host
process reconciliation. The diagnostic's shutdown warning is under investigation.

The first four-suite batching verification had 63 pass and two failed reopen
cases in 18.30s (`/tmp/9router-p3-batched-tests.log`). Counsel confirmed the
policy startup validator receives only `{ get }`, before adapter setup. Its
single-get wrapper was restored; the rows helper remains for callers already
holding a fresh schema image. No startup capability was widened.

Reopen controls: 2 pass; full four suites: 65 pass in 13.45s. Same eight-request
diagnostic after batching: Node 846ms (736 get/283 all), SQL.js 1027ms
(768 get/304 all). Closing the imported disposable adapter before deleting its
data root removed the shutdown warning. This is not full measurement evidence.

The instrumented build also reached exit 124 at its unchanged 300-second bound.
Its report `/tmp/report.20261027.132904.3872861.0.001.json` showed CPU work and
no active network sockets. All four libuv workers waited in filesystem I/O;
open file descriptors pointed inside the retained unrelated 680MB artifact
`tmp/9router-pricing-A-current-1791487641/standalone/node_modules/next/dist/compiled/`.
The Tailwind import in `src/app/globals.css` claimed to scan src but actually
used `source("../../")`, the repository root. Counsel approved correcting it
to `source("../")`, covering application class sources in src while retaining
all historical artifacts. A fresh build will test this cause; it is not yet
proved the sole cause of the stop.

The scoped build also stopped at 300 seconds. Its short inspector profile
identified Next's NFT resolver and filesystem traversal, with 33754 pending
filesystem requests. The inspector was closed and no build processes survived.
Exact public Next 16.3.8 source confirms webpack tracing receives no configured
output exclusions at this stage; its plugin starts with empty traceIgnores.
No speculative output exclusions were added. The NFT root expression remains
under investigation.

Foundation batching also exposed a getter-only backup/import validator caller:
74 pass, two failures in 20.18s. Counsel preceded restoration of the foundation
getter wrapper; the fresh-schema rows helper remains for batched projections.
The import controls then passed twice, and all seven foundation suites passed
78 tests in 17.95s. Coverage identity now derives status, fingerprint and retired
bindings from one fresh synchronous snapshot; 79 authority/coverage tests pass.

The user explicitly approved raising only the full measurement wall bound to
1200 seconds. No test/request deadline, concurrency, workload, ACK or authority
guard changes. Build retains 300 seconds. Old partial receipts are preserved.

Final selected JSON/SSE controls passed 159 tests across four files in 42.79s;
all 53 changed/new JS modules passed lint. Independent review confirmed guard
equivalence of batching and found one harness cleanup omission: a failing
fixture close skipped the default adapter close. Each resource now closes
independently, preserves all cleanup failures and retains data on failure.

## Build tracing repair

The 90-second logging capture identified four repository-wide NFT globs for
Zed settings, Cursor storage, Claude Desktop and Kiro profile candidates.
The plugin's exact compiler bytes are indexed in
`/tmp/9router-p3-nft-inputs.jsonl`. Raw-source probes did not reproduce this
input and are not acceptance evidence. An initial compiler-input probe stopped
at 35 seconds while traversing the original glob; throwing a diagnostic
sentinel from NFT's asynchronous logger then exited uncaught. Counsel preceded
replacing that instrumentation with separate bounded processes.

The baseline receipt `/tmp/9router-p3-captured-original.json` records the first
root glob and explicitly says `traceCompleted:false`. The boundary receipt
`/tmp/9router-p3-captured-boundary.json` completes normally, reads all four
compiler inputs and the helper, includes the helper in `fileList`, and has no
glob. A virtual stat allows the not-yet-created helper to resolve; both variants
use the same tracing options and no broad ignore exclusions. Existing alias,
private Next and optional native-package warnings remain, so this probe does
not substitute for the actual build.

The source change delegates only env-rooted host candidate joins to
`src/lib/runtime-host-path.js`, which calls native `path.join` without changing
env lookup timing, fallback or candidate order. Independent review found no
behavior change. The fixture initially failed import because its `os` mock
omitted `arch`; counsel preceded a partial mock. Six route-level candidate
controls then passed, including Windows branch drive/UNC strings, empty-env
fallback, fresh XDG lookup and Kiro's POSIX APPDATA candidate. These run on
Linux and do not claim native Windows accounting validation.

Narrow lint found two baseline disable comments for an unavailable TypeScript
rule. Counsel approved deleting only those stale comments, retaining both
dynamic native requires. The isolated actual build uses the unchanged
300-second bound and output `.next-chat-host-path-261027`. A three-second
localhost inspector profile found NFT AST analysis rather than the previous
33754-request traversal backlog; the inspector was closed. Static generation
reached 152/152. Final build and standalone evidence remain pending.
