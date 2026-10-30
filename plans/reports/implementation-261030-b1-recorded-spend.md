# B1 implementation — revised durable-evidence policy

## Status

Complete within selected Linux Node SQLite/SQL.js fixture scope. User approved: “Duyệt đề xuất: chấp nhận sai số do crash, budget theo bằng chứng đã lưu.” This supersedes the historical compatibility stop receipt, not historical evidence. Both phases complete in that scope; production remains disabled. No real databases, production activation, commit/push/deploy.

Branch: `test/b1-legacy-provenance-gate`, base `57d82de4`. Existing unrelated dirty planning files/build artifacts preserved.

## Policy mapping

| Evidence | Disposition |
|---|---|
| Authoritative valid usage | Settle once with original snapshot/startedAt, independent of protocol completion |
| Classified interrupted+absent | `unrecorded`: nonblocking idempotency/history disposition, null cost, not a recovery work item |
| Completed+absent, malformed/conflicting observed usage | Existing safety refusal, not an interruption exemption |
| Verified abandoned pending with no stored usage/cost/terminal/audit evidence | Nonblocking `unrecorded`; approved possible crash undercount |
| Pending with contrary stored evidence after owner loss | Preserve evidence and safety obligation, not an allowance |
| Canonical legacy recovery or interrupted terminal without contrary evidence | Migration maps to `unrecorded`; no known charge is reset |
| Independent storage/identity/coverage failure | Existing safety control unchanged; unreadable evidence is not absence |

Live pending attempts remain pending. Late exact callbacks can settle `unrecorded` once in the original period. No reconciliation job or recovery UI/API/CLI is added.

## Consumer inventory (source inspection)

`rg -n 'unresolvedCount|api_key_accounting_unresolved|countAttemptStatesSync' src cli tests/unit tests/browser tests/fixtures/accounting`
found 25 matches in 13 files before consumer changes:
- Production: `budget-errors.js`, `budget-gate.js`, `budget-management.js`, `budget-projection.js`, `api-key-accounting-repo.js`, `ApiKeyBudgetPanel.js`.
- Tests: `accounting-budget-errors.test.js`, `accounting-budget-gate.test.js`, `accounting-budget-projection.test.js`, `chat-budget-loopback.test.js`, `chat-budget-reopen.test.js`.
- Browser/fixture: `budget-panel-checks.mjs`, `budget-restart-process.mjs`.
- No CLI match for these identifiers; CLI copy and projection output still require explicit inspection.

The new disposition is excluded from pending/unresolved counts and safety refusal without deleting evidence. Remaining unresolved rows represent non-exempt safety conditions; UI now labels them accounting safety errors without adding a recovery product. Existing CLI has no budget editor/copy to replace; actual management-session CRUD remains tested.

## Chronological verification history

Earlier pending/failure statements below describe their checkpoint, not final status. Final closure appears at the end. Overlapping test totals are not added.

