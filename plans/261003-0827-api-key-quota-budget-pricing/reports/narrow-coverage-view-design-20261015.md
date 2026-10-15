# Narrow private coverage-view design — review only, 2026-10-15

**Status: DESIGN REVIEW COMPLETE; CONDITIONAL PROPOSAL, NOT APPROVED FOR IMPLEMENTATION.** Operator authorized this design review only. Previous rejection of general frame C remains binding. No source/test change, new test run, profiler, live operation or activation is part of this document.

## 1. Outcome and bounded proposal

Try reducing repeated **coverage-sidecar reads/parse/validation only within one synchronous `captureGeminiUploadedResourceSync` call for one resource**. Do not share resource rows, request authority, lifecycle receipts, SQL results, writer ownership results, grants or timestamps. Do not extend a view to the next resource or any other call.

This is a changed observation contract, not a semantics-preserving refactor. It is proposed because the old profile attributes substantial nested work to coverage.current and the source shows crypto/retired-binding reads repeatedly re-enter it. The actual savings of this narrow subset are **unknown**. The existing profile cannot determine how much belongs to fingerprint calls versus required status calls, or prove it will satisfy the deadline.

Acceptance remains the original semantic, actual producer and bytewise gates at unchanged deadlines. No whole-feature completion follows from this design or its approval.

## 2. Current observation path (source evidence, not exact dynamic counts)

| Ordered operation | Current observations | Proposed behavior |
|---|---|---|
| `assertGeminiOwnedFileAuthoritySync` | Private capability/DB/model identity, fresh safe original snapshot and equality; calls every resource verifier | Unchanged; no captured result reused across calls/resources |
| `assertGeminiOwnedUploadResultSync` | Exact issued upload identity/DB, safe binding equality, current clock; compares returned resource with issued result | Unchanged |
| Registry `captureGeminiUploadedResourceSync` / `read` | Safe binding, db health, fresh SQL registry row; fresh lifecycle receipt, envelope schema/signature, file metadata/timestamps | Fresh SQL/lifecycle/schema/file checks unchanged; only coverage crypto material may use the private scoped view |
| Lifecycle `owned` / `load` | Private store/failure state, writer inspection before/after; file existence/stat/read/parse/signature; current coverage ID, receipt digests, monotonic lifecycle generation | No lifecycle envelope/result reuse; every existing writer check and `coverage.status()` remains fresh |
| Registry signature | `coverage.fingerprint()` currently does full coverage.current, then HMAC | HMAC uses pinned private coverage binding key; still perform writer/health/policy-marker guard for this invocation, but no coverage-sidecar read at this particular invocation |
| `requireBinding` / `freshBinding` | `captureQueuedRequestAuthoritySync`, apikey connection check, independent coverage status/gaps, exact domain-separated binding digest | Actual authority SQL captures and comparisons unchanged; status calls remain fresh; only fingerprint/retiredBindings coverage view substitutions described below |
| Queued request authority | Health; fresh coverage status; joined key/binding/settings/connection/ledger SQL; active/binding checks; credential fingerprint; validateKeyBindings; optional pool SQL; fresh ending coverage status | Preserve SQL query order and every actual status call. Fingerprints use pinned key; retiredBindings reads pinned retired list under invocation guards |
| `validateKeyBindings` | Duplicate/shape checks; current retiredBindings; fingerprint; fresh prior-ID and reverse-fingerprint SQL reads | Keep all key checks and both fresh SQL reads; only retiredBindings sidecar observation is pinned |
| Resource active/expiry and result equality | Current per-call timestamp vs createdAt/expiration; exact issued result comparison | Unchanged, not frame timestamp/cache |

`coverage.current()` currently checks writer ownership, sidecar size/JSON/schema/id/key/generation/policy continuity, acknowledged maintenance history, fresh SQL policy marker and advances retained coverage state. `coverage.status()`, `fingerprint()` and `retiredBindings()` trigger it. The proposal applies **only** to explicitly wired private fingerprint/retired-binding readers in this exact resource operation. Public `fingerprint`/`retiredBindings` always retain current behavior. No singleton active-view flag may change their semantics. A private operation-bound dependency graph would need to reach registry signatures, lifecycle verification and queued binding validation; that wiring is not yet demonstrated.

