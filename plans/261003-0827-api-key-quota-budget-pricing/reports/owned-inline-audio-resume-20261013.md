# Owned-file + inline audio continuation — B/F, not feature completion

## Authority and reconciliation

Operator asked to finish the accepted API-key budget feature and inspect remaining work, then requested continuation. Existing plan/design/all13AC remain unchanged; B/F alone active before G → T → I → V, then C → D → E. No scope reduction, delegation, commit/push, live billable calls or public/enforcement activation.

Read current handoff, architecture/engine/root conventions, AC matrix and remaining packets. HEAD/local upstream `0a785e597964ce9b61cabc25e31dea030aba5758`; initial status194 entries (53 tracked modified/141 untracked). All1862 source/test input hashes exactly match the owned-inline handoff dictionary, no added/missing/drift. No prior active feature writer/gate observed. Preserve all WIP and historical failures/realDB incident; no production DB inspection.

## Finite test-first outcome

`bfa70b8b1` ended FAILED: **138 passed /12 failed /0 pending**, focused three files, lint15 exit0, whitespace0, before/after1862 identical. Added14 finite controls (13 producer,1 private capability). Eleven producer failures stopped at missing mode/admission or enqueue0; the private assertion found the missing grant method. POST/raw/heldACK/downstream checks in those failures were UNREACHED, not positive coverage. Two early refusal controls passing are not delivery evidence.

Two fixture errors discovered by source review before the implementation gate were corrected explicitly: private price test must install its full modality rates, not fixture text-only defaults; absent AUDIO observed quantities cost is186000nanoUSD, not188000 (TEXT30×1 + cacheTEXT20×0.1 + IMAGE30×3 + cacheIMAGE20×0.2 + output20×2 + thought10×2, all under existing formula). Red artifacts retained, not overwritten or rebaselined.

## Implementation awaiting verification

Thirteen product modules changed coherently:

- Tenth positional private capability `allowInlineAudio=false`, strict Boolean, WeakMap-only and fresh read-only `assertGeminiOwnedFileInlineAudioSync`; public captured `{original,resources}` unchanged.
- Seventh raw-owner argument carries the independent audio grant. Existing source grammar validates inline AUDIO; allowed modality union adds observed AUDIO category, never token quantities from bytes/MIME.
- Current usage/SSE/reference-price consumers forward the exact private grant; whole original and original-price snapshot retained.
- New explicit JSON/SSE `native-gemini-owned-video-client-inline-audio-controls-*` modes require five grants. Old arrays unchanged; predicates include the explicitly composed mode, not old-mode audio permission.
- Candidate/dispatch/Base/native executor/queued Accept recognize the distinct modes. Issued private controls, service enqueue/dequeue and executor current checks compare audio grant to mode even when audio parts absent. No generic/unrecorded fallback or caller grant.

`b899ee47b` implementation contract **FAILED_TIMEOUT300s**, exit null. No final test JSON/scope/lint/after-hash report was produced. Log has terminal file summaries for capability14/14 and dispatch26/26 only; producer110 has no terminal file/case summary (log headings are starts, not proof of success). Independent full1862 rehash against pre-gate dictionary unchanged; no surviving Vitest/process observed after kill. Historical timeout preserved, no cause/cold stability/allgreen certificate. LSP probe3paths clean is scoped only.

`be1c0b73b` ended **FAILED**, all six finite nonoverlapping producer partitions consumed:11/9,19/1,12/8,11/9,20/0,10/0 (pass/fail). **110distinct =83pass/27fail**, duplicates/holes/extra empty, all group dictionaries and final full1862 hashes equal frozen contract. Filtered cases are NOT coverage and counts are not added to the killed gate. Existing deadlines/workers2/isolation unchanged. No108-consumer expansion started.

Logs classify most failures as5s test timeouts; several following cases reached `ack.calls===1` but saw2, across both new audio and historical resolution/client/image-PDF cases. This is not yet attribution to product double settlement, setup, historical baseline or timeout pollution. Producer hooks/spies currently use mutable module-global `db`, `ack`, `original` and late asynchronous work can theoretically continue after Vitest deadline; hypothesis only.

