# Native diagnostic runner — finite zero-inference parity result

Ngày: 2026-10-17. **R3 STOPPED_MOCK_EXPORT_PARITY_BLOCKER; matrix chưa chạy, không thêm shim/rerun.**

## Current r3 — narrow interop correction, mock parity blocker

After the operator requested continued completion with anti-overengineering constraints, the assistant explicitly bounded this continuation to one known interop correction + static lock + one zero-inference parity, stopping at the next blocker. No inference/ABBA authority inferred. Artifacts: `.pi/nested-runtime-comparison-20261017-r3/`; entire r1/r2 trees and launch markers retained unchanged.

**Exact delta from r2:** `loader.mjs` adds one ESM interop facade for installed CommonJS `node-machine-id`, allowed only from `open-sse/shared/machineId.js` and `src/shared/utils/machineId.js`. Resolve the actual root installed package; assert inspected realpath; default-import its actual singleton `module.exports`, forward the exact `machineIdSync` reference and assert function type. No fake ID, function invocation by shim, package/source edits, generic export synthesis or Vite emulator. Regenerated fixture/manifest differ only by r3 runtime URL/metadata; runtime/generator/preflight/supervisor byte-identical to r2. Original7mock factories and exports unchanged. Static5MJS/PythonAST pass, LSP loader1clean;12controls and artifact/dependency inputs locked before launch.

**One result:** task `b8a2192a9`, `python3 .pi/nested-runtime-comparison-20261017-r3/run-once.py`; **exit1 / 2.892737510s**, not watchdog. Final JSON/terminal/receipt present. Same **3pass / 1fail / 8unreached** inventory:

| Control | R3 result |
| --- | --- |
| matcher-positive-negative | PASS |
| spy-positive-negative-reset | PASS |
| fixture-selection-import | PASS |
| warm-current-graph | FAIL — mock facade lacks barrel re-export `isTokenExpiringSoon` |
| setup-native-nested | UNREACHED |
| generation-reset-error-identity | UNREACHED |
| canonical-alias-actual-identity | UNREACHED |
| mock-export-shapes | UNREACHED |
| current-driver-instance | UNREACHED |
| nested-seed-and-empty-ledger | UNREACHED |
| zero-contexts-handles-network | UNREACHED |
| cleanup-owned-resources | UNREACHED |

**Read-only cause:** native linker now reports `The requested module './handlers/chatCore.js' does not provide an export named 'isTokenExpiringSoon'` from `open-sse/index.js:67`. The actual module defines that function at `open-sse/handlers/chatCore.js:672–675`; however the original fixture mock at `tests/unit/accounting-queued-fusion-app.test.js:48–59` supplies only `handleChatCore`. The generated manifest/facade correctly preserves that single mocked export. Native ESM validates the barrel's re-export against this exact facade before execution, whereas the original fixture ran under transformed Vitest modules. This is an observed **native-versus-original-mock linking mismatch**, not missing production function or proven accounting defect. No added export/undefined placeholder/actual bypass/barrel rewrite was attempted: doing so would alter the exact mock contract, explicitly forbidden by the parity proposal without renewed semantic review. Source inspection suffices to explain this failure; no post-terminal import/control probe or rerun.

The r2 named-export diagnostic is not repeated, but warm did not complete. Therefore do not claim the new interop facade's runtime/identity behavior is dynamically verified; absence of the previous first error is only progress in link diagnostics.

**Safety/resources:** handleChat0/networkAttempts0;499load-hook events/499unique paths, all generation0, not successful evaluation counts. Selected callback not invoked. Setup/reset/native adapter/DBseed/loopbackserver/teardown not reached. Disposable parent directories `/tmp/9router-runtime-parity-1j17t832/{home,data,tmp}` empty and retained. No inference, provider call, profiler or production operation.

**Preservation:** independent `final-reconciliation.json` confirms1866source/test +4protectedWIP union1869exact, before/after frozen exact, entire r1/r2 roots exact, all r3 locked artifacts/dependency inputs unchanged. Final receipts and both prior failures are preserved. Hashes below are under the r3 root; complete dictionaries in intake/frozen/static-lock/receipt/final-reconciliation:

