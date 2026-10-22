# Measured build on 167 — preparation timeout; build not launched

## Authorization and boundary

User requested measurement on server 10.1.12.167. Authorized intent: one instrumented isolated build, same two-CPU affinity / 2048MiB per-Node heap / 900s inner watchdog / 930s outer wait; no product/dependency changes, installs, live Docker access or restarts. Old helper and evidence are preserved.

## Completed observations

- Server identity is 10.1.12.167. Earlier read-only inspection found ~10GiB available of ~13GiB total, swap ~1.4GiB used but no active swapping in two sampled intervals, no OOM kills in available current-boot kernel/oomd journals, and no memory cap/OOM counters in current session cgroup ancestors. These are not historical measurements of the failed build.
- Old partial Next trace contained 5656 events: server webpack compilation ~378.7s, including node-file-trace-plugin ~273.1s; client compilation events continued until about 03:12:05 UTC. These are partial, unverified post-run artifacts, not a complete build or proof of a root cause.
- New report-only measure.py observes lifecycle, 5s host/owned-descendant CPU/RSS/swap/I/O and relay byte/phase metadata. It retains original proxy blocking/select semantics to avoid testing a network fix simultaneously. No payload/argv/environment logging is intended.
- New prepare.py checks original source/dependency manifests and complete staged inventory/hash coverage before relay controls and actual isolation preflight. Earlier-revision AST and Ruff I,F,S108 passed; this is not a runtime readiness claim. Advisory counsel preceded correction of initial static-check failure and diagnosis of preparation timeout.

## Failed preparation

Task b83bca0cc, Measured build preflight: terminal status failed, exit code null, error `Timed out after 120s`.

The one bounded collection found:

- prepare-output.log contains only `source verified 0/250/500/750/1000/1250` (120 bytes; mtime 2026-10-20T09:01:20.265278Z).
- prepare-exit.txt, inputs.json and prepared.json are absent.

By helper ordering, no fresh preparation manifest or success receipt was reached. No dependency-hash progress marker appears. The exact stopping point may be remaining source checks, lock/manifest checks, dependency inventory or another intervening operation; the evidence does not identify one. Do not claim full source/inventory success from the last progress marker.

No diagnostic build was launched. There is no measured-build RAM/CPU/network result. Timeout does not establish that all preparation descendants exited; residual task-owned process state is unknown and no process was signalled. The helper only creates its private run root after complete dependency validation; no fresh run-root path was recorded.

## Disposition

Measured build gate remains held. No preparation rerun, timeout increase, blanket process scan/kill, new install, product/dependency change or live Docker action followed. No root cause or clean post-run integrity claim is made.

Proposed next step, not executed: inspect task-owned cleanup narrowly if needed, then separately bounded inventory and deterministic hash partitions with durable progress/receipts. Preserve all 36425-file/32-link coverage and frozen manifest matching; do not weaken checks or silently turn partitions into a retry loop. Revalidate exact helper/source inputs before any launch. Any new execution should follow an explicit revised bounded plan and decision, not a blind increase of the failed 120s budget.
