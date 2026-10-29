# P4 revised web preflight — feasibility proven

Supersedes the **current blocker** in [initial failed receipt](./implementation-261028-p4-preflight-blocked.md), not its preserved historical failures. User selected revision of the test seam after that STOP/review checkpoint. No shipping feature code changed during the spike.

## Evidence

Node v24.21.0, installed Next16.4.3, Linux, branch `feat/weekly-monthly-budget` from develop b41dca0a. Each separate process ran:

```bash
PLAYWRIGHT_BROWSERS_PATH=/home/gmo/.cache/ms-playwright \
node --import ./tests/fixtures/accounting/budget-web-loader.mjs \
 tests/fixtures/accounting/budget-web-fixture.mjs \
 /tmp/9router-p4-web-verified-ENGINE.json --engine=ENGINE
```

`ENGINE=node` and `ENGINE=sqljs` both exit0 within unchanged180s/process bounds. Receipts: [Node](./verification-261028-p4-web-node.json), [SQL.js](./verification-261028-p4-web-sqljs.json). Seven controls each:

1. Actual unauthenticated guarded pricing GET401, no-store.
2. Compiled login UI hydrates/submits actual login; framework cookie reaches browser, verified management GET200, expected dashboard redirect completes.
3. Compiled pricing editor sends actual PATCH200; exact `1.000000001` override read from the same source adapter.
4. Actual chat route POST export→P3 app/core/transport→dummy upstream→settled exact1200000 nanoUSD for key-one.
5. Concurrent associated key-two and unassociated key-one HTTP requests both POST200; exactly three dummy POSTs overall, exactly two ledger rows, one per identified key, no leaked association.
6. Independent persisted-image read through adapter authority verifies both terminal rows, exact original price and exact money. Actual adapter names node:sqlite/sql.js asserted in receipts.
7. Real custom-server socket wrapper with actual route guard denies hostile-Origin mutation403 and forged-peer anonymous GET401.

No framework handler failures, browser pageerrors or failed Next static assets recorded. External analytics `/gtag/js` is deliberately network-blocked and retained as such, not fulfilled/mocked. No public ledgerStartedAt stamp.

## Wiring / limits

The tests-only runner uses **actual `AppRouteRouteModule.handle`** with the installed generated template's lazy userland factory, per-request render options and shared build ID. Next owns all async stores, request proxying and Set-Cookie finalization; no synthetic session injection. The source route exports and framework module use the same installed Next module identity. The chat wrapper associates the exact framework-delivered Request before invoking the actual POST export; unassociated route uses the same actual export without association. Module import aliases reuse P3 loader. `custom-server.js` supplies real peer-header normalization. Temporary HOME/APPDATA/DATA_DIR are configured before imports, fixture DB is separately disposable, and browser external requests are blocked.

Compiled P3 artifact `.next-chat-final-261028/standalone`, build ID C6Qw38PdE4PkZDhNz-ODM and pricing HTML SHA256 are in receipts. This proves **hybrid App Route/source/UI feasibility**, not middleware/full Next standalone equivalence, P4 UI, production activation, calendar thresholds, SSE budgeting or restart acceptance. Future P4 UI requires a fresh build; standalone negative smoke remains separate and mandatory.

Budget route does not exist yet; existing guarded pricing route is the phase1-authorized HTTP/guard substitute. Future budget wrapper must associate server-owned readiness on exact Next-delivered Request in the same manner, without a shipping header/env/route activation channel. Test clock must be a domain-only capability; no global timers or network deadlines change.

## Failures retained and resolved

Initial synthetic-store login failure led to user-approved seam revision. Revised constructor expected lazy userland factory (installed template confirmed); login navigation needed explicit expected redirect wait; JSON control needed explicit stream:false matching actual chatCore default; node:sqlite scalar rows needed plain-object projection for strict prototype-independent field comparison. All red JSON receipts remain alongside this report. None were repaired by changing app guards, deadlines, concurrency, routing, auth or money.

Affected baseline remains488/488 across24files on unchanged pre-feature source. No entire phase checkbox is complete merely from this spike. Calendar/gate/typed failure tests, API/UI, full acceptance/build/measurement and CLI compatibility work remain open. Production remains OFF; P5/X/R remain open.