| Evidence | SHA256 |
| --- | --- |
| frozen.json / before.json / after.json | `3230e5d60c6675044f6abac52de4cb4228e742403dc33ec15d8392c63d1d23a7` |
| loader.mjs | `03d2d0441fde32a28850a69595c3964f61d6a86d75afd4f5259ca9557991ddb8` |
| static-lock.json | `2d92508aaa92f606f10a6e4828d8293254656318dca890ff95607f9f8427bcb9` |
| parity-result.json | `384565d447d5179b358c5f8f2b3fe5fa3d4274e89d9f5a4eef93a7bb88fd9398` |
| terminal.json | `1581ab28dab239f0cbe7b071725832a195d62f94ede341aa3d0c3c020dcb9a88` |
| receipt.json | `24762a9a7938c743edb33f94d971042acbd1b25b6b79e9a520cf96c79c52f141` |
| final-reconciliation.json | `ed4736cfe6902ae667e42fae66af3a6c7293f4bedaccbd6f9658558022971c37` |

**Decision/stop:** the bounded continuation is complete, but native runner parity is **NOT complete/NOT matrix-ready**. Do not widen the mock or construct generic Vitest emulation to chase green. Next work must first settle this specific semantic mismatch or explicitly choose another comparison approach; no new brainstorm from zero required. Original8unreached obligations, actual ACK/dispatch/private issuer/cycle/lifecycle/transport parity remain unverified. No runtime performance/historical5vs4 conclusion from2.893s.

Security: denial overlays retained (not full OS sandbox), no credential/body/environment/SQL-binding dump, no original source/test/collector/deadline/authority edits, delegation/commit/push/live services or activation. **Stale-authority patch UNACCEPTED WIP; Bonly/all13ACOPEN/bytewise-performanceBLOCKED/C–Epending/enforcementpublicsynchronousOFF. STOP, no further shim/rerun/ABBA in this round.**

---

## R2 — retained renewed finite scope

## Current r2 — renewed finite authority consumed

User authorized only the diagnosed spy/reset correction, static review/hash lock and exactly one new zero-inference parity, then report/stop. New artifacts: `.pi/nested-runtime-comparison-20261017-r2/`. Entire previous root below, failed evidence and launch marker remain byte-identical; no deletion/overwrite. No production/original test change or broad loader/fixture repair.

### Exact implementation delta

- `runtime.mjs::spyControls`: retain the original positive/negative call-count checks. For `vi.fn(x=>x+1)`, override with `x=>x+10`, then verify reset clears calls and restores initial implementation, return3 and subsequent call count1. Separately create `vi.fn()` with no initial implementation, install an override, then verify reset clears calls, removes implementation, returns undefined and records subsequent call count1. No assertion dropped to obtain green.
- `fixture-native.mjs` and `manifest.json` regenerated only for the r2 runtime import URL/replacement metadata. All other generated bytes normalize exactly to r1; selected callback SHA256 remains `1a47003f1b2e0086a03b71115361d0f36097e2908be98bb8f94ece57d82041d0`, source379–430, not invoked.
- `generate.mjs`, `loader.mjs`, `preflight.mjs`, `run-once.py` copied byte-for-byte. Seven original mock factories, queued wrappers, assertion positions, denial overlays, phase order and budgets unchanged. No inference warm-up or speculative dependency interop change.
- Static prelaunch: Node syntax5MJS/Python AST pass (no dynamic controls); active LSP runtime1file/0diagnostics. Inventory12 and artifact/helper/config hashes locked before launch in `static-lock.json`; this was not functional proof.

### Exactly one r2 result

Task **`b0e292a6e`**, command `python3 .pi/nested-runtime-comparison-20261017-r2/run-once.py`; terminal **exit1**, elapsed **1.121243539s**, not watchdog timeout. Native result/terminal/final receipt all present. **3 pass / 1 fail / 8 unreached**:

| Control | Result |
| --- | --- |
| matcher-positive-negative | PASS |
| spy-positive-negative-reset | PASS — both initial/no-initial branches |
| fixture-selection-import | PASS — callback function present,7registered mocks |
| warm-current-graph | FAIL — native ESM named-export link error for `node-machine-id` |
| setup-native-nested | UNREACHED |
| generation-reset-error-identity | UNREACHED |
| canonical-alias-actual-identity | UNREACHED |
| mock-export-shapes | UNREACHED |
| current-driver-instance | UNREACHED |
| nested-seed-and-empty-ledger | UNREACHED |
| zero-contexts-handles-network | UNREACHED — later full fixture zero-work assertion did not run |
| cleanup-owned-resources | UNREACHED — setup never started |

Counters: **handleChat0 / outbound network attempts0 / app module load-hook events499**, all499unique filesystem paths at generation0. Load-hook events mean source supplied, **not499successful module evaluations**. Fixture import completed; warm import attempted and failed before setup/reset. Selected callback/request helper not invoked;0inference/ABBA. Fixture DB setup, native adapter acquisition/seed, loopback server bind and original teardown were not reached. Parent-created disposable `/tmp/9router-runtime-parity-62ayehu9/{home,data,tmp}` retained, all empty on read-only final inspection; no fixture DB file or server created. No application DB setup operation occurred. `parity-result.json` persisted by finally and supervisor reaped child on ordinary exit; no running parity gate.

