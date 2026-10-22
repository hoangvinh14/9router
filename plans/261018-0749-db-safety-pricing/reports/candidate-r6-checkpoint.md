# R6 checkpoint — bounded usage affected verification concluded

## Scope and evidence
R5 path/release changes finished focused48/48 and seven-filelint exit0; hashes matched at collection. Prior full affected R4 result remains FAILED118pass2fail/120 and is retained.

User authorized narrow dedup repair after controlled diagnosis. `dedup-repair-contract.md` records each-call-is-event policy: no stable explicit idempotency input exists in inspected repository/callers. R6 removes only usageRepo timestamp/token-equality lookup and endpoint-enrichment early return, adding no schema, request-ID API, inference hook or callsite changes. Identical calls intentionally count as separate events; callers must not infer deduplication/retry idempotency from this API.

New `tests/unit/usage-event-identity.test.js` has6cases across actual Node and real SQL.js (only pre-open native availability mocked for SQL.js). Fixed-identical and fixed-clock automatic events must all count; raw/history/daily/lifetime/provider totals and orderly reopen checked; repeated input object/endpoints do not collapse/enrich another event. Original100/50concurrency assertions unchanged.

`candidate-r6-source.json` contains exact hashes and authorized two-file delta over R5. Initial metadata helper wrongly required usageRepo itself to stay unchanged; failed capture and counsel retained in `candidate-r6-manifest-attempt1.md`. Exact allowlist comparison corrected after source/test inspection; no product verification ran during the failed capture. Syntax/whitespace passed.

## Concluded checks — source frozen throughout
- `b048b6138`: PASS53/53tests across4files usage-event-identity/db-concurrent/db-sqlite-vs-lowdb/cached-token-usage,0failed/pending/todo, singleworker/offline/disposable, root `/tmp/9router-db-safety-r6-ZCrVpA`. Both original100usage and50daily failure identities passed with unchanged assertions. Source hashes verified at collection. [Affected receipt](./candidate-r6-affected-receipt.json), raw output/exit archived.
- `bfc3ee78d`: completed exit0, two changedfile ESLint, empty output; source hashes unchanged at collection. [Lint receipt](./candidate-r6-lint-receipt.json), raw output/exit archived. This does not establish runtime success.

Final full12fileaffected `bf28d83a5` completed PASS137/137,0failed/pending/todo; source hashes matched on collection. [Full receipt](./candidate-r6-full-receipt.json), raw output/exit retained. Actual betterR6 `b7b9cc9f6` completed PASS14main+2child namedscenarios (not Vitest assertioncounts), source/mirror/harness hashes and3ESMlogs+CJSaddon provenance verified, no fixture ownership files. [Better receipt](./better-r6-regression/receipt.json). ActualBunR6 `b6e125ce8` completed PASS14main+2child namedscenarios, source/mirror/harness/binary hashes and3modulelogs verified, no fixture ownership files. [Bun receipt](./bun-r6-regression/receipt.json). Finalreadonlyreview remains awaiting native terminal notification; no polling/source mutation. Counts from separate runs are not combined into a synthetic result. Prior R4 failed receipt remains unchanged as historical evidence, not the latest regression outcome.

## Shutdown / acceptance
User approved staged conditional Linux development/testing only, keeping Windows unverified release gate. Latest user expressly excluded shutdown flow and will manage Docker stop/replacement themselves. No shutdown/entrypoint source edits or graceful-stop assurance; prior shutdownmanifest is historical unimplemented design, not a pending production/dev choice. Signal finding remains documented unresolved/out-of-scope. Final authorizedreadonlyreview d31b5177ba2b0a57633bbc25f9df075f2 running on frozenR6 source/tests/consumers/receipts. Existing liveDocker0.5.104 and volume untouched; eventual localDockerbuild/functionality test must use separate image/data.

No commit/push/runtime install/production activation. DB/P1 acceptance gate remains closed.