## 3. Exact proposed observation contract

1. On entry to one resource capture, perform a **complete ordinary coverage.current verification**, obtaining a private detached immutable coverage state. No caller-provided state/Boolean/frame can replace it.
2. While that call is active, coverage fingerprint and retiredBindings may use this captured key/retired list instead of rereading the coverage sidecar. Preserve input validation, each invocation's writer ownership check, unhealthy check and fresh SQL policy-format marker validation; do not cache those results.
3. Every existing `coverage.status()` still performs its ordinary full fresh verification. Its result must pass the private scope's equality/latch check **before any following scoped operation can use it**. Compare detached validated JSON data recursively with exact array order and exact property sets/values, ignoring object insertion order only; all fields including binding key, retired bindings, maintenance/releases, gaps, generation, policy format and any other validated retained fields belong to this equality domain. Differences, validation/read errors or forbidden reentry latch failure. Existing monotonic state updates are not rolled back; no pinned or refreshed state is usable by the private readers after latching. This intentionally rejects persistent coverage changes during the operation rather than silently mixing versions.
4. Immediately before returning success, perform another full ordinary coverage.current verification and require exact validated-state equality with the entry state. Every scoped use checks lifetime/failure latch. Resource-row/lifecycle checks still execute in their original order; the extra fence is not a transaction. On error, invalidate before cleanup, preserve the primary error, and do not run any stale-authority effect during cleanup. A final fence is a successful-return condition, not rollback of intermediate effects.
5. On throw, invalidate the view in `finally`. Never return a reusable view, token or unchecked state. No promise/await/caller callback is permitted to carry it elsewhere. Nested/reentrant attempts to open another scoped view fail closed; reject thenable or Promise escape without running foreign accessors. Do not catch/fallback to weaker authorization.
6. **No view reuse across resource captures**, even when one capability owns multiple resources. No view across grant assertions, pricing capture, pushes, callbacks, finish, enqueue/dequeue, pre-POST, post-yield, completion or own ACK. Existing before/after checks all remain real calls.
7. No change to file/DB formats, price/rate/counter semantics, public APIs, default grants, upload ownership or delivered-ACK identity.

### What is deliberately no longer promised

A temporary coverage-sidecar mutation occurring entirely between the retained full observations, and restored before the next such observation, may not be seen by a pinned fingerprint/retiredBindings operation. Current separate reads **might** see it. Examples: transient maintenance/gap, retired-key addition/removal, a binding-key/ID/policy/history change followed by restoration. Some events are forbidden by managed writes, but external writers/file replacement mean no-ABA cannot be assumed.

Additionally, an invalid/truncated/unreadable sidecar or transient filesystem error at an omitted read may no longer be observed. A persistent coverage change can be acted across using pinned data **before** a retained full observation detects it. Detection and refusal of successful return are not prevention or rollback of intermediate effects. Persistent changes visible at any retained full status/final fence must refuse; the guarantee is conditional on an actual observation, not an atomic filesystem/SQL snapshot. A mutation can still happen after a final check in either design. No numerical risk estimate is justified.

The full-state equality requirement does not prove historical stability. Writer ownership, SQL marker and row reads remain separate, not an atomic transaction. A retained status that sees a change may advance monotonic state before failing; fail-closed latching must not roll it back.

## 4. Threats and boundaries

