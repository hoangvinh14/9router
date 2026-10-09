# Dispatch inventory — initial embeddings hooks, coverage still incomplete

> **Coverage/evidence reference thuộc Gói B.** [Roadmap Gói A–E](../plan.md#current-delivery-roadmap) là execution authority. Inventory này chưa complete; finite preflight phải reconcile source/evidence thành transport/protocol-family list, không claim body inspection là coverage certification. Historical pending/running statements không live tasks. Giữ unsupported accounting refusals như safety, không feature completion.

## Current embeddings implementation and failure checkpoint

`src/sse/handlers/embeddings.js` now creates one requestlocal stable-ID context;
OFF comes from persisted activation absence, not a caught storage failure.
`embeddingsCore.js` injects optional accounting into `embeddingProviders/accountedRequest.js`:
actual initial/refresh POST owns a distinct attempt, bounded single raw JSON reader,
exact usage normalization before adapter translation, durable terminal outside
transport catch. Schema capability initially explicit for OpenAI only; custom and
other unverified budgeted adapters refuse before POST. No production activation.

First gate `bd8a9d896` **FAILED59pass11fail across5 files**; lint0errors,
2 anonymous-default-export warnings on existing adapter shapes, whitespace0.
All11 lifecycle failures stop at service pricing gate before network: fixture's
`text-embedding-3-small` lacks exact/manual reference. Original reports retained:
`/tmp/9router-embedding-accounting-first-{results,failures}.json`.
Fixture-only repair seeds decimal-string manual rates through real pricingRepo,
asserts `priced/manual` complete snapshot before dispatch, keeps original assertions,
and adds independent missingprice zeroPOST/zeroattempt case. Production resolver
and catalog mapping unchanged; no live fetch or precision relaxation.
`b19f99578` rerun **FAILED8pass6fail exact1/lintwhitespace0**:
6 strict refresh-notCalled failures retained one previous hoistedmock call. Bare
vi.fn histories survive resetModules/restoreAllMocks; percase explicit reset of
refresh/retry followed by same default implementations, no assertions weakened.
Original report `/tmp/9router-embedding-accounting-price-repair-results.json` retained.
Advisor failure checkpoint reviewed isolation hypothesis; `b4ba216ac` **71/71
across5 files, lint/whitespace0**, `/tmp/9router-embedding-isolation-results.json`.
Initial Node/explicitmanualpricing/core raw lifecycle checkpoint; not appHTTP/auth,
allprovider coverage, SQL.js parity or release acceptance.

Next patch adds prompt stop around actual fetch/refresh (exact caller reason,
late outcomes observed, unhanded late Response cancelled once without awaiting).
Foreign work can continue; not a resource-stop guarantee. Added actualapphandler
fixture using realcore/storage/context, upstream credential/model/logger mocks;
local429 no cooldown/no duplicate legacyanalytics, parallel request IDs with
midflightpriceedit preserving snapshots, deletion-inflight terminaldebit, callerabort
beforeheaders with latebody cancellation. Gate `b06b8a160` **75/75 across5**,
lint/whitespace0; `/tmp/9router-embedding-app-cancel-results.json`.
Actual HTTP/auth, SQL.js, unhealthyunlimitedexception and full provider certification
remain open. Legacy OFF analytics tests not active-ledger evidence.

## First chat non-stream OpenAI per-POST implementation — pending gate

App creates one stable-ID context; current activecombo/capacity/fusion routes refuse
explicitunsupported beforepaneldispatch until collector authority is integrated.
Singlechat passes injected lifecycle+originalsignal through chatCore initial/auth
retry to BaseExecutor actualPOST owner `executors/accountedBase.js`. No second
attempt at executor wrapper. EachPOST has distinct durableintent; raw boundedJSON
single read settles before retry decisions/backoff/translation/clientresponse.
Headers/serializedbody detached before awaitadmission. Accountingerrors outside
transport catches; unknownerror stops budgeted nextdispatch, exactretry firstsettles.
Localerrors escape chatCore authcatch and appbeforecooldown/quota. Legacy usageStats
suppressed where ledger projection owns analytics; requestdetail/logs retained.

Initial supportedmode only OpenAI nonstream; activeidentified other providers,
stream/combos conservativelyrefuse (including unlimited), not releasecoverage.
OFFnohooks retains originalpath/no new buffering. Headerabort race observes late
foreignoutcomes/cancels unhandedresponse not proof work stopped.
`b8b30d925` **FAILED48pass2fail exact4/lintwhitespace0** original report
`/tmp/9router-chat-accounting-first-results.json`: forceStreamcoldcase5stimeout then
nextcase mockcount2. Timing cause provisional; original assertions retained, cold
sharedimport movedbeforeAll with unchangedhook/testdeadline (no timeoutincrease).

Bodyinspection exposed integration mismatch: OpenAIforceStream=true, so initial
nonstreamBaseunit path never proved realhandlerreachability. Keep originalforceStream
config, add explicit bufferedforcedSSE→clientJSON mode for nonstreamclients only.
include_usage:true upstream option; boundedrawtext oneowner, rawemptychoicesusage+
DONE strictpresence/validzero/error/conflict; no syntheticDONE or convertedusage.
Textreader/SSEparser bounded retainedrepresentation, not absoluteallocationbound;
partialusage before transportfailure currently unresolved/null, rawpartial evidence
retention still releasegap. ForcedSSEconverter suppresses legacyanalytics whenledger
ownsprojection; details/log unchanged. TrueclientliveSSE stillunsupported.
Added actualapp→realcore→realDefaultBase fixture(upstreamauth/model/logger mocks),
unchangedforceStream/usageoptions/rawcost/clientJSON/local429nocooldown assertion.
`bb1d6eece` **FAILED65pass1fail exact6/lintwhitespace0** report
`/tmp/9router-chat-accounting-sse-repair-results.json`: actualappfixture mocklogger
namespace lacks tagForSession export atchatCore74, beforeBase/POST. ForceStream
regression now passes unchanged assertions/deadlines; timing cause notcertified.
Advisorfailurecheckpoint agrees fixture-only importOriginal spreadrealexportAPI,
no-op displaymethods preserving tag/fmtThink/mask helpers. `b59cb6e02` sameexact6
**FAILED65pass1fail/lintwhitespace0**, report `/tmp/9router-chat-logger-repair-results.json`.
Logger missingexport repaired; actualappfixture now503vs200, cause notyetobserved.
No speculativeguard/config/pricing change: diagnostic-only fixture records local
machinecode/networkcount/ledgerstates (no prompt/credential) before unchanged200
assertion. `b5e6b50b8` exactonecase diagnostic pending, report
`/tmp/9router-chat-app-status-results.json` **FAILED0pass1fail with11filteredskips**,
not a scope acceptance run. Diagnosis status503/api_key_accounting_unresolved,
networkcalls1/oneunresolvedattempt. Source inspection suggests effective streamargtrue
but serialized clientbody.streamfalse (translateRequest sameformat retains flag;
accountedBase adds include_usage without stream:true). Notyetwireverified: fixture
records stream/includeusage before unchangedassertion, `bf342eb87` exactcasepending,
`/tmp/9router-chat-wire-before-fix-results.json`. `bf342eb87` **FAILED0pass1fail with11filteredskips**; serialized flags captured
before mockassertion: stream:false/includeUsage:true. Preserved immutable diagnostic
copies `/tmp/9router-chat-wire-confirmed-before-fix.json` and
`/tmp/9router-chat-app-status-confirmed-before-fix.json`. Mock streamtrueassertion
therefore throws inside transportcall; conservative unresolved/retrybarrier retained.
After observedcause, one-line accountedBase fix sets stream:true on detached upstream
body only when effective upstreamstream true. Original clientresponseintent/config/OFF
path untouched; added frozenclientbody/options test preserving otheroptions and
clientstreamfalse. Removed temporary diagnosticwrites from test; failedreports retained.
`b86f64b9d` sameexact6files plusoneimmutabilitycase **67/67,0skip,0todo**,
`/tmp/9router-chat-wire-repair-results.json`, lint `/tmp/9router-chat-wire-repair-lint.txt`
empty; final GATES tests=0/lint=0/whitespace=0. Actual mocked app→chatCore→DefaultBase
forcedSSE→rawusage/DONE→durablesettlement→clientJSON now focused verified, pending
beforePOST, cost200000nano, no duplicatelegacyanalytics, subsequent local429 no
cooldown/newPOST. Frozeninput streamfalse/options unchanged; effectivewiretrue/options
merge preserved. All earlierfailed states/reports retained; no productionactivation,
actualHTTPauth, liveSSE, SQL.js lifecycle, allprovider/fusion or wholephase acceptance.
Next: incremental rawOpenAI liveSSE owner before any translation/estimation, terminal
settlement barrier/cancellation/partialevidence; current livepaths remain unsupported.

Live slice design checkpoint (Advisor advisory, not independent patch approval):
restrict initial raw passthrough to OpenAI source/target/provider and singlechoice;
parse complete events before forwarding, withhold finish_reason/usage/DONE and all
following bytes until exactusage+DONE+cleanEOF+durableACK. Absolute postDONE deadline
(required even for comment trickle), bounded terminal bytes/eventcount, one shared
finalization winner for EOF/error/cancel. Settlementfailure cannot release successful
terminal or enter provider retry/cooldown; native conversions unsupported until trusted
terminal authority. Keep partialusage evidence separate from exact cost authority.

New `accountingSseParser.js`/`accountingStreamLimits.js` provide incremental fatalUTF8
framing, exact raw emptychoices usage contract, singlechoice enforcement, event/chunk
bounds including comments/unknownfields, EOF unfinishedevent compatibility (no invented
DONE). Legacy Gemini decoder unchanged. Not connected to routing or settlement yet.
`b17d2fe33` parser gate **22/22 exact3,0skip/todo**, gates tests/lint/whitespace0,
`/tmp/9router-accounting-parser-results.json`, lint `/tmp/9router-accounting-parser-lint.txt`.
No liveSSE acceptance from parser alone; bounds are not aggregate transport/allocation.

First consumer `createAccountedOpenaiStream` now implemented: raw parser on each event,
delta queue vs bounded heldterminal queue, cleanEOF usage/DONE→one claimed finalization
promise→durableACK→release heldframes. SharedEOF/error/cancel/idle/postDONEtimer winner;
postDONE absolute deadline not reset by comments, nonblocking upstreamcancel/observed
late reads, sanitized streamerror/no successDONE afterfailedsettlement. Existing
Base perPOST transfers ownership only successful rawSSEresponse in explicitlive mode;
failedstatus still settled before retry/auth. ChatCore allows only OpenAI sameformat
singlechoice live slice and bypasses legacy syntheticterminal/estimator/analytics,
no-store. Initialfixture appdelta pending then terminalsettled plus cancelblocksnextPOST.
`be43eda38` firstlivegate **95/95 exact8,0skip/todo**, tests/lint/whitespace0,
`/tmp/9router-live-openai-first-results.json`, lint `/tmp/9router-live-openai-first-lint.txt`.
Focused apprawstream delta pending→terminalsettled/nolegacyanalytics and mockedACK
barrier/error/cancel/postDONEdeadline tested, not broader release acceptance.

Following advisory/source self-review (not independent approval): pretransfer locked
reader or successfulnonSSElivemismatch now caller-completesunknown exactlyonce, outside
constructioncatch, and localrefuses evenunlimited; posttransfer constructionfailure
uses streamcancel owner, never secondcompletion/retry. Added readyqueue count/bytes
limits beforepush, foreignread/cancel timeoutlatefailure tests and slowconsumer policy
(idle deadline deliberately includes downstreambackpressure, not just outstandingread).
Callerabort listener retained duringclaimedACK so output suppresses without overriding
exactwinner; delayed realNode ledgerACK/cancel, live missingDONE blocksnewPOST,
multiplechoiceappdeny0POST tests added. Partial edit applied4entries before spurious
fiftholdText failed; reread currentfile then precisecontinuation, no reset.
`b4f7885a5` hardeninggate **106/106 exact8,0skip/todo**, tests/lint/whitespace0,
`/tmp/9router-live-boundary-results.json`, lint `/tmp/9router-live-boundary-lint.txt`.
Lockedbody/nonSSE unknownsingleterminal/no retry, readyqueuebounds, lateforeignread,
slowconsumeridlepolicy, callerabortduringACK and actualNode delayedACK winner tested.
No wholephase/actualHTTP/allruntime acceptance.

Next actualchat authretry slice: optional signal/terminalpredicate on existing
`refreshWithRetry`, abortablebackoff and foreignwork race (lateoutcomes observed,
not work-stop guarantee); accountedchat threads originalsignal/privatelocalerror
predicate, credentials callback cancellation/localerrors escape, late refreshed
credential mutation checks abortedstate. DefaultOFF no extra callbackargument;
existingretry policy/deadlines retained. Actualapp fixture exact401firstsettled then
refresh then distinctsecondPOST+rawSSE JSON, usage-less401localdeny beforecontrol,
primitivecallerabort duringforeignrefresh no cooldown/secondPOST. `b74a63736`
**113/113 exact9,0skip/todo**, tests/lint/whitespace0
`/tmp/9router-chat-auth-retry-results.json`, lint `/tmp/9router-chat-auth-retry-lint.txt`.
No fusion/wholephase certification.

Accountfallback nextslice reuses single requestcontext: fresh gate before accountloop
and after failedterminal before quota/cooldown, optionalabortable credentialselection
and preRefresh; original OFF routing remains no lifecycle. Hoistedselect/cooldown/
preRefresh mocks now reset/reinstall everycase, defaultcooldown still throws to expose
localrefusal leakage. Actualtwo-account failedexact→settled→cooldown→distinctsecond
connection/attempt/samerequest fixture plus exactspendexhaustion no cooldown/select2,
primitiveabort foreignselection 0POST/attempt. `b4d8d63da` **116/116 exact9,0skip/todo**,
tests/lint/whitespace0 `/tmp/9router-chat-account-fallback-results.json`, lint
`/tmp/9router-chat-account-fallback-lint.txt`.

Sequentialcombo slice now optionalaccounting+signal on `handleComboChat`: freshgate
beforecandidate/afterfailure, private localexceptions escape catch, abortable transient
cooldown/foreigncandidate; app outercombo forwards samecontext only when nonfusion and
no capacityadapter added. Nestedcombo/fusion/capacity remain explicitunsupported.
Actualtwo-modeldifferentmanualsnapshots sameRequestId/distinctPOST/attempt costs200000
and400000; unknown/exhausted localerrors stop before nextmodel/cooldown. Added independent
combo boundary localerror/freshgate/cooldowncancel/OFFordinaryfallback fixtures. Existing
rotation/autoswitch/fusion tests retained, policies/ordering/deadlines unchanged.
Partialedit2entriescommitted then ambiguous3callbacktarget failed; rereaduniqueoutercombo
and precisecontextthreading, no reset. `bfe1b75ad` exact13 **FAILED144pass2fail**,
lint/whitespace0 `/tmp/9router-model-combo-results.json`, lint
`/tmp/9router-model-combo-lint.txt`; pertestfailure extract
`/tmp/9router-model-combo-failures.json`. Actualchataccountingfile29/0 and comboaccounting
boundary4/0 observed; aggregate gate remains failed. Bothfailures combo-autoswitch
web_search→search assertionfalse, no-matchmodelarrayidentity expectedsameactualnewarray.
Source functions untouched bycurrentpatch but not enough to classify preexisting.
Advisorfailurecheckpoint: pinnedHEADcontrol beforeclassification/no searchfeaturefix
or assertionweakening. `b4348de1b` HEADarchive
`/tmp/9router-combo-head-WulGjT` sameNodev24.21.0/deps symlink, aliaspaths archive,
exactoriginal autoswitch/routing/fusion3files **21pass2fail**, same2assertions/messages
`/tmp/9router-model-combo-head-results.json`. Newaccountingfiles absentHEAD, cannot
runfullcandidate13scope asbaseline; control limitation explicit. Candidate remains
144/2 failed, both namedfailures reproduced on pinnedHEAD control, no waiver or
baseline/assertion rewrite. ArchiveHEAD.txt/absolutealiases/candidate diff retained.

Fusion actualowner slice implemented after bounded advisory: optionalaccounting/signal,
privatefirstlocalerror latch beforefatalabort, originalauthority preserved instead of
__error→genericallfailed. Normalquorum/grace does notcancelstragglers; collectorreturns
snapshot andcleansaborttimers/listeners, latecalloutcomes stay observed. Deep cloned
panel/judge inputs avoid translator sharedmutation. Eachcallback getscompositesignal
through app requestSignal override to actualBaseadmission/fetch; panel/judge/singleanswer
regeneration samecontext butdistinctPOSTs. Accountedpanelreturns only aftersettlement,
freshgate/latch beforecollectedanswer andjudge; latefatal canstopactivejudge but cannot
retractdeliveredresponse/durabledebit. Abort neverproveszero/free orforeignworkstopped.
OFF callbackarity/strategy/defaultquorum/grace retained; capacity/nestedunsupported.
Partialappedit5entries applied before3ambiguous regions rejected, rereadandprecise
remainingcallbacks/signalgates; no reset. Added realNodeapp2panels+judge/regeneration/
unknownnojduge plus injectedfatal/mixedsuccess/deepisolation/latefataljudge/callerabort/
normalgracelive tests. `bf19e8a3f` **FAILED153pass2fail exact14**, lint/whitespace0
`/tmp/9router-fusion-accounting-first-results.json`, failureextract
`/tmp/9router-fusion-accounting-first-failures.json`, lint
`/tmp/9router-fusion-accounting-first-lint.txt`. Onlysame2HEADreproducedautoswitchreds;
no newfailedassertion, aggregate stillred notacceptancewaive.

NextrealNode ledger scenarios: normalgraceclientreturnswhilethirdpending thenlateexact
settles original3/6snapshot600000nano aftercurrentpriceedit, fourdistinctIDs/samerequest;
late200SSE missingrawusage afterquorum duringactuallydispatchedjudge. Added perpanel
postreply freshgate inside fusiondispatch beforeHTTPokcollector: converted200 alone
is not usableaccountinganswer; localunknown→firstlatch→abortjudge, oneambiguousterminal
per POST, no laterdispatch. HeldpreRefreshfatal preventsgeneration/intent for heldpanel.
`b137b4bf4` sameexact14 **FAILED156pass2fail**, onlysame2HEADreproducedautoswitchreds,
newthreeactualledgercases pass; lint/whitespace0. Failureextract
`/tmp/9router-fusion-late-failures.json`, report `/tmp/9router-fusion-late-results.json`,
lint `/tmp/9router-fusion-late-lint.txt`.
Integratedmilestone `b898102a6` **FAILED775pass2fail exact74predeclaredfiles**,0pending/
todo/collectionfailure; onlysame2autoswitchHEADreproducedtests. Comparator1 explicitly
REGRESSION/baselineunchanged, runner1/allgreen1/stability0/whitespace0.
**1,449→1,449 inputs unchanged**, reports
`/tmp/9router-routing-milestone-{scope.json,input-snapshot.json,sweep.json,failures.json,comparator.txt,sweep-stability.json}`.
MODULE_TYPELESS_PACKAGE_JSON remains; no moduleconfiguration/warningsuppressionfix.
Same-source diagnosticbuild `b1c8407fc` **PASS exit0**, Nodev24.21.0, isolatedHOME/
DATA_DIR/uniqueNEXT_DIST_DIR/telemetryOFF;1,449inputsunchanged, artifact
`tmp/9router-routing-milestone-panel-1791147483/BUILD_ID`=`Z680e1AhvbJ0Bl8wYedBp`.
Fulltee `/tmp/9router-routing-milestone-build-full.log`, path/stability reports sameprefix.
Advisor summaryonly checkpoint no independentapproval. **Build passed; integrated test
gate remains failed**, notwhole-tree/allprovider/allruntime/fullphase certificate.

Next `chat-accounting-ack-durability.test.js` added fouractualBaseperPOST faultcases
NodeRELEASE beforecommit/committedthenlostACK and SQLjs renamefailure/installedthen
directoryACKfailure. Each exactrawJSON settlementfails privateUNAVAILABLE, onecompletion,
no retry/success. Same-liveowner reopen onlyinspectspersistedpending/settled, never
retrofitoldACK or timeout-recoverliveowner. Installedterminal replaytwice single200000
spend; pendingnullusage/cost preserved; projectionnotwrittenbeforeACK. `b500471af`
focusedexact5gate **FAILED77pass4setupfail**, lint/whitespace0
`/tmp/9router-chat-ack-{results.json,failures.json,lint.txt}`. All4beforePOST:
ENOENTrealpathparent/db fixturecreatedparent/data.sqlite vsinitializeractualparent/db/
data.sqlite. Advisorobservedfailurecheckpoint (summarynotapproval), fixtureonlycreates
DBsubdirectory/correctpath sameownercanonicalparent; no guard/fault/assertion/deadline
change. `b5cb1419d` sameexact5 **81/81,0skip/todo**, allfournewfaultcasespass,
GATES tests/lint/whitespace0 `/tmp/9router-chat-ack-layout-{results.json,lint.txt}`.
Existingactualprocessdeadowner/restartfixturesunchanged; same-liveownerinspection
stillnotnewprocessfailedACKrecovery.

Added `chat-ack-crash-child.mjs`/`chat-accounting-ack-crash.test.js`: explicitNode/
SQLjswriter actualBasePOST samefaultmatrix→privateUNAVAILABLE/onecompletion/onePOST→
actualSIGKILL→productiondriverNode deadownerreopen. Pendingmustbeunresolved/null;
installedsettledretained200000nano; originalfailedACKnotretrofit. Then auditedexact
recovery on originalsnapshot aftercurrentpriceedit, committedoperationrepeat and
projectionreplay twice+newprocess sameonecost/row/receipt. SQLjs→Noderestart is
interoperability, notSQLjsfallback/Bun/healthybettercertificate. Original15sperchild
bound retained; newfourprocesscases60soverall (fourchildcalls/case), noolddeadline
increase. DisposableHOME/DATA_DIR/fetchreplacedbeforeproxyimport/fixtureactivationonly.
`b4e8594ab` exact4 **33/33,0skip/todo**, GATES tests/lint/whitespace0
`/tmp/9router-chat-ack-crash-{results.json,lint.txt}`. FournewactualprocessACKfault→
SIGKILL→driverrecovery→auditedrecover/originalprice/replay casespass; thisdoesnotprove
powerloss/Bun/SQLjsfallback orallnativeprotocols. LSP unavailableonnewtest/deferred
opengrep meansnotclean/staticindependentreviewclaim.

Nextsixanswerboundarycases (testonly/noenginebehaviorchange): realapp2paidrawexact
panels withone/allwhitespaceprose. All-empty returnsoriginal503withoutjudge; oneusable
regenerateswinningmodel distinctthirdPOST; originalemptyattemptdebitsretained. Injected
malformed/whitespace200 cannotbejudgeprose, alreadyabortedprimitive0 invokesnopanel,
syncprivatefailurefirstauthority persists oversecondarycleanup rejection. Existing
quorum/grace countsHTTPok preserved, no alteringstrategy/defaults inthisacceptanceslice.
`ba9855ae1` exact6 **65/65,0skip/todo**, GATES tests/lint/whitespace0
`/tmp/9router-fusion-answer-{results.json,lint.txt}`
includesACKprocess+parity andoriginalfusion/streamoptions regressions. Doesnotremove
integratedautoswitch2red orcompletePhase04; partialusage/hungACK/rawprovider/native/
HTTPauth/SQLjsgateway/fullmanagementsecurity remain.

Bounded liveSSE partial-observation implementation afterAdvisor designcheckpoint:
`accountingUsageEvidence.js` strictversion/kind/OpenAI-chat/reason enum and counts only,
noexactflag/rawbody/money/provenance. Parserretains firstvalidnormalizedcounts; any
parserfailure marks priorcounts invalid_stream, notlasttotal/authoritative. EOFmissing
DONE/cancel/readfail preserves diagnostic `usageEvidence` only, while usage:null/
unresolved/costnull. Service+repo validate allowlistedfields/safeints/cache subsets/
reasoninginoutput, attemptprovider/endpoint; onlyunresolvedterminalJson containsit,
neverusageJson/analytics/no auto recovery. Sourceconsumer audit: terminalJson onlyrepo
canonicaldedupe/CAS/conflict and schema; rowToAttempt stripsit, management/projection
usesusageJson, notnestedobservations. Existingexactwinner/sharedfinalization promise
andmanualrecoveryconflict semantics unchanged; diagnostic no overwrite/enrichment.
No schema/UIautofill/newactivation. `b58a2348c` exact8 **96/96,0skip/todo**, GATES tests/lint/whitespace0
`/tmp/9router-usage-observation-{results.json,lint.txt}`: missingDONE/conflictingvalid/
malformedaftervalid retainedfirstcounts/invalidmarker, realledgerbudgetblock/costnull/
no projection/strictnegativefields/idempotence/manualrecoveryconflict plus existing
ACK/cancelwinner/recovery suites.

Next fullyreadbufferedforcedSSE `inspectAccountingSseUsage` returns exactusage OR
nonauthoritativefirstobservedcounts/reason envelope; existingexact-onlyextractorretains
compatibility. Basehands evidence onlywhenrawreadcompleted, notfabricatingbytesonread
failure; costnull/unresolved/usageJsonnull/no projection. MissingDONEincludingexplicit
zerocounts keptdiagnostic only, conflict/postDONEinvalidmark. Style diagnostic atnew
assignmentconditional resolvedexplicitblock beforegate, no behavior/assertionweakening.
`bebf20e54` exact10 **126/126,0skip/todo**, GATES tests/lint/whitespace0
`/tmp/9router-buffered-observation-{results.json,lint.txt}`.

Nextbufferedinterruptedreader now synchronousboundeddiagnostictap oncompletechunks
beforetextdecode; rawreader stillmustcleanEOF/strictUTF8 and no partialreturn onerror/
timeout/cancel. Existingbufferedframingobserver incremental capturesonlycompleteusage
frames; no EOFflushonfailure (unterminatedusageeventnotretained). Preservesfirstcounts
andinvalid_streammarker afterconflict; readerror→interrupted, abort→cancelled evidence
terminalJsononly usage:null/unresolved/costnull, exactprimitivecallerreason/no retry.
`b3bcfaef4` exact12 **154/154,0skip/todo**, GATES tests/lint/whitespace0 `/tmp/9router-interrupted-observation-{results.json,lint.txt}`:
threeactualledgerreaderror/abort/partial-eventcases andunchanged30sdeadline fakeclock
observertest, sharedembeddingreaderregression. Observerlimits retainedrepresentation
notabsoluteallocation. EmbeddingpartialJSONnoexactauthority/evidence, optionalhungACK
actualHTTP/provider broadacceptance remainopen.

Existingmanagementactualledger fixture added(noAPIrebuild): twoactualBasePOSTs exact
settled+liveSSEmissingDONE unresolveddiagnostic. Statusrecordedspend0.0002/windows,
pageknowntotal0.0002/totalnull, attemptlistingusagecostnull/redacteddiagnosticfields.
SigneddashboardJWTactualroutefunctionauthbeforeDB/gatewaykey401/CSRF403/no mutation;
manualindependentexactrecover aftercurrentprice9/9 stilloriginal1/2snapshot0.0002,
repeatedPOSTimmutablecommittedreceipt/serveractor/oneaudit/twoprojectionreceipts,
postrecoveryknownspend0.0004. EnforcementActivefalse/statusinactive intentionally
unchanged sinceproductionrolloutnotaccepted. NotactualHTTPtransport/UI/globaloperator
acceptance. `b37eff873` exact6 **68/68,0skip/todo**, GATES tests/lint/whitespace0 `/tmp/9router-ledger-management-{results.json,lint.txt}`
includesexistingmanagement/SQLjs/receipt/clientdraft regressions; activationfixtureonly.

Globalrecoveryoperatornextslice afterAdvisor generation/receiptcheckpoint: new
`/api/accounting/gaps` GET observationalNULLscopeonly/redactedgenerationmaintenance,
POSTexplicitglobalgapwaiver boundedreason/evidence/opid/targetgeneration serveractor,
existingdashboardadminJWT/trustedlocalguardbeforebodyDB. Noactivation/maintenanceenter/
maintenancereleaseendpoint; maintenance release needsdurabletargetACKidentity beyond
nullablemaintenancefield beforeHTTPexposure. Globalwaiverduringmaintenance exception
cannotreleasemaintenance/repairintegrity/setpolicy. `reconcileGap` existingauditbefore
sidecar tightened priorauditaction/scope/target/payload conflict409; synchronoussingle
writer excludesinterleaving, targetgenerationrechecked. Receipt reuseexistingcommitted
payload/livegapresolvedbyexactop; historicalreceiptstillreportsnewerlatchesunchanged.
`b42e6be7f` exact6 **40/40,0skip/todo**, GATES tests/lint/whitespace0 `/tmp/9router-global-gap-{results.json,lint.txt}` NodeSQLjs
signedJWT/CSRF/authbeforeDB/redaction/noactivation/wrongkey/stalechangedpayload,
sidecarfailedACK→handle-reopenretry sameop, committedfailedACK→newerlatch→oldop409,
successfulhistoricalreceiptnewgapnotcleared. Handlereopennotactualprocesscrash yet;
coverageidentityantirollbackexcludedv1/actualHTTP/globalUI broaderacceptanceopen.

MaintenanceACKstorageonlynextslice afterAdvisor durability/replaycheckpoint: additive
optional `maintenanceReleases` protectedsidecarhistory(strictshape≤1000uniqueops/target
 generations/coverageID/hash/ISOtime). Domain-separatedpayload binds coverageID,target
 generation/op/actor/reason/evidence. Atomic sidecar clearsmaintenanceANDappendsACK;
DBauditbeforeACK remainsintentnotcompleteduntilACK. Existinghandle detectsdropped/
redefinedhistory; wholebundlerollbackafterdeath remainsoutsidev1; olderwriters/downgrade
notaccepted. Capacitycheck beforeaudit andbeforemutate; historyneverpruned exactreplay
read-only evenatcapacity. Historicalreceiptrequires matchingcommittedaudit+ACK, may
returnwhilelatermaintenanceactive withoutclearingit. AuditwithoutACK permitsretryonly
originalactivetarget, otherwise409/no retrofit. Currentmanagedrestore preservesexternal
sidecar(notrestored), butolderDBmissingmatchingreleaseaudit mustdenyreceipt; broader
retainedinitializationintentrestore stillnotaccepted. `b979929c4` exact7 **95/95,0skip/todo**, GATES tests/lint/whitespace0
`/tmp/9router-maintenance-ack-{results.json,lint.txt}` NodeSQLjs historicalreplay/newerlatch,
failedrename/installeddirACK→poison→reopen/duplicateauditdenial, dropped/malformedhistory
failclosed plusoldledger/restore/offlineguard regressions. Capacity/processcrash/restore
historyacceptance stillrequiredbeforeHTTPrelease exposure; noendpointadded/activation.

`baf0003a0` exact5 **85pass/2fail,0skip/todo**, GATES tests1/lint0/whitespace0
`/tmp/9router-maintenance-crash-{results.json,lint.txt}`. EightactualNode/SQLjsprocess
SIGKILL cases afterauditbeforecoveragewrite oraftercoverageinstalledbeforedirectoryACK,
exclusiveowneractualdeath→reopen inspect/retry originaltarget vsnewmaintenance; original
unacknowledgedintentcannotclearlaterinstance; installedhistoricalreceipt read-only
preserveslatermaintenance. New15sperchild/30scaseboundedstandalone noexistingdeadline
increase. Capacitysyntheticvalidshape1000receiptrows testsboundbeforeauditandexact
historicalreplayallowed, not1000realACKdurabilityproof. Well-shapedACKwithoutmatching
committedauditdeny. Bothcapacity1000cases failedSTACK_TRACE_ERROR duration9201/9449ms;
all8actualSIGKILLpassed. `/tmp/9router-maintenance-crash-failures.json` retained.
Productionhistorypreservation usesnested1000×1000 JSONrowcomparisons; boundedrepair
validateduniqueopID→serializedrowMap preservesexactcomparison/dropped-modifieddeny/
strictduplicatevalidation andremovesquadraticscan. Advisor checkpoint conditional
suggestion notindependentapproval; timeoutcauseplausible notverifiedbyJSONstackalone.
`b26ea26b5` exactsame5files **86pass/1fail**, tests1/lint0/whitespace0
`/tmp/9router-maintenance-linear-{results.json,verbose.txt,lint.txt}`, unchangedcapacity,
assertions/guards/deadlines, no increasedtimeout orbaselinewaiver. VerboseNodecapacity
explicit5000mstimeout/duration8127,SQLjscapacity4137pass;8actualSIGKILLpass. Mapguard
optimization aloneinsufficientnotremainingrootcauseclaim. Advisorfailurecheckpoint:
boundedtiming unchangedsteps distinguish actualproductionvalidation/capacity/replay
fromVitest Bufferdeepmatcher; ifprovenmatcherbottleneck Buffer.equals maypreserveexact
byteequality(nohash/stringsemantic substitution). `b4bbaea3e` selectedbothadapter
capacitytimingdiagnostic **1pass/1timeout/22selectionskips**
`/tmp/9router-capacity-timing-{results.json,verbose.txt}` retained. NodefirstBuffer4444ms+
second1828ms exceeds5000deadline, setup57/denial69/replay57/final6.5ms; SQLjsBuffer1666+
967ms. Timingprovesmatchercostdominates(notallreported10867ms explained). Advisor
checkpoint supports onlytwoBuffer.toEqual→Buffer.equals(bytes).toBe(true), sameactual
Buffers/fullbyte+lengthequality/sameobservationpoints. Temporarytimingremoved; unchanged
1000/deadline/guards. `ba638249b` exactsame5 **87/87,0skip/todo**, GATES tests/lint/whitespace0
`/tmp/9router-maintenance-byte-{results.json,verbose.txt,lint.txt}`. `docs/API_KEY_BUDGETS.md`
adds retainedACKbackup inventory/no legacyretrofit/no historyprune/fullcapacityblocked
(no certifiedrotation)/olderbinaryno-sidecarwrite downgradewarning. FinalcapacityNode
461.886ms/SQLjs300.608ms; all8actualSIGKILLpass. Originals85/2→86/1 anddiagnosticretained.
`b3635f3d9` exact5 **89/89,0skip/todo**, GATES tests/lint/whitespace0
`/tmp/9router-maintenance-restore-{results.json,verbose.txt,lint.txt}` adds2actualNode
snapshotbefore/afteroriginalreleaseaudit cases: backup+externalhistoryunchanged,
newmaintenance/globalgap retained; oldDBmissingoriginalaudit deniesreceipt+replay
noauditretrofit/no sidecarmutation. Samepriorcrash/capacity/ledger/offline/receipt cases;
notretainedinitializationintentrestore/Bun/better/SQLjsrestorecertificate. HTTPexposure
andbroaderrestore/downgrade/UI gates remain; productionOFF.

NextcandidateoperatorPOST `/api/accounting/maintenance/release` afteraboveboundedstorage
prerequisites. Reuses `accountingManagementRoute` signedJWT/trustedloopbackguardbefore
body/DB +CSRFmutation/serveractor. Strict4fields expectedGeneration/op/reason/evidence,
unknownactor/actionreject400; missing/staleorchangedintent409. Callsreleaseprimitive
thenexactaudit+sidecarACKreceipt allowlist version/kind/action/op/generation/releasedAt;
returnsredactedcurrentglobalprojection enforcementfalse. No policy/activation or gapclear.
`b0e64ed05` exact7 **85/85,0skip/todo**, GATES tests/lint/whitespace0
`/tmp/9router-maintenance-route-{results.json,verbose.txt,lint.txt}` sixnewNodeSQLjscases
routefunctions+JWT auth401/CSRF403beforeDB/no-store/redaction/unknown400serveractor/
changedintent409/historicalreplaynewmaintenance retained/failrenameorinstalleddirACK503
thenhandle-reopenretry. NoactualHTTPtransport/UIacceptance, handle-reopennotnewdeathproof;
existing8crashcasesincluded. No productioninvocation orreleasedfeatureclaim.

GlobaloperatorUI candidate addedtoexistingEndpoint via `GlobalAccountingPanel.js`
button(no rebuild). Strictdraftutils `globalAccountingDraft.js`: exact2fieldretained
wrapper/exactsame-origin2URLs, scopeglobalonly/generationpositive/op/reason/evidence
bounded/frozenclone; receiptstrictallowlist nullglobalkey/gapID ormaintenancegeneration/
ISOtime plusop/action validatesbeforecleanup. Echookwithoutreceipt/mismatchdeny,
historicalreceipt withnewergapmaintenance valid originalACKnotreadiness. SessionStorage
immutableidentitybeforePOST, restoredoperationnotauto-dispatched, failedretention noPOST;
failedcleanup retainsameop. Componentownfocus/overflowrestore/trapEscapeTab/singleflight
mountedstate/abortstaleGET/error/loading/OFF/explicitconfirmation. `b41894d7f` exact6
**76/76,0skip/todo**, GATES tests/lint/whitespace0 `/tmp/9router-global-ui-contract-{results.json,verbose.txt,lint.txt}`
new8drafttests+existingdraft/routes/crash/restore, noactualrenderedkeyboard/mobile/storage
failure/HTTPtransport certificate. NewUI sourcepostdatesbuild; currentfreshbuild/real
UIacceptance stillrequired. Endpoint existingHEADlint5errors2warnings notsuppressed.

Added `tests/browser/global-accounting-panel.mjs` interceptedrealEndpoint desktop/mobile
fixture explicitreviewcheckbox/storagefail0POST/wrongtargetACKretain/reopennoautoPOST/
heldbusyEscape/exactunchanged503retry/receiptcleanup/globalgap+maintenancehistoricalACK
newmaintenancevisible/focusrestore/Tabtrap/no horizontalmodaloverflow/screenshot.
Blockexternaloriginsreportsattemptedblockednotzero-egress. DisposableJWT/cookie/traces
notpublishable. Runner `PRICING_UI_GLOBAL=1` addsfreshnesschecksallglobalUI/route/storage
sources; nooldbuildreuse. Notyetexecuted/currentbuildrequired. Noactualwiremanagement
APIauthority claim fromintercepts.

`bc7e8c20a` newstablemilestone RUNNING timeout1500s, predeclaredexact79 prior74+5new
ACKdurability/process/globalroute/draft/maintenancecrash files. Newrunners/scope/snapshot
under `/tmp/9router-global-management-milestone-*`, hash+pathinputs source/config/tests/
scripts/manifests/runners capturedbeforeexecution; heldthroughserialisolatedsweep+same
inputsNextdiagnosticbuild. Comparatorbaselineunchanged/allgreen separate, original2
HEAD-reproducedautoswitch assertions stillnotwaived. Buildevenifredtests diagnosticonly
notwholeACacceptance. Terminalobserved **850pass/2fail exact79,0pending/todo**, onlysame
2autoswitchassertions comparatorREGRESSION1/runner1/allgreen1, lint0/stability0/whitespace0.
Bothsweep+buildcaptured1,465final1,465 noaddedremovedchanged. SameartifactbuildPASS
build/stability/artifact/whitespace0 Next153pages artifact
`tmp/9router-global-management-milestone-panel-1791154945`; integratedtestgateremainsred.
NewfailureJSON `/tmp/9router-global-management-milestone-failures.json` retained.

`b04b30a3e` runtime **rendered1/wire0/stable0** samebuild: interceptedactualEndpoint desktop/mobile
browserfixture andseparateactualrawHTTPcustomentryglobaloperator privateDB/JWT/owned
seedonlyfullystopped/restart/globalgaprelease/auditdeltas/gatewaydeny/CSRFforwardedHost/
changedintentandfreshstalegeneration negatives/oldreceiptnewmaintenancepreserved.
Outputs `/tmp/9router-global-{rendered,wire}-first.txt`, final1,465inputsunchanged.
ActualNodewireall4groupspassed `/tmp/9router-global-management-http-ky5nBt/results.json`,
BUILD_ID `cOtHJWtsplGlKMVT8mcR8`/customhash78b8484unchanged. Audits2bounddistinctops/
serveractor, noactivation/attempts; oldreceipt doesnotclearlatermaintenance. Serveregress
notproved, noliveproviderrequestsissuedbyfixture. Renderedqcxmvf strictstatusselector
matchedACKnotice+loading2, trace/logretained. Advisorcheckpoint locatorsemanticfilter
onlyACK retainsassertion not.first/timeout/UIrelaxation. Inputdeltaold1465exactonly
`tests/browser/global-accounting-panel.mjs`; compiledproductioninputsunchanged permits
samefreshbuildreuse notretroactiveoldhashgreen. Newruntime1,465snapshot captured
`/tmp/9router-global-rendered-selector-input-{delta,snapshot}.json` (snapshotactual
`input-snapshot.json` suffix); `bfa93f9f9` **rendered0/stable0/whitespace0**, revised1,465
unchanged. ArtifactzN83AV10flows4POST0pageerrors scopeinterceptedUIonly. Mobilescreenshot
inspected390×844 modalnohorizontaloverflow OFFclear/latermaintenance3stillactive/waiver
notexactcoveragecopy. KeyboardTabtrap/Escape/focusrestore/storagefail0POST/mismatchretain/
unchangedretry/reopennoautoPOST/historicalACKcleanup verified. AttemptedblockedGTMorigin
reportednotzeroegress. Originalqcxmvf failuretrace retainsdisposablecredentialsnotpublish.
Advisor warns realstop/ownership/canonicalpath/replayvsstaleseparation/deltanotjustcount;
scopedNodewireonly notfullruntimeapproval. Searchautoswitch originalcommentdisabled
mustinvestigatehistory/callercontract, notsilentlyenable routingpreference togreen.
ProductionOFF.

Nextcapacity-onlyappcandidate sourcepostdatesruntime: removetopaugmentationblanketdeny
notconcreteprovider/schema gate, solo pathinjectaccounting+signal andcloneaccountedbody,
combo capacitycallbacksamecontext clone. Preservespools/order/stripping/strategy/OFFbody
arity, actualBase ownsPOSTno wrapperdebit. Nestedstilldeny—including cyclicpool—until
separateboundeddepth/pathcontract. SixnewactualNodeappcases solo/combo capacityOpenAI
visionprioritized3/6snapshot600000 settledoneintent/onePOST vsunsupportedprovidernested
0POST andunknown/exhausted terminalbeforefallback/cooldown. `b9b62da0e` **66/66 across4**, tests/lint/whitespace0 outputs
`/tmp/9router-capacity-ledger-{results.json,verbose.txt,lint.txt}` requested5butabsent
`unit/capacity-adapter.test.js` knownpreflightmiss; runnermaycollect4 cannotaccept5claim.
Resultretained actual4not5assertion. Added3capacityactualappfallbackmodes accounted/OFF/
cancel: realfirst600000settled beforecooldown secondoriginal200000/samecontext/distinct
attempts, exactprimitive cancellation beforefallback preventssecondPOST; OFFsamepool→
originalorder/noledger. New `capacity-accounting-routing.test.js` 2fixturetests priority
augmentationoriginalarraypreserved/strategy+wrappercallbackarity/signal. `b1d76045c`
correctedexact5 **71/71,0skip/todo**, tests/scope/lint/whitespace0 `/tmp/9router-capacity-corrected-{results.json,verbose.txt,lint.txt}`
precheckfileexistence runnerexplicitargs postcheckexactcollectedpathinventory andeach
assertionpassed/no pendingtodo/skip; missingdeclaredfilecan'tsilentlypass. Sourceheld
no deadline/guard/assertionrelaxation ornewproductionactivation. Advisorcheckpoint
conditionalnotindependentpatchapproval; nested/fullcapacitystripmatrix stillrequired.

Nestedsequentialnextcandidate `chat.js` optionalbranch-localimmutablecomboPath passed
sameaccounting/effectiverequestSignal fromtopcombo andnestedcallbacks. Canonicalidentity
modelInfo.model(exact-namecombo resolver); rootincluded max16 `MAX_ACCOUNTED_COMBO_DEPTH`
config, self/indirectcycle/depth17 terminalprivateUNSUPPORTED beforebranchdispatch.
OFFskipnewbounds/no optionalextraownergate. ConcreteBasePOSTonlyoneowner priceperleaf.
Topfusionpanelancestry seed, composedfusiondispatchsignal passedtonestedsequential;
nestedfusionexplicitdenyuntilfanoutboundedcontract notdepthasworkbound. No reservation
orcancel-normal-straggler added. SixactualNodeappnestedpositive/OFF/selfindirectcycle/
16allow17deny/nestedfusion0POST fixtures, priorcapacitycyclefixture retained. Branch
cycleproofnotrequestwide0POSTifyesearlierpaidvalidsibling; diamondsharedchild allowedby
immutablepaths. `b7b72407c` **77/77 exact5,0skip/todo**, tests/scope/lint/whitespace0
`/tmp/9router-nested-accounted-{results.json,verbose.txt,lint.txt}`. Added5actualNodeapp
casesdiamondreuse/sharedchildfirst402200000thenSSEsuccesssecond200000/samerequest,
paid-firstcycleprivateUNSUPPORTEDpreserveddebit1POST, unknownunresolvedcostnull0cooldown,
exhausted4290cooldown, primitive17cancelaftersettlement0secondPOST. `b42889604` **82/82
exact5,0skip/todo**, tests/scope/lint/whitespace0
`/tmp/9router-nested-terminal-{results.json,verbose.txt,lint.txt}`. New5actualNodeapp
cases topfusionnestedseqpanel/usableanswerregeneration/nestedjudge all3POSTprices
200000/200000/400000 sharedcontext/distinctattemptIDs; heldnestedprerefreshotherpanel
rawusageabsentlocalfatal orcaller17cancel observescomposedsignal0childPOST. Existing
nestedfusiondeny unchanged. `be4dfb517` **FAILED86pass1fail exact5,0pending/todo**
`/tmp/9router-fusion-nested-sequential-{results.json,verbose.txt,lint.txt}` retained.
Onlynewcancelcaseexpected1POSTobserved0: childprerefreshbarriernotsiblingPOSTentry,
legitimateabortbeforebothdispatch, no productionbugproof. Advisorcheckpoint fixture
phasecorrection awaitbothchildprerefresh+actualsiblingnetworkcallbackentry beforeabort17;
1POSTassertion/deadlines unchanged. Replace2microticks withtestonlyspy original
awaitAbortableWork wrappedthunkinvokesonce returnsoriginalwork signalunchanged, raw
promiseobservers consumeonlyobserverrejections; finallyreleasechildthenjoinallregistered
invocationpromisesuntilstable, assertchildforeignidentityobserved+rawterminalaborterror,
spyrestorefinally. Notuntrackedfireforgetquiescenceclaim/networkentrynotsettlement.
`b2e77fac8` **87/87 exact5,0skip/todo**, tests/scope/lint/whitespace0
`/tmp/9router-fusion-nested-barrier-*`; original86/1retained. NextDeepSeekOpenAIcandidate
explicit `config/accountedChatProviders.js` allowopenai/deepseek only no generalprefix.
DeepseekactualBasebuildURL fixedregistryhttps://api.deepseek.com/chat/completions and
runtimeTransportformatOPENAI required; staleClaudeendpoint0POSTdeny notschemaauthority.
CorestilltargetOPENAI/liveSourceOPENAI/singlechoice, no specializedowner bypass.
`utils/accountedChatUsage.js` provider-awarerawJSON+live/bufferedparser requiresDeepSeek
cachehit/miss nonnegativeints sum=prompt, total=prompt+completion BigInt, detailscached
ifpresentmustmatch; missing/contradictoryrequiredsplitunresolved notzero. Reasoning
includedoutput sharednormalization no doublecharge. Diagnosticservice/repos admit
boundedOpenAIobservation onlyapprovedproviders/chat usagecostnull no managementautofill.
Officialdocshttps://api-docs.deepseek.com/api/create-chat-completion/ fetchedpubliconly:
hit/miss requiredsum, detailscachedsamehit totalprompt+completion reasoningbreakdown;
9routersearchunconfiguredreported no route invented. 8actualNodeappfixtures JSON/live
manual174000/zero/missing-cache/conflict/missingDONEdiagnostic/Claude/staletransportdeny.
`bc97ebbef` **FAILED161pass6fail exact10,0pending/todo**
`/tmp/9router-deepseek-accounted-*` retained. All6DeepSeekpositive+unknowncasesprePOST
UNSUPPORTED; old161pass inclClaude/stale negatives. Readchat.jsline263 remainingapp
provider===openai precredentialguard blockednewallowlist. Advisorcheckpoint narrowly
alignsameexplicitapprovedproviderpredicate appleaf; keepactualBasefixedURL/runtimeformat
andcoretargetOpenAI/liveSource/Nguards, no generalprefix. `bdc891b76` **FAILED165pass2fail
exact10,0pending/todo** `/tmp/9router-deepseek-app-guard-*` retained. JSON/live174000,
zero0, missingDONEdiagnostic/Claude/staledestinationdeny nowpass; onlymissing/conflicting
cacheJSON expected503returned200. ActualBase completesUNRESOLVED then gatesonlytransport
orupstreamerror, so successfulHTTPinvalidusage leaksconversion. Advisorcheckpoint+
readcontract16/31/55/66: unlimitedunknownmaycontinue, settledlimitcrossingnotretrodeny.
Newmandatoryrequestlocal `assertSuccessfulTerminal(terminal)` outsidecatch aftercomplete:
settledvalidcost/unrecordedfalse nofreshgate; unresolvedcurrentgate budgetedblockswhile
unlimiteddurablerecord/orgapACKcontinuationpreserved; malformedstate/unrecordedsettled
trustedUNAVAILABLE. Existingno-key/OFFnullcontextunchanged. New6actualBasecases missing
JSONbudgetedreject/unlimitedcontinue/exactthreshold200next429/settlementwritefailure
unlimitedlatchedgap200 vsACKfailureUNAVAILABLE/malformedterminalonecompleteonePOST.
Existingbufferedmissingusage/DONEledgerassertionsstrengthenedwithrejection (notwaived).
`b5266d80c` **173/173 exact10,0skip/todo**, tests/scope/lint/whitespace0
`/tmp/9router-chat-terminal-policy-*` unchangedoriginal8DeepSeekassertions/deadlines+
scopechecks lintrequestwrapper/newshared+service/repo. Originals161/6and165/2retained.
Next4actualNodecases twoGatewayKeys samegetExecutor(openai) singleton reversecompletion
firstprice1/2pending thenedit3/6 second600000settled first200000originalsnapshot same
modeldistinctrequest/attempt IDs firstnext429secondstill200; DeepSeek429exact164000each
priorACKbeforesecondintent versusunknown0retryhook/1POST; OpenAI-formatdestinationoverride
0POST. `b7ab3412e` **231/231 exact15,0skip/todo**, tests/scope/lint/whitespace0
`/tmp/9router-singleton-isolation-*` includesBaseinternalretry/embedding/ACKdurability+
crash/unhealthygates toprior10. Newsharedboundarycheckpoint `be73526d3` predeclared80
prior79+capacityrouting actualfilesexists postcollectedexactpaths+assertionstatuses
independentintegrity gate thenunchangedcomparator; diagnosticwebpackbuildseparatefrom
redtestacceptance samefreshcapturedsource/config/tests/scripts/externalrunnersincluding
collected-gate.mjs. `/tmp/9router-provider-milestone-*` inventorysnapshotcapturebyrunner
`be73526d3` consumed **895pass2fail exact80,0pending/todo**, declared/collectedmatches
allassertionscomplete; onlysame2autoswitchREGRESSION comparator1 no waiver lint0.
Sweep/buildinputhashes **1469→1469 noadded/removed/changed** independentwebpackbuildPASS
build/stability/artifact/whitespace0 artifact1791161605/BUILD_IDEg22QTyfb5YedNUYGYVdN.
ActualHTTPnext `b9ab811a4` privateNodecustomstandalone buildsamecopycustomhash seeded
onlyafterfullserverexit canonicalownedNodeadapter+explicitofflinepolicyinitialize then
fixtureledger timestamp/policies/manualrates/dummyDeepSeekconnection+existingproxyPool
vercel-type loopbackrelay. Relayvalidateshttps://api.deepseek.com target/chat/completions
pathactualwire neverforwards realupstream; nofetchmock compiledroute/actualauth/context/
POSTledger tests. TwoHTTPcreatedkeys exact174000 thresholdnext429 unknown503costnull
nextblocked managementgateway401JWTlistingredacted; restartpriceedit9/9 auditedexact
recoveryoriginal174000 receiptidentical1audit0provider call thenHTTPfixtureSSE994000
newprice/spend1168000. Runnerhash51c14f8fafecef831442b4047d47d607e1fe95a3c5d736d4a76c3d6568cf88dd
`/tmp/9router-inference-ledger-http-{smoke.mjs,first.txt}` sourceheldverifycurrent1469.
Advisorboundedwirecheckpointconditions notexecutionproof. unshare -n deniedOperation
notpermitted no networkisolation/egressclaim; Nodeonly/noembeddings/liveprovidercert.
`b9ab811a4` **3groupsPASS wire/stability/whitespace0 1469unchanged** artifacttwIm6C
results3relayPOSTs exactJSON/unknownJSON/fixtureSSE; actualNode24sqlite notliveprovider.
NextSQLjsactualwire `b2f627291` installedNode22.23.2child --no-experimental-sqlite
nativebetterpreopenmemoryERR_DLOPEN_FAILED builtinexactERR_UNKNOWN_BUILTIN_MODULE
existingavailabilityonlydriverfallback unchangedsource. Samebuildcompiledcustomserver
Driver:sql.js logasserteachstart SQLjsownedseedofflineinit stoppedcloseownerrelease.
Node24orchestrator/read-onlyinstalledartifactinspect notnative22parity; 3realSIGKILL
afterexactHTTPACK/unknownterminalACK/recoveryACK durablestatecheckedbeforefixtureedits,
originalreceiptidentical/replayoneaudit/noproviderPOST ensuresnogracefulflushmasking.
Readonlyinspectartifacthashsame. `/tmp/9router-sqljs-inference-ledger-http-{smoke.mjs,first.txt}`
`b2f627291` **wire1stable0whitespace0 1469unchanged** bootstrapreadinessdeadline
failedbeforeinference o49VbYlogbothnativeenginespreopenunavailable thenSQLjsWASM
ENOENTstandalone/node_modules/sql.js/dist/sql-wasm.wasm sourceroot658410binarypresent
standaloneJSonly/noWASMtraces. Intended3SIGKILL/assertionsnotreached no cert.
ConditionalAdvisorrepair exactnext.config globaltracebinary preservingexternalSQLjs
noadapter/fallback/accountingchange nofixturecopy/deadlineraise. Newconfigregression
checksNextinstalledpicomatchroute/header notartifactproof; freshb343681e2 **81files**
source/config/tests/runners+WASMhashsnapshot emittedstandalonebinaryexactinputhashgate
independentbuild originalcomparatorunchanged `/tmp/9router-sqljs-asset-milestone-*`
`b343681e2` **897pass2fail exact81** sameautoswitch comparatorred/no waiver
no pending/todo/mismatch/incomplete lint0sweep1. IndependentbuildPASS
build/stability/artifact/whitespace/WASM0 **1472unchanged**
artifact1791165123 BUILD_IDw-AW6N37EuaeilcpszeaT runtimeWASM658410B SHA256
38c14f6e379210bc942bdc4ebca44e7bfdb4318ecc1c72ca666a28fdce96670a matchescapturedinput.
Packagingpassnotwirecert. Sameexternalrunnerb87db82af nowRUNNINGfreshartifact
`b87db82af` **3groupsPASS wire/runner/stable/whitespace0 1472unchanged**
Mn0s3g/resultsSQLjsNode22fallback threeSIGKILLafterACK actualdriverconfirmed eachstart
exact/unknown/SSE3POST originalprice174k recoveryreplayoneaudit/0POST new994k total1168k.
OriginalmissingWASMbootstrapfailure retained packaging+functional gatesseparate.
Nextbbd6c5885Node24actualHTTPembeddings running samebuild sourceheld1472. Adapterplain
fetch usesexistingglobalenvproxy notBaseconnectionrelay; persistedoutboundproxy strict
ownedloopbackCONNECTapi.openai.com443only→ownedlocalTLS neverforwards/DNSnotused.
STRICT_SSL=true childtrustSANcertificateviaNODE_EXTRA_CA_CERTS no insecureoverride;
untrustedcontrolnon2000upstreamPOSTrequired. Fixedactual/v1/embeddings dummycredential
100inputmanual1output0 cost100000 threshold429/0POST unknown503null nextblocked required
beforeoriginalprice100000recovery/newinput9 cost900000. Unknownobservationpersisted
beforeassert no speculativeguardfix. Runnerabd4caa5571d64e43b2ed51f23025198c3f67ed68ffaf2f4eb15ec8baaebf45d
`/tmp/9router-embedding-ledger-http-*` conditionalAdvisorwirecheckpoint notcert.
Embeddinghistoryretained bbd6c5885FWBTkf0CONNECTsettingscount0UPDATEnoop;
bda663275BRnAH4selfsignedcertCONNECT0POSTverified butcontrolprovider502cooldown
contaminatedtrustedexact; b52cb98fdIBqP6l preTLSWALexists0B noframes assertionfailed.
Externalisolatedclosedbundlecontrols strictWALabsentOR0 rejectnonempty noartifactdelete
fullseedpath/size/hashidentity unchanged; childLandlockABI4CONNECTrelayportonly
preflightdirect443EACCES guardportnotIPisolation certificateSTRICT_SSLtrue nofallback.
b78b631e8Us94cP **wire1runner0stable0whitespace0 1472unchanged** actualunknownupstream200
outward200ledgerunresolvednull/calls2 afternegativecontrol+exact100kthresholdpassed.
Rootembeddingownerignoredcompletionterminal successfulnormalize200; networkunknownmapped
502 appcooldown versuscontractunresolved503nocooldown. Narrowownerconstterminal+successful
assert/failednetworkfreshgate outsidecatch mirroredBase no exactthresholdretrogate
unlimitedunknown/durablegapACKpreserved. bd9f64e79 **242/242 exact15**, tests/scope/lint/
whitespace0 no skipTODO elevennewcases missingusage3/unlimited/threshold/failedexactbelowat/
appnetwork503nocooldown/malformed/gapACKsuccessfailure. Strengthenednetworktest no waiver.
Currentbfd542fc2 **81predeclared** freshcapturedsource/config/tests/WASM/allwireexternal
runners independentbuild/WASMhash thenNode24SQLjsNode22actualHTTPembeddingevencomparatorred
`/tmp/9router-embedding-policy-milestone-*` sourceheld RUNNING noresultyet oldbuildhistorical.
EarlierchatartifactstwIm6C/Mn0s3gsettingscount0 helperdisableintentnotpersisted corrected
claims actualconnectionrelay/ledger/HTTPauth/recoveryevidence retained noegressclaim.
Noactivation/noembeddings/egresscert. Advisorcheckpoint
conditionalnotexecutionproof. No productionactivationfixtureonly. Sourceheld
noactivation liveproviderbehaviornotcertified newprovidercoveragefixtureonly;
broadstatic toolsincomplete notindependentcleanclaim.
Advisorrecommendsrequest-localmonotonicinvocationcounter atomicwholefanoutbatch vs
settingsfreezingsnapshot; newboundedtaskcontractnotdepth/asworkbound notarbitrary1024
inferapproval. Needderiveexplicitlimits/signal/terminalquorum testsbeforeenablingnested
fusion; retaineddeny no reservations/concurrencystrategychanges. Partialedit
applied8uniquechanges onecallbackambiguous2locations; reread precisecontextfix only
missingtopcombopath, noreset/reapply. Advisorcheckpoint warnedaliases/signal/fanout,
not independentpatchapproval; enforcementOFF.
Newtestpostdatesbuildbarrier; historicalbuild notnewwhole-treecertificate. ProductionOFF.
Existingautoswitchreds retained, originaldeadline/assertions unchanged; trueasync
settlementfailure durablepending recovery evidence and remainingrace matrix stillopen.
Unknownpartialusage evidence, asynchungACK downstreamwait (production sink currently
synchronous but optionalinjectedhook canhang), fulfilledEOF/cancel/timer race matrix and
actualHTTP/native/SQL.js/allprovider broader gates remain open. New-file reviewgraph
coverage unavailable (accountedBase specifically noted); tests not cascadecleanclaim.
No production activation/unlimitedexception relaxation.

## Preserved original body inspection (historical line numbers)

Source baseline `a99cf572`. Engine source unchanged at this scan. Initial textual scan stored `/tmp/9router-budget-dispatch-seams.txt`: 45 matches across 24 files. This scan is discovery only; each body, retry layer, stream sink and CLI transport must be inspected before assigning exactly one accounting owner. No fixture currently proves engine hook coverage; no pricing/gate/routing code activated.

| Network or execution seam | Required investigation | Current coverage |
|---|---|---|
| `executors/base.js:146` | Body inspected: each POST within URL loop; retryConfig response retry at156, URL429 fallback159, network502 retry175. Boundary owner must be each fetch, settle prior response/error before retry; execute wrapper is not second debit. No lifecycle hooks yet. | Fixture pending |
| `handlers/chatCore.js:376,445` | Initial/refresh execute; avoid duplicate base charge | Pending |
| `handlers/embeddingsCore.js:64,99` | Body inspected: initial POST timeout,401/403 refresh and second POST; original failed response body currently discarded before refresh retry; retry catch swallowed, parse failure no usage. Adapter normalization occurs after JSON; need capture raw exact metadata/error before translation and settlement. | Fixture pending |
| `executors/codex.js:295` | `super.execute` SSE peek/retry lifetime | Pending |
| `executors/commandcode.js:45` | NDJSON ownership and inherited fetch | Pending |
| `executors/cursor.js:380,424,491` | Proxy fetch + HTTP/2 requests; control/generation split | Pending |
| `executors/github.js:149,175,270,345,380` | Inherited generation, direct fetches, token control planes | Pending |
| `executors/mimo-free.js:84,146,154` | Bootstrap vs initial/retry generation | Pending |
| `executors/grok-web.js:296` | Web generation stream/exact metadata | Pending |
| `executors/perplexity-web.js:458` | Web generation SSE metadata | Pending |
| `executors/qoder.js:712` | Binary/generation stream, retries | Pending |
| `executors/trae.js:121,144` | Session generation and polling distinction | Pending |
| `executors/vertex.js:38,166` | Auth token vs generation transport | Pending |
| `executors/windsurf.js:419` | Binary upstream fetch/usage terminal | Pending |
| `executors/devin-cli.js:423` | Spawned CLI generation, can exact usage be observed? | Pending |
| `executors/grok-cli.js:548` | CLI/local transport and inherited dispatch | Pending |
| `executors/kiro.js:365` | Base retry + binary EventStream completion/recovery | Pending |
| `executors/xiaomi-mimo.js:92,96,99,107` | Inherited execute retry/account route paths | Pending |
| `executors/opencode{,-go,-zen}.js` | Inherited generation, credentials and retry transformations | Pending |
| `executors/antigravity.js:318`, `gemini-cli.js:60`, `default.js:265–333` | Refresh/control planes (body verification required, not charged by assumption) | Pending |

App glue bodies inspected: `src/sse/handlers/chat.js` resolves raw API key only when requireApiKey true; closure carries raw key into fusion/combo/capacity/nested candidates, no stable context yet. `embeddings.js` same auth loop; current exactEmbeddingUsage rejects0and fire-and-forgets usage only on success; budget lifecycle must be separate from this analytics callback. Local accounting errors must terminate before markAccountUnavailable. Auth extractor currently lacks Gemini header/query precedence. No integration claim.

Stream sink bodies inspected (engine not edited): `utils/stream.js:createSSEStream` calls finalize callback synchronously/not-awaited after estimate fallback; state.usage may be overwritten with estimated on finish chunks. Raw accounting must use separate local raw metadata accumulator and awaited sink, not state.usage/client buffer. Same-format Responses may finalize on terminal beforeEOF; passthrough trailing buffer currently forwards without raw extraction. `streamHandler:createDisconnectAwareStream` cancels reader/writer without awaiting return; cancel/error must notify same idempotent lifecycle sink. `pipeWithDisconnect` tap tracks only bytes/stall and has no accounting observer. `streamingHandler` buildTransform forwards only analytics onStreamComplete; success returns prior to usage. `nonStreamingHandler` raw body is unwrapped, decloaked then extractUsageFromResponse and fire-and-forget save; exact snapshot settlement must precede response/translation/buffer, failed SSE/JSON parsing unresolved. Evidence is source body inspection, not hook coverage.

`chatCore` full body inspected: execute boundary376 and refreshed execute445; failed retry catch swallowed and only replace response if retry.ok; local accounting error must bypass these catches. Shared response contexts need request-local hook/attempt token across forced-SSE/nonstream/stream; optional original AbortSignal currently not passed into createStreamController. `combo:handleFusionChat` fanout maps withTimeout; collectPanel resolves sparse mutable out after quorum/grace, live stragglers keep running. one-success branch regenerates upstream (`handleSingleModel(body,successfulModel)`), not reuse; preserve semantics with separate gated attempt. Collector ignores failed responses; terminal accounting failure must not become generic all-failed or silent judge continuation. Late sinks retain own context, no artificial orphaning by timeout. No engine mutation or fixture coverage yet.

Additional inherited boundary body inspection: `opencode-zen.execute` prepares a fresh credentials object then forwards args to `super.execute`; Responses models force stream and normalize input/tools. It adds no direct generation fetch; base owner must receive request-local lifecycle via spreadargs. `gemini-cli` inherits generation/base retry; explicit fetch is OAuth refresh only, not debit. `antigravity.refreshCredentials` proxyAwareFetch google token likewise control-only; generation inherits base buildUrl/retry handlers. Existing GeminiCLI `_currentModel` and Antigravity `_lastSessionId` singleton transform caches are adjacent concurrency hazards (currently synchronous transform→headers ordering); never put accounting key/attempt/hook there, and await-beforeAttempt insertion must preserve headers-before-await or localize these values. Images share Antigravity transport but remain outside chat/embedding metering scope. No raw usage certification or hook tests yet.

Additional read-only specialized-body audit (no enginechange/fixturecertification):

- CommandCode full execute/peek/replay/NDJSON conversion inspected. `execute` has **up to three super.execute generation invocations** after translated early502/503/504 errors, in addition to BaseExecutor own retries. Each realfetch needs own attempt; wrapping execute alone would hide billedretries. Early NDJSON error cancels reader and converts error, discarding any rawusage evidence; raw observer must run before peek/conversion and settle unresolved/exact before nextretry. Peek catch returns original already-read response without replay (adjacent streamcorrectness issue not repaired here). Converter retains only last finish-step usage unless finish.totalUsage; translator usage is not exact accountingauthority. Midstream error throws; EOF synthesizes DONE even without exactmetadata. Need eventlevel complete/raw counts+inclusion semantics and per-attempt sink/abort fixture, no claim failure is free.
- Trae full sessionPOST/eventGET and streaming/nonstream paths inspected. **POST /chat_sessions contains initial_message query and launches firstturn**, not a harmless control/sessionbootstrap. SSE GET observes same generation, should not doublecharge as another chatattempt without provider evidence. Raw token_usage stored local closure then output currently defaults missing counts with `||0`, drops usage on error, EOF without done may look success; accounting must inspect originaltoken_usage before fabricated output and treat incomplete/ambiguous terminal asunresolved. Stream cancel currently lacks explicit underlyingcancel sink; event timeout signalsctrl, no lifecycle hooks. No exactschema certification/sourceevidence or budgetsupported status. Authrefresh placeholder control-only.

- Codex execute/peek/buildHeaders read: images fetched beforegeneration are inputpreprocessing, not chatdebit; basegeneration repeated for SSEoverload patterns and accountcapacity replacederrors. Raw SSE prefix currently canceled onpattern, so exactusage/error evidence must be captured beforediscard and terminalsettled/unresolved before retry. No assumption 200SSEerror isfree. Nonmatched prefixreplay cancellation doesn't await upstreamcancel; local terminal sink required. Singleton `_currentSessionId` generated transform→headers hazard, keep materializedheaders beforeawait or requestlocal state. Nohooks/rawfixture.
- MiMoFree bootstrapJWT POST contains devicefingerprint only, controlplane; directgeneration POST initial+401/403 retry each ownattempt, not baseowner. Failedresponse currently discarded before rebootstrap; no automaticfree401/403. Hooks must be carried in execute destructuring/localclosure, no global cachedJWT accountingcontext. Pricing namefree alone notfree evidence.
- XiaomiMiMo execute inheritedDefault/Base generation initial+401 freshcookie retry; args spread preserves futurelocalhooks but failedresponse dropped. Cookiebootstrap controlcall must bodyaudit; assigning credentialcookie isauth-only, not accountingidentity. Transform output_config/effort remains generationbody; no budgetsourceedit/certification.

- GitHub full execute/routes/refresh bodyread: Base chatcompletions POST400 can **escalate secondgeneration POST** to responsesUrl, cachedroute skipfirst onlaterrequests; failedclonebody must beaccounted beforeescalation, notfree-by400 assumption. AnthropicClaude messages route directPOST forcesstream then translates rawClaude toOpenAI internally; Responses directPOST translates rawResponses internally. Observer must see originalClaude/Responses rawbody before internaltransform, not outerchatCore translatedusage. Both directmethods destructureargs (futurehooks wouldbe dropped unless explicitlythreaded); need rawboundaryowner separatefrombase and onechargeperfetch. TokenCopilot GET and GitHub OAuthformPOST are inspectedcontrol-only. Modelroute cache iscapability-only, neveraccountingcontext.
- Vertex/partner execute directgeneration POST bypassesBase retries; SA/ADC token mint controlcalls, credentialmutations auth-only. PartnerrawAPIkey missingprojectID performs **POST __probe__:generateContent with emptybody** then parses404 projectID; intendeddiscovery but method/endpoint aregeneration-shaped. Cannotcertify nonbillable from intent/comment alone: preserveexplicitprovider evidence or refuseprobe beforebudgeteddispatch whenprojectmissing untilcertified; avoid doublecharge/discard. No observedrawschema/dispatchfixtures. Futurehooks destructuringmustthreadlocalcontext.

- GrokWeb full execute + rawNDJSON extractor + streaming/nonstream builders bodyread: one directgeneration POST, errorsreplace upstreambody and no rawtoken accounting surfaced. Nonstream `Math.ceil(fullContent.length/4)` for **both** prompt/output isestimated (notexact); stream no usage. Error catches turn error into assistantcontent+stop/DONE, cannot use clientterminal as successaccounting. RawmodelResponse metadata currently mostlydiscarded; need providerusage evidence/extractor or budgetedunsupported beforedispatch, unlimitedunresolved afterhooks. No implicitfree fromwebSSO.
- PerplexityWeb full directexecute+rawextractor+builders bodyread: one directgeneration POST containing query/searchagent parameters; block.intended_usage labels renderingplan/markdown, **nottokenusage**. Nonstream Math.ceil currentMsg/fullAnswer counts estimated; streaming nousage, errors emittedascontent+stop/DONE; originalHTTPerrorbody discarded. Sessionhistory cachedglobal (capability/sessiononly) mustneverholdaccountingcontext. Rawusage semantics uncertified; generatedsearchsteps remain withinchatresponse while separate searchendpoint outofscope. No budgetcoverageacceptance.

- Windsurf directbinarygeneration POST inspected execute+doneprotobufdecoder+SSEtransform. Decoder returns[0,0] when missingUsageStats and initializesabsentfields0; outer emitsusage onlyifpositive, so explicitzero versusmissinglost. Trailererror drops accumulatedusage, error/DONE wrappernotsufficientproof. Accounting rawbinary parser needs fieldpresence/varintbounds/endframe/error certification beforeconversion, not converted usage. No streamcancelhook currently; closure contains localtokens but no accountingidentity.
- Cursor execute nonagentHTTP2-or-proxy-fetch branch and fullAgentServicebody inspected: directHTTP2 POST/write generation whennotproxy, proxyPOST buffersarrayBuffer otherwise; outertransformsprotobuf beforechatCore. AgentHTTP2 opensstream+writes initial generation frame then IDEcontext/KV/toolreply writes on samecall; not eachwrite anewnetworkattempt. Agent branch nonstreamcalls estimateUsage; no certifiedrawcountsstream; EOF finally may synthesize done. Original signal listener doesn't checkalreadyaborted atrequestController setup (adjacent hazard); cancelabortsunderlying but noawaitedaccounting sink. All catches currentlywraperrors asupstream, so localterminalaccountingerrors mustescape rather than retry/cooldown. No engineedit/rawprotocol certification.

- DevinCLI partialexecute spawn/ACPprompt/finish bodies inspected (notfull protocolcertification): spawn localCLI initializes/sessionnew, generationstarts session/prompt stdinRPC, builtin agent can internallyproduce multipleprovider calls unobservable atgateway. Finish emits estimated:true length/4 usage; nosafetoclaim exactdebit. Toolrun/permissionbypass localhostfilesystem securityrisk preexisting documentedincode, no agent launched duringthisinspection. To satisfy billableattemptcontract cannot countspawn oroneprompt as certifiedperupstreamattempt without CLIinstrumentation/evidence; budgetedunsupported beforeCLIlaunch unless allinternalbillables instrumented. Unlimitedhooks mustretainlocalterminal context and unresolvedcost, not estimatedupgrade. Fullbody/cancel/internalprovider inventory stillopen.

- GrokCLI execute/transform/headers fullbodyread: despiteCLIname network is inheritedBase POST Responses endpoint, notspawnedCLI; localagentID bootstrap then spreadargs. Transformforcesstream and assigns singleton `_currentSessionId/_currentReqId/_currentTurnIdx/_currentModel/_agentId` consumed synchronouslybyheaders. Any awaitedbeforeAttempt insertedbetweentransform+headers riskscrossrequestheaders; materializeheader/body firstorlocalizecontext. No accountingidentity onsingletons. RawResponses usage certification remainsseparate from legacytranslatedusage; OAuthrefresh delegatecontrolbody stillneedsaudit. No meteringhooks yet.

- Kiro executeintegritygate/recovery+rawprocessEvent bodyread: initialBasefetch then **bounded integrity regeneration via BaseExecutor.prototype.execute.call** on ellipsis/shortfinal/invalidtool/missingterminal; firstresponse can becharged evenif clientonlyseessecond. EachBaseactualfetch ownattempt, settleprior beforeintegrityretry and propagate localterminalrefusal outsidecatch→SSEgeneric. Gate heartbeatstreams beforebufferedcompletion, cancelabort-local; need terminaldurablefailure nativeenvelope withoutsuccessfulDONEclaim. RawmetricsEvent currently Number(...)||0 accepts/fabricateszeros, cachealias||losesexplicitzero; meteringcredits/contextpercentage aren'texactUSDtokencounts. Observer mustrawdecode fields/presence/validnumbers before transformedSSE and notuseterminalvalidatedtext as usageproof. Fullbinaryfinish/parser/inclusioncertification stillopen; nohooks.

- Base retrybody reread after33slice: retrywait uses unabortable setTimeout; catch onlyerror.nameAbortError distinguishesusercancel, customsignalreason Error canmap502+retryfallback. Futuremeteringmustterminal-oncallerabort regardlessreason, cancelretrywait, durablepriorattemptunknown beforeanyretry; addexactbeforefetch/afterbodyabortcases and nevermistakelocal accountingerror asnetwork. AfterbothUIterminal barrier, boundedcancellationprereq appliedtoBase: initial/beforeloop/beforefetch/caller-firstcatch guards, exactcallerreason preservedincludingprimitive, abort-awareretrytimer listenercleanup, postdynamicretryhook check, discardunhandedresponseoncallerabort withoutcleanupmasking. Noaccountinghooks/activation. NewBase8cases plus existingAntigravity/force-stream/CommandCode/GrokCLI `bf2b3f7bc` **failed60/2 across5files**, lint0/whitespace0; bothforce-streamfixtures missingheadroommock exportformatHeadroomSizeLog atchatCore277 beforeexecutor. Originalreports `/tmp/9router-base-cancel-{results,failures}.json` preserved. Advisorfailedcheckpointthenfixtureonlymockcompletesallfourheadroomimports (adds sizeemptylog+phantomfalse), unchangedexecutecount/streamtrue assertions nohandler/RTKproductionchange. `b6a9a6850` same5filegate **62/0/no skips/no todo**, lint0/tests0/whitespace0 (`/tmp/9router-base-cancel-repair-results.json`). Advisor focusedcompletion summaryonly notindependentpatchapproval; callerreason/backofffix testednarrowcasesnotcomprehensivecancelcertificate. Aftergate, `be97e136b`39filesweep **358/0/no skips/todo**, runner0/comparator0/stable0/whitespace0, final1393inputsnoaddedremovedchanged. NoMaxListenersWarnings, MODULE_TYPELESSremains. `b1ca2a467` freshbuild **build0/stable0/whitespace0**, `tmp/9router-lifecycle-panel-1791119727` BUILD_IDexists. Final1393inputsnochanged/added/removed, sameinitialsnapshotassweep; fulltee `/tmp/9router-lifecycle-build-full.log` compiled5.0min+151staticpages butrepeatedoutboundproxyinit writeractiveerrorsremain (notruntimeclean). Sourceheldfixed noactivation/hooks. No 'preexisting'failureclaimwithoutbaselineverification. Expanded39intendedscope `/tmp/9router-lifecycle-current-scope.json` capturedbeforefuturerun adds5enginefiles+listenerfixture tooriginal33. Historical62/0stillhadstalledhookgap. AfterGemini35/0 boundedBaseprerequisiteaddedawaitRetryHook factory: check/installlistenerbeforeinvoke+racereread, exactabortreason promptlyrejects withoutforeignhookcooperation, latefulfill/rejection observedownedlistenerremoved; fourthoptional{signal}context passedhook noAntigravityimplementationchange. Disposeunhandedresponse exactlyonce nonblocking oncommittedretry**beforebackoff**, URLfallback andhookerror/callerabort; finalvetobodyremaincallerowned. No awaitcancelteecriticalpath. `b7010d807`5filegatepending primitive/custom neverhookreturn, latereject/syncabortthrow/listeners/prebackoff/fallback/vetobody. Existingstatusbackofftestupdatedfromcancelatabort tocancelbeforebackoff intentionalnewownershipassertion. NineBaseunusedhints addressedunusedimportremoved+baseextensionargsunderscored samepositionalAPI. OnepartialeditambiguoustransformRequest failedbutthreeothereditsapplied; readuniquemethodcontext and precise remainingedit noreset. Foreignhook canremainalive noabort-independentdeadline; Antigravityclonebodytime/size/abortcooperation stillopen, notcomprehensive cancellation/resourceguarantee. Noaccountinghooks/activation. Earlier292/0/build/UIcapturedprepatch notcurrentenginecertificate.

- Qoder fullexecute/buildbody/wrapSSE read: directencoded/signed generationPOST strictProxytrue avoids ambiguousdirecttransport replay; PATexchange/dynamiccatalog/attachmentrewrite preparatorynetworkbodiesstillneedindependentaudit. Modelcontexttierauto200K/400K/1M canchangepricingsemantics, flatsnapshotnotcertified. Localauth/signing/bodyguards fake400/401 areprovedno-generation yet cannot classifyallupstream401free. RawouterstatusCodeValue envelopeinnerOpenAIusage laterafterfinish, coalescer transforms beforechatCore; observermustprecedepeek/unwrap/coalesce/cancel. Peekerror cancelsdiscardrawbody, subsequenterror renderedascontent/DONE orbillingstructurederror; catchfinallyflush canDONE aftertransportfailure. Preserveexactrawusageorunresolved noerrorfreeassumption. Futureexecutehooksdestructuringmustthreadlocalcontext; nohooks/certifiedcoverage.

- Geminiwrapper POST/fullSSE+JSONconverters+clientkeyextractor rereadwhile1393sourcebarrier: chatwrappedRequest omitsoriginalAbortSignal (cancelnotpropagated), headerscontaincredentialbut TTSextractor omitsx-api-key priority; do not alterTTS scopewithoutneed. SuccessfulSSE splitspernetworkchunk nofragmentcarry, drops parsed.errorwithoutchoices, replacesheaderswithno-cache/CORS-only; budgeterrorscouldsilentlydisappear and no-store/requestId/retryAfter/expose lost. NonOKreturnsOpenAIenvelopeunchanged; JSONconverter similarlypreservesforeignerror and losesheadersonsuccess. Futureboundedsharednativebudgetformatter onlylocalmachinecodes+correctstatus/reset/requestId/timezone/CORS, bufferedSSEUTF8fragments/error-onlyterminal, originalSignal+credentialprecedence chatbranch, TTS untouchedoutsidebudget. CurrentexactUsage neverconsumeconvertedmetadata||0; no wrappercodechange duringbuild/sweep, no nativecertification. Advisorboundaryreview recommends **internal request-local provenance** (e.g.privateWeakMapResponse metadata), notmerelywiretype/allowlistedcode whichproviderscanimitate. Event-specifictrustedterminalproducer notificationneededforSSE; aResponseflagalonecan'tauthenticateallproviderframes. Preserveprovenance explicitlythroughwrapping/cloning, neverfallbackwiretrust. NegativeproviderJSON/SSEperfectimitators remainuntranslated; schema+registry-derivedsanitizednativecodes429RESOURCE_EXHAUSTED/503UNAVAILABLE/409ABORTED, trustedrequest/reset/window/headers only. SSEparseevents incrementalUTF8/CRLF/multilinedata/EOF, cancelsupstreamstopsfuturecandidates aftertrustedlocalterminal, no claim HTTPstatuscanchangeafterheaders. Afterbuildterminal, bounded**pre-stream-only** preparationimplemented: errors.js privateWeakMap responseproducer snapshot, geminiBudgetErrorResponse returnsregistry-derivednumericcode/native status/gatewayCode/no-store/requestId/Retry-After/windows/timezone/CORS; providerwireimitators/clonesunmarkedremaincompatibility no wirefallback. POSToriginalsignal forwardedonlychatbranch, localformatterbeforeSSE/JSONconversion. NoSSEterminalauthority/parser yet noidentityprecedence/disabledkeycallerwiring. `b201ad194`4filegate **27/0/no pending/todo** lint0/tests0/whitespace0 `/tmp/9router-gemini-boundary-results.json`, native429503409 actualroute+TTSregression+customabort+perfectJSON/SSEspoof/clones/mutableerroridentity. NotpersistedrealHTTPauth/proxy/inferenceaccounting. Follow-onparser-onlyrepair `sseEventDecoder.js` locallyadoptedGemini: streamingUTF8 CR/LF/CRLFcarry comments optionalonespace multimlinedata, EOFflush+explicitcompatibilitydispatchunfinishedevent unlikebrowserEventSource; no inventedDONE. Config1MiUTF16codeunitline/eventlimits (notbyte/token), overflowerrors/cancelsnotsilentdrop. Choice/legacyusageconversionunchanged notexactaccountingauthority; providererrorframesuntrusted. Advisorplanreview acceptsboundedparserwithEOF/limits/canceltests notimplementationapproval. `b4d1138c9`5filegate **35/0/no pending/todo**, lint0/tests0/whitespace0 (`/tmp/9router-gemini-framing-results.json`): helperallbytesplits/byteatatime/multiline/EOF bounds; actualPOSTallbytesplits, exactcancelreason, overflowupstreamcancel/readerror; noSSEterminalproducer/hooks/activation. ThreeURL-call STOPdiagnostics werecheckedcallchainvalidateGeminiNativeClientKey/buildGeminiNativeUrl→awaitedforward→POSTtrycatch andmarkedfalse-positive withindividualreason; no ignores/sourceTTSchange; sessionstillreportscachedfinding+8consolewarnings, no cleanLSPclaim. Newsourcepostbuild makes358/0/buildhistoricalpreformatter—notlatestsourcecertificate.

Read-only control-plane follow-up while proxyguard build source barrier held: DefaultExecutor refreshCredentials dispatch and refreshFromGrant/refreshWithJSON/refreshWithForm/refreshIflow/refreshKiro/refreshCline/refreshKimi/refreshKilocode bodies inspected. Actual POST bodies are refresh_token grant or refreshToken/clientType credential payload, not messages/prompts; Kilocode returns null/no fetch. These inspected refresh seams are credential control planes, not generation attempts. Failure catches return null, no raw accounting hook/caller signal propagated here; cancellation/security/credential exposure tests remain separate. This does not certify all dynamic/configured refresh endpoints or hidden provider billing, and never permits treating generation-shaped Vertex probe as control merely by its name. Current proxyguard44-file sweep `b976a053c` **412/0/no pending/todo**, exactscope/comparator/stability/allgreen/whitespace0,1,401inputsunchanged; MODULE_TYPELESSremains, noMaxListeners/PromiseRejection warning observed. Freshbuildstillpending same snapshot, no source change during read-only audit. No activation/inference hooks.

Still required: inspect **all** executors (including those without regex matches), handlers/Responses/native wrappers, account/model/capacity/fusion flows, timeout stragglers and single-success regeneration. Add provider raw usage location, per-attempt owner, nonbillable evidence, unresolved handling and concrete fixture for each billable seam. No silent exemption or claim that grep proves complete coverage.
