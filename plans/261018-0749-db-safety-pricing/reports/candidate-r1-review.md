# Candidate R1 — interim review, not acceptance

First focused run `b5dbcb9af`: terminal exit0; selected4 files,24 assertions allpassed,0pending/todo; raw JSON/log retained as `focused-r1-results.json`/`focused-r1-output.log`. Actual engines Node SQLite and SQL.js; synthetic engine RELEASE/close fault is not another runtime lane. Owned child-process test exercises one child owner death and two simultaneous reclaimers.

Active LSP11sourcepaths clean. Eightfile affected barrier `b1ad06e0f` concluded FAILED/exit1:88 assertions,86passed,2failed,0pending/todo. Standalone18file lint `bc244d1fa` still has no terminal notification in this session; no polling/reconfirmation. No source mutation while these run. Prior report-only lint timeout and original usage-count reds retained historically.

## Affected barrier receipt

Raw `affected-r1-results.json` and `affected-r1-output.log`, plus `affected-r1-comparison.json`, are preserved locally. Exact eight file identities/counts reconciled. In seven files every original assertion identity remains, with zero pass→fail transitions. Same two failing usage-count identities remain: expected100/actual4 (baseline actual3), expected50/actual1. Concurrency/parity fixture changes only close adapters before deleting fixture directories, shifting failure lines by2; assertions unchanged. This is not identical outcomes or a proven root cause and not overall no-regression acceptance.

Driver-chain source intentionally replaces3 old test identities with5 explicit policy tests. Old tests treated arbitrary adapter factory errors as engine-unavailability and allowed fallback after uncertain open, conflicting with the approved safety contract. New tests cover real default init, recognized pre-open missing engine, memory-only missing better binding, fatal unknown import/project/factory errors and actual-driver fatal factory refusal. Comparison lists all3 removals/5additions rather than counting them as unchanged passes. Coverage gap still to close: actual driver composition should be tested selecting SQL.js after a recognized unavailable native engine; helper-level null availability plus direct SQL.js factory tests alone do not establish that composition. No adapter support waiver or assertion weakening authorized.

Both runs use same Node/install, selected baseline manifest, disposable HOME/DATA_DIR/TMP/cache, singleworker/no-fileparallelism and offline preload. Candidate source and explicitly changed driver/cleanup tests differ by design; this is not byte-identical baseline execution. No analytics diagnosis/repair or unchanged rerun. Advisor failed-verification counsel supports keeping failure identities separate from changed policy coverage; did not independently inspect baseline artifacts/source diff.

## Direct review findings requiring bounded follow-up

1. Current `assertManagedSql` is a conservative transaction-keyword blacklist. It refuses legitimate trigger-body `END` (future P1 pricingRevision uses triggers), and `get/all` permit mutating statements whose SQL.js side effects do not set dirty. Although callers are trusted modules, publication bookkeeping must not depend on accidental use of the correct method. Add explicit read-only lexical boundary for get/all, preserve approved introspection PRAGMAs, and a properly tokenized trigger-aware transaction guard. Test comments, semicolons/literals, all entry points, triggers and CTE-mutating statements. Do not merely remove END check.
2. `claimWriter` marks a private token claimed, but retaining the original owner exposes `.release()` while an engine may still be live. Separate pre-open owner cancellation from adapter-exclusive release lease; raw owner release after claim must refuse. Cover retained-token release + real second-open refusal.
3. Native close uncertainty currently leaves engine potentially usable (closed flag only after successful close). Need separate close-failed poison/deny and owned retry-close behavior; no lock release before successful engine close.
4. SQL.js fault coverage currently rename+directoryfsync, not file-write/file-fsync boundaries; add finite controls for missing cases and reject active-transaction backups. Backups of prior dirty state need explicitly documented semantics (safe current image vs committed-file truth) and must not manufacture original-operation ACK. No managed restore/wholebackup claim.

Advisor echoed execution-surface/lease hazards, but full diff/untracked attachments were withheld by disclosure policy; **not an independent full-source review or verification certificate**. Direct code inspection supports items above. No delegation performed.

## Limits

Bun command unavailable and better-sqlite3 intentionally skipped on Node24; Windows fsync behavior unverified. No dependency install, unsafe addon load, platform waiver or all-adapter acceptance. No production DATA_DIR, schema/ACL/analytics body changes, ledger/accounting/activation/commit/push. P1 gate remains closed. Future repair validation must name changed inputs; do not rerun unchanged green controls for counts.