### Read-only explanation of the new failure — no repair/rerun

Observed error: `SyntaxError: The requested module 'node-machine-id' does not provide an export named 'machineIdSync'`, linked from `open-sse/shared/machineId.js:1` at `diagGeneration=0`, during original `fixture.warm()` Promise.all import. Source1 imports `{ machineIdSync }`; its try/catch is inside `loadRawMachineId()`, so cannot catch this module-link failure.

Installed `node_modules/node-machine-id/package.json` is1.1.12, main `./dist/index.js`, no ESM export map/type. Dist is a UMD/CommonJS bundle: outer `module.exports=n(...)`; `machineIdSync` is assigned to an internal bundled exports variable (`n.machineIdSync=u`), not supplied as a native ESM named export in this observed path. The unchanged native loader delegates package resolution/load to Node; unlike Vite it does not implement a package interop transform. This source structure explains the observed **native diagnostic compatibility blocker**, not a missing runtime implementation of machineIdSync, production routing bug or performance cause. No package function was invoked to probe machine identity; no additional import/control execution after terminal. No loader/facade or production import fix was attempted; r2 authorization is exhausted.

### Preservation, exact artifacts and limits

Independent `final-reconciliation.json`: all1866source/test inputs +4protected WIP (union1869) exact; before/after dictionaries identical to r1 frozen; all previous-root files including receipts/marker exact; all r2 prelaunch-locked artifacts, helper files and config hashes unchanged. Frozen dictionary SHA256 `3230e5d60c6675044f6abac52de4cb4228e742403dc33ec15d8392c63d1d23a7`. Four per-path protected hashes and complete prior-tree hashes in `intake.json`; per-input hashes in `frozen.json`/`before.json`/`after.json`.

All paths below are under `.pi/nested-runtime-comparison-20261017-r2/`:

| Evidence | SHA256 |
| --- | --- |
| runtime.mjs | `17361ca3df68bae58a27b9c60b68d26569802117a6dcfe1697bebe6abaabb64d` |
| fixture-native.mjs | `17c46cb24c7c1825a9dab11738d154bb6164b170f57b9ab361103351bb3aaba9` |
| manifest.json | `681989ddb95e270aeae9cf69e42830214799f2763b1c6635c82dadf70039956a` |
| static-lock.json | `71f025b57666a06bdc0044673dfd886f21439c5d40b59473522ff7a3cd87bd0e` |
| parity-result.json | `09dd113f521a10d84cd16f4044b9251193764e94e515f36a94a7d6f424573f8e` |
| terminal.json | `148d248bcbd64a2d961cb4ec10b0cb846c9a7855631fed08fcf627d074e72f2e` |
| receipt.json | `c225bbaeb21bf9b0b15775f9657ec863a4a29b3b731f653390fffcc71c7b6d11` |

Full executed artifact hashes are in receipt/static lock, independently checked against final bytes. R2 run-once marker retained. No post-terminal executable artifact modifications; only read-only reconciliation evidence and documentation appended.

Standalone matcher/spy subset now passes; **runner parity remains NOT verified / NOT matrix-ready**. App graph reset/error identity, aliases/facade exports, actual driver/seed/empty ledger, full zero-work assertion and original cleanup remain unverified. Actual delivered ACK/private provenance/cycle/back-edge/dispatch/transport/late-owner behavior and full deadline scheduler parity were not exercised; no paired A/Vitest comparison. No timing/performance inference or historical nested5vs4 explanation from preflight duration.

**Security/operations:** preflight-only handleChat/network denial overlays retained, not a complete OS sandbox or matrix conditions. No credentials/environment/body/SQL-binding dumps, live providers, production DB/services, delegation, commit/push, enforcement or collector/deadline/authority changes. Patch stays **UNACCEPTED WIP**, Bonly/all13ACOPEN/bytewise-performanceBLOCKED/C–Epending/enforcement/public/synchronousOFF. **STOP after this result, no second r2 parity and no ABBA.**

---

## Historical r1 — retained failed evidence (not current execution authority)

## Quyền và scope

User explicitly authorized implementing diagnostic runner and exactly one bounded zero-inference parity round, then report/stop before A→B→B→A. Reused [comparison proposal](./nested-runtime-comparison-proposal-20261017.md); no renewed brainstorm or product contract change.

