---
title: "Phase 2: Reference pricing và catalog sync"
status: in-progress
priority: P1
effort: 12h
depends_on: [1]
---

# Phase 2: Reference pricing và catalog sync

> **Technical reference, không phải backlog song song.** [Roadmap Gói A–E](./plan.md#current-delivery-roadmap) là execution authority: pricing thuộc A; owner integration thuộc B; full acceptance thuộc E. Checklists/checkpoints bên dưới giữ requirements/historical evidence, không current task state. Reuse valid implementation và gates; không chase live catalog green.

<!-- Updated: Validation Session 1 - preserve numeric price-map API, exact ingress và changed-only override consumer -->

## Outcome

Resolver trả snapshot có provenance, distinguish explicit zero/unknown. Sync pricing-only models.dev giữ overrides và last-known-good. Đọc [design contract](./design-contract.md), không copy catalog/capability pipeline OmniRoute.

## Approved pricing-cache addition — Gói A

[I/O/cache design](./reports/io-group-commit-cache-design.md): memo bounded validated immutable snapshots theo committed pricing/mapping revision/provider/model/endpoint, publish/invalidate sau durable writes và reopen/health changes; no inference fetch/repeated unchanged catalog parse/hash. Cache token rates preserve zero và documented fallback; không fuzzy-map hoặc claim upstream invoice match. Group commit không đổi per-attempt rounding. Đây là remaining implementation/verification, không approval live catalog.

## Current delivery state — implementation khác acceptance

Inactive resolver/snapshot, bounded strict ingress, precedence/mapping/coverage, sync scheduler default-OFF và editor có code/focused evidence. Raw exact usage helper chưa là production dispatch certificate. Live models.dev vẫn degraded do69 overprecision lexemes; không rounding/pruning/repeat-fetch để xanh. Dùng valid approved bundled/manual snapshots trong integrated tests, xử lý unsupported trước dispatch theo contract. Remaining consumer/provider coverage là gate cho Phase04; không restart pricing/editor hoặc chờ live sync xanh mới làm routing. [Current roadmap](./plan.md#current-delivery-roadmap) supersedes stale pending descriptions; toàn phase chưa accepted.

## File ownership

Tất cả path repo dưới `/home/gmo/projects/9router/`; file mới là proposed.

| Action | Path từ repo root | Nội dung |
|---|---|---|
| Modify | `src/lib/db/repos/pricingRepo.js` | Manual > synced > bundled; typed resolution snapshot; invalidate cache mọi price mutations. |
| Create | `src/lib/pricing/catalogSync.js` | Fixed-source fetch/staging/atomic catalog kv namespace, health, single-flight. |
| Create | `src/lib/pricing/catalogMapping.js` | Explicit provider/model mappings + revision, OAuth virtual references, coverage report. |
| Create | `src/lib/pricing/money.js` | Decimal/BigInt nanoUSD math, range/rounding validators. |
| Modify | `open-sse/providers/pricing.js` | Separate resolver provenance, fix explicit-zero fallbacks; preserve legacy exported signatures. |
| Modify | `open-sse/utils/usageTracking.js` | Exact canonical usage/inclusion semantics; preserve estimation/client behavior. |
| Create | `tests/fixtures/pricing/models-dev-minimal.json` | Sanitized approved fixture, invalid/tier/currency/free cases; no secrets. |
| Create | `tests/unit/pricing-catalog-sync.test.js` | Sync validation, offline/SSRF, mapping/precedence tests. |
| Create | `tests/unit/api-key-money.test.js` | Decimal math/cache/reasoning/overflow/rounding tests. |

## Requirements và steps

- [x] Reinspect models.dev provider cost fields and upstream units docs. Record USD/1M evidence URL; a successful JSON read alone is not proof all prices valid. Save minimal fixture, no giant live catalog in repo. Evidence: [pricing report](./reports/pricing-evidence.md), upstream README/schema and sanitized fixture.
- [ ] Produce coverage matrix against current gateway providerModels/aliases: direct providers, Claude OAuth, Codex, Gemini, reseller, compatible nodes, embeddings, confirmed free. Unmapped entries require manual override or explicit bundled mapping; never infer reseller price from model suffix.
- [x] Implement validated decimal-string rate -> BigInt/rational calculation. NanoUSD output round-half-up once per attempt; validate bounded token counts and safe storage conversion. Use nullish checks for zero, not truthiness. Price fields missing/null invalid, not free. Evidence: `api-key-money.test.js` seven passing cases in `/tmp/9router-price-repairs-results.json`.
- [ ] Normalize raw provider exact usage before translation/buffer. Prompt cache-inclusive; subtract cached-read/write subsets. Reasoning inclusion marked by provider schema; charge subset once, extras once. Existing canonicalization API remains compatible; estimated usage never exact.
- [ ] Preserve legacy numeric map `getPricing()/GET/PATCH/DELETE /api/pricing` cho consumers pricing page + PricingModal; enforcement resolver/snapshot riêng, metadata qua sync/status không pollute provider map. Snapshot validate decimal lexical representation tại ingress; legacy finite/bounded numbers convert sang decimal trước BigInt, không dùng Number multiplication cho debit. Phase 05 sửa modal changed-only overrides/inherit; untouched save no-op, zero khác missing.
- [ ] Resolver selects complete rate object from highest valid source, not uncontrolled field merge. Snapshot rates/unit/currency/source/hash/mapping/timestamp + documented cache/reasoning fallback. Unsupported tiers/currencies/units demand explicit flat virtual override for budgeted use.
- [ ] Synced catalog stored in separate kv scopes, atomic revision swap after bounded schema validation. Keep manual reset/reset-all scoped to overrides; catalog clear does not delete budget history. Enforced resolution refuses unsupported pattern guesses even if legacy analytics has pattern fallback.
- [ ] Fetch fixed `https://models.dev/api.json`, HTTPS host/path allowlist, redirect reject, timeout 15s, <=20MiB decompressed, bounded depth/entries, reject prototype keys/nonfinite/negative rates. Invalid batch retains last-known-good; validate scheduled/manual sync uses same service.
- [ ] Prepare optional 24h scheduler default off and manual callable sync; wire admin endpoints in phase 05. No fetch on inference request. Sync state stores failures without credentials/catalog injection strings in unsafe output.

## Historical implementation evidence (current state above supersedes pending claims)

Inactive pricing modules implemented; latest seven-file focused run51passed/0failed and scoped lintclean. Raw exact usage is isolated in `open-sse/utils/exactUsage.js` (existing client estimation/canonicalization untouched), not yet integrated at dispatch/terminal boundaries. Mapping/security/legacy-map repair tests pass at that revision; later @cf/tilde ID fixture and live coverage audit still pending. Phase remains open: complete runtime catalog/mapping coverage, all required snapshot semantics, real PATCH/DELETE decimal ingress, scheduler management and UI wiring still need evidence. No ledger activation or budgeted inference advertised. See [pricing evidence](./reports/pricing-evidence.md).

## Source validation notes

Planning date 2026-10-03: browser-grade GET api.json returns provider/model JSON with `cost.input/output/cache_read`; Python urllib gets 403. Runtime sync HTTP compatibility remains a phase gate, not an assumption. First-party units/coverage still need fixture-based verification; if endpoint inaccessible, ship offline bundled/override functionality with sync marked degraded, not replace source or silently use arbitrary URLs.

## Verification gate

```bash
(cd tests && npx vitest run unit/pricing-catalog-sync.test.js unit/api-key-money.test.js unit/provider-pricing-minimax-m3.test.js unit/cached-token-usage.test.js unit/extract-usage-cache-shapes.test.js unit/openai-responses-usage-pivot.test.js)
npx eslint src/lib/pricing src/lib/db/repos/pricingRepo.js open-sse/providers/pricing.js open-sse/utils/usageTracking.js
```

New tests 0 failures; reference fixture cases independent of live source. Cover price zero for cache/reasoning, unknown != zero, sync stale/failure, overrides unchanged, provider alias/reseller mismatch, rejected redirects/private destinations and oversized compressed response. Historical settled cost stays identical after sync/override changes. Contract fixtures preserve legacy numeric map consumers và optional cache/reasoning missing vs zero; new snapshot resolver không silently change exported signature.

## Security, risks và stop condition

Catalog là untrusted data; không thực thi code/URLs trong payload. Read `open-sse/AGENTS.md` trước source edits. Legacy broad pattern resolution can stay for compatibility analytics but budget path needs explicit approved mappings. Stop nếu exact token inclusion or rate units chưa chứng minh được; expose unsupported, không auto-charge unknown as free. Không thêm nguồn thứ hai để bù một test thất bại.
