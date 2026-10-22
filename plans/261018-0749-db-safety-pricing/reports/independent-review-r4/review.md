## Independent review: changes requested

**Found three concrete issues in the inspected production code.** The first undermines the explicit path-safety/ownership contract; the others affect shutdown and recovery. These are static findings, not newly executed reproductions.

### 1. High — Dangling DB symlinks bypass the single-link-file check

**Evidence:** `src/lib/db/writerOwnership.js:74–88`, particularly `80–82`.

`claimWriter()` calls `lstatSync()` only when `existsSync(record.file)` is true. `existsSync()` follows symlinks and returns **false for a dangling symlink**, so that filesystem entry bypasses the explicit symlink/nonregular-file rejection.

**Trigger:** Pre-create `directoryA/data.sqlite` as a symlink to an absent, writable `directoryB/data.sqlite`, then open a native adapter through directory A.

**Impact:** The lease protects directory A, while a native engine that follows the symlink creates/opens the database in directory B. Another adapter can acquire directory B’s independent lease, defeating the intended one-writer namespace. At minimum, the advertised symlink-refusal policy is demonstrably incomplete; engine-specific exploitation still needs an actual test.

**Minimal fix/test:**
- Call `lstatSync()` unconditionally; treat **only `ENOENT`** as absence. Reject symlinks, including dangling ones.
- Add dangling-symlink controls for direct factories and driver initialization, asserting rejection **before engine open**, no target creation, and appropriate lease cleanup.
- This fixes the existing-entry hole; it does not by itself claim protection against hostile concurrent filesystem replacement.

**Disposition:** Block acceptance until fixed and verified.

### 2. Medium — A transient acquisition/release collision makes successful engine close permanently unretryable

**Evidence:**
- `src/lib/db/writerOwnership.js:37–41,56–58`
- `src/lib/db/adapters/nativeAdapter.js:40–51`
- Corresponding SQL.js ordering: `src/lib/db/adapters/sqljsAdapter.js:114–125`

Native close sets `closed = true` **before** `owner.release()`. Release can fail merely because another process temporarily holds `.gateway-writer-acquisition`. Subsequent `close()` calls return immediately at line 42, so they never retry release.

**Trigger:** A contender acquires the arbitration directory just as the incumbent closes its engine. The incumbent’s release throws; the contender observes the incumbent PID as alive and refuses acquisition.

**Impact:** The engine is closed, but the original lock remains owned by a live process. Retrying close cannot release it. The driver’s close wrapper also does not clear its singleton after the thrown close, leaving the process unable to reopen normally. This is fail-closed—not concurrent writing—but an avoidable availability regression under ordinary contention.

**Minimal fix/test:**
- Track engine closure and successful ownership release separately.
- After engine closure, permit subsequent close calls to retry **only release**, without reclosing the engine.
- Preserve the distinct SQL.js policy for uncertain publication; do not automatically release a deliberately retained uncertain-ACK lease.
- Add a deterministic control that holds the acquisition gate during close, removes it, retries close, and verifies another owner can acquire.

### 3. Medium — SQL.js intercepts termination signals without terminating

**Evidence:** `src/lib/db/adapters/sqljsAdapter.js:77,128`; contrast native handling at `src/lib/db/adapters/nativeAdapter.js:21–22`.

SQL.js installs `flush` directly as both `SIGINT` and `SIGTERM` listeners. That function only persists dirty data. Installing a signal listener suppresses Node’s default termination behavior, and this handler neither closes the adapter nor exits.

**Trigger:** Run a long-lived server using the SQL.js fallback and send SIGTERM or Ctrl+C, absent another application handler that independently terminates it.

**Impact:** The server can remain running and continue accepting work after a termination request. Its writer lease remains held. A supervisor may eventually force-kill it, undermining graceful shutdown expectations.

**Minimal fix/test:**
- Establish a consistent application-owned shutdown path: stop serving, perform bounded persistence/close, then terminate.
- If adapters retain responsibility for signal handling, SQL.js needs an explicit terminating handler, with failure behavior defined.
- Add a child-process signal test with a persistent event-loop handle; verify bounded exit, committed-file contents, and ownership disposition. A child that naturally exits would not expose this defect.

## Acceptance and coverage

- **Do not mark the prerequisite accepted on this review.** Windows remains unverified, and the Linux-first acceptance proposal is not an approved gate change.
- The reported passing Bun/better lanes and 37 focused controls do not establish coverage of the three paths above.
- The two retained analytics failures remain separate. I am **not recommending unrelated analytics repair as a condition for fixing these lifecycle/path issues**.
- In the inspected bodies, the R4 Bun-specific `close(true)` policy is consistently used for normal close and initialization cleanup. I found no additional concrete defect in that particular change.

**Review limitation:** I read the complete bodies of all 11 scoped production modules and `plan.md`. The mandated finalization stop prevented completion of the required tests/consumer review and detailed phase, manifest, disposition, and runtime-receipt review; some requested reads were spilled before inspection. I ran no commands or tests and independently recomputed no hashes. Therefore this is an **incomplete independent advisory review with actionable findings**, not completion of the full-source-review gate or certification.