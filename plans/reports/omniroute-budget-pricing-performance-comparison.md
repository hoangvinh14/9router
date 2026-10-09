# Feature Comparison: pricing/budget performance

## Outcome and boundaries

Compare OmniRoute's price lookup, budget check and spend recording with 9router; identify optimization ideas without changing accepted money/window/durability scope. Direct source inspection only: no copied code, application changes, installs, source scripts, benchmarks, live providers or production activation. Non-goals: new billing stack/Redis/database, full provider coverage audit, security certification or implementation plan. Acceptance: trace named callers/state/write boundaries, distinguish the two source budget mechanisms, identify cost and safety trade-offs, recommend only compatible adaptations.

## Source manifest

- Local source: `/home/gmo/projects/OmniRoute-langostino`, branch `release/v3.8.51`, HEAD `a58000c7685f4091c7a6fd8ddf3ebce7d2ec67c3`.
- Observed unrelated dirty state: `docs/guides/DOCKER_GUIDE.md`, untracked `plans/`, `scripts/docker/update-local-image.sh`, `tests/unit/update-local-docker-image.test.ts`. Not used or changed.
- Local project: `/home/gmo/projects/9router`, master, planning base HEAD `a99cf57239ff778b61e434c2786009d5ed1c412c`; current dirty implementation, not HEAD-only code comparison.
- License: MIT, Copyright (c) 2026 diegosouzapw. Substantial future code port must retain notice; this comparison copies no implementation.
- Scope: `src/domain/costRules.ts`, `src/lib/spend/batchWriter.ts`, `src/lib/db/{domainState,readCache,core}.ts`, `src/lib/db/settings/pricing.ts`, `src/lib/modelsDevSync.ts`, `src/lib/pricingSync.ts` (outline/search only), `src/lib/usage/{apiKeyUsageLimits,meteredBudgetPolicy,costCalculator,costLedgerRecorder}.ts`, chat candidate/streaming callers, relevant tests and migration051 index.
- Repomix unavailable (`command -v repomix` no executable); direct scoped file reads fallback, no package download. No researcher/subagent launch: existing direct-only instruction retained.

## Source anatomy — two mechanisms, not one

### Monetary domain budget

`src/sse/handlers/chat.ts:1559` calls candidate-level `rejectIfMeteredBudgetExceeded`, before credentials/fallback. `meteredBudgetPolicy.ts:90–121` checks domain budget only for metered provider; flat-rate providers are exempt.

`costRules.ts:360–379` caches budget configuration in a Map; it is NOT a cached spend counter. `checkBudget:505+` computes window then calls `getBudgetWindowTotal:240–249`:

```text
cached budget config
  → SQLite SUM stored cost for key/window-start
  + in-flight/buffered spend still in RAM
  → threshold decision
```

`domainState.ts:404–415`: SQLite SUM returns one number, reducing JS row materialization; migration `051_hot_path_db_indexes.sql:1` adds `(api_key_id,timestamp)`. Aggregation still visits matching rows; not O(1) spend lookup. Query lower-bounds time rather than explicit [start,end).

`batchWriter.ts:21–22,73–106`: default flush60,000ms or buffer>=1,000. Pending spend calculation copies/filters in-flight plus buffered entries then sums: O(total pending buffer), with temporary arrays. Failed persistence requeues; threshold is flush trigger, not proven hard memory bound during repeated write failures.

`costRules.ts:407–425`: `recordCost` buffers amount then starts optional best-effort ledger write. `costLedgerRecorder.ts:39–75` awaits price lookup then records ledger, catches errors, never blocks response. Streaming `streamingCost.ts:56–81` schedules cost resolution/recording via Promise and swallows errors. Costs here are Number USD, no durable attempt ACK demonstrated at this boundary.

Partial failure: budget total read throws → `getBudgetWindowTotal` returns0. `getBudget` read failure returns null, and checkBudget with null allows. This is the observed domain path, not a claim all OmniRoute policies fail open: outer/shared usage-limit guards can be different. A crash before cost-history buffer flush can lose that buffer; separate best-effort request ledger does not establish automatic budget replay because checkBudget reads domain_cost_history.

`core.ts:1270–1271` uses WAL + synchronous NORMAL in inspected native setup; it is not the same durability contract as 9router FULL+ACK. NORMAL is not proof ordinary process crash loses committed SQLite rows; unflushed RAM loss and power-loss guarantees must be distinguished.

### Separate usage-derived USD limits

`apiKeyUsageLimits.ts:395–452` groups successful usage_history by provider/model/tier, SQL SUMs tokens, then calls current `calculateCostDetailed` per group. `455–515` does daily and weekly calculations separately using Promise.all. It has unpriced-usage fail-closed handling when configured, unlike swallowing cost-history read errors above.

This reduces transferred rows to groups but still aggregates history, and prices history at current resolver rates. It does not match 9router original-price attempt ledger, Asia/Ho_Chi_Minh dual week/month or failed-attempt requirements. Async Promise.all does not prove synchronous SQLite aggregations execute in parallel.

## Pricing optimization evidence

