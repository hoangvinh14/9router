# Qoder accounting continuation — discovery only

B active; original13AC and A→B→C→D→E unchanged. Branch `feat/api-key-quota-budget-pricing`, authorized HEAD `0d94c728`, intentional dirty WIP preserved. App synchronous/OFF. No live calls, commits/push, delegated execution, activation or rollout. Security-first notes below are limitations, not an independent audit.

## Preceding boundary

Zed characterization `bebb92e83` PASS30/30, exact3files/no pending characterization8/wire11/usage11 TEST/LINT/WHITE0 `/tmp/9router-zed-characterization-boundaries-HMAMba/results.json`. Zed raw-schema/provider/price/token-exchange/queued owner authority remains blocked; no guessing/static IDs/usage invented. Kiro finite353/17files, verifiedTLS10, shared452/9files remain separate scoped receipts, not B/full-family acceptance.

## Inspection

Read entire759line `open-sse/executors/qoder.js` and `open-sse/shared/qoder/sse.js`; existing stream-errors and proxy-replay fixtures also inspected. No production changes.

- Actual executor overrides Base and ignores accounting; signed strict-proxy POST does not carry own intent/settlement ownership. Existing strictProxy/no-direct-replay behavior is not ledger/ACK proof.
- Request preparation may exchange PAT authority, look up/force-refresh model config, rewrite/upload attachments, infer context tier from estimated prompt tokens, synthesize UUIDs/timestamps/stable session/record IDs, normalize content and max-token defaults, then encode and COSY-sign bytes. These need full retained original→actual/config/environment/credential proofs before a new queued owner. Context estimate is not billable token usage.
- Response first-frame peek coerces status via Number and consumes unbounded string data with nonfatal UTF8. It cancels on initial errors; mapped billing403 is not token money or free-attempt/retry permission.
- Wrapper discards malformed envelopes, coerces missing/zero status to200 in later parsing, maps late errors to synthetic chunks/DONE, and catches stream failures before flushing coalescer synthetic terminal.
- Coalescer canonicalizes counters using Number coercion, missing output defaults0 and generated total, permits negative finite values; caches mutable usage and recognizes finish fields at several shapes.
- Finish + usage can emit terminal/DONE and cancel raw upstream before genuine upstream DONE/clean EOF, discarding later frames in that chunk. Empty EOF also synthesizes DONE. Converted finish/usage are not raw exact evidence.
- Subsequent helper inspection completed all1299lines: model/PAT390, encoding55, COSY175, constants178, attachments341, contextTier160. No guessed raw schema, signing policy, cache inclusion, tier price semantics or successor permission added.
- PAT→job-token exchange POST and userinfo GET precede COSY model/inference; intl device token uses api3, job token api2, CN gateway. Catalog cache identity uses region+userId preferentially, not full original token; returned raw model config is shallow-cloned with nested shared mutable values. Cache equality cannot grant fresh persisted credential permission.
- COSY hashes/signs exact encoded bytes/path but generates encryption key/request IDs/time and fallback machine ID. Encoding is obfuscation, not credential/route proof; never persist raw COSY headers/machine/token.
- Attachment helper can upload PUT, substitute returned URLs/stubs and use per-request digest cache; upload URL currently derives default inference region, separate from executor regional selection. Do not certify nontext/CN routes from a text-only fixture. No route/region fix attempted here.
- Tier helper estimates JSON prompt chars/CJK and mutates three payload fields based on ambient QODER_CONTEXT_TIER; tier metadata/cache/environment must be detached before any future accounting dispatch. Estimates cannot become exact usage or guessed tier pricing.

Security limitations: COSY signing/credential/system-machine identity must never enter ledger/log-management raw; retained bytes/full headers need guarded evidence and redaction; route/SSRF/selected proxy/region/env need provenance; error-body logging is not guaranteed credential-free by comment. No same-process sandbox or transport/security approval claimed.

## Current test-only gate

New `tests/unit/qoder-accounting-characterization.test.js` four controls:
1. Actual signed executor with mocked model-config and full proxy transport performs one POST while accounting hooks are untouched. No model discovery/PAT/upload/live fallback.
2. Legacy canonicalizer coerces string counters and invents missing output/total; negative finite counters remain accepted.
3. Empty EOF produces synthetic DONE without raw usage/terminal.
4. Finish + usage causes synthetic DONE/cancel before genuine DONE/EOF and erases trailing503 in the same chunk.