`bf32d296f` FAILED2timeouts/108filtered, stable1862; diagnostic-only trace consumed. **Concrete current-run cross-test pollution observed**: sequence1 cleanup18876.895ms, successor sequence2 setup18892.773ms, then predecessor completion19219.817ms with capturedSequence1/currentSequence2/sameDb=false and original request/attempt IDs. The spy increments mutable global `ack.calls` at that late entry, so it can corrupt the successor counter. This proves this mechanism for this diagnostic; it is NOT root cause proof for every earlier ACK2/historical failure or performance timeout. First test prepare→executorimport3591ms, then cleanup at8236ms since prepare; no deep stage/controlled benchmark attribution.

Removed ALL diagnostic instrumentation/envflag from producer. Cause-aligned TEST-ONLY lifetime guard added with3 deterministic tests: pre-cancelled work never invokes counter/durable callback; cleanup during held completion withholds delivery to successor; cancellation during delivery cannot authorize success. Producer now forwards Vitest test signal to upload/request/executor, captures per-test lifetime and DB before awaits, refuses old completion before touching counter and rechecks after actual durable/held delivery. Cleanup closes lifetime before resources. Assertions/deadlines/production authority checks unchanged; cancellation mitigation does NOT solve throughput/cold latency or waive failures.

`b3654fa8d` **FAILED/consumed**: deterministic lifetime3/3, producer1pass/1fail (JSON5s timeout/body9129.428ms; SSEpass4622.691ms with ownACK1),108filtered NOTcoverage; lint3exit0/stable1864. No ACK2 assertion in this two-case run, not proof of all historical pollution repaired. JSON timeout remains OPEN and guards after timeout not counted. Independent final1864 rehash equals gate-after; only producer-test differs from original product-contract1862 plus2newtest-only files; all13product hashes unchanged. Instrumentation absent. No gate running, no identical rerun or108-consumer expansion.

Read-only existing [bytewise architecture checkpoint](./bytewise-authority-architecture-review.md) and current registry: repeated fresh authority paths include private-original/resource validation, receipt signature/generation, coverage fingerprints, current key/connection SQL plus writer/sidecar file reads. Earlier three optimization attempts did not meet the pipeline objective and review names no demonstrated safe fourth candidate. Current JSON diagnostic does not isolate which stages dominate, so do not infer an exact root cause or invent a production patch. Further completion requires a bounded verification-core design/measurement step under explicit unchanged freshness/durability/security/deadline constraints before another optimization. This is an evidenced verification blocker, not a completed feature or permission to weaken grants/checks/deadlines.

## Current bounded measurement

Read-only [verification-core proposal](./owned-authority-verification-core-proposal.md) completed, no production optimization authorized from it. `bcbc04448` FAILED1JSONtimeout/109filtered, stable1864, body9239ms. One finite measurement consumed; no repeat forgreen. Prepare11204.182→executor-import14800.809 =3596.627ms; candidate calls708.831/752.607ms; enqueue16740.860→return17743.314→intent-delivered18659.527 =1918.667ms inclusive. Completion-enter19847.538 then cleanup19856.791; **generation-http-received/complete-durable/execute-returned NOTobserved**, so this does not prove billable POST/raw settlement/own delivered ACK. Cancellation may finish failure accounting without POST. Nested/instrumented values are not exclusive sums, a controlled benchmark or precise internal root cause. Existing assertions/test5s/workers2/task300/isolation unchanged/no prewarm.

ALL instrumentation removed by targeted edits. Independent `owned-inline-audio-stage-restoration.json`: full1864 dictionary EXACTLY equals lifetime-verification after hashes/no added/missing/changed; producer byte-equal pre-measurement snapshot; no instrumentation flags/tokens left; whitespace0. No gate running/108consumer expansion. Architecture checkpoint required before another production optimization because existing three optimization attempts had not met bytewise objective and this run shows multiple sequential costs. Continue only with an explicit design choice preserving freshness/security/ACK semantics; do not silently reduce support or deadlines.

## Fresh-equality candidate rejected; native CPU diagnosis next