- Initial JSON test-first: 3 expected failures (missing classification API, missing terminal metadata, terminal write invoked twice). Fixed producer ownership; 24/24 JSON/classification tests passed at that source revision.
- Initial SSE test-first: usage before EOF incorrectly null; fixed accounting/protocol separation. 46/46 JSON/SSE tests passed at that source revision.
- Ledger test-first: new state rejected. Added schema/disposition/late settlement; 10/10 ledger tests passed at that source revision.
- First chat integration run: 78/78 across 6 files passed. Later added actual interruption/EOF and malformed/completed controls; these require a fresh run.
- Active LSP: 9 changed runtime/migration files checked, zero diagnostics at probe revision. Later edits require re-probe.
- First migration safety run: 10/10 passed at its source revision.
- Late sink/migration/persisted evidence controls: 22/22 passed across 4 suites at its source revision.
- Expanded Phase 1: **156 passed / 8 failed** across 15 suites. Four actual SSE assertions exposed error-terminal DONE generation; the EOF fixture also mistakenly removed literal escaped newlines instead of actual DONE bytes. Two real-restart child failures require captured stderr before changing policy assertions. Backup suite timed out under parallel load and its next variant resolved unexpectedly; contamination is not yet established. No timeouts or assertions weakened. Narrow isolation/current-source reruns are pending.
- Selected raw protocol failure now uses private error-only terminal formatting even when settlement itself succeeds. EOF fixture now uses the shared `event('[DONE]')` encoder and explicitly asserts absence. These changes require current-source verification.
- Selected actual SSE protocol verification after fixture/error-only fix: **18/18 passed**, 2 suites, `--maxWorkers=1`, 30.29s. No-DONE/no-finish assertions retained.
- Isolated backup failure/retry suite: **4/4 passed**, `--maxWorkers=1`, 4.95s. This does not alone prove the cause of the earlier parallel-run failure.
- Migration chain run: **16/16 passed**, 3 suites, 14.10s at its source revision (further unstamped cases added later).
- Bounded Phase 1 run: **173 passed / 2 failed**, 15 suites, 153.20s. Both failures used legacy `network_unknown` as a supposed permanent malformed-evidence control; migration correctly mapped that legacy interruption on reopen. Current control now explicitly records malformed evidence and retains refusal assertions; separate interrupted-absence positive controls remain.
- Storage controls: **63 passed / 14 failed**. Eight failures showed known publication-failure pending rows classified `unrecorded` despite surviving independent coverage gaps. Recovery now consults loaded coverage and retains unresolved classification for affected pending rows; healthy rejected terminal operations now latch an independent failure gap before returning failure. Poisoned publication remains owned by application own-gap ACK protocol. Four network retry cases asserted old unresolved state inside dummy upstream; those now assert approved unrecorded interruption semantics. Current service→failure→reopen→denial and storage controls pending.
- Restart stderr captured actual `unrecorded` versus obsolete expected `unresolved`; updated process assertions require admission without waiver and preserve null cost/original period plus settled successor costs. Current process run pending.
- Crash after detecting a terminal failure but before persisting its independent gap still has the unavoidable approved pre-durable-evidence window; no claim of invoice-exact durability across that window. Gap publication errors do not produce a success ACK.
- Late evidence conflict + actual malformed/conflicting interrupted SSE controls: **16/16 passed**, 2 suites, 31.42s. Late conflicting callbacks audit/refuse without a second charge.
- Actual real process restart: **4/4 passed**, 46.08s, both backends. No waiver required for approved absent-intent crash; independent known spend/calendar/identity controls retained.
- Detected write-failure safety rerun: **54/54 passed**, 3 suites, 75.32s, `--maxWorkers=1`. Includes service rejected exact write → durable gap → reopen → denied affected key and unaffected-key control, actual poisoned-publication own-gap ACK controls, and explicit malformed-evidence gate across reopen. Malformed-write failure variant added afterward requires supplemental result.
- Final Phase 1 matrix launched across 20 suites with `--maxWorkers=1`, finite 300s wall budget. Includes new observed-write-failure/reopen test, legacy terminal replay, real process restart and storage authority controls. **246/246 passed, 20 suites, 223.76s**, task `bdaab1ab6`. Log: `.pi/tasks/01a189e7-b956-7744-9168-64f9df5d79cc-4026731/bdaab1ab6.output`. Supplemental task `b879df3b4` **28/28 passed**, 17.66s (overlapping tests, not 274 unique tests). Both actual backend loops explicitly use node/sqljs fixtures. Advisor bounded exit review allows focused Linux milestone; broader durability/concurrency/release excluded.

- Scoped runtime/migration ESLint completed exit 0: **0 errors, 2 warnings** (`import/no-anonymous-default-export` in historical migration 001 and new migration 004). Not described as warning-free.

## Phase 2 evidence

