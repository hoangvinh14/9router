# Measured baseline on 167 — incomplete, watchdog terminated

Task b8621522c failed exit124. No worker comparison or retry followed. Product source/config/dependency edits, installations and live Docker actions were not performed.

## Observed measurements

Archived outside telemetry parsed 181 samples with no JSON parse/sample errors, covering927.38s; maximum gap5.86s. Inside lifecycle explicitly records900s wait expiration, SIGTERM,5s escalation timeout, SIGKILL, build exit-9 and helper return124. Outside namespace recorded124 and observer_exit124; launcher nevertheless recorded950s timeout and no runner-exit.txt. The outer shutdown delay remains unexplained.

- Summed owned-process RSS peaked8.925GiB, dominated by one Next process. RSS is not unique physical allocation and may double-count shared pages.
- Host available RAM minimum2.295GiB. Host swap used rose1.081→2.499GiB. pswpout delta493012pages, pswpin17301pages, oom_kill delta0. No measured system-OOM kill; V8 old-space2048MiB is not total RSS.
- Build CPU approximately1.3–2cores early; much lower late. Next process actual affinity0-1; supervisors0-11.
- Next read_bytes reached15,294,337,024. Host I/O pressure avg10 approximately70% near840s. Host pressure and swap include unrelated workloads, so causality is not attributed solely to build.
- Eight outer font relays transferred bytes and closed EOF around38–39s; no active relay in later samples. This argues against those connections waiting all15minutes, not TLS/content or successful font rendering proof.
- Partial trace:5656events/0parseerrors; server webpack compilation391.499s; node-file-trace-plugin269.987s. Last completed trace events around570s are not proof of no later progress. diagnostics still compile/useBuildWorker=false. No BUILD_ID or standalone directory.

## Evidence and lifecycle limitations

Small logs/telemetry were copied once with byte counts and archived-copy hashes; recorded original sizes matched after copy. Partial Next trace copied and hashed separately. Full raw data and summary.json/trace-summary.json are retained. This is an instrumented shared-host run, not a zero-overhead benchmark.

All PID/startTicks identities found in the samples were absent at one subsequent point-in-time check. This does not exclude unsampled descendants or observer threads. No process was signalled during diagnosis.

A20s postcheck attempted source/helper/lock hashes, original-vs-archive comparisons, and exact-run-marker process observation. It timed out with no output. Completion of all these checks and residual owned-process cleanup remain unconfirmed; no successful post-run integrity claim is made. No post-run dependency full hash claim is made. Counsel preceded failure diagnoses and the decision to stop; no postcheck retry/budget increase followed.

## Decision

Build success gate FAILED, analysis collected but root cause not fully established. Evidence supports substantial build memory demand, swapping and I/O pressure under this profile, not a proven physical-RAM OOM, font hang or pricing defect. Both build watchdog termination and secondary launcher timeout are retained.

Hold worker comparison until source/config/helper/lock integrity and owned lifecycle termination are established. If those gates are satisfied, one isolated webpackBuildWorker=true comparison can test memory isolation; preserve original config, all other profile/network/cache conditions and telemetry. Do not start a tuning/retry loop. Build/browser/Docker acceptance remains incomplete.