- **External process / ABA:** missed transient coverage state is the explicit new risk; entry/exit equality does not remove it.
- **Synchronous reentry/getters:** public or overridden DB methods are not trusted merely because they are synchronous. Private adapter/store provenance is a precondition. No caller-supplied callback can open a view or suppress full status checks. A reentry attempt invalidates the active view even if the inner exception is swallowed; restoration afterwards must not resurrect success.
- **Key retirement:** pinned retiredBindings may miss a transient retirement list; fresh binding prior-ID/reverse SQL checks remain but are not a substitute for that sidecar observation.
- **Scope leakage:** an async continuation or nested grant/resource must not inherit the view. Avoid general ambient flags or an exported callback-taking cache API. The implementation must establish exact owner/operation scope across module boundaries; if that cannot be proved without generalizing the frame, reject this design candidate.
- **Writer/health/policy:** do not accidentally remove these guards along with full current(). Their per-invocation checks are explicit obligations, not redundant work granted for removal.
- **Secrets:** pinned binding key/retired fingerprints stay module-private and never enter caller frames, logs, ledger, exceptions, snapshots returned to callers or durable artifacts. Dropping references is not claimed secure memory erasure.
- **Effects:** the inspected resource-capture path verifies HMACs/receipts and performs SQL reads, not registry write/retain/admit/settle. It nevertheless advances in-memory lifecycle `store.latest` and coverage state. Those monotonic updates must remain; no rollback is implied. Any concrete wiring that reaches lifecycle signing for a durable write, upload-intent mutation, queue admission, a management mutation, network work or foreign callback is disallowed. The implementation preflight must verify this read-only effect boundary and private adapter/store provenance; exceptions/exit fences cannot undo such effects. If safe isolation is not demonstrable, reject rather than expanding scope.
- **Restore/crash:** existing coverage/lifecycle format and durability rules remain; no new restore capability or cross-process snapshot guarantee.

## 5. Options compared

| Scope | Assumption | First failure / cost | Recommendation |
|---|---|---|---|
| Leave current code unchanged | A later unrelated lever becomes available | No supported route currently closes bytewise deadline | Safe existing semantics; remain blocked |
| One-resource coverage-only view as above | Repeated fingerprint/retired sidecar reads have material removable cost and explicit private dependency wiring is feasible | May still be too slow; explicitly misses state/read-error observations and may use stale data before refusal | Conditional design only; not yet a recommended implementation |
| Share SQL/binding/lifecycle/writer or extend across resource/push | Wider consolidation yields more savings | Broadens missed changes and reentry/ownership hazards; conflicts with previous C rejection | Excluded; not authorized by approval of this document |

Better approaches: none demonstrated that preserve all current observations and close the measured gap. This proposal minimizes the changed state dimensions; it is not claimed the fastest or sufficient.

## 6. Implementation preflight and rejection criteria (only after approval)

Before any product patch, produce a source map of current() call sites and private-scope plumbing; reject if private provenance and exact resource-call scope cannot be implemented without caller-accessible/ambient authority. Freeze relevant source/test dictionaries and selected-file backups, preserving unrelated WIP. Enumerate direct consumers before the gate.

Test-first controls must cover:

- Forged/foreign DB/capability/view, copied issuer, malformed input/getter/proxy, nested/reentrant invocation and exception/promise escapes; no trap-based view acquisition.
- Persistent coverage change at retained status/final fences: maintenance, gap, retirement, key/ID/policy/history drift, monotonic generation; latched refusal even if inner failure is caught.
- Explicit observation-contract test documenting a mutate-and-restore between retained observations as potentially unseen, **not** an equivalent-semantics test or atomicity proof.
- Unchanged actual writer/health/policy marker, joined authority SQL, binding prior-ID/reverse SQL, lifecycle receipt/file signature, resource timestamps and each-resource checks; faults remain visible at each preserved guard.
- Before/after each push/callback/finish plus actual queue/pre-POST/post-yield/terminal own ACK drift; new observations must start after each boundary.
- Full original POST, observed usage/original prices, own pending/settled ACK, held/lost/revoked completion; no duplicate debit.

Then unchanged focused controls, original actual producer cases and original bytewise test under existing test/hook deadlines. A focused green cannot override producer/bytewise failure. Any correctness failure or original bytewise timeout rejects this performance candidate; archive patch/evidence and restore only its selected changes, leaving feature WIP intact. Do not repeatedly tune tiny variations after rejection without new evidence. Broad direct-consumer verification is required before feature acceptance, even after these narrow gates pass.

