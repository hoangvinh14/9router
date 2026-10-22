## Independent review result: **INCOMPLETE — not an acceptance approval**

I read the complete ownership, durability, acquisition, driver, adapter and backup implementations listed below. I found one additional release-recovery issue from source inspection. **I could not complete the required tests, usage-callers, migrations/pricing-consumers and receipt inspection before the investigation was stopped.** This review therefore does not close the independent-review gate.

No commands, writes, network requests or further delegation were performed. Findings below are static analysis, not newly reproduced runtime failures.

### 1. Medium — ownership release cannot recover when directory fsync fails after unlink

**Location:** `src/lib/db/writerOwnership.js:58–60`, especially the sequence inside `releaseLease()`:

```js
owner.assertOwned();
fs.unlinkSync(lock);
fsyncDirectory(directory);
released = true;
```

**Trigger:** Engine closure succeeds, lock unlink succeeds, but the following directory fsync throws. The arbitration `finally` can complete normally afterward.

**Result:**
- The ownership file is already absent, but the internal `released` flag remains false.
- Both adapters have already set their engine state to closed and retain their separate adapter-level `released = false`.
- Retrying `close()` calls `owner.release()` again. That reaches `owner.assertOwned()`, whose `readOwner(lock)` throws `ENOENT`.
- Consequently, retry-close cannot finish, even if the filesystem error was transient and no replacement owner exists.
- For a driver-managed adapter, `driver.js` clears `state.instance` and `state.initPromise` only after its wrapped close returns successfully. The process therefore remains stuck with an unhealthy closed adapter.

This is **not evidence of two live engines or data corruption**: the old engine is closed. It is an availability/lifecycle recovery defect that the R5 separate-closed/released fix does not cover.

**Minimal repair direction:** Track lock removal separately from completed release. A retry after *this lease’s own successful unlink* should be able to finish the pending directory synchronization without requiring the removed owner record to exist. Preserve arbitration and do not unlink or adopt a replacement owner’s record. Keep the first failed release observable rather than silently reporting success.

Also account explicitly for the additional synchronization in `arbitrate()`’s `finally` (`writerOwnership.js:43`), so recovery state represents which operation failed.

**Regression to add:** Inject a one-shot directory-fsync failure immediately after successful lock unlink during close:
1. First close throws and the engine closes exactly once.
2. Public database operations remain refused.
3. Retried close succeeds without reopening, exporting or closing the engine again.
4. Driver state can then be cleared.
5. A replacement-owner variant confirms retry never deletes the replacement lock.

The existing gate-collision repair does not itself demonstrate this case. I did not read the test bodies, so I cannot assert whether some existing test already targets it.

### 2. Low — current disposition and manifest metadata are stale

**Locations:**
- `plans/261018-0749-db-safety-pricing/reports/current-disposition.md`, opening status, remaining-gates section and final paragraph.
- `plans/261018-0749-db-safety-pricing/reports/candidate-r6-source.json`, `shutdown` field.

These still describe a pending production/dev shutdown decision and future checks “after shutdown changes”; the disposition also says the follow-up reviewer has not launched and no shell checks are active.

The authoritative directive instead states:
- Shutdown-flow changes are expressly out of scope.
- This is the authorized follow-up review.
- Final affected verification was running at handoff.

**Action:** Reconcile these documents with the final collected outcomes and latest scope. Retain historical checkpoints as historical; do not describe deferred shutdown work as a pending implementation prerequisite. This is an evidence/status accuracy issue, not a new product defect.

## Assessment of the earlier findings

- **Dangling database symlink:** The current `claimWriter()` uses unconditional `lstatSync`, treats only `ENOENT` as absence, and rejects nonregular/multilink entries. This addresses the previously described dangling-symlink bypass at the source level. I did not independently reproduce it or inspect its regression assertions.
- **Close followed by release-gate collision:** Native and SQL.js adapters now distinguish engine closure from ownership release, allowing retry after a pre-unlink arbitration collision. SQL.js additionally retains `closePublicationFailure` and refuses to turn a failed close publication into success on retry. These changes address the described branches at source level; finding 1 above identifies a different, post-unlink failure branch.
- **Shutdown:** **Deferred, not fixed and not certified.** SQL.js still installs flush-only signal handlers; native adapters still install handlers that call `process.exit(0)` after a shutdown attempt. Safe whole-application drainage/termination cannot be inferred from this code. Per the user’s instruction, I am **not requesting a coordinator redesign or making it a new in-scope implementation requirement**.

## Security and compatibility notes

- The reviewed implementation maintains private raw-engine handles and claimed release authority, guarded read surfaces, managed transaction boundaries, and conservative fallback selection.
- Those protections do not constitute a hostile-SQL or hostile-directory sandbox. The documented trusted-local-directory/single-host assumptions remain material.
- I found no additional confirmed high-severity security defect in the production bodies actually inspected. This is **not a security clearance for unread consumers or usage changes**.
- Windows remains unverified; this review neither removes its support nor waives its release gate.
- Host Linux/runtime evidence cannot certify the Node 22 Alpine Docker target. A successful local image build and functional testing with a separate container/volume remain separate acceptance work.
- Nothing here authorizes changes to the live `latest` 0.5.104 container or its volume.

## Exact coverage

### Fully read
- `src/lib/db/writerOwnership.js`
- `src/lib/db/durableFile.js`
- `src/lib/db/engineAcquisition.js`
- `src/lib/db/driver.js`
- `src/lib/db/backup.js`
- `src/lib/db/adapters/nativeAdapter.js`
- `src/lib/db/adapters/nativeDurability.js`
- `src/lib/db/adapters/nodeSqliteAdapter.js`
- `src/lib/db/adapters/betterSqliteAdapter.js`
- `src/lib/db/adapters/bunSqliteAdapter.js`
- `src/lib/db/adapters/sqljsAdapter.js`
- `reports/candidate-r6-source.json`
- `reports/current-disposition.md`

### Requested but **not inspected**
The reads of these files returned spill receipts rather than visible test bodies; investigation was then stopped:
- `tests/unit/db-writer-ownership.test.js`
- `tests/unit/db-durable-publication.test.js`

They **do not count as reviewed tests**.

### Unread
- `tests/unit/db-sqljs-publication.test.js`
- `tests/unit/db-driver-chain.test.js`
- `tests/unit/usage-event-identity.test.js`
- `repos/usageRepo.js`, its relevant callers and associated identity semantics
- Affected migrations, pricing and other repository consumers
- The archived R4 independent review itself
- Detailed R5/R6 test/lint receipts, raw results and runtime provenance artifacts
- Final twelve-file affected result and updated actual better/Bun evidence

I therefore cannot independently validate the narrow usage repair, the preserved 100/50 assertions, test adequacy, consumer compatibility or final-source runtime acceptance. Reported R5/R6 passes remain **parent-supplied/documented evidence**, not checks I ran or independently reconciled. I did not compute or verify source hashes, and I have not combined historical results into a synthetic green outcome.