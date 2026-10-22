# R4 review lifecycle diagnosis — findings reproduced within bounded scope

Task `b8b20199c` completed exit 0. This script collects observations, not an acceptance suite: successful execution does not mean product correctness. Source, probe and archived-artifact hashes were checked; see `receipt.json`, `inputs.json`, `results.json` and raw `output.log`. Runtime: actual Node v24.21.0/Linux, direct Node SQLite and SQL.js factories. No product source or original tests changed.

## Observed path validation
- Regular zero-byte path: both factories opened/closed, no fixture lock remained.
- Symlink to existing file: both rejected with regular-single-link error and released lease.
- Dangling symlink: both opened despite `lstat` identifying symlink. Actual Node SQLite created the absent target outside its leased directory. A lease in the target directory could independently be acquired. **No second engine was opened and no competing writes/corruption were attempted or demonstrated.**
- SQL.js accepted the dangling symlink but did not create the target in this probe; its publication semantics differ. This demonstrates validation bypass, not the same native target-file behavior.

Classification: concrete pre-existing-entry validation gap, high priority. Proposed repair: unconditional `lstatSync`, allow only ENOENT as absence, reject nonregular/multilink. Does not establish hostile concurrent path replacement protection.

## Observed release retry
Both actual factories were initialized normally. A fixture-owned acquisition gate was then held during close. Engine close succeeded; release threw. After gate removal, repeated close returned, but writer lock remained and next ownership acquisition refused the still-live owner. The two `release/*/.gateway-writer.lock` files are intentionally retained evidence, not manually removed and counted as cleanup success.

Classification: concrete fail-closed availability defect. Proposed repair: separate engine-closed and ownership-released state; retry only ownership release after successful closure, reporting failure while still blocked. Preserve SQL.js close-publication uncertainty retention: do not let a second close release a lock deliberately retained because publication during close failed. Test engine-close counts and driver singleton/reopen as well as direct factories.

## Observed signals and actual application limits
Persistent SQL.js child processes reported dirty=true before SIGTERM/SIGINT. Neither exited within fixed 1-second observation deadline, requiring owned-child SIGKILL. Reopen recovered persisted row73; Linux dead-owner recovery and subsequent orderly close cleared those signal fixture locks. Persistence was not lost in these observations.

Classification: reproduced isolated-adapter nontermination, not whole-application shutdown failure. `initializeApp.js` separately registers process.exit cleanup; `custom-server.js` stops token refresh on signals. Listener registration order and Next's handlers can mask or preempt adapter handling. A library-level unconditional process.exit is not an accepted repair design: it may cut off application cleanup. Need explicit coordinated shutdown scope, real-entrypoint/listener-order verification and defined persistence-failure/repeated-signal behavior before closure. No claim of clean application shutdown from this probe.

## Counsel / next actions
Counsel taken after collection and before repairs. Source remains frozen until independent corrected usage probe terminal notification. Bounded path/release fixes fit the DB prerequisite; any change invalidates relevant R4 runtime evidence and requires fresh hashes and affected regressions. Signal coordination and full independent tests/consumers/evidence review remain unresolved. Linux-first proposal remains unapproved; Windows unverified; original affected118/120 result remains FAILED; P1 closed.