- Management/API/draft/security/actual chat focused run: **90/90 passed, 8 suites**, 81.96s, task `bc6e1416a`, `--maxWorkers=1`.
- Active LSP changed management/UI/browser fixture owners: 5/5 clean, zero diagnostics. Phase 2 scoped ESLint task `b182068ce` exited0 with no output (0 findings for its five target files).
- Fresh build task `beead02f7` exited 0 using isolated `/tmp/9router-b1-build-IGAJUV`; artifact `.next-b1-recorded-spend/standalone`, BUILD_ID `y-kR5qknFW8BhMBVv9Sku`. Build has lazyRuntime createRequire/dynamic dependency warnings and build-worker writer acquisition/active-owner messages; not a warning-free build, runtime acceptance distinct. Assets/public/custom-server copied by postbuild.
- Build provenance: ApiKeyBudgetPanel SHA256 `5dc431411ea81e182c81d46798510e4a05e75bcd5ab37628965d8d694c36fc99`; budget-management SHA256 `844605f4fc491d2a90fcba0d0a0753ec78a54c5b8d4165e3ec8f020ead68cf7f`; schema SHA256 `28f8bd519a4514b5d2f958319274e949cc6f38fc47bb9c2e8c19962da1f45802`.
- Browser/CLI exact commands and isolation/cleanup contract: [preflight](./b1-browser-preflight.md). Initial Node hybrid task `b86f2eb7b` failed before checks because disposable HOME hid browser binary cache; receipt `b1-browser-node-initial.json` preserved. Verified installed executable and absent prior fixture process; retry `b6587faca` explicitly sets `PLAYWRIGHT_BROWSERS_PATH=/home/gmo/.cache/ms-playwright` while all profiles/data remain disposable, sandbox enabled. No installation or no-sandbox workaround.
- Detached shipping smoke `b36aee184`: **8/8 checks passed**, receipt `b1-standalone-smoke.json`, same BUILD_ID. Packaged SQL.js/WASM reopened, actual server auth/Origin/no-store guards, finite production PUT409 despite forged activation headers, null-null no-op, hydrated UI disables finite save, no activation/ledger rows; child exits code0. Browser errors/assets failures empty (external analytics blocked). This is separate from hybrid source-route fixture acceptance.
- Initial affected regression `b3a2a227e`: **761 pass / 11 fail**; preserved `b1-affected-regression-initial.json`. Repo comparator correctly rejected all11 (its path rendering is `undefined` for this checkout because it assumes `/app/`; assertion identities independently extracted from JSON). Ten historical assertions expected unresolved for now-approved interrupted absence or valid EOF settlement; one hardcoded backup target schema3 despite target5. Updated only those approved expectations, retained malformed/conflicting/oversize and protocol-negative controls, and strengthened backup assertion to verify source-v1 metadata, two original rows and pre-ACL columns in actual backup. No known-fails/snapshot edits.
- Narrow consumer verification after test-only updates: **121/121 passed, 3 suites**,97.61s, `bb4fa58c9`. Final affected regression `bbe113333` now running same bounded command/JSON output; comparator follows. Not a whole-repository all-green claim. No runtime mutations since passing fresh browser build.

- Node hybrid browser/CLI retry `b6587faca`: **20/20 checks passed**, receipt `b1-browser-node.json`, same fresh BUILD_ID; includes guarded UI→API→actual chat→ledger, no unknown work for interrupted absence, valid EOF debit without DONE, preserved malformed/completed safety, dirty draft/freshness and real CLI CRUD. Mobile screenshot `/tmp/9router-budget-web-T1icoI/budget-mobile.png` visually reviewed: editor is readable and within390px viewport, action buttons wrap; long ISO reset date wraps mid-token (minor readability limitation, no overflow).
- SQL.js equivalent `bcf6bdb31`: **20/20 checks passed**, receipt `b1-browser-sqljs.json`, same BUILD_ID. Both hybrid receipts have empty browser errors and handler failures. SQL.js desktop overshoot screenshot `/tmp/9router-budget-web-J3wtHw/budget-overshoot.png` visually reviewed: exact limit/spend/overshoot and no admin recovery requirement; long ISO timestamps wrap mid-token (readability limitation).

