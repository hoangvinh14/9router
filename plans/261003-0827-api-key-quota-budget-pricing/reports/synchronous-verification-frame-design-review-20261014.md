# Synchronous verification frame — design review and approved B decision

<a id="approved-b-20261015"></a>

## Current decision — B approved, 2026-10-15

Operator explicitly selected B: “đồng ý B”, accepting fewer intermediate observations while the five grants are read together. This approval supersedes the historical pending-approval statements below **only for option B**. It permits bounded test-first implementation and verification of B; it is not acceptance of a successful repair or permission to activate the feature.

**Approved change:** one complete private current-authority/capability/binding/resource verification per logical boundary, followed by reading and checking the five independent grants together: videoMetadata, videoResolution, clientTools, inlineMedia, inlineAudio. No reusable caller frame/token or generic caller-supplied validator. The five values are private issuance-time values with no setter; the accepted observation reduction concerns changes in underlying key/connection/resource/coverage/ownership state between the formerly independent checks, not refreshing those Boolean values. The operator considers the short interval an acceptable risk; neither risk magnitude nor speedup has been measured.

**Unchanged safety boundaries:** retain complete fresh resource/signature/binding/coverage/SQL/writer validation inside the operation; retain actual dequeue, pre-POST, post-yield, before/after callback, before/after each push and finish, pricing and terminal/own delivered ACK checks. No general coverage/binding/writer frame (C), cached authority across boundaries/requests, callback crossing, unsafe getter/proxy/thenable/reentry shortcut, deadline increase, prewarm, altered money/durability/ACK semantics or activation. This is an explicit narrow observation-contract change, not atomic filesystem/SQL execution or a semantics-preserving refactor. Existing broader prohibitions remain except for the specifically approved independent-grant consolidation.

**Implementation handoff:** reconcile current WIP and any active writer/gate before editing; map exact old/new callsites and retained boundaries; add finite positive and mutation/reentry tests and explicit transient-observation discriminators before implementing B. Use the test-first/rejection contract below, now authorized for B. Document the approved observation delta rather than silently weakening unrelated tests. Compare matched real JSON/SSE results with unchanged deadlines, original price, exact usage and own ACK; no microbenchmark-only acceptance. B reduces fixed grant-path duplication but leaves per-chunk fresh checks intact, so bytewise performance is not assumed repaired. Reject/revert for a lost promised boundary, unsafe invocation, consumer regression or failure of the agreed actual pipeline objective; no automatic expansion to C.

**Status at this decision update:** documentation only; no code/test changes, test run, delegation, live provider call or production DB operation. Performance, B/F and all13AC/G→T→I→V/C–E remain OPEN; enforcement/public/synchronous activation OFF. Prior receipts and rejected experiments remain historical evidence, not revalidated current hashes. No completion or ETA claim.

## Historical authorization and outcome — 2026-10-14

Operator explicitly approved **review thiết kế-only** after refresh-policy candidate failed. This permits source inspection/threat modeling/proposed tests, NOT implementation, shared frames, fewer checks, changed freshness guarantees or activation. Full confirmed product goals/B/F→G/T/I/V→C/D/E/all13AC remain unchanged. No gate running; original1864source/test dictionary restored exactly, all rejected experiments/failed receipts retained.

Outcome of this review: decide whether a narrowly consolidated verification operation is feasible enough to propose for separate approval. Do not label synchronous execution as atomic filesystem/SQL authority.

## Source-grounded amplification and boundaries

`requestAccounting.current(meta, original)` freshly captures queued caller authority and then asserts capability binding/fulloriginal/allresources. Each of five ownedControls grant methods calls current(), then the independent grant verifier calls full authority again. `accountedGemini.assertOwnedCurrent()` calls capture plus five controls. Thus one engine-owned check enters repeated app/current resource paths; these are nested, not six independent external I/O operations. CPU profile points to this area but does not measure exact savings.

`geminiOwnedFileUsage.createGeminiOwnedFileSseParserSync` constructor currently asserts authority plus five grants. Each push/finish repeats authority before/after; emitted event repeats it around onEvent. The user callback is an explicit mutation/reentry boundary and MUST remain separately surrounded. Private grant flags themselves were recorded as Boolean values in a private WeakMap during issuance, with no setter; that does not make current resource/credential/coverage valid forever.

