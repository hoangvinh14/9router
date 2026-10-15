# Conditional coverage-view candidate — 2026-10-15

**Final outcome: REJECTED and exactly restored.** Original bytewise gate still failed its unchanged5sdeadline. No candidate code or prerequisite remains in the working tree; original1865source/test dictionary restored. Feature WIP retained. See final restoration section.

Operator explicitly accepted the trade-off and requested continued work after the narrow design/risk explanation. Authorization is **one conditional experiment**, not rollout, generalized frame C, wider observation sharing, deadline changes or acceptance. Exact scope and risks: [design review](./narrow-coverage-view-design-20261015.md). Any correctness failure after implementation or original bytewise timeout rejects the performance candidate; archive/restore only its selected changes, preserving feature/unrelated WIP. Expected test-first missing-API red is not a candidate correctness failure.

## Preflight

- Node24.21.0; better-sqlite3 package exists but must not load its native addon on this runtime (project warning). Bun binary absent. No actual all-adapter execution claim can be made.
- Source/test baseline1865 entries and ten selected exact backups retained in `.pi/coverage-view-candidate-20261015/`. Backup suffix `.js.backup` avoids treating historical artifacts as live source. No whole-worktree restoration permitted.
- Private graph must not rely on exported caller registration, a forged ownerInstanceId or methods copied onto a DB object. Current factories expose mutable methods; constructor-issued provenance is the first prerequisite. Each factory must attest its own exact constructed instance and ownership closure; no common caller-populated allowlist.
- Existing writer WeakMap proves ownership but not DB constructor provenance. SQL.js/native get closures have their own current health/ownership guards; exact method descriptor comparison must avoid getters/proxies. A capture cannot bypass future method replacement, including after capture.

## First test-first prerequisite

New `tests/unit/coverage-view-provenance.test.js`: real disposableSQL.js positive exactfactory+owner/readhealth; no write/transaction/close surface; copiedDB/copiedowner/fakeownership/tamperedget refusal, retainedreadrefuses methodreplacement; foreigngetter/proxy traps untouched. Two cases; no product API implemented before receipt.

Gate `be41ca820` consumed **0pass/2fail/0pending**, originaldeadlines/frozen1866stable, both missing `coverageReadAuthority.js`; downstream security assertions were not reached. No coverage-view sharing exists at this stage, no producer/bytewise acceptance or performance claim.

## Planned feasibility boundary

Avoid a generic exported registration API: callers could register forged adapters. Adapter-local exact-instance WeakMaps can provide read attestations without caller-controlled registration. Shared verification may consume only those attestations and exact writer provenance. Static loading of any adapter verifier must not trigger better-sqlite3 addon acquisition on Node24; constructor laziness/availability behavior must be preserved and tested if changed. If this cannot be achieved without widening the accepted scope, reject the candidate rather than silently trusting plain driver fields.

## Provenance prerequisite implementation and gate

Implemented constructor-local WeakMap attestations in allfour adapter factories, exactwriterclosure+directory comparison via existing privateownerWeakMap, shared pure sealing helper (not registration), and `coverageReadAuthority.js` verifier. Lookup does not rely on driver strings, publicownerIDs or callerregistrations. Exactget/health datadescriptors checked without getters on every sealed call; a public tamper cannot be bypassed by retainedread. Parameters bounded/snapshotted and scalar-only, SELECT-only/no-semicolon guard, no run/all/exec/transaction/close surface. This is a read-provenance prerequisite, **not an operation-scoped coverage-view API**, and no coverage sharing is active.

betterSQLite constructor remains synchronous but dependency acquisition moved inside factory via createRequire; importing lookup now does not import optionalpackage/addon. DirectNode import smoke succeeds on24 without nativeengine acquisition; not actualbetterSQLite/Bun execution proof. Node/Bun engine acquisition remains constructor-dynamic. Newtest expanded actualSQL.js+nodeSQLite positive/tamper/getter/parameter/no-write controls plus foreigngetterproxy case (3cases total); no Bun/better execution in this runtime.

`b0a043943` consumed **13pass/0fail/0pending**, 3focusedfiles provenance controls + existing sqlite-engine-acquisition + api-key-budget-sqljs; lint8empty/exit0, frozen1868stable/disposableHOME+DATA_DIR/originaldeadlines. Existing engine/budget controls passed within this scope; no speedup/producer/bytewise/alladapter acceptance inferred.

## One-resource scope/fault red

`ba5b224a7` launched new `tests/unit/coverage-resource-view.test.js` **9cases** on realdisposableSQL.js registry+lifecycle storage fixture, not authenticatedupload/GenerateContent producer. Fixedoperationcoverage API notimplemented yet. Test-first expected APIabsence/copycoverage/reentry differences; existing persistentdrift controls may already pass and are not newframeproof. Firstpositive asserts structural coverage-read count7 for planned entry+fiveexistingfreshstatus+exit observations, not walltime or throughput; publicfingerprint/retiredBindings still eachfullread. Othercontrols: forged/proxyframe/copyDB/coverage/methodtamper; persistentgeneration/maintenance/retirement/key/invalidfile; swallowednestedcapture invalidatesouter; newcaptureaftercompletedoperation mustfreshread/refuseinvalidsidecar. Explicit transientweakerobservation behavior and retainedscopeescape/lifetime controls remain to specify at actualprivategraph seam, not inferred from currenttests. No genericcallback API or ambientreadbehavior switch planned.

