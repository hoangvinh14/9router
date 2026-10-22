# R5 checkpoint — path safety and retryable ownership release

## Scope / implementation
After actual frozen-R4 diagnosis and counsel, repaired:
- DB claim unconditionally lstats directory entry; only ENOENT means absent, all symlinks/nonregular/multilink rejected. readOwner parse failures normalized to fail-closed invalid-owner error, not swallowed or recovered.
- Native lifecycle tracks closed engine separately from successful lease release. Repeated close after a release collision retries only release; engine close policy runs once after successful close. Close failure still requires real close retry before release.
- SQL.js mirrors release-only retry but retains actual close-publication error. Repeated close after that uncertainty continues to throw and retain exclusion, never re-export/reclose or silently release. Existing poison-before-close behavior is not expanded into a different policy.
- Added direct actual Node/SQL.js dangling path/nonregular controls, non-ENOENT inspection failure, blocked/repeated release retry and eventual reopen, synthetic engine-close-once control, SQL.js uncertain-close publication retention, and actual driver dangling path/release-singleton recovery lanes. Original usage/count assertions unchanged.

Exact3source+4test delta against R4 captured in `candidate-r5-source.json`. Syntax and whitespace checks passed. Active LSP7paths returned0diagnostics:5confirmedclean,2timeouts/inconclusive (not allclean).

## Checks concluded
- `ba73888fc`: PASS48/48tests across focused4files Node/SQL.js,0failed/pending/todo, fresh `/tmp/9router-db-safety-r5-yS7PoR`, single worker/offline. [Receipt](./candidate-r5-focused-receipt.json); rawlog archived. Source hashes match at collection.
- `b9d56c5d7`: exact7changedfile ESLint exit0, emptyoutput, source hashes match. [Receipt](./candidate-r5-lint-receipt.json). No R5 shell runs remain active.

Failure requires counsel before diagnosis/repair. Existing R4 runtime evidence is retained but cannot certify R5. New actual Bun/better regressions pending final coherent source; no new install or runtime download approved.

## Other approved continuation, not implemented yet
Corrected usage diagnosis `b846b70d3` passed4cases each actualNode/SQL.js, artifacts archived in `usage-diagnosis-attempt2/`; originalR4affected118/120 remainsFAILED. User now approved:
1. Staged Linux-development/testing conditional gate, Windows still unverified release gate/no support removal/all-platformDONE/activation.
2. Narrow dedup repair after caller/identity inspection. `dedup-repair-contract.md` plans each-call-is-event policy; no stable idempotency API exists in inspected callers, no request-id/schema/inference additions inferred.
3. Bounded shutdown design+repair, manifest before edits per `shutdown-contract-proposal.md`; application-owned termination not unconditionaladapterexit. Real listener ordering and request-details flush must be designed, no broad teardown edits yet.
4. One further independent read-only review of coherent approved scope/tests/consumers/receipts; not launched prematurely.

R5 source/tests were frozen throughout these checks. Subsequent authorized R6 usage-only changes have their own source manifest and fresh verification; R5 is not final coherent candidate acceptance. No commit/push/activation; pricing gate remains closed pending conditions.