`captureQueuedRequestAuthoritySync` does coverage-before → current canonical SQL view → credential fingerprint → actual prior-ID/reverse/retired helper → grammar/pool → coverage-after. `accountingCoverage.current` freshly checks writer/sidecar/history/policy SQL; each fingerprint/status/retired lookup currently invokes it again. `sqljsAdapter.get` asserts current owner/health and freshly executes, including reentry-aware leased statements. `geminiResourceLifecycle.owned` invokes withOwnershipInspection checks before/after its internal callback; load reads/signs/validates current receipt/latest generation.

Neither these DB adapters nor ownership handles are universally immutable public objects. Existing tests wrap/replace methods, SQL parameter conversion can reenter, and parser callback can synchronously mutate/revoke before returning. A frame must not treat typeof-function or non-AsyncFunction as proof that foreign work cannot occur. `synchronousResult` currently reads result.then and can execute an accessor; its rejection check is not a trusted-call proof. Do NOT extend it into a generic user-callable frame API.

## Threat model: why no await is insufficient

| Mutation source | Does synchronous JS prevent it? | Consequence for a shared frame |
|---|---|---|
| Event-loop task in same JS isolate | Usually cannot interleave until yield | Must discard frame before every await/queue/network read/delivery continuation |
| onEvent/getter/proxy/toJSON/thenable/substituted method | No; synchronous reentry executes immediately | Never span such callbacks; validate plain data first, reject reentry, fresh checks after |
| Worker/child/other OS process changing protected files | No | Can change between reads while JS is blocked in synchronous syscalls |
| Cooperative single database writer | Prevents another legitimate gateway writer, not all file edits | Owner lock is not an OS lock on coverage/lifecycle/DB artifacts |
| External change-and-restore (ABA) | No | Initial/final equality cannot prove no intermediate modification |
| Expiry/time progression inside a long sync operation | No | Fresh time/expiry must be checked near final use; a captured timestamp is not valid throughout |
| SQL/health/write failure or durable mutation | No | Frame invalidated by mutation/transaction/uncertain ACK; no reuse across intent or settlement |
| Lost/held completion ACK | Not related to synchronous authority | Row presence or valid frame never grants delivered completion identity |

Current repeated checks ALSO do not detect every adversarial out-of-band ABA. But eliminating observations enlarges which mutations can go unobserved. Therefore a before/after sandwich is NOT behaviorally equivalent to existing repeated checks, even if private flags are immutable and there is no await. Managed-restore/no-external-antirollback scope does not authorize ignoring live file mutations that current checks can detect.

## Options

### A — Preserve every current observation, no shared frame

Preserve all existing grant/resource/coverage/writer/SQL checks. Pure implementation changes within each check remain allowed, but no successful pipeline candidate has been demonstrated. Assumption: enough incidental work is optimizable; fails first when fresh reads alone dominate. Safest semantics and cheapest operational change, but no promised deadline repair.

### B — One consolidated private authority-and-grants operation per logical boundary

Proposed change: privately return all five immutable flags alongside fulloriginal/currentresources after a complete current capability/binding check, then enforce mode equality together. Caller receives no reusable frame, serialized token or public caller-supplied validator. Repeat the complete operation at EVERY existing externally meaningful boundary: actual dequeue, pre-POST routing and after transport yields, before/after callback, push, finish, pricing read and terminal release. Do not share SQL/coverage frames inside their own validators in the first candidate.

This only removes repeated full validation for independently read immutable grants **inside one logical boundary**. It leaves underlying resource→signature→freshBinding→coverage→SQL/writer checks intact and all bytewise/callback before/after checks intact. Smaller blast radius than a general coverage verification cache; potential substantial fixed JSON grant-path savings, but not guaranteed bytewise performance.

