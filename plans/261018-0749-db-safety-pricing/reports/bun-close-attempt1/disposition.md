# Actual Bun close boundary — FAILED, repair not authorized

Task `b3c591d89` exited1 on actual Bun1.4.3/Linuxx64 revision `c6da4a4d3010e5553438c60f6bd76d981976867c`. [Receipt](./receipt.json), [main](./adapter-close-main-result.json), [reject child](./adapter-close-reject-result.json), [holder child](./adapter-close-hold-result.json), [output](./adapter-close-output.log), [executed harness](./bun-adapter-close-boundary.mjs.txt) and setup/raw-preflight/input evidence retained here.

## Demonstrated boundary failure
With test instrumentation retaining internally prepared native statements:
1. Actual Bun factory returned `driver=bun:sqlite`; retained SELECT returned73.
2. Separate actual-factory process against the canonical fixture path was rejected while original owner was open.
3. Real public adapter.close returned; adapter health reported closed.
4. A fresh actual-factory child acquired application writer ownership and stayed open.
5. While that child owned the fixture, the retained old native SELECT still returned73.
6. Holder shut down exit0/no signal; main then asserted deterministic statement invalidation and FAILED. Child receipts pass their own narrow handshake controls; they do not make main pass.

This fails the tested **deterministic native-close-before-owner-release** contract under delayed collection. It is not a public API escape, concurrent write/corruption or data-loss demonstration. Application ownership lock and SQLite engine locks are distinct. `Database.prototype.prepare` was instrumented with preserved this/args/return and strong-reference retention; this deliberately prevents GC, not a fully transparent observer. No retained-write probe used in actual adapter test. Original property descriptor restored, retained statements finalized and engines strictly closed in finally; cleanupErrors empty is reported, not an independent process/handle audit.

[Raw preflight](./lifetime-preflight-result.json) separately passed4named controls: defaultclose retained SELECT/transaction INSERT remained executable, whereas close(true) invalidated statements and uncommitted data reopened as0rows. This supports semantics, not full wrapper acceptance.

## Not run / current gate
Repeated adapter close, initialization-failure cleanup and close-failure handling explicitly NOTRUN after first required boundary failed. Ordinary Bun driver/schema/ACL/pricing integration suite NOTRUN. All original R3 DB/test hashes, mirror DBfiles, exact harness/preload and Bun executable hashes matched after failure. No fixture writer lock observed in bounded final listing. Failed fixtures/root retained at `/tmp/9router-db-safety-bun-RuROb8`.

Bun verification remains blocked, prerequisite unaccepted WIP, P1 gate closed. Better bounded lane remains14pass, R3 combined115pass2fail/117 remains red; no cross-lane green or failure erasure. Windows evidence and independent full-source review still absent.

## Bounded repair candidate — separate approval required
Source review after failed-verification counsel confirms nativeAdapter clears the JS statement Map, invokes db.close() and releases ownership, both normal close and initialization cleanup. Bun factory delegates to that wrapper. Clearing references does not synchronously finalize native statements. Candidate: inject an explicit engine-close policy into shared wrapper, supply `db.close(true)` from Bun factory only, and preserve no-argument close behavior for Node/better. Do not infer correctness before tests; no production edit yet.

Review all acquired-connection cleanup paths. Normal close must set closed/release only after successful strict close; thrown strictclose must propagate, poison public use, retain exclusion and support explicit retry as currently intended. Initialization cleanup must also strictly close before releasing; on uncertain failure retain lock rather than hide error and allow fallback. Constructor failure before acquiring a connection remains distinct. Do not use finally to release unconditionally.

Proposed approval scope: only Bun-specific close policy and shared wrapper call sites, plus exact runtime/unit controls and documentation. Controls: repeat preserved cross-process retained-statement test with every old statement invalidated; repeated close/public methods refusal; injected initialization failure after prepare exists; injected strictclose failure/retained owner/poison/retry; committed persistence and uncommitted rollback; ordinary uninstrumented Bun factory/driver/ACL/pricing/reopen; regression controls on Node/SQL.js and bounded better lane after shared wrapper changes. Synthetic fault controls labeled separately from actual engine integration. No schema/default/analytics/accounting/inference changes, installs/global changes, support narrowing or activation. Fixed budgets and one changed-input invocation per purpose declared before launch; counsel on reds and retain attempt1.
