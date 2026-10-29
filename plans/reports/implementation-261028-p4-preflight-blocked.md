# P4 preflight — blocked at authenticated web seam

## Authorization and source

User invoked `ak-cook --auto plans/261018-0213-weekly-monthly-budget/plan.md`.
Execution branch: `feat/weekly-monthly-budget`, created from `develop` at
`b41dca0a791bd464070e4d65c667381613ed5c8d`. Node v24.21.0/Linux,
installed Next 16.4.3. No commit/push/merge/deployment authorized or performed.

The required phase-1 harness spike ran before feature mutation. No shipping
source was changed: calendar enforcement, budget management API, key CRUD guards
and budget UI are **not implemented**. The initial working tree already contained
numerous untracked `.next-*`, `.pi/` and `.unipi/` artifacts; these are not new
P4 deliverables, were not removed, and must not be staged as part of this work. Production remains OFF; no public coverage
stamp was written. P4 remains in progress, blocked, with no completed phase.

## Baseline

Command (isolated temporary HOME, APPDATA and DATA_DIR, before imports):

```bash
(cd tests && npx vitest run unit/accounting-*.test.js unit/chat-accounting-*.test.js unit/default-executor-accounting-compatibility.test.js unit/pricing-management-*.test.js unit/pricing-crud-management.test.js unit/dashboard-guard.test.js --reporter=json --outputFile=/tmp/9router-p4-baseline.json)
```

Exit 0: **488/488 tests in 24 files**, zero skipped/failed assertions and no
failed suite/import results. [Durable summary](./verification-261028-p4-baseline.json)
records canonical repository-relative names. Raw JSON/log remain in
`/tmp/9router-p4-baseline.json` and `/tmp/9router-p4-baseline.log`.
`tests/__baseline__/verify-no-regression.mjs` splits names on `/app/`, which does
not match this checkout. Its output is not accepted as regression proof; later
full-suite comparison must normalize actual repository-relative names and count
suite/import failures explicitly. No baseline list was weakened or changed.

## Test-only artifact and wiring

New files:
- `tests/fixtures/accounting/budget-web-loader.mjs`: existing P3 source alias
  loader plus explicit Next server/headers extension resolution.
- `tests/fixtures/accounting/budget-web-fixture.mjs`: disposable source-handler
  HTTP adapter, static compiled UI, real socket normalization and headless browser
  spike. **Failed diagnostic harness, not an accepted runner.**

Artifact: `.next-chat-final-261028/standalone`, compiled P3 build ID
`C6Qw38PdE4PkZDhNz-ODM`. Pricing HTML SHA256:
`a86b336c1fe148e63ca7febd94de22cc79cc3d4246dc21128b8bd9a5bc5a75f0`.
This retained artifact is a feasibility input, not evidence of future P4 UI or
current-source production acceptance.

The runner requires the actual root `custom-server.js`, reusing its HTTP server
wrapper and peer-header stripping/stamping rather than reimplementing it. It
binds a random loopback port and serves compiled login/pricing HTML and static
assets. Selected API paths construct `NextRequest` and invoke actual source
handlers. The existing guarded pricing route is the preflight management
substitute expressly allowed by phase1; it is not a budget route acceptance.
The intended inference path privately associates the server-created Request
with the P3 fixture before `handleChat`. No client header/body/env enables
accounting in shipping source. `global._dbAdapter.instance` is the source
fixture adapter; the same-process assertion and actual inference path were
**not reached**, so shared-lifetime feasibility is unproven.

Existing P3 fixture helpers create separate temporary accounting DB roots;
HOME/APPDATA/DATA_DIR are set before source imports to isolate default storage.
Browser external traffic is blocked. Test DB/server/browser close paths ran;
temporary diagnostic directories are retained. No test failure was repaired by
changing request deadlines, guards, concurrency, routing or authentication.

## Preserved failed runs

1. [Initial browser launch failure](./verification-261028-p4-web-launch-failure.json):
   isolated HOME hid installed Playwright cache; no browser assertions reached.
2. [Explicit cache rerun](./verification-261028-p4-web-login-failure.json):
   browser launched; unauthenticated actual pricing HTTP returned401 with
   no-store. Compiled login submitted to the real source login handler, which
   returned500. No authenticated assertion passed.
3. [Observation-only diagnostic](./verification-261028-p4-web-diagnostic.json):
   same runtime/guards, only bounded redacted diagnostics added. Actual
   `/api/auth/status` returned200; `/api/auth/login` returned500 with:

   > `cookies` was called outside a request scope.

Executable diagnostic command:

```bash
PLAYWRIGHT_BROWSERS_PATH=/home/gmo/.cache/ms-playwright \
node --import ./tests/fixtures/accounting/budget-web-loader.mjs \
  tests/fixtures/accounting/budget-web-fixture.mjs \
  /tmp/9router-p4-web-node-diagnostic.json --engine=node
```

Wall bound120s, process exit1. No browser pageerror was recorded before failure.
External `/gtag/js` was blocked by the network policy; this is not a successful
no-console/no-assets acceptance claim. All later UI editing/inference/ledger/
unassociated-request/security assertions were **not reached**. SQL.js web spike
was not run because the common framework seam failed first.

## Cause and stop decision

Installed `next/dist/server/request/cookies.js` requires both work store and
work-unit request store before serving cookies. The manual adapter supplied
`createRequestStoreForAPI` and `workUnitAsyncStorage` only. Actual App Route
handling in `next/dist/server/route-modules/app-route/module.js` additionally
owns action/work async contexts, cookie propagation and lifecycle. This is a **test-seam failure, not evidence of a production login defect**.
It explains the observed missing-context refusal; simply adding one store does not prove
middleware, redirects, sessions and module identity equivalent to Next.

Advisor reviewed the initial direction and the failed seam. After the second
failure it recommended exactly one observation-only capture and then stopping,
not iteratively synthesizing framework state or injecting authentication to get
a green result. That capture is complete. **Phase1 feasibility remains red.**

Next decision: review a test-only adapter based on the real Next route lifecycle
(or another demonstrably faithful same-process seam), with no shipping activation
channel. Do not proceed to calendar/API/UI implementation until actual browser
login, authenticated route, actual POST/ledger and private module/DB identity
controls pass on both adapters. Separate standalone production negative smoke
remains mandatory; hybrid harness success alone could never replace it.

## Security / compatibility findings retained

- Production authentication/CSRF/peer boundaries were not modified or bypassed.
- Legacy `cli/src/cli/api/client.js` sends only `x-9r-cli-token`; adding the named
  key-route management guard would break its key list/create/delete consumers
  when login is required. No CLI-token exemption is allowed by this contract.
- `cli/src/cli/commands/connect.js` has actual dashboard-login cookie flow but
  does not currently send mutation Origin; preserve/repair through supported
  authenticated management flow before guard edits, not by weakening CSRF.
- Dashboard key consumers include Endpoint/CLI-tools/MITM/media examples. Their
  affected checks are still phase2 obligations, not passed by the baseline.
- No raw key, password, session token, provider credential or prompt was added
  to budget projections (none exist) or durable diagnostic receipts. Diagnostics
  retain paths/status and bounded redacted error strings only.

## Checks and remaining scope

`node --check` passed for both new `.mjs` files; `git diff --check` passed.
No feature lint/full build/full-suite/browser budget matrix/performance or
restart/calendar acceptance ran. No phase checkbox was marked done. P4, P5,
X1–X6 and R remain open; this receipt does not certify all-protocol budgeting.
