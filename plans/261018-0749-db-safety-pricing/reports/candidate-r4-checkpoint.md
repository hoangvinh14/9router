# R4 Bun strict-close repair — implementation under validation

User explicitly approved the bounded repair after Bun close-boundary failure. Changed production files only nativeAdapter.js and bunSqliteAdapter.js: shared wrapper accepts a close policy (default no-argument db.close for Node/better), invokes it on normal close and initialization failure cleanup; Bun factory supplies db.close(true). Closure failure continues to throw before marking closed/releasing ownership, poisoning returned adapters as before; retry-close behavior retained. No schema/ACL/analytics/inference change.

Added three unit controls to db-durable-publication.test.js for explicit policy once/idempotence, closefault poison/retained ownership/retry and initialization cleanup release vs uncertain lock retention. These use a synthetic engine, not Bun runtime proof.

Frozen source/test hashes captured in candidate-r4-source.json, exact R3 delta is the two production files plus that unit file. ESLint on these3changedfiles exit0; Node syntax check of runtime harness exit0; whitespace pass. Source/tests frozen while verification runs.

Actual Bun changed-input close-boundary task bf5b2c12e PASS exit0 in fresh root `/tmp/9router-db-safety-bun-r4-6NqeKj`: preserved failure condition now passes, all retained statements invalidated plus repeatedclose/publicrefusal. Explicit JSfault-injection on actual Bun task bfbce69b1 PASS3controls: initafterprepare cleanup, closefaultpoison/lock/retry/persistence, init+closefault retains uncertainfixturelock. No new downloads; prior failed evidence kept. Final receipts archived under `bun-r4-lifecycle/`, including intentional uncertain-init fixturelock retention and postrun hashes.

Affected regression bcd817aa6 FAILED exit1:11files120assertions118pass2fail0pending/todo; all37focusedDBcontrols pass. Same2usagecountfailureidentities actual3vs100/1vs50; no analytics repair or unchangedcause/no-influence claim. R3→R4 adds3policycontrols,no removed/no retainedpass→fail; raw results/log/source hashes and receipt retained as candidate-r4-*. Source hashes unchanged postrun. Counsel obtained before comparison, overall remainsred/notaccepted.

Actual better R4 b7bd34891 and ordinary Bun b15772c6c both PASS exit0:each12main+2child namedcontrols,0failed/unreached/skipped, independent freshfixtures. Perlane rawresults/runtime/moduletrace/hashes captured in `better-r4-regression/` and `bun-r4-ordinary/`. No source/mirror/binary/harnessdrift. Bun ordinary uses module resolver but no enginefault/retention hooks. Their results do not offset the two regression failures. No activejobs remain. ActiveLSP3changedpaths0diag but3inconclusive, notcleanclaim.

No runtime/platform support narrowing, independent full-source review or prerequisite acceptance. P1 remains closed. Windows evidence and two analytics failures remain open. No commit/push/activation.
