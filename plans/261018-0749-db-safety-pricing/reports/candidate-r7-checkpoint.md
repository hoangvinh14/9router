# R7 — release-directory synchronization recovery under validation

## Reproduction and evidence
Review R6 was explicitly incomplete, not approval; production bodies read but tests/consumers/usage/receipts not inspected. Static post-unlink directory-fsync finding was counseled before diagnosis. `b7947129e` actual Node/SQL.js temporary diagnosis completed exit0 with8observations, archived in `release-sync-diagnosis-r6/` with source/probe hashes matched.

Both engines: after successful own-lock unlink, injected directory-fsync failure makes first close throw with engine closed and lock absent; retry fails ENOENT without replacement, ownership-lost with replacement. Replacement record stays unchanged and its engine remains usable. At arbitration-final-cleanup fsync failure, retry returned; the diagnostic did not trace retry-sync calls, so this return alone is not proof of either resync or its absence. R6 source shows released flag set before final cleanup; R7 adds explicit sync-count assertions.

## Bounded repair
Only `src/lib/db/writerOwnership.js` production delta:
- Record removed=true immediately after this lease successfully unlinks its own lock.
- Ownership assertions refuse removed lifetime.
- Sync-only retry under fresh arbitration when own removal was proven, never read/adopt/delete a replacement owner.
- Set released=true only after whole arbitration including gate cleanup and final directory fsync succeeds.
- Arbitrary ENOENT before own unlink is not accepted. Gate-removal failure remains fail-closed/operator recovery, not auto-delete.

New `tests/unit/db-release-sync.test.js` has12cases: both fsync locations, repeated persistent errors, contention then recovery, sync call counts, replacement identity/use, actual Node/SQL.js closed-adapter behavior/no export writes, driver cache clearance, native policy close-once, arbitrary missing lock refusal and failed gate-rmdir requiring explicit fixture intervention. Existing SQL.js uncertain close-publication tests retained unchanged.

Exact two-file delta and hashes in `candidate-r7-source.json`; syntax/whitespace checks passed. No shutdown flow or signal/entrypoint changes, as explicitly requested by user. No pricing API/UI changes yet.

## Completed R7 verification — source unchanged
- `ba525a9bb`: completed PASS60/60tests across5files,0failed/pending/todo; new12cases plus four prior focused DB files, single worker, offline/disposable `/tmp/9router-db-r7-NMK64I`. Source hashes matched at collection; [receipt](./candidate-r7-focused-receipt.json), rawoutput/exit archived.
- `b326b8125`: completed exit0, exact two changedfile ESLint, empty output and sourcehashes verified; [lint receipt](./candidate-r7-lint-receipt.json). ActiveLSP twochangedpaths confirmedclean0diagnostics.
- `b3cad2960`: completed PASS149/149tests across13affectedfiles,0failed/pending/todo, frozenR7hashes verified; [full receipt](./candidate-r7-full-receipt.json), rawoutput/exit retained.
- Fresh betterR7 `b7660c63c` completed PASS16main+1contender+1reopen namedscenarios on actualNode22.23.2/privatebetterABI127, including2explicitJSdirectorysyncfault/replacementowner controls. Frozen source/mirror/harness/addon hashes matched;3ESMlogs ownedpaths and CJSaddon provenance in main/reopen checked; nofixtureownershipfiles. [Receipt](./better-r7-regression/receipt.json), rawresults/logs/helpers archived. NotDockerAlpine/musl/Windows/powerloss proof.
- BunR7 `bdcd2622f` completed PASS16main+1contender+1reopen on actualBun1.4.3, including2explicitJSdirectorysyncfault/replacement controls. Source/mirror/harness/binaryhashes and3ownedpathmodulelogs verified, nofixtureownershipfiles; [receipt](./bun-r7-regression/receipt.json), allraw/helpers archived. NotDockerAlpine/musl/Windows/powerloss proof.

All launched tasks have finished and terminal evidence collected once. No active job/reviewer. Failed verification requires counsel before diagnosis/repair. R6full137/137 and better/Bun16namedscenarios each retained as historical unchanged-input evidence, not proof for R7 ownership code. Fresh affected runtime checks required after relevant repair acceptance.

Independent review gate still incomplete at this checkpoint. User-authorized additional missingcoverage review d71cc1f6852c50225ce9b861db4039108 completed but mandatoryfinalization stopped before usage/consumers/receipts/ownershipdelta. Three fulltestfiles plus SQLjs1–120 read, no new production defect; low native testtitle overclaims caughtinnerRELEASEcoverage. [Verified answer](./missing-coverage-review-r7/review.md). Counseled [executor followup](./executor-review-r7-followup.md) directly inspected additional scope, explicitly not independent approval. No active/new reviewer; explicit policy decision or narrowly authorized followup still needed. Do not equate successful tests/direct review with independent approval. No Docker/livevolume/activation/install/commit/push; P1 remains closed until in-scope conditions reconcile. Stale helper advisory is not a trigger to rerun setup or edit unrelated source.
