---
title: "Phase 4: Chat, embeddings, retries và fusion integration"
status: in-progress
priority: P1
effort: 20h
depends_on: [1, 2, 3]
---

# Phase 4: Chat, embeddings, retries và fusion integration

> **Technical reference, không phải backlog song song.** [Roadmap Gói A–E](./plan.md#current-delivery-roadmap) là execution authority: dispatch/attempt owners, native formats, retry/fallback/fusion và transport authority thuộc B; complete acceptance thuộc E. Pending/running statements bên dưới là historical checkpoints, không live jobs. Reuse scoped evidence đúng boundary; explicit unsupported deny không phải delivered coverage.

<!-- Updated: Validation Session 1 - Gemini wrapper ownership, singleton isolation, quorum/straggler settlement -->

## Outcome

Mỗi billable attempt trong scope có stable identity, gate và durable settlement. Không thay strategy/model ordering/stream protocol ngoại trừ local refusals đúng contract. Không chỉ gắn middleware ở HTTP route rồi tuyên bố retry được accounting.

## Approved group/cache addition — Gói B

Theo [I/O/cache design](./reports/io-group-commit-cache-design.md): queued group write không permission trước await; each actual POST chờ own durable intent ACK, successor chờ predecessor settlement/ACK, eligible native terminal chờ own ACK. Giữ one context/terminal owner và exact abort reason. CacheRead/write subsets tính riêng theo original snapshot, không double-charge; local response hit proven0newPOST không recharge usage cũ, miss/revalidation/race actualPOST vẫn own attempt. Preserve key/access/gates; không xây response-cache engine mới. Queue/commit/crash/cache matrix là remaining acceptance, không claim current source đã implement group commit.

## Current delivery state — embeddings and buffered forced-SSE chat checkpoints

Current authority update: see [AC matrix](./reports/acceptance-closure-matrix.md).
Actual Node24 chat HTTP three groups and Node22 SQL.js fallback HTTP three groups
with three acknowledged-terminal SIGKILL restarts passed in their scopes. Explicit
DeepSeek schema/transport and two-key singleton isolation are implemented. SQL.js
standalone WASM defect retained and repaired with exact tracing/hash/runtime evidence.
Latest completed81-file sweep897/2 retains same autoswitch comparator reds.
Actual HTTP embedding unknown200 leak verified, owner postcompletion terminal
assertion/failed gate repaired; `bd9f64e79`242/242exact15 focused tests/scope/lint/
whitespace0. Current `bfd542fc2` fresh81 sweep/build/WASM and both runtime embedding
HTTP gates running on held source; no current result. Previous build historical
since owner patch. Nested fusion remains denied, not completed coverage.
Read-only next-owner preparation: live validusage/DONE/EOF accounting authorization
must use trusted terminal policy for unlimited unpriced/ACKed-gap continuation,
without accepting invalid/missing protocol or rewriting a cancellation winner.
No source changes during current gate; final provider/native/full AC still open.

Historical checkpoints below remain provenance, not current pending instructions.

Bounded offline prerequisite passed final65/4. Embeddings app→core→initial/authrefresh
POST→rawJSON→durableterminal beforetranslation focused gate `b06b8a160`75/75exact5.
Chat app→chatCore→DefaultBase perPOST owner, raw forcedSSE usage/DONE→settlement
beforeclientJSON now `b86f64b9d`67/67exact6,0skip/todo,lint/whitespace0.
Original59/11,8/6,48/2,65/1 failures retained; real serialized streamfalse mismatch
confirmed then detached effectivewirestreamtrue repair, clientintent/options immutable.
Fixtureonly activation/manualreference/upstream/auth/model mocks: not actualHTTPauth,
SQL.js lifecycle, allprovider coverage, native CLI/binary or wholePhase04 acceptance.
LiveOpenAI sameformat/singlechoice delta→heldterminal→usageDONEEOF→durableACK now
`b4f7885a5`106/106exact8; actualauthretry113/9 and accountfallback `b4d8d63da`116/9,
0skip/todo,lint/whitespace0. Sequentialcombo samecontext/modelprices/localerrorescape
implemented; `bfe1b75ad` exact13 **FAILED144pass2fail**, accountingfixture29/0 and
combo-boundary4/0; same2autoswitchassertions reproduced pinnedHEAD `b4348de1b`21/2exact3,
no waiver/greenlabel. Fusionfirst153/2thenlate `b137b4bf4` **156pass2fail exact14**,
onlysame2reds; actualpanels+judge/regeneration/fourPOSTs/samerequest/lateoriginalprice
settlement afterclient, lateunknownactivejudge fatal/heldprep0POST tested.
Currentintegrated74file sweep `b898102a6` **FAILED775pass2fail**,0skip/todo/collectionfailure,
onlysame2autoswitchHEADreproducedreds; comparator1 explicitREGRESSION/no waiver.
1,449inputhashes unchanged/whitespace0; same-source diagnosticbuild `b1c8407fc` PASSexit0,
1,449inputsstillunchanged, artifact1791147483/BUILD_ID. Build passed; integrated test
gate remains failed. NewACKdurabilitytestafterbarrier `b500471af` FAILED77/4exact5
(all4newcasebeforePOST setupmissingparent/db). Fixtureonlylayoutcorrectedtoactualoffline
contractparent/db/data.sqlite originalguards/faults/assertions/deadlinesretained;
`b5cb1419d` same5repairgate **81/81,0skip/todo,lint/whitespace0**. Node/SQLjs actualPOST
settlementACKfailure before/afterinstalled, onecompletion/no retry verifiedfocused;
liveownerreopeninspection notdeadownerrecovery/retrofitACK. Newactualprocessfault→SIGKILL
→productionNode driver deadownerrecovery→auditedoriginalsnapshot/replay singledebit/
receipt `b4e8594ab` **33/33 exact4,0skip/todo,lint/whitespace0**. SQLjswriter→Node restart
notSQLjsfallback/powerlosscertificate. Testonlyusableanswerboundaryslice `ba9855ae1`
**65/65 exact6**: realemptyprosepaidpanels retaincost/allfailednojduge orfreshregeneration,
malformedreply/abort0/synclocalfirstauthority. Originalstrategy/quorum unchanged.
Historicalcheckpoint notwholePhase04 completion. Capacity/nested atthatcheckpoint
unsupported foractiveidentified includingunlimited; laterboundedscopesbelow.
Rawlivepartial-observation96/8 andfullyreadbuffered126/10 verifiedfocused; interrupted
reader `b3bcfaef4` **154/154 exact12,0skip/todo,lint/whitespace0**, completeusageframes
retained diagnostic only/usage:null/unresolvedcostnull/no projection/no EOFflush of
partialevents; primitiveabortpreserved. Currentactualledger→management signedJWTroute
integration `b37eff873` **68/68 exact6,0skip/todo,lint/whitespace0**: existingstatus/spend/unknownpagetotal/listing
redaction/authbeforeDB/CSRF/independentexactrecover/originalprice/receipt replay.
NotactualHTTPtransport/fullUI/globaloperatoracceptance. Native errors/fullSQL.jsgateway/
HTTPauth and unhealthyunlimitedproofexception remain open; no wholephase completion,
enforcementOFF.

Latest79milestone850/2sameautoswitchreds buildPASS1,465unchanged; globalNodewire4groups
andrendered10flows4POSTpassedscoped notactualinference. Newcapacity-onlycandidate threads
samecontext/signal throughsoloaugmentation+combo pool, cloneaccountedbody; removesonly
augmentationblanketdeny, concreteprovider/schema+actualBasePOSTgates unchanged. Atthis
capacitycheckpointnestedunsupported/cycles0POST (laterslice below). SixnewactualappNodeledgercases poolpriority/exact3-6price/
oneowner/bodypreserved/unsupportedprovider+nested0POST/unknown-exhaustedstop. Advisor
checkpoint ordering/OFFarity/actualowner reachabilityrequired no wrapperdebit. `b9b62da0e`
firstrequested5 result **66/66 across4,0skip/todo,lint/whitespace0**; absent
capacity-adapter.test.js meansincompleteintendedscope, not5fileacceptance. Retained
JSONprovesactual4. Added3actualappcapacityfallbacktests accounted/OFF/cancellation,
first600000settled beforecontrolplane thenoriginal200000distinctPOST/sharedcontext;
cancelprimitive stopssecondPOST. New2capacityselectiontests order/no-mutation/strategy/
callbackarity+signal preserved. `b1d76045c` **71/71 exact5,0skip/todo**, tests/scope/
lint/whitespace0 prelaunch existence+postcollectionexactpathmatch/allassertionspassed.
No deadline/assertion/guardrelaxation.

Nestedsequentialcandidate nextbranchlocalimmutableancestry canonicalresolvermodel/root
included limit16(config); cycleor17thnode terminalUNSUPPORTED beforebranchPOST. Same
accounting/effective request-or-fusion signal eachwrapper/gate/candidateclone actualBase
oneowner. OFFskipnewbounds preserveslegacybehavior. Topfusionpanels seedancestry; nested
fusion stilldeny pendingfanoutcontract depthalone insufficient; no reservations added.
6newactualNodeapptests positive/OFF/cycle/depth16allow/depth17deny/nestedfusiondeny,
oldcapacitycyclicnegative retained. `b7b72407c` **77/77 exact5,0skip/todo**, tests/scope/
lint/whitespace0. Cycleguardnotrequestwidepreflight: earliervalidsiblingsmayalreadybepaid;
sharedchildsiblingsnotcycle. Added5actualNodecasesdiamondsecondPOST/paid-before-cycle
retains200000debit/privateUNSUPPORTED/unknownunresolvedcostnull0cooldown/exhausted429
0cooldown/cancel17afterfirstsettlement0secondPOST. `b42889604` **82/82 exact5,0skip/todo**,
tests/scope/lint/whitespace0. Next5actualNodeappcases topfusionnestedseqpanel/regeneration/
nestedjudge3POSTsharedcontextdistinctsnapshots200/200/400k; heldnestedprerefreshsees
otherpanelfatalunknown/callerprimitive17cancel beforechildPOST. `be4dfb517` FAILED86/1
exact5originalretained cancelchildbarrierallowed0siblingPOST; fixtureonlyactualsibling
entry+childbarrier/rawinvocationobserverdrain finallyreleasechild not2ticks unchanged
1POSTassertion/deadline. `b2e77fac8` **87/87 exact5,0skip/todo**, allgates0. Nestedfusion
itselfstilldeny.

DeepSeekapprovedOpenAItransport actualBase fixedregistryURL/runtimeformat rawJSON/live
provider-awareusage requiredcachehit/misssum prompt/totalBigInt detailscachedconsistent
reasoningincludedoutput; explicitproviderallowlist no generalprefix. Original161/6
residualappguard then165/2 unknownJSONsuccessleak retained. Mandatorytrustedrequest-local
post-completion assertion unknownfreshpolicygate budgetedreject/unlimiteddurablerecord
orgapACKcontinue settledthresholdcrossingnotretrodeny malformeddeny. `b5266d80c`173/173
exact10; broad `b7ab3412e` **231/231 exact15,0skip/todo**, tests/scope/lint/whitespace0.
Node two-keysharedsingleton reversecompletionpriceedit preservesfirst200000/second600000
requestidentity+snapshot/isolation firstnext429other200; DeepSeekfailed429exact164000each
priorACKbeforeretry secondintent versusunknownnohook/1POST; wrongdestination0POST.
Notliveprovider/native/allruntimecertification. New `be73526d3` currentmilestoneRUNNING
predeclared80prior79+capacityselection, exactcollectedassertionstatuses/comparator with
freshinputhashsnapshot+same-source diagnosticbuild independentlyafterredtests. No old
buildreuse/no autoswitchwaiver. Sourceheldthroughgates `/tmp/9router-provider-milestone-*`.
Partialedit8blocksapplied oneambiguouscallback retained rereadprecisefix; noreset.
Advisorcheckpoint recommendsrequest-localmonotonic invocation ceiling atomicfanoutbatch
ratherthangraphsnapshot(bindsdynamicsettings/unusedfallbacks), but newceilingsemantics
notexistingcontract/arbitrary1024unjustified; retainnestedfusiondeny whilederivebounded
scope. No reservations, no changedquorum/normalstragglercancellation. Noactivation.

Delivery theo vertical slices: validated request identity + pricing/durable begin gate → chat/embeddings raw attempt/terminal sink → retries/account/model fallback → fusion collected settlement/late sink/judge → remaining specialized provider/native terminal coverage. Mỗi slice có actual network-count/no-dispatch/failure/cancellation tests; không double-own attempt hoặc exempt unknown billable seam. Consumer gate bắt buộc dù TODO routing chỉ phụ thuộc remaining budget delivery: validated immutable pricing snapshot và supported exact-usage schema tại actual attempt boundary; budgeted unsupported paths deny trước fetch, không silently proceed. Chỉ dùng prerequisites đã verified cho consumer; complete pricing-sync UI/all-runtime release work không là lý do trì hoãn mọi hook preparation, nhưng acceptance cuối không được bỏ. Theo [current roadmap](./plan.md#current-delivery-roadmap); giữ toàn bộ verification matrix dưới đây.

## File ownership

Repo prefix `/home/gmo/projects/9router/`; phase tuần tự, không concurrent writers với phases 02/03.

| Action | Path | Change |
|---|---|---|
| Modify | `src/sse/handlers/chat.js` | One parent request context qua single/combo/nested combo/capacity/fusion; handle terminal local errors trước markAccountUnavailable. |
| Modify | `src/sse/handlers/embeddings.js` | Same identity/gate/lifecycle; bỏ assumption chỉ success exact usage mới cần tracking. |
| Modify | `src/app/api/v1beta/models/[...path]/route.js` | Chat-only identity/AbortSignal/native error/header propagation; native TTS outside metering. |
| Modify | `open-sse/handlers/chatCore.js` | Optional lifecycle hooks; initial + refresh retry boundaries và exact raw usage context. |
| Modify | `open-sse/handlers/chatCore/{requestDetail,nonStreamingHandler,streamingHandler,sseToJsonHandler}.js` | Single settlement sink; propagate await/abort/terminal semantics; no duplicate analytics debit. |
| Modify | `open-sse/handlers/embeddingsCore.js` | Initial fetch/refresh retry hooks, exact error usage extraction; preserve response bodies. |
| Modify | `open-sse/executors/base.js` | Per-network URL/retry attempt hooks, no extra top-level billable charge. |
| Modify | `open-sse/executors/codex.js` | SSE-peek retry settlement/error evidence; same hooks across super.execute. |
| Modify after inventory | `open-sse/executors/*.js` | Only specialized billable network seams needing hook propagation; record exact file list before edit. |
| Modify | `open-sse/services/combo.js` | Candidate-local price errors vs terminal budget errors; panel/judge attribution and settlement barrier. |
| Modify | `open-sse/utils/{stream,streamHandler}.js` | await lifecycle on terminal/flush/cancel/disconnect; exact metadata before estimates/buffers. |
| Create | `tests/unit/api-key-budget-chat.test.js` | Format/mode/abort/gate tests. |
| Create | `tests/unit/api-key-budget-embeddings.test.js` | Retry, failed usage, unknown/no-key coverage. |
| Create | `tests/unit/api-key-budget-dispatch.test.js` | Internal executor retries/account/model fallback/fusion inventory tests. |

## Required dispatch inventory artifact

Before edits, write `reports/dispatch-inventory.md` inside this plan directory with rows: actual file:line network seam, retry layer, billable vs control-plane, callback usage location, attempt owner, covered fixture and unresolved handling. Scan all executors and chat wrappers, including native Responses/passthrough/custom executors. No double owner for `chatCore.execute` + base.fetch. All generation/embedding network attempts belong to exactly one accounting owner. Include HTTP/2 (`cursor.js:403,463`) và direct seams (Github, Qoder, Vertex, Windsurf, Grok/Perplexity web, Mimo bootstrap/retry, Trae polling), không scan `fetch(` alone. Inventory `open-sse/handlers/responsesHandler.js:37` optional-hook standalone consumer, six app handleChat callers + embeddings route; full caller list tại [audit](./reports/validation-session-01.md). Proposed hooks optional không blanket authorize unmetered app calls.

## Implementation checklist

- [ ] Build mocked dispatch tests first; prove hooks optional and standalone/unlimited/no-key client behavior unchanged. Naming/warmup bypass without upstream generation must not charged; count-tokens alone outside enforcement.
- [ ] Carry one validated apiKeyId/requestId context through nested combo, capacity adapter and fusion panel/judge. Never use raw key/mask as accounting ID. Singleton executors/default cache không lưu accounting state lên `this`; pass local execute args/closures. Parallel two-key requests + internal retries + late stragglers tests phải không mix identity/snapshot.
- [ ] Gemini wrapper preserve original request.signal khi dựng new Request; credentials precedence giống outer guard (Bearer, x-api-key, x-goog-api-key, query key), không serialize raw key vào new tracking. Convert local budget errors sang Gemini prestream/SSE machine-code envelope; no-store/Retry-After/requestId/CORS exposed headers survive wrapper, error chunk thiếu choices không drop. Native TTS vẫn excluded; tests giữ behavior.
- [ ] Insert gate + durable intent at actual network boundaries, including credential-refresh retry, executor URL retry, Codex SSE retry and specialized direct fetches. Refresh credential/control-plane fetch itself not chat debit. Guard all actual attempts, not just client model string.
- [ ] Settle prior failed/billed attempt before retry/fallback; unknown charge blocks later budgeted attempts. Local refusal bypasses markAccountUnavailable/quota probing/cooldown. Model unpriced can skip to priced candidate; monthly/weekly exhausted, unresolved and DB unavailable terminal.
- [ ] Integrate exact provider usage collection pre-client format translation/buffer/estimation. Success/nonstream, SSE forced JSON, passthrough/tool-only responses all call same sink. Valid explicit zero usage accepted only with defined exact provider evidence, not missing object.
- [ ] Streaming: capture usage as received; completion/flush/cancel invoke idempotent terminal sink. Abort with no exact usage unresolved; final callbacks repeated no double-charge. Await persistence before successful terminal where possible; already sent bytes không rollback, budgeted persistence failure closes stream và blocks subsequent budgeted admission; unlimited may continue only after durable gap latch, failed latch surfaces storage failure.
- [ ] Fusion panels each get own attempt IDs; parallel panels may overshoot (accepted). Giữ quorum/grace, await settlements của **collected** responses trước next gate, không chờ mọi live straggler. `withTimeout/collectPanel` không cancel request; detached panel giữ own sink đến late settle/unresolved, live pending không tự orphan. Client completion không accounting completion; cancellation/timeout/disconnect/duplicate callback giữ idempotent sink, process death recover durable pending thành unresolved qua ownership proof. Single-success branch hiện gọi upstream lại (`combo.js:616-618`) phải được gate/account riêng như judge; không silent change sang reuse answer. If exhausted/unresolved/gap/storage terminal sau panels, no judge/regeneration; preserve terminal error thay vì generic all-panels-failed. Late straggler race vẫn accepted recorded-spend overshoot.
- [ ] Embeddings same lifecycle, support exact prompt usage and provider failure metadata, no estimated debit. Usage missing should not disappear because `exactEmbeddingUsage` returns null.
- [ ] Reconcile inventory: mọi billable route covered or explicitly fails before upstream for budgeted use; popular supported scope paths must be covered before done. Record unsupported provider limitations, don't silently exempt subscription providers.

## Verification gate

```bash
(cd tests && npx vitest run unit/api-key-budget-chat.test.js unit/api-key-budget-embeddings.test.js unit/api-key-budget-dispatch.test.js unit/embedding-usage-persistence.test.js unit/embeddingsCore.test.js unit/combo-fusion.test.js unit/combo-routing.test.js unit/fusion-strip-stream-options-3024.test.js unit/openai-responses-completed-usage.test.js)
npx eslint src/sse/handlers/chat.js src/sse/handlers/embeddings.js 'src/app/api/v1beta/models/[...path]/route.js' open-sse/handlers/chatCore.js open-sse/handlers/chatCore open-sse/handlers/embeddingsCore.js open-sse/executors open-sse/services/combo.js open-sse/utils/stream.js open-sse/utils/streamHandler.js
```

Matrix: OpenAI Chat/Responses, Anthropic Messages, Gemini via chat; stream/nonstream/forced-SSE; embeddings; success + cache/reasoning; billed failed response; account/model/capacity fallback; internal retry; fusion N panels+judge; abort and late usage; budgeted DB intent failure fetch-count=0; budgeted settlement failure block next fetch; stale price update midstream no repricing; no-key/CLI/unlimited; denied dispatch cooldown mutations=0. Distinct IDs for identical token payloads, same ID replay charges once. Mock upstream; no live credentials needed. Add actual `/v1beta` route tests cho google header/query/Bearer conflicts, abort, prestream/SSE local errors/header preservation (không helper-only); fusion quorum with late successful/unknown straggler, one-answer regeneration, terminal local failure mixed with successful panels, two-key singleton interleaving. Unlimited persistence failure follows durable-gap policy, budgeted failure always closes/blocks.

## Security, risks và stop condition

Read `open-sse/AGENTS.md` first. Avoid new app DB coupling in engine; optional injected hooks own budget. Do not buffer entire stream to get usage or mutate native envelopes casually. Nếu provider seam không chắc chắn accounting: stop that budgeted route before fetch, complete inventory and escalate; do not claim full acceptance until supported scope coverage done. Preserve trusted client-IP/header code; không thay `custom-server.js`.