Implemented artifacts under `.pi/nested-runtime-comparison-20261017/`: AST extraction generator, generated fixture, pinned matcher/spy support, native module loader with generations/mock facades, zero-inference preflight, exclusive run-once supervisor, manifest/frozen dictionaries/README. No src/open-sse/tests edits. Diagnostic implementation is **not validated or matrix-ready**.

Selected deliver callback preserved by AST source extraction (`tests/unit/accounting-queued-fusion-app.test.js:379–430`, SHA256 `1a47003f1b2e0086a03b71115361d0f36097e2908be98bb8f94ece57d82041d0`). Not invoked. Seven original mock factories preserved; native imports/setup/teardown prepared, not all executed. Matrix observation config/launch remains disabled/not delivered as an executable matrix gate.

## One finite round

Task `bf5333a76`, command `python3 .pi/nested-runtime-comparison-20261017/run-once.py`.

- Terminal exit **1**, elapsed **0.417 seconds**, not timeout.
- Final `parity-result.json`, `terminal.json`, `receipt.json`, before/after dictionaries and private log present.
- Inventory12controls: **1 pass, 1 fail, 10 unreached**.
- PASS: matcher-positive-negative (bounded matcher subset, not full Vitest semantics).
- FAIL: spy-positive-negative-reset — `AssertionError: expected NaN to be undefined` at runtime.mjs:48.
- UNREACHED: fixture-selection-import, warm-current-graph, setup-native-nested, generation-reset-error-identity, canonical-alias-actual-identity, mock-export-shapes, current-driver-instance, nested-seed-and-empty-ledger, zero-contexts-handles-network, cleanup-owned-resources.
- **0 handleChat calls, 0 outbound network attempts, 0 application module loads.** App/fixture imports, DB setup, loopback server and teardown never started. Disposable parent-created directories remain as run artifacts; no application DB operation occurred.
- No inference, matrix, profiler, production build or production test suite execution. No rerun, no optimization variant.

## Root cause of this preflight failure

This failure is in **the new control expectation I wrote**, not a demonstrated product or loader defect.

`runtime.mjs` creates `vi.fn(x => x + 1)`, calls mockReset(), then incorrectly expects `spy()` to return undefined. Installed `@vitest/spy`4.1.11 source:

- `tests/node_modules/@vitest/spy/dist/index.js:151–156`: reset clears observations and restores mockImplementation when resetToMockImplementation is true.
- `:179–189`: fn(originalImplementation) sets resetToMockImplementation:true.

Therefore the original x=>x+1 is restored, spy(undefined) returns NaN. Source evidence explains the observed failure without another execution. The fixture's own network/legacy spies are initially `vi.fn()` without implementation, a distinct case the control should not conflate.

No diagnostic source was repaired after the run, and no second parity invocation was attempted. Exclusive launch-once marker retained. A later correction would need a new approved finite scope/artifact set; do not delete the marker or overwrite failed evidence.

## Preservation and static evidence

-1866 frozen product/test inputs unchanged before/after.
- Four protected unrelated WIP paths unchanged; one already in the1866 dictionary, so union is **1869**, not1870.
- Executed artifact hashes unchanged per terminal receipt.
- Before launch: generated JS/loader/preflight syntax checks and Python compile check passed; active LSP5files clean. These static results did not detect the incorrect behavioral expectation and do not override the failed preflight.
- No production/test changes, no delegation, commit/push, provider calls or service operations.

## Limits and security

Preflight-only deny overlays block handleChat entry and outbound fetch/socket/HTTP. They are containment, not native transport/timing evidence, and are not a complete OS sandbox. They must not be reused as matrix measurement conditions. Here the run stopped before any app load.

Private WeakMap/issuer identity, reset behavior across app graph, alias/cycle equivalence, actual adapter, setup/cleanup and actual ACK semantics all remain **UNVERIFIED**. Pinned helper reuse alone does not prove parity. No conclusion about Vitest overhead, production performance, nested readiness or historical5vs4 follows from this run.

Patch stale-authority stays **UNACCEPTED WIP**; Bonlyactive/all13ACOPEN/bytewise-performanceBLOCKED/C–Epending/enforcement/public/synchronousOFF. Missing native/SQL.js positive and affected-consumer receipts remain unchanged.

## Handoff

R1 authorized finite round was consumed; **stop before matrix** applied at that checkpoint. Its failed evidence remains immutable. A subsequent explicit user authorization allowed the single r2 correction/parity reported above; that renewed scope is now also consumed. No further repair/retry or matrix run is authorized.
