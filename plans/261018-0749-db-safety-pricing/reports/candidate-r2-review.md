# R2 receipt and bounded R3 review repair

R2 task `b116895a2` terminal FAILED/exit1:11 files,114 assertions,112passed,2failed,0pending/todo. `candidate-r2-results.json`, `candidate-r2-output.log`, `candidate-r2-receipt.json` retain raw result/identity/count/hash comparison. All expected R2 source/test hashes matched on collection; R2lint18files exit0, changed8file activeLSP8clean. All31 focused DB-safety assertions passed (Node/SQL.js real engines, two fault-engine controls and simulated engine-availability composition separately labeled).

Two failures remain in unchanged concurrency assertion identities: expected100/got5 (old baseline3,R1got4), expected50/got1. Same identity is not identical outcome or proven cause; no analytics repair. Seven original non-driver files preserve assertion identities, no observed pass→fail; changed driver policy3→6 controls is explicitly replaced/expanded coverage. Overall verification remains red, not unconditional no-regression or prerequisite acceptance.

## Final source review disposition

Read implementation directly: native wrapper/transactions, SQL.js adapter, driver and ownership/SQL boundaries. R2 fixed previously identified read-surface mutation bypass, trigger guard, private claimed release and nativeclose poison. Remaining concrete primitive obligations found:

- SQL.js `exec` only marked dirty after success. SQLite multi-statement execution can apply earlier statement then throw on later invalid SQL, leaving changed image outside publication bookkeeping. R3 conservatively schedules dirty in finally after execution is attempted; managed rollback restores prior clean/dirty state. Preparation/lexical validation remain before attempted write. Partial SQL batch outside managed transaction does not promise atomicity and does not itself poison.
- Both native/SQL.js `close()` lacked active managed transaction guard. R3 refuses close before flush/callback removal/engine close/release while depth>0. Tests cover caught close (callback remains usable) and uncaught close (normal rollback), lock retained and final value preserved.
- Added SQL.js real partial-exec→ACK→reopen control plus initially clean/alreadydirty managed rollback controls. Raw transaction guard remains authoritative; no unmanaged BEGIN allowed. Advisor confirmed these are within approved primitive contract, not analytics scope. Advice is not independent source verification.

R3 exact delta: `src/lib/db/adapters/nativeAdapter.js`, `sqljsAdapter.js`, `tests/unit/db-durable-publication.test.js`, `db-sqljs-publication.test.js`. Combined11file task `b774229a1` and changed4filelint `bcdf0c5b7` running; no source changes while running. This is changed-input verification, not repeating identical green controls for counts.

## Runtime gate remains closed

| Lane | Evidence | Limitation |
|---|---|---|
| Node SQLite on Node24/Linux | Actual factory/DB/reopen/PRAGMAs and affected driver/ACL tests | Not power-loss/system-wide certificate |
| SQL.js on same runtime | Actual WASM DB/file publication/faults/reopen and driver composition | Engine availability decision mocked only in explicit fallback control |
| Native fault engine | Synthetic RELEASE/close failures | Not Bun/better/native runtime proof |
| Bun | Not installed/discovered | Unverified; not removed from support |
| better-sqlite3 | Installed package, deliberately skipped on Node>=24 per existing safety guard | Not loaded unsafely; no runtime proof |
| Windows/filesystems | Not exercised | No compatibility/durability acceptance |

P1 requires keeping supported adapter obligations. No evidence of all-adapter/platform acceptance and no approved narrowing, so **P1 gate remains closed**. Review-only pricing manifest analysis is possible, but product port cannot treat the prerequisite as passed. Need actual missing-runtime evidence or a separately approved bounded execution/verification scope; do not install runtimes or waive support silently.

No schema/ACL/usageRepo body edits, ledger/accounting, production DB/server/catalog/network, delegated writer, commit/push/activation. Pending R3 receipts are not pass. Candidate remains unaccepted WIP.