Operator selected continued performance blocker work. Narrow snapshot-free equality experiment retained all current boundaries/resources/SQL/receipt checks; detailed [candidate evaluation](./owned-authority-verification-core-proposal.md). Red `bd4d99c75`1pass3fail included absent-function falsepositive in invalid-input case (corrected); semantic `bea729022`3pass1fail had spy-installation instrumentation error (corrected). `b89f619d8`4/4semantic+1000differential0mismatch+6/6in-memoryfaster, not pipeline certificate.

`ba259ba49` FAILED0producerpass2fail108filtered,JSON5stimeout9062ms/SSErunnerSTACK_TRACE_ERROR6563ms;18capability+semanticpass/lint4exit0/stable1865. No causality claim for SSEfailure. Candidate **REJECTED/FULLY REVERTED**: archive rejected source/test under `/tmp/9router-gemini-function-authority/prepared-equality-rejected-*`; independent `prepared-equality-restoration.json` exact1864originaldictionary/noaddedmissingchanged/bothcallersbyteequal/white0. Original audio WIP/test cancellation preserved.

`bbbf9aab8` FAILED/consumed:ONE original JSON5stimeout/body8208ms/109filtered/stable1864, **profileFiles=[]**. No inner CPU-cost evidence obtained; do not infer no bottleneck from missing profile. Vitest fork stop sends SIGTERM then SIGKILL500ms (installed cli-api class inspected), compatible with exit-time profile not flushed but exact cause unproven. No sourcepatch/prewarm/deadlinechange. Prior receipt retained/no rerun-forgreen.

