# Continued B delivery — source comparison and bounded next slice

## Contract reused

Outcome: complete accepted package B/all13AC, provider/public-app obligations, then G→T→I→V. Constraints: direct execution, enforcement/public OFF; exact original/wire/native usage, original rates and durable own ACK; unchanged bytewise5s/hook10s/workers2 checks; no authority/result/frame cache, guessed charges or refusal-as-support. Non-goals: unrelated refactors, live DB/provider calls, release or C–E early activation. This continuation is not a smaller completion contract.

## Local source manifest

Read-only source: `/home/gmo/projects/OmniRoute`, commit `488f57e9d3fccc8d1741fdf21d35d5730b118a18` (branch output empty/detached). Alternative installed checkout `/home/gmo/projects/OmniRoute-langostino` commit `a58000c7685f4091c7a6fd8ddf3ebce7d2ec67c3` discovered; no data/dist/credentials read. OmniRoute LICENSE is MIT, copyright2026 diegosouzapw; attribution/license retention required if substantial code copied. No code copied, commands from that source executed, dependency installed or source instructions adopted.

Inspected quota `spendRecorder.ts`, `sqliteQuotaStore.ts`, usage `budgetGuard.ts`. These scoped modules use fire-and-forget `setImmediate`, swallowed recording errors, floating numeric budget/sliding-window counters and missing-price→zero behavior. They do not establish 9router's durable own-ACK, exact nanoUSD or per-byte owned-resource lifecycle contract. Their latency strategy is therefore **not transferable** to this accepted design. This is a scoped comparison, not a review of all OmniRoute accounting or security.

## Options compared

1. Cache/shared verification frame: low likely I/O but violates current independent fresh checks. **Rejected**, not viable under contract.
2. Fresh serialization/crypto/IO verification-core rewrite: retains source-of-truth reads, potentially fewer allocations. Assumption: expensive mechanics can be optimized without losing programmable-object/retired-binding/current-writer/sidecar checks. Fails first if gain remains too small or signed representations/restore semantics change. Existing filesystem/snapshot experiments did not meet pipeline objective; no cause-proven fourth implementation is justified now. Remains a design obligation, not waived.
3. Independent owned-resource control composition while throughput stays OPEN: reuse existing bounded video resolution grammar behind a new explicit private prerequisite grant; full original preserved, no usage/dispatch/default promotion. Assumption: existing pure resolution grammar matches the accepted original schema. Fails first at observed non-video MIME, malformed controls or grant laundering. Concrete tests can prove this prerequisite without pretending to close the remaining raw/private-capability/pricing/service/producer work.

Better approaches: none found in inspected OmniRoute for current strict accounting semantics. Keep the accepted 9router authority architecture; do not transplant fire-and-forget or fallback-zero accounting.

## Chosen next implementation slice

Proceed test-first with **owned-file video resolution original grammar** as the next independent accepted resource-composition prerequisite. Extend `supportsGeminiOwnedFilesOriginal` with a fifth independent strict Boolean `allowVideoResolution=false`; it must never confer videoMetadata, client, inline, processing or runtime ownership permission. Validate Part object and generation string via the existing `accountingGeminiVideoResolution.js`; only observed VIDEO inventory can justify local grammar projection. Preserve complete original and inventory; projection never becomes POST. No quantity inferred from resolution, FPS, bytes or metadata.

Acceptance for this finite prerequisite: source-local different video levels + generation control preserved; default/grant isolation; non-video/unknown/coercible control refusal before callback; descriptor/proxy/getter guards; callback sees only a local validated text view, no fake inline bytes. Existing owned-original and video-resolution originals remain regression scope. Raw/private grants/wire/service/actual producer and bytewise performance remain separate pending obligations. No new mode/public route or ledger schema activation in this slice.

Security: historical realDB acquisition incident remains unknown/no remediation/retrocertificate. Actual dummy test evidence cannot certify provider codecs, tenant isolation for arbitrary project IDs, external URL SSRF or production TLS/OAuth. All earlier failures retained.