No matched speedup, enough leverage, all-adapter safety or whole-feature acceptance is promised. Design approval is separate from implementation success.

## 7. Read-only feasibility map and conclusion

The operator's review authorization already covers this inspection; **no additional approval is needed merely to finish reading/designing**. Advisor review identified effect-boundary and cross-module scoping gaps; these are hard feasibility gates, not assumptions to silently accept. No independently verified implementation or benchmark exists.

| Module | Concrete wiring required for a candidate | Read/write and provenance constraints |
|---|---|---|
| `accountingCoverage.js` | A separately private operation-owned reader; public methods never consult active-view flags. Entry/final/current status equality and latches must be coordinated here with existing lexical state/owner. Preserve original guard order. | Current API returns a mutable public object with closures; it has no private resource-operation registration API. New provenance plumbing is required, not a one-line cache. |
| `geminiUploadRegistry.js` | One fixed resource-capture entry using that reader; `read`, signature, requireBinding/freshBinding must pass explicit scoped dependencies. Keep write/begin/observe/revoke paths exclusively on ordinary readers. | `capture` reads SQL and constructs detached result. Do not let `write` inherit the scoped reader. No generic callback supplied by caller. |
| `geminiResourceLifecycle.js` | A distinct verification-only receipt path with explicit reader into `load`/signature verification. Existing retain/mutate paths remain ordinary. | `load` reads file and advances `store.latest`; it does not write disk. Private store/owner WeakMap exists, but by itself does not prove public DB methods are untampered. |
| `queuedRequestAuthority.js` | A private read-only capture variant wired to scoped coverage verification, not replacement `db.coverage`. Existing public capture stays unchanged. | Fresh SQL, actual settings/connection/key/binding checks preserved; detached output contains secrets and cannot expose scope. |
| `helpers/apiKeyBindings.js` | A private exact-reader path for retired/fingerprint, retaining both SQL identity reads. | Must not turn existing generic helper's caller-provided coverage object into privileged scope authority. |
| Adapter/driver provenance | Explicitly prove the exact read/health closures used by this graph, or refuse the scoped path. Cover all applicable adapters rather than silently adopting SQL.js only. | Inspected SQL.js adapter returns mutable methods; driver adds public ownerInstanceId. A matching field or captured public function alone does not establish constructor provenance. Adding a private registration mechanism would expand the implementation scope and needs its own controls. |

### Effects and feasibility result

The inspected fixed path has no intended durable/network mutation; retained in-memory monotonic updates cannot be rolled back. However, current mutable adapter/coverage dependency surfaces do **not yet provide the required private read-only operation graph**. A singleton active-view flag or replacing `db.coverage` would let indirect/reentrant operations inherit the bypass; both are rejected. A safe explicit graph is conceivable, but requires coordinated provenance and read-only variants across these modules/adapters. It is not a supported small patch or proven performance win.

**Design review outcome:** completed. The narrow consistency relaxation is precisely described, but implementation feasibility and sufficient leverage are not established. Do not recommend implementation on the present evidence. No product/test source was changed, and there is no additional profiling/test gate to wait for.

### Decision boundary for the operator

There is no remaining routine coding step that is implicitly authorized to change these observations. To pursue the narrow model, the operator would need to explicitly accept:

- Loss of the intermediate coverage-state/read-error observations specified above, including stale use before retained observation and ABA risk;
- A larger architecture effort for a private, verification-only dependency graph and actual adapter provenance, **not** ambient frame C;
- The possibility that it still fails the unchanged bytewise deadline and must be rejected/restored.

That would authorize a separately scoped architecture candidate with test-first preflight, not prove feasibility or completion. Without that explicit choice, keep current semantics and the performance blocker open. No deadlines, fresh resource boundaries, lifecycle/SQL/writer checks or own-ACK semantics may be silently relaxed. This review does not itself supersede the prior C rejection.
