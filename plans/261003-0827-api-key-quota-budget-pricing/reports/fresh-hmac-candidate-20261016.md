# Fresh-per-call HMAC representation — rejected, 2026-10-16

## Scope and outcome

After the WIP checkpoint was published, operator approved prioritizing a genuinely new, evidence-supported performance lever while preserving safety semantics. This was one bounded fresh-key representation experiment, not permission for coverage/read consolidation, key caching, deadline increases, activation, live calls, automatic publication or additional timing variants.

**Outcome: REJECTED.** The original unchanged bytewise test still timed out at5000ms. Only this candidate was archived and removed; full1865preflight source/test hashes restored exactly, independently rehashed twice. No HMAC representation change remains in product code. No new commit/push or acceptance claim.

## New evidence and hypothesis

Reanalyzed the existing `.pi/option-b-20261015/bytewise-loop.cpuprofile`, not a fresh unchanged test rerun. Node24.21.0 runtime source shows `prepareSecretKey(Buffer)` probes KeyObject/CryptoKey using caught invalid-receiver exceptions before selecting bytes. Existing sample attribution: `prepareSecretKey`670.115ms inclusive, `createHmac`880.148ms inclusive, nested slots self625ms approximately. These overlap and are not additive or guaranteed removable wall time. Existing byte loop was about7509ms; crypto evidence did not establish that this alone could bridge the5sdeadline.

Hypothesis: constructing `createSecretKey(Buffer.from(state.bindingKey,'hex'))` locally on each fingerprint call may avoid this type-probe cost without retaining keys or reducing any current-state observation. Fresh `createSecretKey` uses the runtime's buffer-only preparation path.

Dummy diagnostic `b17a169d6` passed16exact digest vectors and equal checksums. Three alternating isolated-process rounds,6000calls each, Buffer1326.260/1578.993/870.954ms versus freshSecretKey556.764/393.997/454.354ms. Fresh key bytes on every call, rotating dummy keys, no warmup or cache. Variation and scope prevent a pipeline speedup claim. Read-only Advisor consultation supported one low-confidence bounded candidate, not independent verification or an acceptance waiver.

## Candidate and controls

Backed up product file plus1865input dictionary under `.pi/fresh-hmac-candidate-20261016/`. Changed only two lines in `src/lib/db/accountingCoverage.js`: crypto import and the `fingerprint()` HMAC key argument. Preserved `current()`, ownership, fresh sidecar/history validation, policy SQL, input guards, hex bytes, message bytes, digest encoding and call order. No changes to `legacyAttributionId`, schema, signed representation, adapters or stream boundaries. KeyObject created anew per invocation and not retained; it adds native secret material lifetime/allocation, with no erasure guarantee or security-improvement claim.

Test-first `bd52a92b1`:0pass5fail,stable1866, expected absent fresh-key calls/failure injection. Before changing product, exact digest/read counts and mutation refusals reached their expected assertions; no test setup timeout.

Focused `bb7e828bd`:49pass0fail0pending/4files,stable1866, original gate isolation/outer300s/workers2. Five new real SQL.js controls cover exact fingerprints/fresh distinct keys, repeated current sidecar/lock/policy reads, injected SQL/read failures, sidecar generation/key removal/rotation/malformed state, ownership loss and key-allocation error propagation without fallback. Existing queued authority/upload registry/resolution capability controls included. ESLint2files exit0empty; active LSP2clean. Focused controls do not certify all runtimes/adapters or pipeline performance.

## Mandatory discriminator and restoration

`bd44cd9c2`, original `gemini-owned-upload-loopback.test.js` case `owned video metadata capability grant binds full original private upload authority through actual raw/reference/nativeSSE consumers`:0pass1fail55filtered. Log explicitly **Test timed out in5000ms**, body10704.172ms; stable1866. No instrumentation, prewarm, deadline/assertion/byte-split changes, production DB or live provider. Reporter tail duration is not success or a matched causal performance comparison. Historical gates remain failures; unmatched durations do not establish regression or speedup.

Stopped immediately: no producer expansion, unchanged rerun, fallback representation or further timing variant. Archived exact candidate source/control/patch in `.pi/fresh-hmac-candidate-20261016/rejected-candidate/`; restored only backed-up `accountingCoverage.js`, removed only the new candidate control. `restoration.json`:exact1865preflight/nochanged-added-missing, second independent rehash also exact; whitespaceclean. Four unrelated WIP paths and `.pi/` remain local. Diagnostic scripts/profiles/raw receipts are not default publication content.

## Remaining status

No supported next performance patch established by this experiment. Do not turn a micro win into a retained production change or relax freshness to compensate. Mandatory bytewise/performance remains blocked; prior2394pass10fail barrier, missing-DOCUMENT positive branch, routing/fusion integration, management/reset/restart/recovery/restore and all13acceptance criteria remain open. Enforcement remainsOFF. A further contract change or architecture experiment requires an explicit, separately reviewed decision; this rejected experiment does not authorize it.