- Final affected regression `bbe113333`: **770 passed / 2 timed out**,49 files,553.87s; preserved `b1-affected-regression-timeouts.json`. Failed identities: node actual JSON `settles the network predecessor before an actual native retry`; key-access handlers `/v1/models unrestricted sees the full catalog; restricted keys see only their entries`. Both exceeded unchanged5s budget; not waived as flakes. Logs show actual retry waits configured3000ms (default502 retry), then successful second POST/DONE around3573ms before teardown/background usage errors; setup/reopen also occur inside5s. Catalog fixture mocks connections empty (no proven external network cause); per-key timing instrumentation added to identify await costs. Diagnostic task `b083c7cc5` runs affected owners together with original5s timeouts. No increase to timeout, no fake timers/socket bypass, no runtime changes. Advisor requires actual causal trace and final gate; completion remains blocked.

- Timing diagnostic owners `b083c7cc5`:71/71 passed with original5s limits; diagnostic pass not substituted for gate. Console instrumentation was suppressed, so explicit optional file tracing used for catalog, then removed.
- Catalog diagnostic `bf117d772`:45/45 passed; `/tmp/b1-catalog-timing.jsonl` records five sequential real route enumerations1770/484/596/944/1061ms =4855ms, catalogSource false, mocked connections empty. No external-network cause asserted. Decomposed four independent policy cases; each still obtains the real unrestricted catalog and compares exact filtered results. Timeout remains5s, filtering code unmocked; assertion count increases by3, not weaker assertions.
- Retry ordering fixture clones/restores only its unique fixture executor config, keeps attempts3 and actual sockets/durable boundary assertions but uses1ms scheduling delay instead of production2–3s. Tests are sequential within isolated worker; no global timer interception/runtime policy change. Default backoff duration is outside this accounting-ordering assertion.
- Final same-scope affected gate `bdbb91a5c`: **775 passed, 0 failed, 0 pending, 49 files**, ~526s, maxWorkers1/600s. JSON `b1-affected-regression.json` has success=true and explicitly enumerated empty failure identity list. `node tests/__baseline__/verify-no-regression.mjs plans/reports/b1-affected-regression.json` exits0 (`now fails=0, baseline known=32`). Comparator's hardcoded path parsing remains unfixed but cannot hide a failure here because JSON failure list is empty. This is affected scope, not whole-repository green.
- Final test lint `bfac648bd`: exit0, no findings. Runtime/UI build linkage hashes rechecked unchanged; only tests/docs changed after fresh build. `git diff --check` clean.
- Advisor final review supports fixture-scoped closure, not independent source-level certification; untracked contents were not available to its diff review. Migration coverage includes populated legacy ledger/audit preservation, stamped upgrade, complete unstamped legacy/current replay, rebuild rollback/retry, strict verifier/hybrid refusal and real reopen on both adapters, not fresh-only creation.

## Closure and limits

B1 complete only for selected Linux Node SQLite/SQL.js fixture scope. Production activation, real DB mutation, commit/push/deploy, full-repository regression, all-provider/protocol coverage, Bun/better/Windows parity, managed restore and release acceptance excluded. Build warnings and mobile long-date wrapping retained as limitations. Possible pre-durable-evidence crash undercount and in-flight overshoot are explicit accepted tradeoffs, not invoice/hard-cap guarantees. Independent storage/auth/CSRF/ACL/identity/single-writer/coverage controls retained and tested.

Generated `.next-b1-recorded-spend/` is retained only as verification artifact, excluded from any future source commit. Existing unrelated dirty plans/build artifacts preserved. All DBs and credentials used here are disposable synthetic fixtures.