Corrected collection via explicit `node:inspector` start/stop/write externalsetup/config: `b6ab3d6e6` FAILED/consumed JSON5stimeout8986.028ms/0pass1fail109filtered/stable1864/**profilewritten**. No app imports/prewarm/sourcepatch/changed assertions/deadline. [CPU diagnosis](./owned-audio-cpu-diagnosis-20261014.md): approximate final8997ms suite+cleanup samples resourceauthority4113msinclusive/freshbinding2453/coveragecurrent1924/SQLget1640/writerassert1174,nestedNOTadditive; snapshotcopy517msself/idle1700ms. No exactbodywindow/syscallcounts or matchedbenchmark; profiler overhead. Source reconciled fresh resource→binding→coverage→SQL/writer/sidecars; no safe next optimization demonstrated. No gate running. [Design-only feasibility checkpoint](./owned-verification-core-feasibility-20261014.md) COMPLETED/BLOCKED_NO_APPROVED_CANDIDATE; no furtherpatch/test launched, exact1864finalrehash/white0. Implementation/verification pending concrete safe redesign, not marked complete. Rawprofilecode metadata notlocals/reviewbeforepublication. No108consumer expansion/enforcementOFF/all13ACremainOPEN.

## Continued execution — bounded runtime attribution

User requested **làm tiếp cho xong plan** after confirming goals. Implementation resumed with constraints intact, not activation or a new architecture waiver. `b520c956c` RUNNING ONE per-runtime diagnostic on the same external source fixture:Vitest then nativeNode, fresh disposable SQL.js/owner/coverage/lifecycle,4seededregistryresources/32freshcaptures, same SQL/file-read counters and credential-drift refusal. Original1864source/testfrozen/no productpatch/no app prewarm/unchangedVitest5s/workers2. Native alias-only resolver for existing `@/` import. Each lane120s process ceiling/task300; no assertiondeadline expansion. Artifacts `/tmp/9router-gemini-function-authority/resource-runtime-attribution/`.

**Important scope:** seeded metadata proves registry-storage mechanics only, NOT authenticated upload/private capability/GenerateContent/pricing/ownACK/full producer repair. Native diagnostic cannot replace original Vitest acceptance. Cold imports/setup measured separately from captures with no warmup, one sample each/wrappersoverhead/runtimeorder bias; similar current fixture/key/metadata/operation counts needed before attribution. Stop if non-equivalent/insufficient, no rerun-forgreen. Subsequent cause-aligned design only if data identifies a replaceable cost. Full confirmed-product-goals and B/F→G/T/I/V→C/D/E/all13AC remain required.

### Runtime receipt consumed; pure-policy boundary candidate

`b520c956c` FAILED Vitest5stimeout/nativeexit0/stable1864. Vitest late fixture result is diagnostic NOTpositivegate. Both32captures448SQLgets1184filereads checksum544/driftrefusal/4resources/noaccountingrows; coldimports4853vs1863/setup1181vs919/captures366vs295ms (ONEeach/orderbias/wrappers/notproducerproof). No productpatch. Source inspection identified sync `Base.needsRefresh()` policy imports whole network-refresh implementations via OAuth manager/tokenRefresh. [Cold-boundary candidate](./refresh-policy-cold-boundary-20261014.md) preserves exact policy/public exports/accounting checks; test-first2cases `b2855432e` consumed0pass2fail/stable1865. Purepolicy extraction candidate `bd21e4732` FAILED23policyPass3Fail (Basecold5s/Codexrotation5s/lead600000!=432000000),producer0pass2fail108filtered(JSON5stimeout8475ms/SSErunnerSTACK_TRACE_ERROR5736ms),lint0/stable1867. No realpipelineobjective met. Candidate REJECTED/FULLYREVERTED/archive6copies/remove3newexperimentfiles/independentexact1864restored/noaddedmissingchanged/white0. No gate running/newbroadimpact/identicalrerun; originalaudioWIP/historicalfailurespreserved. No prewarm/deadline/freshness waiver; safe nextdesign stillrequired.

## Affected verification plan

Actual13 shared-module changes justify new direct import/API/text consumer inventory:110 hits,108 outside3contract files,18 finite groups of six. Set equals the historical inventory but source generation differs; historical receipt does not certify changed grants/modes. Run each group once against the final contract hashes, disposable HOME/DATA_DIR/workers2/existing deadlines, no prewarm. Keep all failure/unreached classifications, no repeated green-seeking or additive unique-case counts. Stop on drift or a gate timeout; continue independent bounded groups after an ordinary classified assertion failure without modifying frozen sources. Inventory/runner prepared under `/tmp/9router-gemini-function-authority/owned-inline-audio-resume-*`; NOT launched because producer contract remains failed. Consumer runner must bind to a future verified source dictionary1864 or successor, not the nonexistent original contract-after file; previous1862 consumer runner is stale and must not be executed unchanged.

## Remaining accepted work — not waived

- Remaining owned inline-video/resolution/processing compositions, transport/upload/resource/public-app obligations, Gemini OAuth/envelope/Vertex and other provider/protocol owners.
- Messages tool/container/file ownership/duration/protocol gaps and specialized providers with unproven exact usage remain evidence blockers; do not invent counters or treat refusal as support.
- Byte-at-a-time SSE throughput, cold setup, retained Fusion/Claude/adapter failures remain OPEN; this change neither repairs nor certifies them.
- G routed/retry/fusion/two-key integration, T unhealthy/transport, I group/cache/performance and V integrated B closure still required.
- C full budget policy→inference→ledger→UI/calendar reset/restart/header flows; D natural crash/recovery/managed restore/all-adapter parity; E full regression/current build/browser/security/docs/all13AC.

This is progress toward the accepted full feature, not production readiness. Enforcement/public/synchronous activation OFF.

## Evidence paths

- `/tmp/9router-gemini-function-authority/owned-inline-audio-resume-red-{tests.json,tests.log,scope.json,lint.log,inputs-before.json,inputs-after.json}`
- `/tmp/9router-gemini-function-authority/owned-inline-audio-resume-contract-*` (FAILED_TIMEOUT300s; timeout-rehash confirms1862 stable)
- `/tmp/9router-gemini-function-authority/owned-inline-audio-producer-partition-inventory.json`, `owned-inline-audio-producer-part*.{py,json}` / `-scope.json`, `-tests.json`, `-tests.log`, full before/after hashes (consumed83/27; no completion claim)
- `/tmp/9router-gemini-function-authority/owned-inline-audio-diagnostic-*` (2timeouts/current cross-test pollution trace, instrumentation removed)
- `/tmp/9router-gemini-function-authority/owned-inline-audio-lifetime-verification-*` (3/3lifetime +1/1producer; final1864 hashes)
- `/tmp/9router-gemini-function-authority/owned-inline-audio-resume-impact-inventory.json`
- `/tmp/9router-gemini-function-authority/owned-inline-audio-resume-consumers.py` (prepared, not started at capture)
