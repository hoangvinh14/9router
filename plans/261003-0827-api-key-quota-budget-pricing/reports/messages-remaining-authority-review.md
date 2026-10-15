# Remaining Messages authority review after client-RAG boundary

B alone active/F; enforcement/public-app/synchronous activation OFF. Direct inspection/self-review; no delegation/advisor/provider swap, live provider/OAuth/billable calls, activation/merge/release or new gate in this review. Prior [client RAG receipt](./messages-client-rag-continuation.md) `b02ce88bf` remains **FAILED baseline-only** SQL.js134/134, affected819pass2fail1todo, translator13pass1fail; exact40files/1367stablehashes/lint17white0. Finite source/raw/originalprice/ownACK/default-consumer delivery, not integrated B acceptance. No counts combined as unique coverage.

## Paid embedded server tools: a pricing-contract decision, not a missing token parser alone

Public pages read without credentials:
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool — `server_tool_use.web_search_requests` is billed in addition to tokens, $10 per1000searches in the current unpinned documentation; errors not billed. Search result count is not the billed-use count. Usage may accumulate across iterations within one Messages turn. Original encrypted result content/index must survive replay. Dynamic filtering may introduce code-execution blocks automatically; response_inclusion can suppress returned nested blocks, so counting content blocks is not a debit authority.
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool — current docs say no additional charge beyond standard token costs; raw `web_fetch_requests` still reports nonzero operations. Token examples are not exact counters or prices. Fetched documents/citations may be introduced dynamically; pre-request original-document-only inventory cannot validate those as if originally supplied.

Current source proof:
- `open-sse/utils/exactUsage.js` rejects every nonzero/unknown server counter under token-only semantics. Do not change `tools[key] !== 0` to accept positive counters without a typed downstream monetary category.
- `open-sse/config/accountingCacheTiers.js` exposes only six token rates. `src/lib/pricing/referenceResolver.js:completeReferenceRates` rejects additional fields; snapshots explicitly label USD/1M tokens. No per-search unit/rate/source mapping exists.
- `src/lib/pricing/money.js:costFromExactUsage` computes token/cache/reasoning components using BigInt, with one round-half-up per attempt. `src/lib/apiKeyBudget/service.js` uses retained original snapshots and unresolved/null-cost on missing authority. A guessed 0/free or token-rate reuse for search units would violate these owners.
- Accepted `design-contract.md` says chat all formats/embeddings but excludes search/fetch metering; `plan.md` phrases that exclusion as standalone endpoints. Existing handoff explicitly requires embedded-tool semantic/pricing evidence and never guessed zero. Neither establishes a per-use reference-price contract or an explicit product choice to exclude embedded fees.

**Operator decision received:** user selected “Tính cả phí tool (Recommended)” in the structured fee-treatment question. Include token/cache/reasoning cost plus observed raw tool uses × explicit typed reference rate, retained original snapshot, missing authority fail-closed; standalone search/fetch endpoints remain excluded. Decision recorded in `design-contract.md` embedded pricing section. Implementation/evidence still pending, gates not opened.

Historical alternatives presented before that decision: include documented embedded per-use fees in chat attempt reference cost using explicit typed USD/1000uses rates/immutable snapshot/manual override + missing-rate fail-closed, while standalone endpoints stay excluded; OR intentionally define token-only virtual cost for embedded tools and explicitly disclose omitted fees (a support/monetary scope decision, not implicit default). Keep current paid-tool gate closed until implementation and protocol/price/ACK evidence, not just the approved choice; refusal is not delivery. No rate values copied from public docs into production.

If inclusion is approved, required implementation spans raw typed counter cumulative semantics, original/version/allowed-caller/tool block history, server ID/result/citation association, pause_turn successor with fresh own intent, typed reference-rate ingress/snapshot/UI/sync treatment, one-round BigInt cost + recovery/CAS and actual API-key/OAuth failure/ACK/adapter/default regression boundaries. Web-fetch documented free fee requires a documented schema category, never blanket free for unknown tools/versions. This review does not authorize such implementation by itself.

## File reference security boundary

Files docs https://platform.claude.com/docs/en/build-with-claude/files state files are upstream workspace-scoped and warn against untrusted file IDs. Current gateway inference identities share provider connections; knowing a file_id is not proof the gateway API key owns it. Inspection found no Files route under `src/app/api`, or file ownership/type binding in `src/lib/apiKeyBudget`/budget migrations. Documents may be PDF or text; file source gives neither verified kind nor original corpus. Required facts: retained gateway-key/provider-workspace ownership, stable credential connection authority, verified file type/citation kind, deletion/expiry/reimport/restore behavior. Dummy file regex/loopback tests alone cannot prove them. Do not retrieve privileged file metadata under a shared provider key merely to classify an untrusted ID, or silently waive ownership. No file source support claim.

## Other finite gaps retained

- URL reference forwarding is verified with owned HTTP + dummy references, not provider DNS/redirect/remote media/large-byte safety.
- Custom string source SDK shape lacks documented original string-to-block index mapping; no conversion/count guessing.
- Nested cache SDK optional fields are not proof of valid sub-content breakpoints. Public prompt-caching docs require top-level source blocks; current cache budgeting/TTL ordering and price requirements traverse top-level only. Direct generated citation caching is documented unsupported; do not strip markers and call that support.
- Missing signed thinking tool history currently refused because legacy transformer inserts a placeholder; refusal is safety, not delivery. Additional accepted beta/original option preservation, other provider/protocol observability, public app adoption and G/T/I/V remain open.

No active featuregate after consumed `b02ce88bf`; intentional local WIP retained. No checkpoint commit/push performed in this continuation. B remains incomplete; C–E pending/all13AC retained.
