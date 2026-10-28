# Prerequisite timeout investigation

The user requested completion on October 27. Resume the existing P3 contract
without waiving its failed verification or changing deadlines, concurrency,
durability, freshness, backup or fixture workload.

## Bounded evidence collection

Hypothesis: the combined focused suite's Node pre-RELEASE overrun occurs in a
specific fixture/publication/proof boundary rather than a retained read-only
SQLite transaction. Earlier aggregate syscall traces did not locate the
boundary. Record monotonic durations for fixture ownership/open/migration,
pricing, coverage, bindings, lifecycle, backup and the failing test's actual
publication/proof/gap/close steps. Record aggregate real fsync durations and
slow SQLite exec durations without query payloads, keys or credentials.

One 120-second profiled invocation runs the same two focused suites and their
existing five-second test deadlines. Instrumentation calls the real operations
and adds no waits or extra DB writes. Temporary source instrumentation is
removed after collecting the log. This is diagnosis, not acceptance. A repair
requires evidence identifying a cause and preserving every required guard.

Command: `timeout --kill-after=5s 120s env P3_PROFILE=1 DATA_DIR=/tmp/9router-p3-profile-261027 npm --prefix tests test -- unit/accounting-policy-classification.test.js unit/accounting-persisted-authority.test.js`.
Output: `/tmp/9router-p3-profile-261027.log`.

The profiled run passed 19 cases in 19.58 seconds. Fixture steps were tens to
hundreds of milliseconds and proof was about 9–19 ms. The region between
persisted proof and completed gap publication took 3487–3858 ms, while its
explicit fsync calls took 2–64 ms. That region also deeply compares full SQLite
Buffers with Vitest `toEqual`. A single refinement of the same two-suite
workload will separately time binary equality and gap publication, with the
same 120-second bound. This new boundary evidence justifies that refinement;
it is not a repeat seeking green. Output:
`/tmp/9router-p3-profile-refined-261027.log`.

## Proven cause and repair

The refinement passed 19 cases in 16.57 seconds. Vitest's full Buffer deep
equality took 2435/2387 ms on Node and 2603/3075 ms on SQL.js. The immediately
following gap publication took 7/5/8/7 ms. This identifies an expensive test
assertion rather than gap fsync as the dominant region. Runtime/setup
variability plus seconds of byte-index deep comparison can exhaust five seconds.
It does not prove every historical millisecond has the same cause.

The two new suites now use native `Buffer.equals` for full SQLite-file
comparisons. The invariant remains exact equality of all bytes, including
length. Neither comparison is removed, and file/backup/publication work is
unchanged. Temporary profiling was removed and the fixture restored byte for
byte to its pre-profile candidate. A normal combined focused run now verifies
the repair under the existing five-second deadlines.
