# Historical plan snapshot — before feature packages A–E

> Superseded execution roadmap; not the current backlog or a request to repeat gates.
> Source: `../plan.md` before the operator-approved feature-complete reorganization.
> Relative links in the preserved snapshot below were authored relative to the original plan directory, not this report directory.
> Historical running/pending statements are not live task state. Original failures remain failed.

Snapshot SHA256: `4030809a06e9de2aca26baf934503bf97e2a526a8f1aeb3563240da395d1056b`. The bytes after the following marker are the exact original file.

<!-- BEGIN EXACT ORIGINAL PLAN -->
---
title: "API key quota, weekly/monthly budgets và reference pricing"
description: "Durable per-key accounting, calendar budgets cho chat + embeddings và pricing-only sync."
status: in-progress
priority: P2
effort: 88h
branch: master
tags: [feature, backend, database, api, auth, frontend]
blockedBy: []
blocks: []
created: 2026-10-03
---

# API key quota, budget tuần/tháng và reference pricing

## Overview

Mở rộng tracking SQLite hiện có để admin xem usage theo gateway API key ID, cấu hình budget tuần/tháng đồng thời và chặn upstream attempt mới khi recorded spend chạm một trong hai mức. Giá là **chi phí tham chiếu/virtual**, kể cả OAuth/subscription, không phải invoice upstream.

- Đầu vào: [brainstorm report](../reports/brainstorm-261003-1455-api-key-quota-budget-pricing.md).
- Contract authority: [thiết kế chi tiết](./design-contract.md), cùng các phase dưới đây.
- Evidence và policy validation: [prior planning validation](./reports/planning-validation.md), [Validation Session 1 source audit](./reports/validation-session-01.md). Session 1 supersedes conflicting prior report claims; prior report retained as history.
- Planning base revision `a99cf57239ff778b61e434c2786009d5ed1c412c`. The source-unchanged/plan-only claims below describe the historical validation session, not the current implementation. Authorized `--auto` execution has since modified source and run isolated tests; see the execution checkpoint.
- HOLD SCOPE; hard-depth investigation, direct execution, không independent subagent red-team. Không HTML/wiki/GitHub vì không được yêu cầu.

<a id="current-delivery-roadmap"></a>

## Hướng triển khai hiện hành — ưu tiên khép kín feature

Cập nhật sau phản hồi của user về thời gian triển khai và TODO không phản ánh đúng tiến độ. **Đây là thay đổi thứ tự thực thi và cách báo cáo, không đổi design contract, scope hay acceptance criteria.** Phần này và bảng Phases là chỉ dẫn tiếp tục; các checkpoint bên dưới được giữ làm lịch sử, không phải danh sách việc cần lặp lại.

### Kết quả đã có và khoảng trống thực sự

**Latest resume checkpoint — 2026-10-08, Gemini/Codex narrow runtime consumed; unhealthy request authority next.**
- Gemini/native text-only standard API-key `generateContent` first implementation
  connects wrapper original-intent WeakMap → sole app accounting context → core
  native mode → Base/actual strict singlePOST owner. Raw native JSON sole reader,
  exact modelVersion (no fuzzy remap), token/cache/thought/total/textmodality/tier,
  finish/cleanEOF/durableACK/terminal authorization before native return. OFF uses
  existing converter; tools/nontext/cachedContent/SSE/OAuth remain separate obligations.
- First focused `ba9c7222c`: **93/93 exact4**, pending/todo0,lint/whitespace0,
  private `/tmp/9router-gemini-json-focused-Naoz6y`. Route-functions/real disposable
  ledger + mocked network, not actual HTTP/live-provider certificate. Active LSP10
  paths0diagnostics at that source only; no comprehensive static/security approval.
- Self-review caught `serviceTier` location: official captured docs define it
  top-level, not generationConfig. Corrected guard and added standard/priority/
  wrong-location controls + post-invocation late-cancel singlecompletion. 93/93
  retained as pre-correction evidence. Current caller `be0873297` **FAILED807pass/
  1fail exact29,808complete,pending/todo0**,four serial300s shards,lint/white0,
  **1,492 inputs unchanged**. NEW `/tmp/9router-gemini-json-caller-resume-riKFfb/union.json`;
  only original combo-autoswitch:42 web_search→search unwaived, no Gemini failure.
  Current Gemini exact4 **96/96**. No assertion/deadline weakening or green waiver.
- Applicable new-source `b20a7dd6c` **PASS exit0**: build/emittedWASM, Node24
  actualGeminiHTTP **4groups**, Node22 SQL.js actualHTTP **4groups**, whitespace/
  everybarrier stability0 on **1,498 unchanged inputs**. Build
  `tmp/9router-gemini-json-owner-panel-1791441691843`, BUILD_ID `jpTxxoSkvDksJzJQ7JYO3`;
  source/emittedWASM SHA256 `38c14f6e379210bc942bdc4ebca44e7bfdb4318ecc1c72ca666a28fdce96670a`.
  Durable `/tmp/9router-gemini-json-owner-runtime-wZBwzF/{artifact,results}.json`;
  Node `nFDLUA/results.json`, SQL `F4ZoMW/results.json` assert actualengine, fourgroups,
  threeactualPOSTs/twoCONNECTs each. No binary/config patches/fetchroute mocks.
  Observed original hostedwork denial0intentPOST, heldEOF pending/no response,
  exact124000/next429, invalid-total unresolved/no successor, original124000
  recovery/replay1audit/new1170000. Disposable activation/dummy credentials only.
- JSON sourcebarrier released; continue native Gemini SSE using shared soleterminal
  owner, not another accounting context/sink. New source after barrier makes this
  build historical for SSE; do not rebuild/repeat JSON prerequisites without reason.
  No liveGoogle/GeminiSSE/OAuth/generalmodelVersion/fulladapter/security approval.
  Original callersearch red remainsunwaived. Production enforcement OFF.
- NativeGeminiSSE raw parser/tests now entry-connected (verification pending):
  native finish+exactraw usage+cleanEOF, modelVersion/responseId/text-only integrity,
  fatalincrementalUTF8/framing/nativebyte replay, sharedsoleterminal owner for
  EOF/ACK/auth holdback/failure/no-double-settlement. No synthesizedDONE or new
  total-output/eventcount restriction. Focused `b747fd158` **139/139 exact3**,
  pending/todo0,tests/lint/white0,private `/tmp/9router-gemini-sse-parser-SUeZ6I`.
  New SIX liveowner/Base/core/app+missingfinish/trailinginvalid entry tests written
  beforewiring; `bc8ec1ff9` **FAILED114pass/6fail exact3/120complete**,pending/todo0,
  lintwhite0;all six intended entry failures unsupported/wrongowner/app503 observed,
  originals private `/tmp/9router-gemini-sse-entry-before-9Zaaj8` retained.
  ExplicitnativeSSEmode now wired config/owner/Base/core/app original-route stream,
  fixedURL/parsedwire/singlePOST,sharedsoleowner transfer/noJSONfallback/doubleterminal;
  wrapper preserves markednativebytes notOpenAIreconversion. JSONfalse remains.
  Old wrapperlive-negative nowlivehostedtoolsnegative (no deletion), sevenmore
  liveOAuth/tools/query/mode/route controls. `b9a950e87` **127/127 exact3**,
  pending/todo0/tests/lint/white0,private `/tmp/9router-gemini-sse-entry-wired-4ufRbW`.
  ActiveLSP9paths0diagnostics at thissource,not comprehensive static approval.
  Current `bfd2c6b97` **FAILED860pass/1fail exact30/861complete,pendingtodo0**,
  old25+Gemini5/fourserial300s,**1494inputsunchanged/lintwhite0**; onlyoriginal
  combo-autoswitch:42 web_search→search unwaived,noGeminiSSEfailure. Private
  `/tmp/9router-gemini-sse-caller-883PVq/union.json` retained.
  Applicable `bab92b3df` **PASSexit0 build/WASM/NodeHTTP4groups/SQLHTTP4groups/
  whitespace/allstability0**,**1500inputsunchanged**. Build
  `tmp/9router-gemini-sse-owner-panel-1791443668624`,BUILD_ID `pEK-vH7b-9OUTHGz67O9t`;
  runtime `/tmp/9router-gemini-sse-owner-runtime-ApbjmG`. Node `yr32JG/results.json`
  andSQL `L6q58R/results.json` assert actualengines/fourgroups/3POST2CONNECT each,
  unmodifiedbinary/config/no fetchroute mocks. Observed hostedtools0intentPOST,
  heldEOFpendingdelta/withheldfinish→settled124000/next429,missingfinish actual
  downstreamabort/unresolved/nosuccessor,original124000recovery/replay1audit/new1170000.
  SocketfixtureASCII,notfullUTF8socketcertificate; unitallsplits separate evidence.
  No liveGoogle/OAuth/generalmodelVersion/Bun/better/fullsecurity/fullphaseapproval.
  JSONpriorruntime proof notrerun asprerequisite. Sourcebarrierreleased; next
  Codex/OAuth actualPOSTownership and remaining unhealthy/nestedfusion obligations.