Assumption: operator accepts changing independent-grant freshness observations into a bounded logical operation. Fails first if external/programmable mutation can occur between flag decisions and current-use checks, or tests show lost boundary/drift acceptance. This is a CONTRACT CHANGE relative to the current explicit prohibition/check-count guarantees. Additional final reread can protect persistent endpoint mutations but cannot restore all removed transient observations. Needs explicit approval before any code/test-first implementation.

### C — General shared coverage/binding/writer frame

Capture read material once and use it for fingerprint/status/SQL adapter operations until frame exit. Could reduce dominant repeated file reads, but spans many public methods, private histories, marker reads and helper predicates. Needs read-set/version validation, trusted adapter provenance, write/reentry invalidation, clock rules and protected-file coordination. Initial/final reread still cannot preserve intermediate ABA observations. An actually atomic cross-artifact protocol would require coordinated writers/versioned storage/restore changes not currently scoped. Reject as next implementation: larger security/restore risk than B and no established equivalence/performance design.

**Better approaches:** none currently proven to deliver performance under unchanged guarantees. If a separately approved guarantee adjustment is chosen, B is smaller/easier to abandon than C; it is not accepted automatically by this review.

## Historical recommendation — superseded only by the B approval above

1. **Reject a general "atomic synchronous frame" claim and option C.** No OS-level atomicity is provided by the current code.
2. Under unchanged contract, choose A; performance stays a real blocker, not waived support.
3. If operator wants to evaluate a materially different verification model, separately approve **B only**, explicitly accepting consolidation of independent grant observations within a logical boundary. No broad coverage/binding/owner-frame sharing, callback crossing or read-result cache. Approval must state the changed guarantee; do not describe it as a no-semantics-change refactor.

This review recommends B as the *smallest proposed architecture experiment if a contract adjustment is accepted*, not as a proven repair. The feature-completion request and design-only approval do not already authorize it.

## Test-first and rejection contract for B — approved, NOT launched here

- Positive full JSON/SSE original→pending-beforePOST→observed money/original drift→exact own delivered ACK; missing mode/grant failures are not positive coverage.
- Five-grant true/false matrix even with controls absent, copied capability/control/issuer/cross-key/DB/model/original rejection, strict defaults.
- Persistent revoke/expiry/key or connection change/coverage gap or maintenance/lock replacement/corrupt sidecar before and after every logical boundary, queued actual-dequeue and held post-durable delivery.
- onEvent mutation/reentry/throw/nonundefined/promise/thenable/getter safety: callback work always outside any frame; after-callback fresh check rejects changed authority; latched failure cannot later recover silently.
- Original snapshot read limits/proxy/accessor rejection and trusted adapter provenance; no new generic caller closure or cache key can manufacture authority.
- Explicit transient mutation discriminators: document where current repeated checks would reject but consolidated operation cannot observe. That is the changed threat guarantee now explicitly approved for B above, not permission to weaken other guarantees silently or relabel baseline.
- Same original bytewise pushes/EOF/framing and current-resource before/after checks; unchanged5s/hook deadlines/no prewarm. Matched counts/timings scoped to candidate and originalprice/ledger outcomes; no micro/static-only acceptance.
- No price/frame reuse across lookup callbacks, await, enqueue/dequeue, persist, fetch, read, event callback, terminal or ACK delivery. Lost ACK/cancellation cannot turn into success.
- Reject/revert if any promised boundary lost, unsafe programmable invocation occurs, broad consumers regress or actual pipeline objective still fails. Existing failures retained and all13AC still open.

## Handoff / current status

Design review completed; **operator approved B's narrow changed observation guarantee on 2026-10-15**. Approval remains valid, not a pending question. The decision update itself was documentation-only; subsequent [implementation and verification](./option-b-implementation-20261015.md) consumed red8fail, focused22/22 and originalproducer2/2(JSON3933ms/SSE2445ms), then originalbytewise5stimeout/body7975ms. This B candidate was **rejected and fully restored** per rejection contract; exact1864currentpreflightdictionary/nochanged/added/missing/white0, not historical `/tmp` equality. No gate running/retained B implementation; no automatic C/check/deadline/prewarm expansion. Original audio/unrelated WIP retained, broader obligations remain OPEN, activationOFF. No completion, feasibility certainty or ETA claim.
