# Durable chat accounting continuation

The user resumed `ak-cook --auto` on October 26 on
`feat/durable-chat-accounting`, based on
`4cb4f80ecc5f629cd7d08c2167a443892ad38f2f`. The
[October 23 receipt](./implementation-261023-1430-durable-chat-accounting.md)
retains the failed baseline, focused verification and bounded syscall
diagnostic. This continuation does not waive those results or activate
accounting. Production data, live inference and Git publication remain outside
the task.

## Change and review

Scoped inline review covered all candidate DB diffs, new source/tests, owning
docs and the prerequisite acceptance contract. No independent full-source
review is claimed. The candidate still lacks complete request/key/route proof,
a fresh degraded-request app capability, gap ACK/one-use continuation and
JSON/SSE integration. A digest/reader primitive alone grants no POST permission.

Review found that a recording-failure proof remained available if a subsequent
engine close failed. Native and SQL.js close catches now invalidate it. The
regression controls first establish positive persisted proof and lifecycle's
production close refusal, then exercise the adapter-only engine-close boundary.
After the injected failure, proof and ordinary reads deny and ownership remains
held. Fixture cleanup restores the real close implementation and disposes the
temporary engine. No writer recovery or lease-release semantics were weakened.

The new migration's anonymous-default-export lint warning was removed by naming
the exported migration object.

## Verification

All commands run from the repository root with existing five-second per-test
limits. Disposable real Node SQLite and SQL.js adapters are used; fixtures back
up before mutations. No live upstream or DB is used.

1. New close-failure controls: two passed, nine skipped by the explicit name
   filter, in 2.51 seconds. Command:
   `timeout --kill-after=5s 60s env DATA_DIR=/tmp/9router-p3-close-proof-261026 npm --prefix tests test -- unit/accounting-persisted-authority.test.js -t 'invalidates persisted proof if engine close fails'`.
   Log: `/tmp/9router-p3-close-proof-261026.log`.
2. Affected proof/native/SQL.js publication suites: 39 passed in 19.18 seconds.
   Command:
   `timeout --kill-after=5s 120s env DATA_DIR=/tmp/9router-p3-close-affected-261026 npm --prefix tests test -- unit/accounting-persisted-authority.test.js unit/db-durable-publication.test.js unit/db-sqljs-publication.test.js`.
   Log: `/tmp/9router-p3-close-affected-261026.log`.
3. The resumed focused gate failed: 18 passed and one Node pre-RELEASE case
   timed out at 5584 ms against the existing 5000 ms limit; total 21.91 seconds,
   exit 1. Command:
   `timeout --kill-after=5s 120s env DATA_DIR=/tmp/9router-p3-resumed-focused-261026 npm --prefix tests test -- unit/accounting-policy-classification.test.js unit/accounting-persisted-authority.test.js`.
   Log: `/tmp/9router-p3-resumed-focused-261026.log`. The unchanged deadline and
   full focused workload remain required. Passing evidence above does not
   replace this combined gate.
4. Scoped ESLint passed with no warnings or errors after naming the migration
   export. It used `timeout 60s npm exec --offline -- eslint` followed by the
   15 changed/new JavaScript paths. Log:
   `/tmp/9router-p3-final-lint-261026.log`.

Required `ak-cook` failed-verification counsel completed before further edits
or diagnosis. It found no proven cause-aligned timeout repair. The native
baseline reader closes before the savepoint and proof readers close in
`finally`; there is no established retained-reader lock defect. The close
invalidation change is not on the timed-out lifecycle-refusal path. Earlier
syscall counts apply to that historical traced execution only. Fixture
creation, migrations, durable writes, checkpoint/backup, proof and gap
publication are all within this test; current timing does not attribute the
overrun to any one operation. No further diagnostic or repeat-for-green run
was performed in this cycle.

## Plan state and limits

The AgentKit index was backed up through SQLite's backup API to
`/tmp/9router-p3-plan-index-before-261026.sqlite`; `quick_check` returned `ok`.
`ak plan reindex --apply` succeeded. P3 and its named prerequisite were changed
to `in-progress` with the CLI, and the prerequisite is the current plan. No
acceptance checkbox was completed from partial evidence.

Policy migration/import/retirement coverage, complete positive/negative proof,
fresh degraded requests, native uncertainty cases and finite performance remain
required before closing phase 1. Transport, JSON, SSE and combined acceptance
follow it. No phase or acceptance checkbox is complete. The user-requested scope
is retained. A further verification cycle requires new causal evidence or an
explicitly revised verification contract; no timeout/concurrency/prewarm or
durability/freshness change was made.

Finalization checks passed: `node --check` for all 15 changed/new JavaScript
files, `git diff --check`, and 69 relative document link targets (none missing).
CLI status reports zero completed phases for both plans; no partial controls
were promoted to accepted phases. All bounded runners completed. No project
server or watcher was started and no matching Node/strace/Vitest process
remained in the final process check. Existing unrelated workspace changes were
preserved. No commit, push, merge or activation occurred.

The automatic [local journal](../journals/2026-10-26-durable-chat-accounting-prerequisite-remains-unaccepted.md)
was created with `ak journal create`. AgentWiki publish skipped.

## Unresolved question

Which operation or execution condition causes the Node pre-RELEASE test to
exceed five seconds under the combined focused workload? Existing evidence
does not establish the answer; no product decision is pending.