- Codex nativeOAuth explicitResponsesSSE test-first owner slice: `b4c8b3dc1`
  **FAILED19/19 exact19 complete/lintwhite0/1491inputsunchanged**; original
  `/tmp/9router-codex-owner-focused-6yBpIP` retained. Four owner/executor/core/app
  positives unsupported/prefetch/app503; missingcompleted unsupported; denial
  assertions observed prefetch before guard. Not infrastructure/testdeadline error.
  Narrow mode now wired app exactResponsesroute→core originalrequest→Codex bypass
  legacy prefetch/transform/peek→existing Responses strictPOST/rawSSE/soleterminal.
  Requestlocal OAuth/account/session/proxy/header/wire; no singletonidentity reads,
  no new retry/fanout/outputcap. APIkey/compact/lite/stateful/tools/nontext/tier/
  relay/customtransport denied before generation. OFF legacy untouched. Gate
  `b8cc0203e` **PASS19/19 exact1/lintwhite0/1492inputsunchanged**,privateDOLqb5.
  Narrow routefunction/realledger/networkmock proof only; no actualHTTP/liveCodex/
  generalformat/security acceptance. Selfreview rejects Codexunsupported maxoutput/
  temperature/top_p (not silentlystrip),removed arbitrary512credentiallengthcap.
  Sixteen additional EOF/auth/cancel/interleave/credential/route/undefinedfield
  controls; `b318adf30` **PASS35/35 exact1/lintwhite0/1492unchanged**,xc2GpN.
  Caller `b9ce3b9b4` **FAILED985pass/5fail exact45/990complete/no pendingtodo**,
  fiveserial300s/lintwhite0/**1496unchanged**,A9WHd7. Originalsearch plus Codex
  litecapability/imagefetch2/refreshlead1 failures. Differential `be2ac28e6`
  **diagnosticPASS same5 failures,38pass/5fail exact4**,GNDrnq shadowcurrentcopy
  removesonlynewCodeximports+accountingexecutebranch,declaredhashdiff/sourceunchanged.
  NotHEAD/fullplanbaseline/notwaiver; caller remainsfailed. DNSmock object versus
  hardenedall:true array and refresh600000vs432000000 not fixed by weakeningsecurity.
  `b6823880f` **PASSbuild/WASM/NodeHTTP4groups/SQLHTTP4groups/white/allstable0**,
  **1502unchanged**,panel1791445656096/BUILD_ID `DRcJ0fwIS7nESykOJdxCH`,pY3VFk.
  NodePmbEmn/SQL8JN083 actualengine/4groups/3POST2CONNECT each,no config/binarypatch.
  Observed hostedtools0intentPOST,heldEOFpendingdelta/withheldcompleted→settled104000
  next429,missingcompletedactualabort/unresolved/nosuccessor,original104000recovery
  replay1audit/new1080000. NarrowOAuthnativeSSEfixtureproof,notliveCodex/refresh/
  otherformats/fulladapter/security/fullphase. Sourcebarrierreleased;next unhealthy
  requestauthority. No repeatedGemini/Messages prerequisites;OFF.
- Unhealthy requestauthority adapter prerequisite testfirst `bf64774a4`
  **FAILED26/26 exact1/lintwhite0/1493inputsunchanged**,9F9ck9 originals retained;
  all missing `provePersistedRequest`,no deadline/infrastructure error. Nowimplemented
  shared freshpersistedcaller→binding/explicitBOTHNULLpolicy/coverage→strictsettings/
  exactactiveconnection snapshot validator. Node reusesquiescentWAL/read-only/fsync;
  SQLjs reusespinneddiskimage/newfsync/noRAMexport. Deepfrozenrequestlocal evidence,
  no cache/secondwriter/healing/gapACK/price/providercompatibility authority. Existing
  unlimitedproof path preserved. `b90855bff` **PASS26/26 exact1/lintwhite0/
  1494inputsunchanged**,beSZKF. Added20controls (retired/rebound/missingpolicy/settings,
  poisonconfig/deepfreeze/rowprecedence/generation/fileidentity/closeACK/healthyclosed);
  `b7e1db537` **PASS95/95 exact4/lintwhite0/1494unchanged**,H4kl6p;
  request46+native+unlimited+unhealthyservice,assertions/deadlines unchanged.
  Sharedproof barrier consumed; not appdispatch/independentsecurity/alladapter proof.
  New requestcontext TDD `b199387af` **FAILED20/6 exact26complete/lintwhite0/
  1495unchanged**,OvSElc originals retained; failures currentunhealthyguard,
  six unknown/precedence/notarget negatives passed,no infrastructure/deadline error.
  INTERNALtarget seam nowwired: preawaitcaller/targetpin,freshsnapshot everygate/
  attempt/configcomparison/unsupported/cancelfalse; existingservice solegapACK owner.
  `b4eece1e8` **PASS26/26exact1/lintwhite0/1495unchanged**,LAgMLk;
  same26 originals preserved. Barrierconsumed; added20 authoritycontrols for absent/
  disabled/weekly/monthly/maintenance,healthy/closed transitions,terminalreproof,
  foreignowner. `bd92ce2c7` **FAILED/incomplete exact13planned**,gAlYeI:
  missingresultsJSON/observedTEST_EXIT124,verbose345finishedlines2healthytransition
  fixturefailures,tailGemini;not completeassertiontotal. Lintwhite0/1495unchanged.
  Originalkept incl incomplete-diagnosis.json; healthmock restored afterunchanged
  denial beforeunchangedsidecargap assertion,production sourceunchanged.
  `b3de1808a` **PASS535/535 exact13/fourserial300s shards allchild0/lintwhite0/
  1495unchanged**,UGOeMh; context46+proof46+old49+eightcallers completeunion,
  nopending/todo. Totalruntimeallowance larger than old monolith,pertest+eachchild
  deadlines unchanged; originalfailed/incomplete retained,barrierconsumed.
  Next persistedselection TDD `be048afdd` **FAILED30/30exact1/lintwhite0/
  1496unchanged**,mY7coK allmissingnewmethod,originalsretained/no deadlineerror.
  Node+SQLjs snapshotowned allreader + strictselectionvalidator nowwired:
  canonicalINTERNALprovider/model,priority/locks/exclusion/providerstrategy,
  noRAM/newfsync; existingexactrequestproof stillvalidates caller/config/binding.
  `b77723ab5` **PASS30/30exact1/lintwhite0/1497unchanged**,5VBPwZ;
  barrierconsumed,originalred retained. Added30controls prioritytie/zero/accountlocks/
  expiredlocks/Codexenabled/exclusions/settingsshape/generation/closeACK/healthyclosed.
  `b850f56a2` **PASS595/595exact14/fiveserial300s allchild0/lintwhite0/
  1497unchanged**,CHFccu; selection60+previous535context/proof/callers complete.
  Barrierconsumed. Appentry TDD `b49dbe9d1` **FAILED30/30exact1/lintwhite0/
  1498unchanged**,2R6Hcq ordinaryrepo seam,originalsretained/no deadlineerror.
  NarrowcanonicalOpenAIResponses poisonedentry nowwired before normalsettings/auth:
  originalroute/body guards,persistedselection/configpin,freshselection eachgate/
  perPOST,onecontext/servicegapACK owner,no poisonedrepos/refresh/cooldown callbacks.
  Budgeted/unknown/strategy/proxypool/OAuth/alias/combo/unsupported staydenied;
  failedpredecessor doesnot grantsuccessor withoutdurablecontrolplane authority.
  `bfe5e482b` **PASS30/30exact1/lintwhite0/1499unchanged**,B7JcWv;
  actualpoisonedNode+SQLjs routefunctions/mockedcore barrierconsumed.
  New realcore/realResponsesJSON+SSE POSTowner tests24 written without production
  changes: gapbeforePOST/nativeEOF/heldcompleted/missingcompleted/lostgapACK/
  freshterminalconfig/failednosuccessor/unsupportedsettings/noRAM. `b6a14ae19`
  **FAILED22/2exact24complete/lintwhite0/1500unchanged**,LvWzx1 originalsretained;
  bothengines failed429 expected got503: core native successmessage guard applied
  toalreadyterminalownedfailedresponse. Narrowcore repair preservesownedfailure,
  requiresrawsuccess evidence onlywhenok,skipsnative refresh/successconversion,
  no retry/settlement change. `bd6a1bf9f` **PASS24/24exact1/lintwhite0/
  1500unchanged**,nY2F5N originalred retained/barrierconsumed. Added20controls:
  native401/403/SSE429 no refreshretry,cancelfalse,healthyreaderror,newselectionchange,
  legacyproxypin and globalproxy deny before independentsavedproxyresolution.
  `b43a49292` **FAILED38/6exact44complete/lintwhite0/1500unchanged**,GN2J8y
  originalsretained: twoactualglobalproxy200vs503 bypass failures +fourfixture
  json401/403 statusRangeError (slice3 beforeowner). Fixture numeric-suffix extraction
  corrected withoutassertion/deadline changes; poisonedentry savedglobalproxy now
  denied until independentpersistedresolution,no envcache/direct bypass.
  `be69e6ece` **PASS44/44exact1/lintwhite0/1500unchanged**,IoKwWZ;
  actualpoisonedNode+SQLjs/networkmock only,original38/6 retained/barrierconsumed.
  `bbfcf9ed4` **FAILED1261/5exact53/1266complete** allstatuses/no pendingtodo,
  eightserial300s/exitsrecorded/lintwhite0/1500unchanged E52xg1,barrierconsumed;
  exactsame5failureidentities vs CodexA9WHd7 union (comparison.json),notwaiver:
  originalsearch/lite/image2/refreshlead remainred. Allnew8files passed.
  `b6537c185` **FAILED NodeHTTP1** pkiiOB,build0/WASMmatch/1510unchanged
  valid BUILD_ID4zZxhqGnsn7lKtT7azt6i. NodefixtureOf6gxz reached finalassertion
  'Gap did not block budget enable'; no fullreceipt,SQLnotrun. Originalfixture
  retained pkiiOB/original-http-fixture.mjs. Managementactivation hardcodedOFF
  deniesaccounting_not_ready beforegapcheck; fixtureassumptionincorrect,notapproval.
  `b74bcc48f` **PASS samebuild NodeHTTP5/SQLjsHTTP5** 3FuRPs:
  actualnode:sqlite jxsBu4/sql.js d9Asvb, each3POST/1CONNECT/faultobserved;
  1510inputs/3266binary unchanged atbothHTTP+final/white0,barrierconsumed.
  Originalb653failedgate retained; validbuild reused/no productionchange.
  onlyfinalfixture correction:
  exactpersistedgap managementGET/enforcementActivefalse thenbudgetenable409
  accounting_not_ready,not deliveredgap-enable enforcement; originalfailure retained.
  `/tmp/9router-unhealthy-responses-samebuild-retry.mjs` pins1510inputs/exactoriginal
  fixturehash +unchangedstandalone/static/BUILD_ID binaryhashes. Explicitstoragefault
  preload/no binary/config/route/fetchpatch/privateactivation/dummycreds; source/tests/
  revisedharness unchanged,no nativeprerequisite/build reruns. NarrowactualHTTP
  proof nowobserved,not fullruntime/provider/alladapter/security/fullphaseapproval.
  Next independent savedproxy authority/pinning controls; denyonly isnot support.
  `bd3b99261` **FAILED61/12exact73/2/lintwhite0/1500unchanged** v6InqJ,
  expectedRED/barrierconsumed/originalretained. Implemented sharedpure internal
  `accountedProxyAuthority.js` savedHTTP(S) originURL/noProxy validation; unhealthy
  app derives authority fromindependentpersistedsettings +fresh equality everygate/
  attempt/terminal, coreexplicitinternalarg, strictPOST ignores mutableenv including
  deliberate savedNO_PROXY bypass. Legacyconnection retainsnormalprecedence;
  malformedauthority failsbeforeadmission/noTLSorproxyfallback. Healthy/OFF unchanged.
  `baec844b8` **PASS73/73exact2/lintwhite0/1501unchanged** Xiv7Oq,
  original61/12retained/barrierconsumed. `b4537389e` **FAILED87/9exact96/2**
  lintwhite0/1501unchanged FQ92MP/redretained/consumed. Ninefailures =rawdotpath/
  emptyquery/fragmentnormalizedeligibility (stricttransport3/coreNodeSQL6),remaining
  credentialproxy/upstreamauth/precedence/falsecancel/freshproofloss passed.
  Validator now checks raworiginonly syntax beforeURLparse,never dotpath/query/
  fragment/backslash/whitespace intoeligibility. `b64022e77` **PASS96/96exact2**
  lintwhite0/1501unchanged ULS02Y/original87/9 retained/barrierconsumed.
  `b88f6f1e1` **FAILED1302/5exact53/1307complete** allstatuses/no pendingtodo/
  eightserial300s/lintwhite0/1501unchanged ZOhdqY consumed; exact5failureidentities
  matched E52xg1 receipt,notwaiver. `b8776c678` **PASSbuild/WASM/NodeHTTP6/
  SQLjsHTTP6/white0/1511unchanged** FIBxmk/BUILD_IDL7fIwKeCqPpTeBUeEo42m,
  actualnode:sqlite OvDeka/sql.js H8RYyt each4POST/1CONNECT/fault+staleenv observed,
  barrierconsumed. `/tmp/9router-unhealthy-saved-global-runtime-run.mjs`,
  fixture `/tmp/9router-unhealthy-saved-global-http-smoke.mjs`: independentpersisted
  savedglobal/no legacyproxy, storagefaultpreloadalso conflictingHTTPS_PROXY+NO_PROXY
  afterinit/realTLSCONNECT/no fetchmock/dummyprivateactivation; JSON/SSEheldEOF/
  missingterminal/proxytransportfailure nofallback/restartgap/OFFdeny observed,
  NOTgap-specific budget-enable enforcement. No nativeprerequisite reruns/waivers.
  `be0bd43e7` **FAILED2/18exact20/1/lintwhite0/1502unchanged** 1ZhE7L,
  redretained/consumed; requiredpool missingproof/no missingbadJSON denial,
  twofsyncnegatives passed. `persistedRequestProof` now sameindependent reader gets
  referencedpool, strictshape/requiredmissing denial/rowcolumnsdominate/deepfreeze/
  explicitnopoolnull; inactiveaccurate evidence only. app/context pinfreshproxyPool
  equality atgate/attempt/terminal. `bbe4013c3` **PASS20/20exact1/lintwhite0/
  1502unchanged** vshfqh/red2/18retained/barrierconsumed. `bc737eb82` **PASS44/44
  exact1/lintwhite0/1502unchanged** z2mgFS/consumed, retain20+24idshape/specificshape/
  trimmedreference/closeACK/healthyclosed/requestcontext freshpool URL/strict/active/
  disappearance/prooffailure denycontrols. `b726c5a08` **FAILED1346/5exact54/
  1351complete/lintwhite0/1502unchanged** lwsIXV consumed; exact5failureidentities
  matched ZOhdqY/notwaiver. `bc2ce8117` **FAILED116/12exact128/2/lintwhite0/
  1502unchanged** EMl3As/consumed/redretained:6activepool success+6terminalmutation
  controls deniedbeforePOST; invalidpoolnegative controls passed. Implemented internal
  `persistedPoolProxy` app->core->strictPOST fromsameindependentsnapshot; active
  HTTP(S)origin+typedstrict/noproxy only, poolprecedence andfreshfullpool equality,
  explicitstrictProxy/proxyPoolId, no mutableenv fallback onpoolbypass. Inactiveempty/
  relay/SOCKS unsupported beforegap; no rotation/gapACK/controlplane grant.
  `b7fc10586` **PASS128/128exact2/lintwhite0/1502unchanged** EJsOu0 consumed/
  original116/12retained. `b20c260aa` **FAILED144/4exact148/2/lintwhite0/1502unchanged**
  zP5krr consumed/redretained; fourNodeSQL strictpoolbypass no-global/global-bypass
  preadmissioncontrols failed200vs503,alltransportcontrols passed. Extracted existing
  hostnameNO_PROXY matchingunchanged into sharedpure authority helper; persistedpool
  targetresolver appfixedResponsesURL beforecontext/gap +stricttransportreuse,
  no duplicate semantics/envfallback. `b4f88c085` **PASS148/148exact2/lintwhite0/
  1502unchanged** FK4lxj consumed/red144/4retained. `b792d05b2` **FAILED1434/5exact59/
  1439complete/lintwhite0/1502unchanged** 4UedV6 consumed; shard9fiveproxyfilespass/
  exact5failureidentities matchlwsIXV/failure-identity-comparison.json/no waiver.
  Nineserial300s/fullstatuses/exits retained. `bb22fcbd4` **PASS freshbuild/WASM/
  NodeHTTP9/SQLjsHTTP9/white0/1512unchanged** Hb2Di1 consumed; build
  tmp/9router-unhealthy-pool-panel-1791465049856 IDa_6wI3LrSIA_PM8GNy-_H;
  actualnode:sqlite SeKGUQ/sql.js ce6H2G each4POST/1CONNECT/fault+staleenv observed.
  Requiredinactive-empty-strictbypass zeroPOSTzeroCONNECTnogap/activepool precedence
  over unreachablelegacy-global-staleenv/JSON-SSEheldEOF/missingterminal/no replay/
  restart exactgapGET/OFF409accounting_not_ready passed. Dummyprivateactivation/
  explicitstoragefault+staleenv preload/no fetch-route-binaryconfigpatch; emitted
  WASM match/no nativeprerequisite reruns. OFFenable notgap-specificenforcement.
  NarrowunhealthyResponsesHTTPpool runtime proven,notHTTPSproxy/rotation/SOCKS/relay/
  liveprovider/alladapter/fullsecurity/fullphaseapproval.
  Scout: normalconnection poolprecedence->legacy->global/env; inactive/empty strictpool
  guarantee mustnot downgrade. Normal auth/core strictProxy propagationrepair now
  underverification (finding notclosed/waived); `b17e7ab40` FAILED9pass/11fail exact20/2/
  lintwhite0/1503unchanged JxkLQf consumed/redretained:7authstrictflagfailures +4core
  blockedfixturemissinglogRawRequest. Correctedlogger API fixture only/no assertion-
  deadlinechanges; `bacc6509d` FAILED9pass/11fail exact20/2lintwhite0/1503unchanged
  rkrmvV consumed/redretained; all4core reachedmissingstrictflag/poolID assertions.
  Repairedauthresolvedflag bothbranches +corestrictflag/poolID forwardingonly;
  `b21f8ff3c` PASS20/20exact2lintwhite0/1503unchanged3882EN consumed/redretained.
  `be10cd061` FAILED1495/5exact65/1500complete/lintwhite0/1503unchanged fgFux6
  consumed; shard10sixauthcallerspassed/exact5identities match4UedV6 comparisonretained/
  no waiver/tenserial300s fullstatuses-exits. `b60973d79` FAILEDnodeHTTP1/build0/WASM
  match/1513unchanged gDW0jJ consumed; build tmp/9router-normal-strict-proxy-panel-
  1791467264401 IDm5WDnMN87YDBYzBtP1piy; nodefixturevILgOj inactive strictobserved
  503strictProxy/0POST0CONNECT/no groupspassed,SQLnotrun. Fixture wronglyexpected
  core502; actualnormalapp allRateLimited returns503 afterexistingcooldown/retry.
  Originalfixture+failedreceiptretained, exact503correctiononly separatefixture/
  unchangedno-networkassertions-deadlines/no productionchanges. `bc3f5b231` PASS
  samebuildNodeHTTP4/SQLjsHTTP4/white0 je8p8q consumed; actualnode:sqlite BZVlpw/
  sql.js h3fw1C each1POST1CONNECT. Original1513inputs+2retry inputs=1515 +3266binary
  files unchanged beforebothHTTP/final; originalfailedgate notretroactivepass.
  ActiveTLSCONNECTanswer/inactive-empty-bypassstrict0POST0CONNECT/accountingOFF
  0attempts/dummyHOME-DATA/no fault/routefetchbinaryconfigpatch/operatorproxyinheritance
  passed. No rebuild/nativeprerequisite reruns. Narrownormalaccountauth/core HTTPpool
  forwardingproven; not noauthruntime/legacyglobalfallback/managedenv/rotation/relay/
  SOCKS/liveprovider/alladapter/fullsecurity/fullphaseapproval. Cascadeauthgraph
  unavailable notstaticclean.
  New12actualresolver->auth account/noauth +actualcore->executor OFF propagation,
  active/inactive/emptystrict/nonstrict plus existingstrict8/source-tests-harnessfrozen/
  dummycreds/no upstreamnetwork/no rotation.
  b6d10cc12 FAILED23/7exact30/3lintwhite0/1504unchanged7RHSFK consumed/redretained:
  resolverlegacydowngrade2/authmarker2/transportignoredmarker3 actualfailures.
  Implementedresolverstrictunavailable beforelegacy/clearedURLs+internalmarker,
  authbothbranches/corepropagation (persistedactivepool overridesfalse), transport
  strictpool+unavailableguard beforefetch/relay/env/global/DNS/singlePOST resolution.
  b99626725 PASS30/30exact3lintwhite0/1504unchanged6TxCvs consumed/red23/7retained.
  bf60f0b78 PASS46/46exact3lintwhite0/1504unchangedNYGMRm consumed/red23/7retained.
  ba007cf21 FAILED1520/6exact66/1526complete/lintwhite0/1504unchangedmfKrSC consumed:
  5priorfailures +NEWQoder nullsignedPOSTloss timeout5000ms(verbose5125ms/JSONSTACK-
  TRACE_ERROR),notreplayassertion. Comparisonretained notsame5/no waiver/flakeclaim.
  Shard10current46passed; b2b430a97 FAILED35/1exact36/5lintwhite0/1504unchangedSN1MtO
  consumed; samefirstQodernullcase5000mstimeout(verbose5081ms),reproducible/no flake
  classification. b79aef92d diagnosticFAILED1/5exact6 originalassertions5000ms/
  300schild retained32hbso9j; firstcoldimport6023ms (start1791470367289/end1791470373312)
  timeoutbeforeexecute/fetch; latecontinuationcrossednexttest, notno-replay evidence.
  Laterimports128-208ms. Testsetuponlycollectionpreimport+restorefetch/reset added,
  eachcase stillreset/stubfetch/reimport realproxy/assertions5000msdeadline unchanged.
  Explicitcoldtransformmovedoutassertiontiming; notcoldloadperformanceproof/noredwaiver.
  bfdb0e91a PASS36/36exact5lintwhite0/1504unchangedLAMAfW consumed; productionunchanged/
  alloriginaltimeoutreceiptsretained. b9e12d404 FAILED1521/5exact66/1526complete/
  lintwhite0/1504unchangedXO1PDN consumed; exact5identitiesmatchfgFux6 comparisonretained/
  no waiver/shard9Qoderproxy+10strictauthcontrols passed. Original5000msassertions
  unchanged/collectioncoldtransformscope explicit/notcoldloadperfapproval.
  b24318360 FAILEDNodeHTTP1/build0/WASMmatch/1514unchangedQJzopS consumed;
  build tmp/9router-strict-unavailable-pool-panel-1791471645841 IDAwqNISuCmQlGIT90fBZzG;
  Nodeht048t firstinactive10sTimeout0POST0CONNECT/nogroupspassed/SQLnotrun.
  Base mapsdeterministicpolicyrefusal to502 default3x3000ms retries (candidatecause,
  nofixturedeadlineweakening). b4ce80a67 FAILED65/3exact68/4lintwhite0/1505unchanged
  3IXuvE consumed/redretained typedtransport2/Basebackoff1; retain46+Base21+1test.
  WiredProxyPoolUnavailableError transportguard/Base instanceof immediateescape
  aftercallerabortcheck+timercleanup/discard before502backoff/URLfallback; network
  retry/cancel unchanged. beda9a9d5 FAILED67/1exact68/4lintwhite0/1505unchangedHpN2S3
  consumed; typedtransport2pass/BasecaseexactProxyPoolUnavailableError fail (prior
  undefinedreason assertionnotreported), notgreen/notwaived. b6e0e4f75 diagnostic
  FAILED1/21skipped nhe_c2u5; everyoriginalassertion passed/caughtexactinstance/1fetch/
  nohook/0timers/workfulfilled yetrunnerfail exactpolicyerror afterbody. Notacceptance.
  b1416418d diagnosticFAILED1/21skipped consumed trackedpromisesundefined/body+
  afterEachstatepass thenfail. Rootcause runnergetBeforeHookCleanupCallback accepts
  returnedfunction; mockResetreturnsfetchMock; originalbeforeEach expressionregistered
  fetchmockcleanup invokingconfiguredreject afterbody. Originalfixture copied under
  nhe_c2u5/original-base-before-hook-fix.test.js. Changedhookblock-no-return only/no
  productionedit/assertionsdeadlinesunchanged. b1426f1a9 PASS68/68exact4lintwhite0/
  1505unchangedKnQz30 consumed/typedpolicy+fixturehook narrowly verified/redsretained.
  b62399c45 PASS74/74exact5lintwhite0/1506unchangedjBE1OO consumed; retain68+
  3exactcallerabortfalse-string-Error+1untypedlookalikemessage retainsnetworkretry+
  2realBase->realproxy frozenconflictingauthority nofetch-backoff-timers(signal/nosignal).
  Newcasecollectiongraph scope notcoldload/socket/liveprovider. b20005a09 FAILED
  1528/5exact67/1533complete10serial300s/lintwhite0/1506unchangedxRF0Xm consumed;
  failureidentitycomparison same5asXO1PDN file/fullname/firstmessage hashbound not
  waiver. Shard5Base/cancel+9proxy+10authpass/fivepriorfail remainunwaived.
  b556fca81 PASSfreshbuild/WASMactualNodeHTTP6SQLHTTP6white0/1517unchangedMXxnoD
  consumed; buildtmp/9router-proxy-policy-panel-1791475297561 IDPuNE8b91x9Id3VmRxSoC-.
  Actualnode:sqliteZyPMRU/sql.jsmIriau each1POST1CONNECT onlyactiveTLSnativeanswer;
  other5groups inactive-empty-bypass+workinglegacyglobalconflicts0POSTCONNECT/OFF
  0attempts. Same6modeHTTPfixture10s unchanged/privateHOME-DATAdummy/no fault/route
  fetchbinaryconfigpatch/operatorproxyinheritance; WASMhashmatch658410bytes/1517
  unchangedatbuildNodeSQLfinal barriers/no nativeprerequisite reruns.
  Originalfake-timerredpendingbackoff+QJzopSfailedtimeout retained/notretroactivepass.
  Narrowhealthy-no-keyauthcoreHTTPpoolcertificate only/notunhealthy/noauth/rotation/
  relaySOCKS/liveprovider/generalproxy/security/fullphaseapproval/no productionactivation. Nonstrictlegacy/__none__/Qodernopool preserved,
  no rotation/selectionchange. Lookupfailure/missingpoolauthority/activebypassglobal/
  managedenv remainopen; lostrow cannotinferstrict/cachewaive no policychange pending.
  bf1856a92 FAILED10/3exact13/2lintwhite0/1506unchangedAbzsgn consumed(twoCodex
  images+publicPNG); originalfixturescopied underAbzsgn. Productionlookupall:true
  expectsarray vsfixtureobject causedprefetchearlydeny/vacuousnegativeguardrisk.
  ChangedDNSfixturesonly public-private{address,family}arrays+hardeningfetchrestore,
  assertionsdeadlines/productionSSRFunmodified. bf18d19a7 PASS13/13exact2lintwhite0/
  1506unchangedUsut5X consumed narrowfixturefixonly/originalredretained.
  bc225aefb PASS23/23exact3lintwhite0/1507unchangedhuGSwg consumed retain13 with
  strongerhardeningnonvacuousfetch/DNSargs/reader+10mockedDNSAgentcontrols mixedprivate4
  empty-error2 validatedpin/manualredirect1 302nofollow1 oversizecancel1 magicEOF1.
  b1173dfb3 FAILED1549/3exact69/1552complete11serial300s/lintwhite0/1507unchanged
  HtB2gJ consumed; hashboundcomparison xRF0Xm retained3 removed2Codeximage/new0.
  BothCodeximagecases+hardening9/pinning10passed/currentfixturemilestone verified.
  Remainingsearchcapability/CodexGPT6capability/OAuthrefreshlead failuresunwaived.
  OriginalAbzsgnred/prior5failurecaller remainfailed/notretroactivepass. Production
  unchanged/no native-runtimeprerequisite reruns/mockcontrolsnotactualsocket/full
  SSRForsecuritycertificate/narrowruntimeunchanged/priorforwardruntimehistorical.
  ReviewgraphproxyFetch missing/cascade unavailable notsecurityclean. No generalproxy/
  rotationsecurity/fullphaseapproval.
  Newpool seam mustcarrystrict intent explicitly,not copy omissions. Noauthrotatingpool scope distinct/unsupported.
  Reviewgraph excludesnewvalidator/cascade unavailable,notclean downstreamproof;
  narrowactualHTTP savedglobal proven,not generalproxy/securityapproval. Savedpool/disabled-managedenv/
  broaderformats/alladapter/security/fullphase stillopen. ActiveLSP/cascade unavailable
  onproxyFetch isnot staticclean; lateaux TLS/log findings untriaged historical.
  SavedglobalHTTP(S)origin support narrowly proven; broaderproxycompatibility open.
  Not actualsocket/HTTP/liveprovider/generalformat approval. ESLint/nodecheck0;
  earlier partialfile LSPunused diagnostics were stale pretestbody,not clean static
  certificate; astgrep/opengrep coverage incomplete.
  LSPcascade unavailable for SQLjsadapter is not clean downstreamcoverage.
  No alias/combo/modelresolver/proxy/provider/dispatch approval; roundrobin needs
  durableupdates,never downgrade tofillfirst. Not appselection/dispatch authority;
  appsettings/selection/perPOST actualcore/runtime verification stillrequired.
  Healthy path normalsettings/auth remains; no healthyreadfailure exception.
  Broader independentpersisted model/alias/combo/proxy/provider authority required,
  not forcedconnection or cachedgetSettings/getProviderCredentials bypass.
  ProductionOFF; no prerequisite reruns or weakened assertions.
- Direct continuation `b4863d1b1` **exit0, fixture0/stability0**. Same frozen
  fixture/build SQL-only retry; private `/tmp/9router-native-message-sse-ledger-http-TJhYSe/results.json`
  asserts **sql.js and all FOUR groups**, three actualPOSTs/twoCONNECTs, four
  declared compiled-copy config patches. Raw heldEOF/terminal/threshold106500,
  missingstop abort/unresolved/no successor, original-price recovery/replay/new1080000.
- Resume HEAD/master matches; source/fixtures **1,523 unchanged inputs** before
  and after retry, build **3,001 files** matched prior Node clone except exactly
  the four declared standard-config patches. No owned fixture/runner remained;
  two existing next-server processes belong to unrelated `/app` containers.
- Filesystem ext4 rw/readable,44GB free/5.7M free inodes. Old EIO cause **not
  proven** (kernel logs permission-denied); original `DFTPlF` partial clone,
  original error/composite failure preserved. New log `/tmp/9router-messages-sse-sqljs-resume-BgWi4v.log`
  and stability JSON separate. No build/Node/prerequisite rerun or assertion weakening.
- SQL-only immediate blocker closed; continue Gemini/native next-owner slice.
  Both-runtime **narrow fixture** evidence, not production beta/OAuth/live-provider/
  Bun/better parity or full-plan acceptance. Enforcement OFF, all phases incomplete.

**Historical pause checkpoint — 2026-10-08, user-requested context clear.**
This checkpoint supersedes every older “current/running/pending” claim below;
original results remain historical evidence. **All six phases remain incomplete.**
See [fresh continuation handoff](../handoffs/api-key-budget-pause-20261008-0515.md).

- Messages text-only standard API-key SSE owner is implemented through actual POST
  owner → Base → core → app. Focused `b6309632d`: **194/194 exact3**, tests/scope/
  lint/whitespace all0. Original and parsed serialized request checked separately;
  exact app routes/boolean intent, EOF/ACK/authorization, single terminal owner.
- Latest caller gate `beefb9f41`: **711 pass / 1 fail, exact25 files, 712 complete
  statuses**, pending/todo0, **2,992 input hashes unchanged**, lint/whitespace0.
  Only original `combo-autoswitch :: web_search tool -> search` remains unwaived.
  Search is intentionally disabled in current implementation; enabling it just for
  green tests would change routing preferences outside the accepted scope.
- `b6d0fcc95` is **NOT still running** as previously reported. User-requested status
  inspection returned `Unknown background task ID`; durable files show build0,
  stable0, artifact0, whitespace0, WASM0. Build
  `tmp/9router-messages-sse-owner-milestone-panel-1791373009`, BUILD_ID
  `jjjX2Nidvi4MjSsN2HtrY`; build + Node HTTP snapshots **1,523 inputs unchanged**.
- Actual Messages SSE HTTP/ledger **Node24: 4 groups passed**, private fixture
  `/tmp/9router-native-message-sse-ledger-http-twmO7Y`: unchanged-beta denial
  zero intent/POST; explicit standard-config clone heldEOF/pending delta/withheld
  terminal then settled106500/next429; missingstop downstreamabort/unresolved/
  no successor; original106500 recovery/replay/new1080000. Three actualPOSTs,
  twoCONNECTs. Four copied compiled config files have before/after hashes;
  production beta config/source/artifact untouched. Positive clone does **not**
  approve production beta/OAuth/nontext/live-provider compatibility.
- **Immediate blocker: SQL.js fixture preparation failed**, `EIO` at
  `fs.cpSync`, before server/ledger/runtime assertions:
  `/tmp/9router-native-message-sse-ledger-http-DFTPlF/standalone/node_modules/next/dist/compiled/source-map`.
  `/tmp/9router-messages-sse-owner-milestone-sqljs-http.txt` preserves original stack;
  no SQL.js stability report/result exists. Composite chain failed; do not claim
  both-runtime pass or rerun Node/build unnecessarily. No matching build/fixture/
  runner process was observed by the read-only process scan at pause.
- Why progress appeared stuck: assistant repeatedly returned while assuming a
  native completion wake was pending, then did read-only investigations. That
  stale waiting state was not a missing user decision. Advisor consultation also
  failed `Advisor model not found: 9router/cx/gpt-6-astra`; this is not a code
  verdict or approval. No advisor/provider substitution or delegation is authorized.
- Next after resume: verify source/build identity and fixture-copy filesystem
  health, preserve EIO artifacts, rerun **only SQL.js** with same frozen fixture/
  build if identity holds; otherwise fresh applicable gate. Then implement real
  required gaps: Gemini/native/OAuth/Codex owners, unhealthy request authority,
  nested fusion; pricing/UI/windows/adapters/security/final AC closure. Do not
  keep rereading prerequisites or declare phase completion from scoped counts.
- Read-only next-owner/self-review notes persisted in
  [pause investigation notes](./reports/pause-20261008-investigation-notes.md).
  They are candidate designs/self-review, **not implemented or independently
  approved**. Production enforcement OFF. No activation/commit/push/publication.
  Stop requested: no new background task/retry launched at this checkpoint.

**Historical continuation checkpoints (superseded, not erased):**
- Historical source checkpoint: `ba30bfdf9` **1,198pass/1fail exact88**, complete
  unique serial-shard union (8 shards, unchanged internal deadlines, 1,199 complete
  statuses/no pending/todo). Only original disabled-search assertion remains
  unwaived; previous monolithic/composite/native-assembly timeouts remain failed.
  `b30b750cb` fresh build/emitted-WASM/snapshot/whitespace all0 on **1,505 unchanged
  inputs**, build `tmp/9router-native-app-owner-milestone-panel-1791361764`.
  Four real strict-helper TLS/socket groups passed on that source, private artifacts
  `/tmp/9router-native-single-post-socket-voLOy8`: fixedCONNECT/trustedonePOST,
  untrustedcert0POSTwithoutSTRICT_SSL,redirect0successor,proxyrefusal0directreplay.
  Landlock CONNECT port restriction is not IP/netns/full-egress approval.
  `be8b46031` current-build five actual HTTP/runtime slices **all passed** for
  existing approved paths,1,505 inputs unchanged/whitespace0: Node24+SQL.js
  embeddings4groups each and Node24+SQL.js+nativeNode22 global6groups each.
  [Remaining delivery contract](./reports/remaining-delivery-contract.md) maps
  concrete implementation gaps to AC without repeating foundations or expanding
  antirollback/powerloss/full-egress scope. Previous `bb477e12c` is historical.
  Native owner is now wired explicitly through Base and narrow core/app eligibility
  (API-key anthropic + Claude endpoint + explicit stream:false). Optional authorized
  native message capture shares the bounded sole raw observer/reader; exact usage
  remains separate monetary authority. Real-ledger route-function threshold200/
  next429, unknown-no-successor, cancellation/ACK and denial fixtures passed.
  Strict single-POST transport opt-in forbids helper TLS downgrade/direct replay/
  relay; proxy options and serialized wire/model/price pinned before admission.
  These scoped proofs are not actual native app-ledger HTTP or live-provider
  compatibility approval. Production registry beta headers are not stripped and
  remain denied, as do OAuth/live/alternate-tier/server-tool billing. Active LSP6
  paths reported24 diagnostics/2 inconclusive; narrow unused-import/boolean/parse
  diagnostic fixes applied, no static-clean or independent-review certificate.
  Next: close native actual-ledger HTTP boundary explicitly without beta semantic
  changes, then required Messages streaming/Responses/Gemini/provider owners,
  remaining nestedfusion/
  unhealthy authority and full acceptance. Enforcement OFF.
- Historical stream checkpoint `b122d35ee` completed sweep **1006pass/2fail exact83**,
  same unwaived autoswitch regressions, zero pending/todo/mismatch/incomplete;
  fresh build/WASM and three HTTP gates passed before composite2400s timeout.
  `bb86d2830` independently completed unfinished SQL.js/nativeNode22 global gates
  on the exact same snapshot/build with unchanged fixtures/internal deadlines.
  **1,485 inputs unchanged**, build
  `tmp/9router-stream-terminal-milestone-panel-1791273373`, all five HTTP slices
  now have completed evidence. Original composite remains failed, not all-green.
  Live cancellation/failure local responsiveness **290/290 exact15**; terminal
  promise claimed before foreign cleanup reentry, one immutable winner, local
  closure is not durable ACK/readiness/successor authority. Normal successful
  EOF still awaits ACK and trusted authorization; buffered panel gates unchanged.
- Previous `b94de20ef`: **982pass/2fail exact83**, no skipped/pending/todo or
  scope/completion mismatch; same autoswitch regressions unwaived. Independent
  lint/build/emitted-WASM and five actual HTTP gates passed on **1,485 unchanged
  inputs**, build `tmp/9router-restore-owner-milestone-panel-1791267875`.
  Managed restore protected-intent bundle **127/127 exact6** includes eight actual
  Node/SQL.js SIGKILL boundaries, explicit offline retry, async mutation recheck,
  pinned consumed bytes, mixed-generation and dangling archive denial. Archive
  never authorizes/adopts live intent. Same-directory scope only; transfer,
  antirollback/power-loss/all-runtime acceptance remain open. Originals retained.
- Capacity71/5, nested sequential/terminal/top-fusion→nested-sequential87/5 and
  explicit DeepSeek OpenAI raw schema/transport coverage are implemented with
  focused evidence. Nested fusion remains denied pending a justified work bound;
  unsupported provider/native/format denial is not completed compatibility.
- Shared dispatch/isolation gate231/15 passed. Successful chat JSON terminal
  policy now rejects budgeted unknown success, preserves settled threshold success
  and durable unlimited/gap continuation. Actual Node24 HTTP chat/ledger/recovery
  three groups passed; actual Node22 SQL.js fallback three groups plus three
  acknowledged-terminal SIGKILL restarts passed. Fixture-only activation and dummy
  loopback upstreams, no live-provider or production-egress certification.
- SQL.js standalone missing WASM was observed in the original runtime failure,
  repaired through exact tracing (not fixture copying), then independently verified
  emitted binary/hash and runtime. Historical integrated checkpoint `b4a9ad46b`
  **926/2 exact81**, no pending/todo/mismatch/incomplete, same two autoswitch
  REGRESSIONs unwaived. Independent build/WASM and all four actual HTTP chat/
  embedding gates passed on **1,477 unchanged inputs**, artifact1791172704.
  Diagnostic build success does not convert the red regression gate to green.
- Actual HTTP embeddings exposed successful200 without usage despite durable
  unresolved/null ledger. Narrow actual POST-owner terminal policy repaired;
  focused242/15, then live trusted terminal authorization and explicit embedding
  provider/schema support including unlimited verified **260/260 exact15**.
  Current actual Node24/Node22-SQL.js embedding HTTP gates four groups each passed:
  certificate negative control/zero upstream POST, exact threshold, unknown refusal,
  original-price recovery/replay and new price. Original fixture/source failures
  retained; no live OpenAI-provider compatibility certification.
- Existing global management wire/UI, ACK-history, recovery and per-key controls
  have scoped evidence. Actual-ledger rendered recovery now passed separately on
  Node SQLite `b8093c664`/SQL.js `b7cbd36dd`: five HTTP/browser groups and five
  rendered checks each, **1,480 inputs unchanged**, real login/API pass-through,
  storage fault0observed server mutation, original174k/one audit/receipt cleanup,
  reopen/reload no autoPOST, keyboard/mobile390×844, then HTTP same-operation
  replay after acknowledged SIGKILL/new994k/unlimited unpriced live next admission.
  Original disabled-policy focus fixture failure retained; runner-only delta
  verified before same-build reuse. No browser crash-retry/full AX/security/runtime
  certificate. Earlier chat fixture settings UPDATE affected zero rows;
  helper-disable intent was not persisted. Actual relay/ledger/auth observations
  remain evidence, not proof of intended settings. See
  [current AC matrix](./reports/acceptance-closure-matrix.md) and
  [dispatch history](./reports/dispatch-inventory.md) for originals and limitations.
- Live SSE valid usage/DONE/cleanEOF now awaits trusted request-local successful
  terminal authorization before release and rechecks cancellation. Valid unpriced/
  durable gap continuation, rejected/missing authorization and invalid protocol
  holdback tested; hung optional authorization/ACK remains open. Remaining owners:
  nested fusion work bound, provider/native/format inventory and unhealthy-unlimited
  request authority, followed by full regression/security/restore/runtime acceptance.
  Advisor guidance is not independent acceptance; production enforcement stays OFF.

Historical checkpoints below are retained for provenance, not a instruction to
restart foundations or a current build/phase-completion certificate.

- Storage/identity/ledger, pricing resolver/sync/override, budget service, analytics projection và management API/UI đã có implementation và focused evidence. Không mô tả chúng là chưa bắt đầu.
- Bounded actual offline writer/CLI prerequisite đã qua focused gates: `b76045cf7` **114/114 across7** ACK/legacy, sau finalsecurityhardening `b2aae1b59` **65/65 across4**, lint/whitespace0. ActualNode/SQLjs CLI, retainedoperation/crash/repeatedrecover, fsyncfail, protectedartifacts/tamperdenial, uncertaincleanup liveownerdeny→death→recover. Legacyproductionexportrefuses0DBinteraction; originalfailurebody/assertions historicalfixture retained. TODO budget completed chỉ deliverable hẹp để nối routing; **không wholePhase01/fullsecurity/hardwarepowerloss/allruntime/managedrestore-retainedintent acceptance**.
- Actual embeddings lifecycle app→core→initial/refreshPOST→rawJSON→durableterminal đã focused verified `b06b8a160` **75/75 exact5**. Chat app→chatCore→DefaultBase perPOST/initial-internalretry, buffered forcedSSE rawusage/DONE→durableterminal→clientJSON đã `b86f64b9d` **67/67 exact6**,0skip/todo,lint/whitespace0; confirmed serialized streamfalse mismatch repaired detachedwiretrue, clientintent/options unchanged. All originalfailures retained. Fixtureonly ownedNode/manualprice/upstream/auth mocks, **not actualHTTPauth/SQL.js/allprovider/fullretry-fusion acceptance**. LiveOpenAI sameformat/singlechoice106/8, auth113/9, account116/9 focusedverified; sequentialcombo144/2 and fusionlate `b137b4bf4` **156pass2fail exact14**, onlytwoautoswitchassertions reproducedonpinnedHEAD21/2exact3 (no waiver/greenlabel). Actualpanel/judge/regeneration distinctPOSTs/samecontext, normalstragglerafterclientoriginalpricesettle and lateunknownactivejudge abort/heldprep0POST tested. Capacity/nested/specialized providers unsupported including unlimited; boundedrawobservation154/12, ACK81/5+actualprocess33/4 andusablefusion65/6 now scopedverified; broadernative/SQL.js/unhealthyexception/hungACK/HTTP remainopen. Gemini preparation chưa trustedterminalaccounting; enforcementOFF.
- Existingmanagement trên actualtwoPOSTledger đã `b37eff873` **68/68 exact6** (signedJWTroutefunctions notHTTP/UI), globalgapGET/explicitwaiverPOST `b42e6be7f` **40/40 exact6** scopedauthority/generation/receipt. Maintenance targetACKstorage `b979929c4` **95/95 exact7**; capacity/crash final `ba638249b` **87/87 exact5,0skip/todo,lint/whitespace0**, 8actualNode/SQLjsSIGKILLcases +1000historybound/replay. Original85/2,86/1timeoutartifacts preserved; measuredVitestBufferdeepmatcher6.27s→exactnativeBuffer.equals samebytes/points/1000/deadline, finalcapacity462msNode/301msSQLjs. Restore `b3635f3d9` **89/89 exact5,0skip/todo,lint/whitespace0**; candidateoperatorPOST `/api/accounting/maintenance/release` added onlytargetrelease/audit+ACKreceipt/no gapclearactivation. `b0e64ed05` exact7JWT/CSRF/serveractor/failedACK/newmaintenancereplayroutefunctiongatepending (notHTTP/UI); NodeolderDBmissingreleaseaudit deniesreceipt/no retrofit; latestexternalACKhistory/globalgap/newmaintenance retained. No broadretainedinitializationintentrestore/allruntime/HTTP/UIcertificate. Empty-ledger HTTP/intercepted UI không thay acceptance.
- Current routing milestone `b898102a6` **FAILED775pass2fail, exactly74predeclaredfiles,0skip/todo/collectionfailure**, serialisolatedHOME/DATA_DIR. Onlysame2autoswitchHEADreproducedassertions; unchangedbaseline comparator1 explicitlyREGRESSION, no waiver. **1,449 inputs unchanged**, stability0/whitespace0. Reports `/tmp/9router-routing-milestone-{sweep.json,failures.json,comparator.txt,sweep-stability.json}`. Same-source diagnosticbuild `b1c8407fc` **PASS exit0**, 1,449inputsstillunchanged, artifact `tmp/9router-routing-milestone-panel-1791147483/BUILD_ID` (`Z680e1AhvbJ0Bl8wYedBp`), Nodev24.21.0/isolatedHOME-DATA_DIR/telemetryOFF. **Build passed; integrated test gate remains failed**. Subsequent newACKtestinput postdatesbarrier; no currentwhole-tree/buildclaim. Historical selected regression: **505/0, đúng53 files**, comparator/stability/whitespace0, **1,414 inputs unchanged**. Không phải full suite/all-runtime acceptance. Build `be840e920` đã pass build/stability/artifact/whitespace0 trên snapshot1,414unchanged, artifact `tmp/9router-authority-current-panel-1791134562/BUILD_ID`. Docs-only roadmap edits không là whole-tree build certificate; writer/routing mới sau barrier chưa có current integrated sweep/build acceptance.
- **Enforcement OFF; không phase nào accepted complete.** Không tự production-activate, commit/push/publish.

### Thứ tự delivery còn lại

1. **Khép kín prerequisite phục vụ lifecycle:** triển khai bounded explicit initialization intent + offline recovery cho Node/SQL.js; exact pre/post state, retained receipt, fail-closed ambiguity, crash/replay tests và operator authority. Không thêm helper/foundation độc lập nếu không có consumer hoặc blocker cụ thể trong delivery này. Giữ old interrupted-state evidence; legacy sidecar-first initializer không được ship như callable bypass.
2. **Nối đường chính end-to-end:** request-local identity → actual attempt gate/intent → raw exact usage → durable settlement cho chat và embeddings; sau đó internal retry/account/model fallback, fusion panel/judge/late sinks và native terminal errors. Pricing phải validated tại consumption; approved bundled/manual vẫn dùng được khi strict live sync degraded. Không chờ live catalog xanh, không nới precision hoặc miễn trừ unknown/billable seams.
3. **Khép kín management đã có:** global gap/maintenance operator scope, existing-attempt recovery/receipt replay, policy/usage/status UI trên actual ledger và request flows; auth/CSRF/redaction/mobile/keyboard acceptance. Không xây lại endpoints/editor đã có chỉ vì TODO cũ ghi pending.
4. **Nghiệm thu tích hợp:** full dispatch inventory, adapter/runtime gates, managed restore/runbook, security, full regression/baseline/static checks, current build/UI và AC-to-evidence matrix. Bun/better-sqlite3 và known-red/cloud gaps vẫn phải xử lý hoặc báo rõ release blockers; không tự waive.

### Nhịp verification và báo cáo

- Mỗi patch: relevant focused tests + changed-file lint; failure giữ artifact và sửa nguyên nhân, không đổi assertions/timeout để xanh.
- Broad sweep/build ở milestone tích hợp, thay đổi shared lifecycle/startup boundary hoặc regression có căn cứ. Không lặp broad build sau mọi helper nhỏ; không bỏ impact-based verification.
- Comparator repair + negative fixtures là prerequisite trước mọi no-regression claim. **Focused integrity repair đã hoàn tất** (TODO comparator); không cần làm lại. Full-suite classification/assertion-level limitations còn ở rollout, không được coi selected-file execution là chứng minh tất cả assertions. Collection/runtime/missing-scope failures vẫn fail-closed, known-red chỉ narrow evidence-backed classification.
- Không edit source/config/tests/runner inputs trong build/sweep barrier. Docs-only roadmap update không chứng nhận final whole-tree build.
- TODO mô tả **remaining deliverables**, ghi phần implementation đã có và acceptance còn thiếu riêng. Completion cần implementation + relevant verification; số tests pass không là tỷ lệ hoàn thành feature. Không đặt ETA mới khi chưa có căn cứ.

## Execution checkpoint — lịch sử và bằng chứng

### Latest direct continuation (supersedes stale pending entries below)

- Transport-bound loopback normalization compatibility: actualcustomentrycopieddiagnostic uPBmwz observedpeerproof+URLlocalhost/Host127 matchingport butNextpopulatedforwardingbreaksoldabsencecheck; all3factoryinstrumentationrequired winningpricing/syncguard observed. No trust-by-header-equality repair: wrapper nowoverwriteincomingoriginal-forwardingpresence0/1+socket-protocolstamps; guardnewcoherentframeworkheaderpermission onlyauthenticateddirectpeer/proven0/exactsocketscheme/Host/proto andoriginalmarkerblocksevenafterdownstreamdelete. Originalparsefail/behavioralTDD1pass6fail retained; focused58/0 thenexpanded60/0exact5+lint0. Narrowactualcustomruntime rawwiregate subsequentlypassed (below), notallpeer/runtimeacceptance.
- Currentexact48sweep `b202e9cd3` **461pass/0fail/pending/todo**, runner/comparator/stable/allgreen/whitespace0, sharedprelaunch **1,405inputs** finalunchangedhash/pathinventory includesrunnercommands. Comparatorstillassertion-levelskiplimitations; notfullsuite. MODULE_TYPELESSremains/noMaxListenersorPromiseHandledwarningobservedinthisrun. Build `b279c5027` **build0/stable0/artifact0/whitespace0**, same1,405snapshot finalunchanged, `tmp/9router-authority-current-panel-1791129909/BUILD_ID` exists. Fullteecompile8.9min/151pages; no knownproxy-init/writerconflict/errorwarningmatchinglines observed thisbuild. ActualcustomHTTPoriginalb8d0dc71b failednegativeassertion OSO6IG; telemetryb2f55632b QMQ7nF case8intendedHost127.1status200 policyabsent→version1 (originalwireunobserved). RawhelperreceiverrawHeaders verifiesactualHostalias+duplicatelines versuscomma; unchangedassertionsnewtransport `b45d6f3eb` **all12groupspass** qLrLkY, all13negativecases403authorityinvalid/no-store/SQLrowsabsentbeforeafter, actualrestartpolicyv1 ledgerOFF/attemptaudit0. Samefreshbuild/source1,405runtimehashinventoryunchanged; originalsretained no retrospectivegreen. Source/config/testsheldstable throughgate original11groups+negativeforwardedHost/spoof/Originauth/persistedfullpolicyrow existence/monthly beforeafter no-write. No compiledinstrumentation/trustheaderinjection; readonlyenvobserver limitation/noegress/fullruntimeparityclaim. Notoldbuildacceptance. Enforcement **OFF**; globalinit/rawhooks/providerfusion/runtimeparity/staticcloudwholephaseopen.

- Phase03unusedread-only groundwork: fingerprintinitial7/0then `bbbec7ab9`expanded10/0lint0; ownership-bound `logicalInspection.js` privateownerbrand/leaseexistingimage NodeWAL+SQLjsstandalone first22/0 then `ba792584c` **62/0exact4/linttestswhitespace0**, actualrollback/closefailure/pathreplacement/postcleanupownershipfail/missing+oversize; existingledgerdurability/policyinitincluded. NOTofflinequiescence/durableACK/freshness/adoptioncertificate; noinitializer/adapter/startup/offlinewritercaller. Fullintentwriter/recovery/crashmatrixunimplemented. See [initialization-intent design](./reports/initialization-intent-design.md). Nextsecurityprerequisite drivercatchallfallback narrowed `engineAcquisition.js`: onlyexactenginepreapplicationavailabilityallowsfallback/betterinmemorylazybindingprobe, unknownimport/projectfactory/ownership/DBopen/artifact/PRAGMA/durabilityfailuresfatal; Node24betterskipretained, removedNodeadapterglobalprocess.emitreplacement. `b265bfba2` first4filegate overallfailed **49/0exact4/lint1/whitespace0**, forbiddenlocalmodulebinding ESLintrule, originalJSON/lintretained. Advisorcheckpoint thenbinding-onlyengineModule rename, unchanged4filererun `b920fb546` **49/0exact4/linttestswhitespace0** /tmp/9router-engine-boundary-repair-results.json focusedcheckpointonly. AddedactualNodeownedstartup/invalidfile +isolatedbetterJS-onlymissingbinaryprocessfixtures `b0bd0b9be` **17/0exact3/linttestswhitespace0** separateoutputs; Node24installednativeaddonneverloaded, fullplatform/startup/buildparitynotaccepted. Newstable53selectedsweep `b4cc77122` **505/0/pendingtodo0 runnercomparatorstableallgreenwhitespace0**, /tmp/9router-storage-foundation-current-sweep.json prelaunch1,414→1,414inputs noaddedremovedchanged SHA/pathmanifestincludesrunners exactprior48+5foundation. Comparatorassertion-levelskiplimits; MODULE_TYPELESSremains noMaxListeners/PromiseHandledmatchingwarningobserved. Samepredeclaredsnapshotbuild `be840e920` running sourceheldunchanged; no build/fullsuite/recoveryacceptanceyet. Newsource makes461/build/runtime historical; enforcementOFF.

- Latest [proxy-bootstrap evidence](./reports/proxy-bootstrap-evidence.md): prior build-only guard unit9/0 +44file412/0/build1,401stable knownwritererrorsnotobservedinthatbuild. ActualAPI-only runtime smoke `b27679962` failedpersistedenvapplication (configreallypersisted); retainedjLeHsF artifact. ControlledA/B samepreimage showsAPI-onlynotapplied125samples versusdynamicHTTP200layoutapplied862msafterrequest; diagnosisnotruntimeacceptance. ExtendedexistingNodeinstrumentationregister settings-onlyawait +singleflight/redactedretry, existingconsole/cataloghooks retained; focused `b7cea8820` **18/0exact2**, lint/whitespace0. No broadbootstrap/no accountingactivation, false-on-failure compatibility remainsnotfailclosedoutboundguarantee.
- Newlatestsource `b73b758f9` **421/0exact45/no pending/todo**, runner/comparator/stable/allgreen/whitespace0, sharedprelaunch **1,402inputs** unchangedhash/pathinventory. MODULE_TYPELESSremains; noMaxListeners/PromiseRejectionwarningobserved. Build `bb2c089db` **build0/stable0/artifact0/whitespace0**, same1,402snapshot unchanged, `tmp/9router-proxy-register-panel-1791125941/BUILD_ID`. OriginalAPI-onlysmoke unchanged `bd71b2ef3` **6/6pass** SrA0of actualauth/settings/persistedproxyenvrestart/ledgerOFF no forcedinitializer/layoutrequest, not actualnetworkdelivery/firstoutboundproof. ManagementrealHTTPoriginal `bbb304d15` failedauthenticatedbudget403 wUnC1D preserved. Correctedthree-arm `bfaa917e7` diagnosis0 7vF9MH: canonical localhost200inactive/no-store; standalone127/customentry127403authorityinvalid. Canonicalfullsmoke `bd405ac08` **all11groupspass** ZRkTw3: actualauth/gatewaydenial CSRF/inactive409no-write lexical/bounds/CASstale/emptypageusage/coveragepagingrevision409/nonexistentattempt404/realrestart/read-onlySQLite OFF zeroattempt/audit. ClientIPv4lookup only no injectedtrustheaders; literal/customcompatibility stillopen. `b8f2de66c` copiedcompiledfixture safeheader/provenancebooleandiagnostic pending, source/buildheld unchanged; not pristineacceptance. Runtime/customserver/networkdelivery/allparity/globalinit/rawaccountinghooks stillopen. **Enforcement OFF; no wholephase completion.**

- Current-source checkpoint: [retry-hook/scope evidence](./reports/retry-hook-scope-evidence.md). Base prompt caller-abort/discard gate corrected **68/0 exact5**, original56/0 four-file incomplete artifact retained (wrong Antigravity filename; comparator2). Antigravity bounded clone read original **78/1 exact6** real timeout→cancel→done EOF race, repaired **81/0 exact6**, comparator/lint/whitespace0; no timeout/bytecap weakening. Gemini trusted pre-stream producer WeakMap/native envelope + original chat signal **27/0 exact4**, incremental bounded UTF8/SSE framing **35/0 exact5**. No inference accounting hooks or trusted terminal SSE producer yet.
- Expanded latest exact43-file sweep `b7758b9e6` **403/0/no pending/todo**, runner/comparator/stability/allgreen/whitespace0. Fresh build `b73e85e77` build0/stable0/artifact0/whitespace0, `tmp/9router-native-lifecycle-panel-1791122897/BUILD_ID`, both same prelaunch **1,400 inputs** unchanged hash/path inventory. Fulltee compile7.9min/151pages; repeated proxy initialization writer conflicts persist, not runtime-clean. MODULE_TYPELESS warning remains; no MaxListeners/PromiseRejectionHandledWarning in new sweep.
- Fresh-build budget UI `b05539a11` **12 fixture flows pass**, pageErrors[], mobile390×844 readable opaque internal-scroll panel; disposable server log startup/migrations only, no writer error observed. GoogleAnalytics attempted-but-blocked, server egress not certified. Pricing/coverage UI `bc89270b3` **17 fixture flows passed**, pageErrors[], knownanalyticsattemptblocked; bothgates sourceheldstablethroughterminal. Laterproxyguard/registerpatches makethesebuild/UI checkpointshistorical. These intercepted flows are not real persistence/auth/proxy/fullAX acceptance.
- [Future initialization-intent design](./reports/initialization-intent-design.md): full committed logical snapshot/pre/post plus retained durable intent and explicit offline ownership recovery; fingerprint proves state match, not freshness/whole-bundle rollback resistance. No retrofitted intent for ambiguous history, no initializer/startup/operator writer added. **Enforcement OFF. No wholephase complete.**

- Receipt committed-audit/sidecar ACK repair **19/0 across4files**; independentSQLjsreopen **1/0**. Latefixture original17/1 retained, validlateusage conflict audit unchangedledger+originalreceipt replay nowtested. SSR-only childwatcher fixture repair full durability **18/0**, original15s/death/reopen assertions unchanged. Original286/3broadreportretained; newintended33file sweep **292/0/no skips**, runner/comparator/hash/whitespace0, 1031paths unchanged; configstabilitysupplementcapturedmidrun limited.
- Freshreceiptbuild `b3c2abc95` compile0/stable0,995sourcepathinventoryunchanged; fulltee logs repeatedbuildworkeroutboundproxywriterconflicterrors, notruntimeclean. Budget12 and pricing17interceptedbrowserflows pass onthatbuild, pageErrors[]; empty/wrongreceiptretainsunchangedoperation, correctreceiptcleanup; realAPI/auth/proxy/allAX/egress notcertified, knownanalyticsattemptblocked. Originalfailedtracespreserved.
- LaterBaseExecutor cancellationprerequisite sourcepatch (noaccountinghooks) makesbuild/292/0prepatch evidence. Initial5filegate **60/2** bothforce-streamheadroommockmissingexport beforeexecute; Advisorfixture-only completecontract fixsameassertions, `b6a9a6850` **62/0fivefiles**, lint0/whitespace0; pendingretryhookneverreturnsstillcancellationgap, notcompletecancelcertificate. Listenertrace confirms4warnings requestDetailsRepo importhandlers; boundedlazy registration/idlecleanup repair **16/0twofiles**, lint0/whitespace0, trace noMaxListenersWarning. No durablelogging/gracefulshutdownclaim. ActiveLSP4changedpaths3clean/base9unusedhintfindings, noerrors—notallclean.
- Exact39intendedmanifest capturedbeforeexecution `/tmp/9router-lifecycle-current-scope.json` addsengine5+listenertest. `be97e136b` **358/0across39/no skips/todo**, runner/comparator/stability/whitespace0, sharedprelaunch1393inputhash+inventoryunchanged source/tests/config/manifests/runner. NoMaxListenersWarnings, MODULE_TYPELESSremains. Freshbuild `b1ca2a467` same snapshotpending, sourceheld; don'treuseoldgreen. Bounddurableinitializationintent/recovery, globaloperator scope, nativeBun/betterparity, fullrawdispatch and nativeerrors/fusion remainopen. Existingambiguousinitialization cannot bebackfilledunlimited; noactivation/productioninitializer/publish. **Enforcement OFF. No wholephase complete.**

- Authorized execution: `ak-cook --auto`, direct execution; no delegated writers/reviewers, no commit/push/publish. Branch `master`, HEAD still planning base; dirty source is intentional implementation, not disposable changes.
- **Phase01:** available Node24/SQL.js storage foundation implemented and focused tests passed; Bun/better-sqlite runtime, final release/regression and admission integration gates remain open. **Phase02:** inactive pricing implemented in part; security/compatibility focused tests passed, but live models.dev sync is **degraded** because69 original price lexemes exceed9decimal places. **Phase03:** isolated inactive windows/errors/request-local service started; verification/identity/analytics and already-unhealthy unlimited durable-proof gates open. **Phase04:** not integrated (dispatch inventory only). **Phases05–06:** inactive management routes/UI and comparator preparation partly implemented/under verification; full acceptance/rollout open. No whole phase is accepted complete; the original phase table is a coarse backlog, not current execution evidence.
- Accounting/enforcement remains **OFF**: no `ledgerStartedAt`, no upstream lifecycle hooks wired. Existing DB/auth/config/pricing repo modifications do affect ordinary startup/admin/analytics and require regression checks despite inactive enforcement.
- Precision decision: rate contract converts USD/1M to integer nanoUSD/1M. User replied `continue` after a precision-choice question returned no selection; continue under existing strict contract, **not approval for rational-rate representation or rounding/pruning**. Reject incompatible batch and retain last-good; keep valid approved bundled/manual pricing. No repeat live fetch to chase a green result.
- Resume verified 2026-10-04: initial latest pricing53/0 lintclean; current pricing ingress/snapshot/alias/free/HTTP slice76/0 lintclean LSP9clean; storage/auth74/0 lintclean. Cached live inventory remains **unvalidated** (69 incompatible original rates, no publication). Expanded inactive Phase03 identity/SQL.js checks33/0 lintclean; later redaction25/1, projection44/2, current accounting integration57/1 (all scoped lintclean). Original failures retained; serialized diagnostic26/0 and current15-file regression118/0 twice, lintclean after scoped disk-suite timeout accommodation. Earlier root cause remains suspected, not confirmed; no whole-phase completion or dispatch hooks.
- Resume contract: [handoff](../handoffs/api-key-budget-resume-20261003-1819.md). Durable detailed evidence: [storage](./reports/implementation-evidence.md), [pricing](./reports/pricing-evidence.md), [partial dispatch inventory](./reports/dispatch-inventory.md), [captured pricing inventory](./reports/pricing-coverage-inventory.md), [inactive budget-service checkpoint](./reports/budget-service-evidence.md).
- Current inactive accounting/storage/pricing boundary sweep `b33e3adeb`: **202/0 across22files**, scoped lint and whitespace clean; includes actual poisoned Node/SQL.js service proof+latch and restrictive-policy denial after gate repair. Failed original `be2224350`63/1 retained; repaired `b93cc5853`66/0, original fail-closed assertion unchanged. No all-runtime/independent/whole-phase approval. Changed-only decimal pricing editor now implemented with pure draft/submission seam; `be6608151` tests48/0 but lint1error (effect declaration order). Advisor failed-verification checkpoint completed; lifecycle/reset repair `bc55871ca`48/0 across5files, scoped lint/whitespace clean, active LSP4clean. Isolated Next production webpack build `b43a578d4`exit0 (temp HOME/DATA_DIR/dist, no postbuild/publish/manifests change); temp Playwright1.58.2 runner setup `b3edfe877`exit0 outside repo. Rendered smoke `b4176a260`failedexit1, fixture lintclean, no assertion/trace captured; ready/login then pricing compile. Advisor checkpoint done; `b40f4df0e` failed alert-selector collision, `bfd7fd1d0` failed known analytics attempted-origin assertion, originals retained; checkpoints completed. Local transparent-panel repair built/linted with21/0 twofiles `b8193a119`; fresh `b6b2d6667`rendered8checks exit0, no pageerrors, light/dark screenshots reviewed opaque/legible. Known analytics attempted+blocked, no unknown browser origin; actual persistence/auth/mobile/focus not claimed. Latest LSP2clean1inconclusive. Build actual output repo-relative `./tmp/9router-build-dist-EBuMOa`, not external; dev-generated CLAUDE.md block narrowly removed after shutdown, original instructions intact. Fixture-backed desktop pricing editor checkpoint passed; real persistence/auth/CSRF/responsive/accessibility and broader release gates open.
- Pricing management continued: strict route-level session/verified direct-peer+CSRF guard, fixed-source sync GET/POST/PUT, status/degraded UI and durable opt-in24h scheduler (defaultoff, explicit startup no immediate fetch). Actual JWT/SQLite/catalog70/0, schedule62/0, rawTCP/custom-server56/0 scopedlintclean; originals55/1 normalization and53/1 untransmittedHost fixture retained/repaired. Composite6file regression/build `b4424b603` passed83/0+buildexit0; rendered `b56a2728f`13checks passedfixturedesktop after retained nestedglob/immediatecheckbox testfailures; realAPI/UIcomposition notcertified. No live source/production schedule/ledger activation. Budget/recoveryHTTP availableNodeSQLjs focusedrepair65/0fivefiles; new coverage/keyusage original41/1 due canonicalaliasembeddingvalidation, repairedsource/test b0a2b6611 pending. Coveragebuild bad5f3000exit0 predatesvalidatorrepair+Endpointbudgetpanel; b7438803a16flow fixturedesktopmobile pending. Panel helpers/read/focus/ambiguousretry UIpreparation implemented, b78062435unit/lint and b6d36a491freshbuild pending; endpointpreexistinglint5errors2warnings verified againstHEAD, no wholelintclean. Comparator preparation b29f0e5a2pending, detailed [comparator evidence](./reports/comparator-evidence.md); no new scopeactivation.
- Original88h estimate remains provisional; full dispatch/coverage inventory incomplete. Do not infer new timeline commitment.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Stable key identity + durable idempotent accounting độc lập logs. | P1 |
| 2 | Weekly/monthly calendar limits và reset `Asia/Ho_Chi_Minh`. | P1 |
| 3 | Chat mọi format, embeddings, fallback/internal retry/fusion đúng attribution. | P1 |
| 4 | Pricing sync/override và dashboard/recovery có auth, không leak key. | P1 |

## Phases

| # | Phase | Implementation | Acceptance còn thiếu |
|---|-------|----------------|----------------------|
| 1 | [Identity, schema và durable ledger](./phase-01-start.md) | In progress — available-runtime foundation có code/evidence | Remaining recovery/restore và complete adapter/runtime gates; chưa accepted |
| 2 | [Reference pricing và catalog sync](./phase-02-pricing-catalog.md) | In progress — inactive resolver/sync/override/coverage có code | Pricing/raw-usage consumption coverage; strict live sync degraded; chưa accepted |
| 3 | [Windows, budget gates và accounting lifecycle](./phase-03-budget-accounting-service.md) | In progress — service/state/projection/recovery and bounded offline writer verified in focused scopes | Same-directory retained-intent restore scoped evidence passed; complete transfer/restore/runtime, unhealthy-unlimited request authority and broader integrated lifecycle/operator gates |
| 4 | [Chat, embeddings, retries và fusion](./phase-04-routing-integration.md) | In progress — actual OpenAI/DeepSeek chat and OpenAI embedding POST owners, retry/fallback/fusion/capacity/nested-sequential integration implemented with scoped evidence | Nested fusion work bound, unhealthy-unlimited request authority, hung terminal authorization, remaining provider/native/format owners and full inventory |
| 5 | [Management API, dashboard và recovery](./phase-05-admin-api-dashboard.md) | In progress — inactive endpoints/UI có code và scoped HTTP/UI evidence | Global/per-key actual-ledger rendered composition and retained semantic-operation retry scoped evidence passed; natural lost-ACK/browser-crash, broader UX/security/runtime acceptance remains |
| 6 | [Regression, security và rollout](./phase-06-verification-rollout.md) | In progress — comparator prep/selected tests/builds/docs có evidence | Full AC/regression/security/runtime/runbook acceptance; no rollout |

## Decisions và giới hạn

- User xác nhận: không debit lịch sử trước `ledgerStartedAt`; sau đó track cả identified unlimited keys. Bật/tắt budget không reset spend.
- Thiếu exact usage => unresolved và block budgeted key đến khi admin recovery có audit; không dùng estimate để debit.
- Thiếu giá/DB lỗi => fail-closed budgeted traffic; pricing sync lỗi giữ last-known-good. Manual > synced > approved bundled reference.
- Calendar windows `[start,end)` theo timezone chung; v1 không expose đổi timezone giữa kỳ. Attempt charged theo `startedAt`; unresolved không tự hết khi reset.
- **Không hard cap**: pending không reservation; concurrent/in-flight requests có thể vượt limit. Request tiếp theo bị chặn theo tiền đã ghi nhận.
- Không daily/rolling budget, billing, reservation, quota pools; không enforce image/audio/video/search/fetch. No-key/CLI compatibility giữ và UI công khai exemption.
- Strict unknown usage có thể block các provider thiếu metadata; one writer process/DATA_DIR là topology được hỗ trợ, không cluster SQL.js. Ownership acquired trước writable adapter load/migration, non-owner không ghi analytics/settings kể cả no-key/unlimited.
- Unlimited identified key tiếp tục khi recording lỗi chỉ sau **durable coverage-gap latch**; nếu latch không persist được thì reject identified dispatch. Gaps block budget activation/admissions tới audited reconciliation; no-key inference exemption không bypass writer lock.
- Management mới: dashboard JWT hoặc verified loopback + requireLogin=false; reject CLI inference token/gateway key và anonymous remote. Giữ unrelated APIs, không auth rewrite.
- Restore guarantee v1 là **managed stop-writer + maintenance/reconciliation procedure**, không automatic out-of-band DB rollback detection; config import preserves accounting/rejects key rebinding. Binary downgrade management/export only, không legacy inference.

## Execution order và dependencies

Thực thi remaining delivery theo mục **Hướng triển khai hiện hành**, không restart sáu phase từ đầu hoặc chờ mọi release gate của pricing/storage trước bất kỳ routing work nào. Dependencies bắt buộc là concrete consumer gates: verified ownership/durable recording, validated pricing snapshot tại consumption, fail-closed unknown/error handling và request-local identity trước actual hooks; fully enabled acceptance phải đủ cả sáu phase. Phase frontmatter dependencies vẫn là acceptance prerequisites, không có nghĩa các phần implementation chưa làm hoặc phải ngừng mọi preparation độc lập. Direct execution, không concurrent writers.

**88h** và effort từng phase là original provisional estimates, không deadline/revised commitment. Không external plan dependency; runtime availability và strict catalog degradation được ghi như gates/limitations, không đổi scope để né.

## Success Criteria

- [ ] Phase 01: identity/migration/durable ledger và adapter crash tests đạt.
- [ ] Phase 02: snapshot pricing/mapping/zero/unknown/math và sync security tests đạt.
- [ ] Phase 03: dual windows/state/idempotency/recovery/concurrency tests đạt.
- [ ] Phase 04: dispatch inventory + mọi supported chat/embedding/fusion/retry paths đạt.
- [ ] Phase 05: management auth/redaction/error contract và dashboard QA đạt.
- [ ] Phase 06: 13 brainstorm AC có evidence, baseline/lint/build và rollout/security đạt.

## Validation status

Ba policy questions trước đây giữ nguyên. Validation Session 1 hỏi 4 câu, user chọn toàn bộ recommended decisions; approved revisions đã propagate design + cả 6 phases. Full-tier source audit: 90 sampled claims, 70 verified / 12 failed incoming instructions / 8 future gates unverified; corrected plan blockers 0 sau consistency sweep. Đây là direct source validation + Advisor, không independent red-team hay implementation success. Tests/build/lint/catalog/durability implementation còn pending; xem [current audit](./reports/validation-session-01.md).

## Validation Log

### Session 1 — 2026-10-03

**Trigger:** User request `validate plans/261003-0827-api-key-quota-budget-pricing/plan.md`.
**Questions asked:** 4. Application implementation not authorized.

#### Verification Results

- **Tier:** Full — Fact Checker, Flow Tracer, Scope Auditor, Contract Verifier; direct execution.
- **Claims checked:** 90 (15 per phase).
- **Verified:** 70 | **Failed (incoming plan):** 12 | **Unverified:** 8.
- **Unresolved plan failures after approved revisions:** 0. Unverified external/runtime items remain explicit implementation gates, not verified success.
- **Failures/evidence:** pre-open writer exclusion (`driver.js:60-76`, `sqljsAdapter.js:24-37`); import/export/downgrade coverage (`db/index.js:71-111`); Gemini credentials/wrapper (`auth.js:345-358`, `v1beta/models/[...path]/route.js:100-104,428,457,524`); unlimited durability exception contradictory in incoming design; fusion live stragglers/regeneration (`combo.js:479-524,616-618`); CLI/anonymous remote management (`dashboardGuard.js:187,232`); modal full-map override pinning (`PricingModal.js:57,155`); comparator false-green suite errors (`verify-no-regression.mjs:15-18`, synthetic probe exit0). Full claim ledger/callers at [source audit](./reports/validation-session-01.md).

#### Questions & Answers

1. **[Security/Architecture]** For the new budget, accounting-recovery, and pricing-sync endpoints, which management access policy should the plan enforce?
   - Options: **JWT or trusted local (Recommended)** — dashboard JWT or verified loopback requireLogin=false, reject inference tokens/anonymous remote; **Dashboard JWT only** — require dashboard session even local; **Keep current guard behavior** — retain CLI and anonymous login-disabled remote access.
   - **Answer:** JWT or trusted local (Recommended).
   - **Rationale:** Existing outer guard is broader than the new sensitive recovery/sync contract. Shared route-level auth/CSRF checks needed; unrelated routes unchanged.
2. **[Availability/Accounting]** If durable accounting fails for an identified key with no budget, should inference continue despite an accounting gap?
   - Options: **Continue + latch gap (Recommended)** — durable gap marker before continuation, block later budgets until audited reconciliation, reject if marker cannot persist; **Reject identified-key traffic** — intent durability mandatory for all identified keys.
   - **Answer:** Continue + latch gap (Recommended).
   - **Rationale:** Preserve unlimited availability without advertising false exact coverage. Independent fsynced sidecar handles unhealthy adapter; failed latch rejects, no-key remains exempt.
3. **[Recovery/Scope]** What restore guarantee should v1 promise when an operator replaces the database with an older physical snapshot?
   - Options: **Managed procedure (Recommended)** — stop-writer/maintenance/reconcile, preserve accounting on config import, no automatic out-of-band detection; **Automatic rollback detection** — external durable watermark and broader persistence scope.
   - **Answer:** Managed procedure (Recommended).
   - **Rationale:** State restored with the DB cannot detect its own rollback. v1 promises a supported procedure, not an unimplemented anti-rollback mechanism.
4. **[Engineering Corrections]** May I apply the evidence-backed engineering corrections to the plan, without implementing application code or changing the accepted budget scope?
   - Options: **Revise plan now (Recommended)** — add Gemini wrapper/PricingModal/import-export ownership, pre-open writer exclusion, fusion straggler lifecycle and baseline suite/report checks; **Report only** — keep instructions unchanged and findings blocked.
   - **Answer:** Revise plan now (Recommended).
   - **Rationale:** Repair verified consumer/flow/gate gaps before execution; all new runtime tests remain future work.

No custom input supplied. Original money basis, calendar/timezone, strict missing usage, no-history debit, no-reservation and chat+embeddings scope unchanged.

#### Confirmed Decisions / Action Items

- [x] JWT/trusted-loopback new management guard and mutation CSRF requirements.
- [x] Unlimited durable-gap exception + failed-latch deny, audited reconciliation and activation blocking.
- [x] Managed physical restore/downgrade boundaries; config import preserves accounting and key binding.
- [x] Consumer ownership: Gemini route, PricingModal, config import/export; singleton-local accounting, fusion collected-only settlement and late sink.
- [x] Regression gate must catch collection/runtime errors and incomplete reports; no broad known-fails expansion.
- [ ] Implementation evidence: full dispatch inventory, pricing units/runtime HTTP, adapter durability/backup/gap crash matrix, actual native/UI/security/regression/build results. These are execution gates, not validation blockers hidden as passes.

#### Impact on Phases

- **01:** Ownership before all writable initialization, durable coverage/maintenance sidecar, config import/export collision tests, backup round-trip and restore boundaries.
- **02:** Separate enforced snapshot from legacy numeric price-map API; validated decimal ingress; preserve explicit zero/inherit semantics.
- **03:** Credential precedence, request-local hook state, gap-aware policy/recovery and unlimited failure tests.
- **04:** Gemini wrapper signal/errors/headers, actual route fixtures, singleton isolation, quorum/grace stragglers and separately gated regeneration.
- **05:** Shared route-level admin guard/CSRF, audited gap recovery, PricingModal changed-only/no-op/inherit/reset UI.
- **06:** Comparator failed-suite/report completeness fixtures; managed restore/downgrade/gap/security rollout. Original estimate must be revisited.

### Whole-Plan Consistency Sweep

- Files reread: plan.md, design-contract.md, all six phase files and current audit report.
- Decision deltas checked: 8 groups (admin auth, unlimited gaps, writer exclusion, restore/import, Gemini wrapper, pricing modal, fusion/state lifetime, baseline completeness).
- Reconciled stale references: across all affected files; previous planning-validation report retained and explicitly historical/superseded.
- Unresolved contradictions: 0 after approved propagation; eight runtime/external evidence gates remain pending.
- Source unchanged; no implementation phase marked done. Advisor completion review recorded in the current audit report.

## Handoff

Implementation đã được user authorize `ak-cook --auto`; không quay lại chờ routine approval. Fresh session tiếp tục **remaining delivery sequence** ở đầu plan, không restart Phase01. Có thể resume bằng:

```text
/ak:cook /home/gmo/projects/9router/plans/261003-0827-api-key-quota-budget-pricing/plan.md
```

Reread design contract/root instructions và current remaining-delivery roadmap; giữ existing dirty work/evidence, enforcement OFF và source barriers. Task hydration là mirror của remaining deliverables; phase checklist/evidence vẫn giữ acceptance authority. Không suy completion từ frontmatter in-progress hay focused green.

<!-- slug: api-key-quota-budget-pricing -->