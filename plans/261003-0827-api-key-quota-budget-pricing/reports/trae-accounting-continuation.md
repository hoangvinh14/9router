# Trae accounting continuation — discovery/characterization only

B active, original13AC and A→B→C→D→E unchanged. Branch `feat/api-key-quota-budget-pricing`, HEAD `0d94c728`; intentional dirtyWIP retained. App synchronous/OFF; no live calls, delegation, commit/push, activation or rollout. Production Trae unchanged. Self-review/security notes are limitations, not independent approval.

## Preceding finite Qoder boundary

`beb409d1a` PASS77/77 on6distinctfiles `/tmp/9router-qoder-structural-reconcile-i_uto5ar/{results,scope,inputs}.json`: exactinventory/complete=true/no pending/testlintwhite0/16hashstable. Lint only5declarednewpaths, notunchangedlegacyhashinputs. Structural reader unwired; opaque innerbody has no certified usage/cache/reasoning/terminal/modeltierprice/durableowner authority. Earlier overlapping38/26/35/40receipts notsummed; missingmoduleRED4pass12pending/duplicateRED18pass3fail preserved.

## Inspection

Read full `open-sse/executors/trae.js` and registry `open-sse/providers/registry/trae.js`; no existing Trae unit files found by filename search. Existing dispatch-inventory discovery at Trae session/events boundary retained.

- `execute` overrides Base and only destructures model/body/stream/credentials/signal. Accounting/selected proxy options are ignored. Every transport call passes null proxy argument; this does not certify direct/ambient proxy routing.
- `POST /chat_sessions` contains `initial_message.query`, manual/auto model-selection strategy, remote agent mode and generated common_params. It submits first turn, not a harmless session-control request. Actual inference-attempt authority must precede it; do not guess token exchange/session classification from URL alone.
- Event GET subscribes to returned session/message of that turn. No evidence supports doublecharging GET as new generation. Returned IDs interpolated into session path (reply ID encoded); provenance/route/SSRF binding remains unverified, not production-fixed.
- `flattenQuery` flattens roles/text/arrays and coerces block text. Body sampling/default fields/model aliases/common_params/Cloud-IDE-JWT headers/date IDs/environment/config need full retained evidence and fresh persisted authority before ownership.
- Registry contains `auto`/`work` server-selection modes plus named models. Registry identity alone is not canonical upstream-model/rate proof for selected generation. No estimated/auto-rate support invented.
- `streamEvents` uses nonfatal UTF8, unbounded buffer, per-data-line JSON parse fallback `_raw`; no complete raw schema/duplicate-key/aggregate/EOF proof. Callback on done/error cancels reader immediately and can discard later usage/error in same chunk or after terminal, before clean EOF.
- Latest token_usage wins; `usage.prompt_tokens || 0` etc preserve strings/default missing fields and allow truthy negative counters. Cache/reasoning/inclusion/totals are unverified. No usage provenance/counter parser implemented.
- Empty EOF or text-only EOF without done produces success-shaped stop and synthetic DONE (stream) or completion JSON (nonstream). Error drops captured usage; streaming error still emits DONE. Converted terminal/counters cannot settle money or authorize successors.
- Stream consumer cancellation lacks explicit wrapper cancel forwarding; stream timeout signals controller but is not by itself bounded terminal/ledger proof. Full abort/consumer lifecycle still uncharacterized here.
- Refresh placeholder returns null; OAuth exchange/userinfo calls were not executed or inferred billable. No native/socket/adapters/durable ACK/queued gate evidence.

Security notes: retain/freeze full credential+common_params+model/route/header/proxy/environment before exposure, validate fresh persisted identity and response session IDs; redact raw JWT/identity/full headers from ledger/log-management. Existing error body reflection may disclose upstream details; fixtures do not approve production log/redaction/SSRF. Descriptor/brand guards are not a same-process sandbox. No native or live transport called.

## Test-only characterization gate

New `tests/unit/trae-accounting-characterization.test.js` mocks whole proxyFetch module; exact POST/GET routes accepted and unknownURL throws (no native fallback). Actual TraeExecutor methods execute, no method/subclass overrides. Initial fixture missed intentionally hiddenregistry state; corrected fixture explicitly assigns raw `traeRegistry.transport` to instance **testonly**, while asserting production `PROVIDERS.trae` and ordinaryinstance config remain undefined. No productionregistry/executor activation or customroute exemption. Seven stream controls plus an ordinary-hiddenconstructor control:

1. Positive full100/20/120 stream: one initial-query POST then one GET, manual model/text binding; accounting untouched/selected proxy omitted/null both calls.
2. Empty raw EOF → synthetic successstop/DONE/no usage.
3. String prompt counter +missing output/total → string100/zeros (nonstream).
4. Text-only nonstream EOF without done → successful partial completion.
5. Genuine done with unclosed rawstream → cancel once; trailing usage/error discarded, no EOF proof.
6. Usage then error → usage discarded, error plus synthetic DONE.
7. Malformed token_usage JSON fallback → manufactured zero counts.

`b3ca8b283` RED **0pass/7fail/7**, oneactual/no pending `/tmp/9router-trae-accounting-characterization-Pyq9cu/results.json` TEST1/LINTWHITE0. Allseven fail at `TraeExecutor.base`→errorresponse base() with `TypeError: Cannot read properties of undefined (reading 'baseUrl')`. Registryindex intentionally comments importp102/exportp102 out (no tools); ordinary `PROVIDERS.trae` undefined. No stream/accounting assertion coverage/no transport; red retained. No production hiddenstate change to green.

Fixture-only minimalcorrection assigns rawregistry transport to testinstance with no method override. New eighth control asserts ordinary constructor configundefined, execute rejects baseUrl, zero transport calls. Originalseven assertions unchanged nowuse explicitfixture helper. Partialedit receipt readback reconciled/applied onlyremaining unique blocks, no duplicates.

`b847d61a9` RED **1pass/7fail/8**, oneactual/no pending `/tmp/9router-trae-hidden-fixture-rD9Yf9/results.json` TEST1/LINTWHITE0. Ordinaryhiddenconstructor passes. Sevenfailures `Unexpected fixture Trae transport` stack `callCleanupHooks`/mockline24: expression beforeEach returned `fixture.fetch.mockReset()` mock function; Vitest interpreted return as cleanup and invoked mock withoutURL/options. Do not classify as new upstream-route defect or certified green streamcontrols; receipt retained.

One testhook-only correction: `beforeEach(() => { fixture.fetch.mockReset(); });` returns no cleanup. Transport allowlist/unknownroute refusal/assertions/instancefixture/hiddenproduction unchanged. No assertion weakening/no production repair.

`b06229fcf` PASS **8/8**, oneactual/no pending/todo `/tmp/9router-trae-fixture-hook-repair-VlAIdm/results.json` TEST/LINT/WHITE0. Hiddenordinaryconstructor +sevenoriginalcharacterization assertions reached. Both preceding reds preserved/no overlapping countaddition. Productionhidden unchanged; fixture-only rawregistry config is not app support/route permission.

Test-only8→10 adds:
- Actual downstream reader consumes assistantrole then `fixture delivered prefix` BEFORE fault injection; later usage+503error arrives, usage erased/error+syntheticDONE/onecancel/oneinitialPOST+oneGET/accountinghooksuntouched. Consumerprefix assertion precedes fault, not inferred from finalbuffer.
- Positive full100/20/120 usage then negative-3/1/-2 usage: latestrecord survives via legacyclosure/`||0`, not counterexactness/inclusion certification.

`bdc046cdc` PASS **10/10**, oneactual/no pending/todo `/tmp/9router-trae-prefix-boundaries-e0KmI5/results.json` TEST/LINT/WHITE0. Actual downstreamprefix-beforefault and latestnegativeusage controls reached. Earlier8/8 overlap—not18unique; two redreceipts preserved. Fullproxytransportmock/unknownURLthrow, no native/live calls. Productionregistry/executor remain unchanged/hidden; fixture-only rawregistry config NOT activation/route/provenance permission. Characterization confirms legacy evidence-loss, **not** accounting safety/schema/pricing/owner/family/B closure. Unavailable/pending LSP/cascade inconclusive. No active Trae gate after consumption.

## Remaining

Verified raw usage/cache/reasoning/inclusion/totals/terminal/error/EOF contract; model selection/rate canonicality; bounded full original→sessionPOST conversion and detached credential/header/commonparams/config/environment/proxy evidence; fresh persisted authority plus own durable intent/completion ACK and separate terminal authorization; subscription identity/abort/consumer/native/adapter/proxy/recovery tests. No support/owner implementation until these boundaries established. Trae/full-family/B remain open.
