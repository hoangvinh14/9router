# Staged production build attempt — failed verification, exit 124

Task: `b34837935` (`Isolated staged pricing build`). Terminal notification reports failed, exit **124**. Build root: `/tmp/9router-pricing-staged-build-qszrhmf6`; output: `.next-pricing-staged-261020`. No build retry, limit increase, package installation, source/helper repair or process signalling followed this failure.

## Observed evidence

- Advisor counsel preceded failure diagnosis and each subsequent collector-timeout disposition.
- The initial archive command copied all five expected artifacts, the input manifest and helper, wrote `archive-index.json`, and printed the completed index. Its tool call then reported a **10-second timeout**. These two facts are retained; collector completion is ambiguous, not a proven product or harness defect.
- Archived `build-exit.txt` and `runner-exit.txt` were each read and contain `124`.
- Archived `build-output.log` was read: `9router-app@0.5.104`, `next build --webpack`, Next.js **16.3.8**, configuration loaded, then `Creating an optimized production build ...`. No compiler-completion or postbuild success message is present. The final progress message does not establish where execution stalled.
- The archive index records empty runner output, 266-byte build output, and no missing expected artifact. Its hashes were computed from original files; **archived-copy hashes have not been independently confirmed**.
- Archived proxy events record one denied `registry.npmjs.org:443` CONNECT and allowed Google Fonts destinations. The registry initiator and causal relevance are unknown. Destination admission is not TLS/content certification or evidence that downloads completed.

## Verification limitations

A separate read-only post-run verification command received one **30-second bound**. It timed out without returning output; it combined recorded-source/dependency hashing and run-owned process observation. No retry or larger budget was used. Therefore:

- Post-run source/helper/dependency/lock integrity is **unconfirmed**. Pre-run matching manifests, complete staging-tree checks and passing corrected preflight remain pre-run evidence only.
- Archive-copy integrity is **unconfirmed**; successful copying and the printed index are not a completed byte comparison.
- Residual run-owned process state is **unknown**, not certified clean. The terminal build-task notification does not prove all descendants absent. No unrelated processes were inspected for action or signalled, and no cleanup action was taken.
- Build artifact completion/standalone/postbuild status was not established by a completed post-run inventory.

Exit 124 is consistent with timeout handling but does not alone identify the timeout layer or exclude a child returning the same code. The frozen helper profile specified a 900-second inner watchdog, 930-second outer wait, and 960-second task bound. No explicit observed watchdog event identifies which path occurred. OOM, CPU contention, font/proxy delays, dependency problems and product defects are **not established causes**. The two-CPU affinity and per-Node 2 GiB heap limit are not an aggregate-memory bound or a root-cause finding.

## Disposition / safety

**Production build completion is not demonstrated. Phase 3 remains incomplete**, with build verification failed and post-run integrity/process state unresolved. Existing source-bound unit/API/UI-helper passes do not substitute for compiled Next.js, rendered-browser or Docker acceptance.

Stop automated build/collector retries and timeout tuning. A further diagnostic experiment requires a materially justified bounded plan and explicit approval before additional execution. Do not relax networking, disable browser sandboxing, install more packages, or change product code to obtain green output.

The authorized dependency setup stayed in disposable staging; no intended root dependency/lockfile mutation, live Docker action, live-volume access, shutdown redesign, delegation, commit or push occurred. Post-run equality is deliberately not claimed beyond the pre-run evidence. Browser remains inconclusive; Node22 Alpine/musl Docker functionality/restart testing remains unexecuted. The live Docker system must remain untouched.
