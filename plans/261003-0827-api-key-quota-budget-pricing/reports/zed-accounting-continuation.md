# Zed accounting continuation — discovery/characterization only

## Scope and state

Package B remains active; original 13 AC and A → B → C → D → E ordering unchanged. Application accounting remains synchronous/OFF. No production changes, endpoint exceptions, live provider/model-discovery/auth calls, new commit/push, activation or rollout.

Preceding Kiro ellipsis-only internal mode receipts are separate:
- `b32596b79`: finite **353/353**, 17 distinct test files, partitions owners170/authority86/raw97; exact inventories/no pending; test/lint/whitespace0; 43 checked hashes unchanged. `/tmp/9router-kiro-repair-reconcile-0fu0zx9o/{owners,authority,raw,scope,inputs}.json`.
- `bc26d72b8`: verified TLS **10/10** (native6/repair4), runner/test/lint/whitespace0, certificateCleanup=true; `/tmp/9router-kiro-verified-tls-1FQBLF/results.json`.
- `b554ef740`: shared impact **452/452** on nine unchanged distinct files, four disjoint partitions Claude158/Base99/Responses+Codex99/transport96, exact inventory/no pending, test/lint/whitespace0, 18 checked hashes unchanged; `/tmp/9router-kiro-repair-shared-impact-4vydzcps/{claude,base,responses,transport,scope,inputs}.json`.

These do not close Kiro's full legacy repair/fallback/refresh family, all adapter/proxy parity, physical crash/restart/recovery, current security/build/performance acceptance, or B. Do not sum overlapping historical gates as unique coverage.

## Source inspection

Read all 319 lines of `open-sse/executors/zed.js` and all 437 lines of `open-sse/shared/zedAuth.js` before selecting tests.

- Executor overrides Base `execute`; ignores accounting and does not forward selected `proxyOptions` into the helper. No intent/completion ACK owner surrounds `/completions`.
- It resolves a model catalog (possibly force-refreshed), infers provider on lookup failure, translates the original into provider-native request, and adds thread/prompt/provider/model envelope. Google path removes translated `safetySettings`. None of this is yet full retained request/config/credential provenance for a queued owner.
- Auth helper resolves organization from explicit PSD or `/client/users/me`; exchanges user/access-token authority for an LLM token via `/client/llm_tokens`; caches token/model state by partial identity. Cache shape is not persisted original-token equality or route permission.
- `zedLlmFetch` uses real helper logic to retry after401 or expired/outdated-token headers, including potential HTTP200 header trigger. Each `/completions` POST needs its own future accounting ownership. `/models` GET and token-exchange POST must not be guessed to be inference charges.
- NDJSON/SSE-ish wrapper unwraps `{event}` / `{status}` / raw `[DONE]`, ignores malformed JSON, uses nonfatal UTF8 and unbounded string buffering, translates per provider, synthesizes final conversion + `[DONE]` on EOF. After a done marker, subsequent status/usage is ignored. These are legacy behavior, not exact usage/terminal/EOF authority.
- Quota/edit-prediction percentages in usage service are not per-attempt token money.

Security notes: credential exchange, full PSD/system/org identity, route/SSRF permission, selected proxy propagation, token/header redaction, and fresh persisted authority remain unverified for a new accounting owner. Characterization is not a security audit or sandbox.

## Current gate

New `tests/unit/zed-accounting-characterization.test.js` five controls invoke the actual executor and auth helper, mocking **all** `proxyAwareFetch` calls (unexpected URL throws; no native fallback):
1. Empty clean EOF produces synthetic DONE with no raw usage/provider terminal/accounting hooks.
2. Malformed JSON is erased and still produces synthetic DONE.
3. Text + DONE causes later failure and usage frames to be ignored.
4. HTTP401 causes actual helper token refresh and completion POST2 without per-generation accounting.
5. Expired-token header on HTTP200 causes the same hidden generation retry.

Existing `zed-completions-wire.test.js` and `zed-usage.test.js` are included unchanged. Other Zed tests were inspected but **not** included: native-auth suite's global-fetch stub can miss proxy module's captured native fetch; live-model suite has native fallback for unmatched hosts. No implied coverage or live-call authorization.

`bf2dff04f` PASS **27/27**, three exact actual files/no pending: characterization5/wire11/usage11. `/tmp/9router-zed-accounting-characterization-U7W5iU/results.json`, TEST/LINT/WHITE0. Five actual executor/helper characterization controls reached; no raw schema/usage/owner/native transport grant. LSP unavailable remains inconclusive, not clean.

Registry inspection: `open-sse/providers/registry/zed.js` has empty static catalog and `passthroughModels:true`; provider inferred from dynamic catalog/model cannot by itself authorize selected raw accounting schema, canonical price model or retained queued provenance. No static-model alias or synthetic usage added.

Test-only characterization5→8 adds:
- Actual consumer `reader.read()` delivers text prefix before a server-stream barrier permits late failed-status frame. Legacy wrapper then emits `[Zed error]` with success-shaped stop/DONE, no accounting completion and no regeneration. Prefix is delivered before fault, not merely enqueued in the same chunk.
- Selected persisted proxy evidence is provided to actual executor but absent at token/model/completion helper calls (null/undefined); full transport remains mocked, not route/SSRF/native proxy evidence.
- Actual auth refresh replaces a still-unread first401 response without cancelling it; test explicitly cancels owned fixture body only after assertions. Not heap/resource-deployment proof.

`bebb92e83` PASS **30/30**, three actual files/no pending characterization8/wire11/usage11; `/tmp/9router-zed-characterization-boundaries-HMAMba/results.json` TEST/LINT/WHITE0. Consumer-prefix-before-late-failed-status, dropped selected proxy, uncancelled first refresh response controls reached. No production owner/parser/mode/request-routing changes or live calls. Zed remains blocked at independently verified raw-schema/owner authority; no counters/static-model identity invented.

Next backlog discovery: [qoder-accounting-continuation.md](./qoder-accounting-continuation.md), `b2f01150a` PASS38/38 characterization only; `bb4f72a10` PASS26/26 actual model-helper characterization; `becb6bebe` RED4pass12pending/16 missing prerequisite/not guard coverage preserved; `be09db40b` PASS35/35 structural-only; `b6686fd8c` RED18pass3fail/21 duplicate acceptance preserved; `b49dd6181` PASS40/40 structural-only; `beb409d1a` PASS77/77 finite six-file structural reconciliation/16hashstable; `b3ca8b283` RED0pass7fail/7 hiddenregistry/no streamguardcoverage retained; `b847d61a9` RED1pass7fail/8 cleanuphookreturnmock retained; `b06229fcf` PASS8/8 characterizationonly; `bdc046cdc` PASS10/10 Trae actual delivered-prefix/negative-usage characterization, production hidden unchanged; no activegate/accounting support. No Zed activation or coverage inferred from that work.

## Remaining boundary

No Zed raw accounting schema/owner/internal mode has been implemented. Need independently verified provider/envelope raw usage and terminal semantics, full original→actual guarded conversion and token exchange authority, fixed route/config/proxy evidence, own intent/terminal ACK per generation, cancellation/error/EOF/price/successor gates, native transport and applicable adapter evidence. Refusal, synthetic finish, generic translator usage or these characterization controls do not certify the family.