Existing `qoder-stream-errors.test.js` and `qoder-billing.test.js` included unchanged. Existing proxy-replay suite is inspected historical evidence, not run/ledger certification in this gate. LSP unavailable is inconclusive, not clean.

`b2f01150a` PASS **38/38**, threeactual/no pending characterization4/billing17/stream-errors17 `/tmp/9router-qoder-accounting-characterization-U190uU/results.json` TEST/LINT/WHITE0. Accounting-bypass/coerced-defaulted counters/syntheticEOF/preEOF-cancel/trailing-fault-loss controls reached. Legacy characterization only, not raw money/ledger/ACK/native transport owner.

New `qoder-accounting-authority-characterization.test.js` two actual model-helper controls mock every transport (unexpectedURL assertions/no native fallback): same user/region token rotation reuses previous catalog instead of performing new credential lookup; top-level config clone preserves nested shared mutable context tiers across calls. Accepted initial config asserted before mutation, no weakening of fresh queued authority. Existing four characterization and pure context-tier tests included unchanged.

`bb4f72a10` PASS **26/26**, threeactual/no pending authority-characterization2/priorcharacterization4/context-tier20 `/tmp/9router-qoder-authority-characterization-oRJ7ci/results.json` TEST/LINT/WHITE0. Legacy token-rotation cache reuse/shared nested config mutation controls reached; no source/helper/cache/route changes, owner/schema grant or live calls.

## Bounded envelope prerequisite — test first

New `tests/unit/accounting-qoder-envelope.test.js` specifies a structural reader only: complete opaque `body` string retained without parsing/coercing/defaulting its usage; explicit numeric status; ordered raw envelopes/DONE; fatal incremental UTF8 and fragmented CRLF; comments supported, unknown fields/malformed JSON/unterminated tail/postDONE records refused and poison retained; intrinsic byte copy/zero-trap Proxy rejection; explicit event/chunk/record ceilings; frozen detached records. EmptyEOF returns empty records—not syntheticDONE or usage. Body may carry unsupported/unknown semantics: accepted envelope structure is never raw money/terminal/ACK/retry permission.

`becb6bebe` RED **4pass/12pending/16**, twoactual files; no assertionfailures. `/tmp/9router-qoder-envelope-before-GJTTyK/results.json` TEST1/LINTWHITE0: envelopebeforeAll missing`open-sse/utils/accountingQoderEnvelope.js`, priorcharacterization4pass. Twelvepending are setup-blocked, not executed guard coverage; redretained/consumedbeforeimplementation.

Added separate `config/accountingQoderEnvelope.js` limits/status/fields constants and `utils/accountingQoderEnvelope.js` structuralreader. Descriptor-only plain options guard; intrinsicUint8ArraybyteLength/set copy rejectsProxy/fake beforecallerreads; per-event1MiB/chunk2MiB/records1024/aggregate8MiB boundedretention, incremental fatalUTF8 plusperline decode, CRLF exact/newline dispatch/comments, one-data-line selectedshape; exactfields/numeric100..599/opaque bodystring, rawDONE/postDONErefusal, frozenrecords/array, invalid/ended poison. No callbacks/parsebody/coercion/defaultusage/EOFsynthetic/semanticterminal/ACK/retry/ownerprovenance. Legacyexecutor/coalescer/modelcache unchanged/unwired. Retainedbytes ceilings notheap/deployment/sandboxproof.

`be09db40b` PASS **35/35**, fouractual/no pending envelope12/characterization4/authority2/streamerrors17 `/tmp/9router-qoder-envelope-candidate-nV4ZHi/results.json` TEST/LINT/WHITE0. Original12structuralcontrols nowexecuted; missing-module redpendingretained. Unwired/no semanticusage/ownergrant.

Self-review found `JSON.parse` last-value overwrite can erase duplicate envelope keys before exact-field validation. Test-onlyenvelope12→17: three duplicate plain/escaped decoded keys after accepted envelope; accepted escaped-key/order/whitespace/numericJSON fixture while duplicate keys **inside opaque body remain unparsed and not certified**; options accessor/Proxyzero-read, actual aggregate-byte cap and multiline data refusal controls. Productionreader unchanged until redreceipt classified. Not full JSON/body-schema/security proof.