- `readCache.ts:63–101`: merged price map cache TTL30s; explicit write invalidation in `invalidateDbCache:294+` also clears cache and bumps catalog version. Not TTL alone.
- `modelsDevSync.ts:227–298`: parsed synced pricing memo reused while catalog version unchanged; save/clear invalidate after writes. Test `tests/unit/models-dev-pricing-memoization-8697.test.ts` asserts <=1 prepare across repeated reads and write freshness. Tests read, NOT executed; not latency benchmarks.
- `modelsDevSync.ts:168–186` fetched catalog cache TTL24h. Periodic launcher `startPeriodicSync:740+` reuses activeSyncPromise, so periodic launches coalesce; not a certificate for all manual/concurrent entrypoints.
- `settings/pricing.ts:133–181`: even with cached full map, lookup iterates Object.entries for case-insensitive provider/model and alias fallbacks; cached map does not make every lookup direct O(1). It also permits normalized names unsuitable as exact monetary mapping authority here.
- Models.dev sync includes capability/catalog functionality; 9router wants pricing-only, one initial source, strict original decimal/provenance checks. Do not transplant full sync.

## Head-to-head / dependency matrix

| Component | Source | Current 9router | Status / recommendation |
|---|---|---|---|
| Price read cache | merged30s + explicit invalidation; synced version memo | referenceResolver reads/JSON parses stored values and validates/hashes selected snapshot per resolve | EXISTS resolver; NEW compatible revision-bound immutable memo seam |
| Price mapping | case-insensitive scans/normalization | explicit validated exact/mapped reference | CONFLICT: retain local authority, optionally preindex approved lookup keys |
| Spend read | indexed SQL SUM + RAM buffer scan | apiKeyAccountingRepo:166–171 reads costs, BigInt exact sum; service:55 does week/month | EXISTS ledger/index; measure, then optional rebuildable post-ACK derived cache, not second money store |
| Spend write | RAM batch60s/1000 + best-effort ledger | durable intent and exact terminal transaction | CONFLICT: no unacknowledged buffer as spend authority |
| Native persistence | WAL/NORMAL inspected | WAL/FULL verified PRAGMA and ACK | CONFLICT: retain local durability |
| Failure policy | domain reads may return0/no budget; separate usage-limit path blocks unpriced | unavailable/unresolved/gap semantics | CONFLICT: don't import fallback-to-zero |
| Policy/window | one active reset interval; flat-rate exemption | simultaneous weekly/monthly fixed timezone, OAuth virtual prices, zero denies | CONFLICT: retain local product contract |
| Analytics | can batch/defer | projection already separate from ledger authority | EXISTS: batching compatible only for nonauthoritative observability |

## Challenge and trade-offs

1. Source batching assumes buffered cost may precede durable spend without blocking response. Local contract requires durable intent/settlement ACK (or narrow independently durable unlimited gap exception). Risk if transplanted: crash can restore allowance/lose cost. Keep local write contract.
2. Source number/SUM math reduces transfer overhead but not exact safe bounds. Local BigInt sum exists explicitly to avoid SQLite aggregate overflow and Number loss. Do not replace with unbounded SQL SUM/REAL for benchmark gains.
3. Source current-price usage aggregation assumes historical repricing is acceptable. Local original snapshot is mandatory. Optimize ledger read, not raw-token repricing.
4. Memoization assumes all relevant committed mutations invalidate cache. 9router needs writes/recovery/reset/reopen/health/coverage boundaries to be covered; price/spend cache cannot replace independent persisted unhealthy proof or authorization. Stale grants are unsafe.

Options:
- Existing exact indexed reads: smallest and safe; assumes moderate per-key window history. First pressure point is row transfer/sum and repeated pricing parsing.
- Revision-bound pricing memo + optional derived spend cache: recommended direction; assumes complete mutation invalidation and single writer. First failure is missed revision/health/recovery invalidation; evict/rebuild safely, don't treat TTL as budget authority. Bound cache memory and avoid full-ledger rebuild in every request.
- Source-style delayed spend batch: fewer write transactions; assumes crash-loss window acceptable. First failure is killed process before flush; incompatible with accepted contract. Not adopted without explicit scope decision.

Better approach found for repeated reads: source's version-invalidated parsed pricing memo demonstrates a concrete way to avoid repeated SQL/JSON work; adapt that idea to immutable validated snapshots with independent pricing revision, rather than tying price invalidation to every unrelated model/catalog mutation. Cost of switching: cache seam + mutation/reopen/health tests, not new DB/migration. This improves expected computation, not measured throughput.

## Recommendation

OmniRoute has real performance optimizations, especially pricing caches and batched writes. It is not uniformly optimal: spend still aggregates rows, pending buffer scan and alias lookup scan remain, and the write speed partly comes from a weaker/best-effort durability contract. No matched benchmark supports saying OmniRoute is faster overall.

For 9router: learn pricing memo/invalidation and short write transactions; preserve exact original-price durable ledger and safety. Benchmark first before adding derived spend cache. Do not copy batchWriter into monetary enforcement. A cache/implementation proposal remains advisory, not accepted or executed; source outcome doesn't authorize reopening completed foundations.

Risk of wholesale port: high (crash durability, exact money, historical repricing, failure permissions, windows/provider policy). Risk of scoped pricing memo adaptation: limited surface but needs verified invalidation. No file-count/ETA asserted before concrete implementation plan.

## Acceptance and limitations

No tests/builds/source scripts/live catalog called; static mechanism inspection only, no live socket/full provider/security certification. Source tests describe intentions, not this session's passes. Repomix unavailable and pricingSync only searched: not exhaustive two-catalog implementation audit.

Future performance acceptance: same owned fixture/load, p50/p95/p99 accounting overhead, event-loop delay, throughput, price-map sizes and attempts/key/window; native vs SQL.js, cold/restart and warm separately. Correctness controls for exact money, EOF/ACK, original prices, recovery/reset/duplicate/abort, unhealthy failure and no secrets/SSRF weakening remain mandatory. No chosen latency target or maximum workload assumed. Contract/prod OFF unchanged.