Red consumed **6pass/3fail/0pending**,1869stable: missing fixedAPI, copiedcoverage accepted, swallowednestedcapture didnotinvalidateouter. Existingpersistent5drift+nextcapturefreshness passed oldguards, not scopedframeproof. No productsharing before redreceipt.

## Single implemented graph candidate

- Coverage module orchestrates one fixed registry read operation, createsopaqueWeakMaptoken privately, calls fixedbody, finalfullstatefence, destroysinfinally. No token/frame returned, no callercallback. Explicit dependency readers flow to registry/lifecycle/queuedauthority; publiccoverage reads unchanged. Activeoperation flag only rejects nestedcapture/mutations; it never substitutes state for ordinary publicreads.
- Entryfullcurrent; everyexistingstatus fullcurrent+exactstateequality; finalfullcurrent. Only privatefingerprint/retiredBinding reads use pinnedstate and retain writer/health/freshpolicySQL guards. ExactDB+coverage/methoddescriptor provenance required. Joinedauthority/priorID/reversebindingSQL and lifecyclefile/signature/schema/timestamp/ownership checks retained. No sharing across resourcecalls/grants/push/callback/finish/ACK.
- Registry/lifecycle/coverage mutator entrypoints explicitly reject duringoperation before durableeffects; ordinaryreadmonotonicupdates remain. Reopencoverage whileactive latchesrefusal. This is not an atomicfilesystem/SQLsnapshot or arbitraryJSsandbox.
- Source-map correction **beforefirstcandidate run**: existingstatus calls are4 (lifecycle1, queuedstart/end2, freshBinding1), not5. Structuralread expectation corrected7→6 = entry+4retainedstatus+exit; no guard removed/productbehavior changed to fit count. Prior7planningassumption retained here for transparency.
- Added2controls at actualgraph seam: resolvedreader/token unusable aftercompletion/foreignDB, explicitly omittedHMACcoverage-sidecar readerror window endingatnextfullstatus (weakerobservation, notatomicity/equivalence). Total11scopecases. This seamspy is fixtureobservation only; not productioncallback/frameacquisition path.

`bc08ef94c` consumed **45pass/0fail/0pending**, 4focusedfiles scope11/provenance3/registry14/privatecapability17, lint13empty/exit0/frozen1869stable/originaldeadlines/disposableHOME+DATA_DIR. Prior registry13 count was a documentation count error, actual14. No producer/bytewise or alladapterclaim.

`bcf4c66a0` launched originalbytewise test first (cost-dominant mandatoryrejection gate) with exact original5stestdeadline/unchangedfixture/assertions, frozen1869/disposableHOME+DATA_DIR. No stageprofiling/prewarm/coalescing/changedtesttimeout. Output `coverage-view-original-bytewise.{json,log}` and before/after/scope receipts. A timeout rejects+archives+restoresselectedcandidate before any producerexpansion. If pass, originalproducer gates still mandatory, focused45notreplacement. No source/testedits whilegate; implementedcorrectnessfailure rejects/archive/restores selectedcandidate under contract. Static analyzer staleJSON.parse warning in pre-existing maintenance release is not proof newcandidateissue; reviewgraph unavailable is not clean cascade evidence.

## Rejection and restoration — final

`bcf4c66a0` consumed **0pass/1fail/55filtered**, scope1869stable. Log explicitly `Test timed out in 5000ms`; JSON `STACK_TRACE_ERROR`, reported body19769.57ms. No stage attribution or paired benchmark; this is not a quantified regression/speedup comparison and tail assertions are not credited. Mandatoryperformance objective failed despite focused45pass/lint13clean; no producerexpansion, unchangedretry, further tuning or deadline/check waiver.

Archived exact14candidate files as `.rejected` artifacts, baseline-relative patch, candidate1869dictionary and gateJSON/log/before-after/scope/lint receipts under `.pi/coverage-view-candidate-20261015/`. Restored ONLY10selectedbaselinebackup files (one helper unchanged but exactbaseline backup retained) and removed ONLY4newcandidate files (two productmodules/two testfiles). Backup hashes checked against preflight before restore; restored full1865dictionary equals preflight exactly, no changed/added/missing paths, whitespaceclean. Receipt `restoration.json`; originalsafety/video/audio/unrelatedWIP preserved, no commit/push/live/activation. BetterSQLite lazyimport change and adapterattestations were also reverted, not retained as unrelated improvements.

Candidateexperiment STOPPED. The operator's conditional authorization was exercised once and does not authorize a succession of variants or widerC/frame scopes. The design/evidence remain as rejected history, not currentsemantics. No privatecoverageview active or backgroundgate running. Wholefeature/BF/performance/all13AC/CDE remainOPEN; no sufficient accepted nextoptimization demonstrated.