`b6686fd8c` RED **18pass/3fail/21**, twoactual/no pending `/tmp/9router-qoder-envelope-duplicate-before-gmcasw/results.json` TEST1/LINTWHITE0. Three plain/escaped decoded duplicate envelopes accepted; their subsequent poison assertions unreached. Otherpositive lexical/options/aggregate controls pass. Redretained/consumedbeforeminimalrepair.

Minimalreaderrepair: selected flat outer lexical grammar reads decoded keys before assignment and refuses duplicates/unknowns/extra fields; only individual JSON strings/numbers parsed with explicitcatch, separators/end/whitespace exact. Body remains opaque (its internal duplicates/unknownusage notcertified). Bounds/status/UTF8/EOF/framing/poison/legacy behavior unchanged; no genericJSONparser/refactor/executorwiring.

`b49dd6181` PASS **40/40**, fouractual/no pending envelope17/characterization4/authority2/streamerrors17 `/tmp/9router-qoder-envelope-duplicate-repair-xjHDNs/results.json` TEST/LINT/WHITE0. Duplicate refusal and subsequent poison assertions nowreached; red18/3retained. Structuralonly/notusage-owner certification.

## Finite structural reconciliation — current

`/tmp/9router-qoder-structural-reconcile.py` declares6distincttestfiles envelope17/authority2/characterization4/streamerrors17/billing17/contextTier20 (expected77, actualJSONwins), ten source inputs +six tests=16hashes. Exactinventory/perassertionpassed/no pending/todo/aggregatecounts/hashstability required; lint onlyfive new source/testpaths (two structuralmodules/three newfixtures), unchangedlegacysourceshashchecked **not** assertedlintclean. No production/testchanges; heldfixeduntilreceipt. Missing-module/duplicate reds retained, no overlappinghistoricalcoverage sum.

`beb409d1a` PASS **77/77 on6distinctfiles**, exactinventory/complete=true/no pending/testlintwhite0/16hashesstable `/tmp/9router-qoder-structural-reconcile-i_uto5ar/{results,scope,inputs}.json`. Envelope17/authority2/characterization4/streamerrors17/billing17/contextTier20. Lint limited tofive declarednewpaths, notlegacymodules. Unwired selectedenvelopestructure/characterizationonly—semantic usage/cache/reasoning/terminal-money/modeltierpricing/durableowner/native transport/security-build-recovery/fullfamily/Bapproval absent. Earlier35/40/38/26overlapnotadded, missingmodule/duplicate redsnotwaived.

Nextboundeddiscovery: Trae initial-messagePOST/eventGET inspected, productionunchanged; test-only sevenactualexecutor characterizationcontrols with allproxytransportmocked/unknownURLthrow. `b3ca8b283` RED0pass7fail/7 hiddenregistryconfigundefinedbaseUrl/no transport no streamguards redretained; fixtureonlyrawregistry.transportinstanceplusordinaryhiddenzeroPOSTcontrol productionhiddenunchanged. Current `b847d61a9` RED1pass7fail/8 hiddenordinarypasses sevenVitestcleanupfailures beforeEachreturnmock notnewupstreamroutefailure retained; onehookblockvoidfixonly. Current `b06229fcf` PASS8/8 oneactual/no pendingtodo checks0 hidden+7characterassertionsreached redsretained. `bdc046cdc` PASS10/10 oneactual/no pendingtodo checks0 `/tmp/9router-trae-prefix-boundaries-e0KmI5/results.json` actualprefixBEFORElatefault/latestnegativeusage reached; characterizationonly hiddenproductionunchanged, prior8overlapnotadded/redsretained. No activegate or semanticowner support. See `trae-accounting-continuation.md`; no Qoder/Trae/family/accounting activation grant.

## Remaining

Independently verified raw envelope/counter/cache/reasoning/terminal/clean EOF semantics, bounded original conversion/config/encoding/signature authority, exact region/model/tier/rate binding, own durable ACK per generation, abort/errors/unknown and native/adapter/proxy transport evidence. Characterization or refusal alone cannot close Qoder or B.
