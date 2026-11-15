# M1 — Selected-path inventory, 2026-11-01

## Provenance và cách đọc

- Source: `develop`, HEAD `08ee1a74954c5fe7a1659a6473e57b6b1ea9059b` (`merge: sync master into develop`). Existing dirty plans/build artifacts không bị reset. Đây là source inventory, **không phải baseline/runtime acceptance**.
- Source paths bên dưới tính từ repo root `/home/gmo/projects/9router`; line anchors là snapshot, symbol/path mới là identity. Không import application modules để lấy context, không đọc `.env`, credentials, DB thật hoặc usage logs.
- [D1–D4 user decisions](./m1-decisions.md) là authority. `selected` nghĩa là intended child scope, không `supported` đã accepted. Không có Codex/Claude accounting positive runtime receipt mới trong lượt này.
- P1–P4/B1/R1/E1 receipts chỉ reusable có điều kiện theo input/revision hashes. Không cộng test count cũ thành evidence trên merged HEAD.

## Actual entry → producer map

| ID / disposition | Ingress → transform → actual producer | Auth / raw / owner / prerequisite |
|---|---|---|
| R2-S1 / **SELECTED, pending** | `src/app/api/v1/{responses,chat/completions}/route.js → src/sse/handlers/chat.js:handleChat → handleSingleModelChat → open-sse/handlers/chatCore.js:handleChatCore → executors/index.js:getExecutor('codex') → CodexExecutor.execute → BaseExecutor.execute → utils/proxyFetch.js:proxyAwareFetch`; registry URL `https://chatgpt.com/backend-api/codex/responses` | `codex`/`cx`, OAuth access token + workspace/account identity; force upstream SSE, client JSON/SSE. Canonical raw owner R2-S1 before peek/translation; X5 refresh/retry/transport seams owned in same child, no second X4 debit. Exact schema gate below. |
| R2-L / **DEFERRED child đầu** | Same executor; `responsesLite` registry flag + tool content choose Lite header, `additional_tools` input prefix, `reasoning.context=all_turns`; hosted search can switch Lite label back to standard transport shape | Not equivalent to R2-S1 by model label. Reject as Lite **before** hosted-search transform could reclassify it. Later child needs independent effective-wire/schema/disposition. |
| R2-C / **DEFERRED child đầu** | `/v1/responses/compact` route creates new `Request`, adds `_compact`; Codex `buildUrl` reads `_isCompact` | New Request has no explicit original signal or WeakMap transfer in route; need actual route no-bypass control. Base builds URL before `transformRequest` sets `_isCompact`, so stale-state/order risk is source-backed; actual concurrent defect not reproduced here. Reject compact before reconstruction/dispatch in controlled entry, preserve ordinary behavior. |
| R2-V / **DEFERRED child đầu** | Review/upstream-ID mappings, `[1m]` marker strip in app handler, reasoning suffix normalization, `service_tier fast→priority`, auto review | Admission must retain original variant intent before stripping; exact reference model identity may differ from wire ID. No suffix-price inference. Core standard reasoning settings are separate from review/1M/fast variants. |
| X2-A / **REQUIRED M1 FOLLOW-UP** | `/v1/messages` (also convertible Chat/Responses) → same app/core → `DefaultExecutor('anthropic') → Base → proxyAwareFetch` → `https://api.anthropic.com/v1/messages` | Registry `anthropic` API key (`x-api-key`), default version/beta + client beta merge. New raw Messages JSON/SSE owner required; current OpenAI usage owner cannot certify it. |
| X2-O / **REQUIRED M1 FOLLOW-UP** | Same ingress → `DefaultExecutor('claude') → Base → proxyAwareFetch` → `https://api.anthropic.com/v1/messages?beta=true` | Registry `claude`/`cc`: API-key/OAuth split auth capability, but selected subscription path specifically access-token OAuth. Beta selection, Claude session metadata, cloaking/history/thinking/signatures need independent positive evidence; token refresh is not inference debit. |
| X2-compatible / **DEFERRED, not implied** | Dynamic `anthropic-compatible-*`, GitHub Messages, Bedrock/resellers route through other identity/transport/auth | Not selected merely because model starts `claude-`. Even official-host compatible node is not auto-included without persisted identity/transport proof. Ordinary routing remains available. |
| C1 / **SELECTED only Chat→Codex Responses** | `chatCore` detect source format → direct/pivot translator → Responses producer → forced SSE converter or stream translation | Actual POST owner remains R2-S1, no ingress-side debit. Claude-format ingress→Codex or Responses→upstream Chat not accepted by this child; reject for budget-controlled requests. |
| X6 / **DEFERRED child đầu by D4** | `chat.js` combo/smart/Fusion/capacity dispatch → `combo.js`; `src/sse/services/systemoneRouter.js` calls `handleSystemoneCore` independently | D1 admission before any callback, router/classifier/judge/panel POST. Even all-Codex combo is unsupported composition in child đầu. Ordinary combo/Fusion behavior unchanged. |

## Codex model/feature classes from current registry

Source `open-sse/providers/registry/codex.js`, `config/providerModels.js`, executor `getModelUpstreamId`/`isCodexResponsesLiteModel`. Inventory is finite at this revision; new entries default unsupported for this child until manifest review.

| Class | Entries / first-child disposition |
|---|---|
| Core standard candidates | `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-daybreak-blue-latest`, `gpt-reserve`. Phase 1 freezes each as eligible or BLOCKED by named schema/price/dispatch evidence. No blanket acceptance from one model. Model without exact price cannot run even if parser works. |
| Lite | `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-sol`, `gpt-6-luna`; `[1m]` variants compound the distinction. Deferred. |
| Extended/review | Registry `[1m]`, `*-review`, `codex-auto-review`; deferred before app strips/mutates markers. |
| image/STT | Registry `kind:image`, `transcribe` and dedicated `handlers/imageProviders/codex.js` / `codexStt*.js`; standalone modalities outside M1 accounting delivery, no support from LLM child. Do not modify dedicated endpoints in this child; R activation must inventory their policy boundaries rather than imply gateway-wide enforcement. |
| Functions | Client function tools/calls/results selected; no executing client code. `custom_tool_call` / hosted MCP/search/code/image tools are not implicitly function tools. |
| Reasoning/history | Standard `reasoning.effort/summary`, injected `include:[reasoning.encrypted_content]`, encrypted reasoning items and continuation IDs need explicit effective request profile; preserve payload, never count/price encrypted bytes. |
| Premium/media | `service_tier`, image/audio/file input, remote resource prefetch, hosted search injection (`_autoCodexWebSearch`) deferred; validate before transforms can fetch or strip fields. |

## Named shared prerequisites and source findings

| ID | Evidence at source snapshot | Required action / ownership |
|---|---|---|
| A1 persisted identity/eligibility | `src/lib/accounting/persisted-chat-authority.js:assertAgainst` only permits dynamic `openai-compatible-*`; `chat-accounting.js:bind/prepare` uses dynamic baseUrl and OpenAI/Responses profiles | Extend with narrow provider-specific policy, not delete allowlist globally. R2-S1 owns Codex branch; preserve R1/E1 and key ACL/identity. |
| A2 activation boundary | `chat-accounting.js:16–28` WeakMap fixture association only; no production callsite automatically attaches | Private entry/route fixture must associate before guard/reconstruction. Missing association is ordinary runtime today, not budget certification. Production activation remains separate R gate; do not make fixture auto-activate real keys. |
| A3 exact refresh transition | `src/sse/services/tokenRefresh.js:167–215` persists credentials and returns bool; proactive refresh awaits return but doesn't check success. `chatCore.js:449–496` refresh callback catches failures and reuses accounting binding | Add exact request-owned before/after persisted transition acknowledgment for selected path, including proactive adoption and reactive 401/403. Lost/false/throw ACK forbids successor. No broad re-snapshot/accept arbitrary revision. Concurrent token rotation requires proven latest credentials or safe refusal, not duplicate refresh of consumed token. |
| A4 multiple retry layers | Base HTTP/network/URL retry; Codex `execute` calls Base repeatedly after `_peekSseTransientError`, sometimes replaces 200 SSE with 503; app account fallback follows core | One ticket per actual inference POST, predecessor terminal own ACK before successor, preserve native/provider outcomes. Valid failed usage settles, not lost in peek/error translation. Auth HTTP calls counted separately as zero inference POST, not fake ledger attempts. |
| A5 effective wire mismatch | R1 `accountingProfiles.js`/`assertResponsesRequest` don't accept `include`, encrypted reasoning input, Lite prefix, service tiers; Codex injects/mutates fields | Introduce named Codex standard contract; separate client input from trusted transformed wire. No blind shared-R1 relaxation. Unknown priced category not silently ignored. |
| A6 executor lifetime/order | `executors/index.js:49` singleton Codex; `_currentSessionId`/`_isCompact`; Base `buildUrl` before transform; async image prefetch/retry can interleave | Characterize cross-session/two-key and standard/ordinary-compact overlap with deterministic barriers. Any required fix narrow to request-local state; no concurrency defect claimed as reproduced in this inventory. |
| A7 graph admission | `chat.js` authorization before bypass/combo; `systemoneRouter.js` has own inference core call; capacity adapter can add candidates | D1 graph/source-composition preflight before any helper or inference; revalidate immutable target/transport before POST. Child rejects combo and expanded graphs, not silently filter. |
| A8 signal/late lifetime | Core combines accounting signal with stream controller; compact reconstructs Request; `handleChat` disposes session in finally while streams can outlive return | Preserve retained per-attempt terminal sink after request disposal; successor permission dies on cancellation, valid late usage retains original key/price/startedAt. Tests must await owned cleanup without draining unseen future network forever. |
| A9 price identity | `catalogMapping.js` maps Codex→OpenAI and Claude→Anthropic as virtual; `referenceResolver.js` requires exact model, complete rates, source precedence; service uses `candidate.endpoint='chat'` | Reuse endpoint pricing identity `chat` for LLM, not introduce `responses` price namespace. Record logical/wire/reference identity explicitly; no suffix-price fallback. Label reference cost vs subscription bill. |
| A10 transport/security | `proxyFetch.js`, `accounting-transport.js` provide actual exposure; provider/user overrides and saved proxies influence effective headers/target | Codex first-child supported set: direct and existing saved strict HTTP CONNECT proxy under original authority; env/global/relay/SOCKS/custom override composition refused if not proven. No global transport rewrite; no redirects/replay or credential leakage. |

## Raw usage/units authority — what is and is not known

Public targeted reads on 2026-11-01 (no private URLs/credentials). 9router search default was unavailable; direct official URL reads used instead.

1. [OpenAI Responses reference](https://developers.openai.com/api/reference/resources/responses/) and [streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events): Responses usage, terminal `response.completed/failed/incomplete`, reasoning encrypted continuation, service-tier distinction. These describe API Responses, **not by themselves the internal ChatGPT Codex subscription contract**.
2. [Official Codex SSE parser pinned at `7656a23b8d404447f6eb0b4b947f45e5e139e49e`](https://github.com/openai/codex/blob/7656a23b8d404447f6eb0b4b947f45e5e139e49e/codex-rs/codex-api/src/sse/responses.rs): `ResponseCompletedUsage` has `input_tokens`, `output_tokens`, `total_tokens`, optional input/output details; cached/reasoning counts; **optional `cache_write_tokens` and `codex_rollout_budget_units`**; completed/incomplete handling and response.failed path. This is consumer schema evidence, not a guarantee every selected model emits every field or a monetary tariff for new fields.
3. [Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): distinct cache-read/write/TTL economics. Read only to flag X2 cache tiers; no prices copied into runtime, no Claude subscription billing inference.

**Hard gate G0 before runtime implementation:** freeze source-backed Codex standard contract and sanitized fixture provenance for admitted models, including inclusion/subset semantics for cached/reasoning/**cache-write** tokens and disposition of rollout units. Existing R1 assumes cacheWrite=0 and strict fields; it cannot be reused unchanged merely because shape is Responses. Do not adopt SDK zero defaults as measured counters, drop a present category, or infer new units are free. If authority remains insufficient, stop with exact field/model blocker, do not generate a green synthetic fixture and declare support. Synthetic wire fixtures validate our implementation after contract selection, not establish the provider contract. HTTP failed usage and 200 SSE error formats need exact examples/provenance too.

## Reuse/evidence disposition

| Asset | Reuse allowed | Not proven here |
|---|---|---|
| P1 snapshot/exact-money; P2 ledger/coordinator; P4/B1 budgets | Shared implementation and semantic invariants, impacted tests rerun through isolated runner | Current merged revision runtime pass or Codex coverage |
| R1 raw Responses framer/stream/late sink | Structural reuse after profile/terminal/output and ownership review | Codex cache-write/rollout/refresh or subclass peek compatibility |
| R1 actual loopback fixture | Pattern for dummy sockets, held ACK, two keys, Node/SQL.js and cleanup | Registry Codex routing: current fixture inserts dynamic API-key node |
| Existing Codex tests | Affected transform/model/tier/refresh/identity contracts | Accounting actual loopback, durable ACK or exact internal price authority |
| R1/E1 final receipt counts | Historical scoped evidence only | No new pass count imported into M1 |

## G0 research follow-up — 2026-11-01

[Codex standard contract evidence](../../261101-0716-m1-codex-standard-accounting/references/codex-standard-contract.md) ghi semantic findings và finite6model manifest. Research complete; G0 partial: cache partition/reference-token valuation/reasoning inclusion và rollout-session budget role đã được làm rõ. Rollout units không cần USD conversion và không thêm money term theo D2. Còn B01 omitted/detail counters + internal cache applicability, B02 recognized failure envelopes/B1 classification, B03 per-model/effective-profile provenance; Daybreak/Reserve B04 exact reference price conditional. Không model nào được certify eligible/provider accepted từ lượt này.

Bounded profile/unknown-vs-zero plumbing technically designable mà chưa đóng production eligibility, nhưng existing plan G0 runtime lock/research-only authorization vẫn giữ; muốn code trước whole-G0 cần explicit scope/authorization, không tự nới gate. No actual bill/TTL tier mapping hoặc default0 inference.

## Readiness disposition

Inventory/design may proceed; D1–D4 resolved by user. [One detailed R2-S1 child](../../261101-0716-m1-codex-standard-accounting/plan.md) is prepared, with G0 and finite preflight. Whole-child cook remains **conditional on G0 and separate implementation authorization**. Claude cache/beta/tools/auth contracts need their own child inventory freeze; R/M1 child not yet hydrated. Platform/release/security/build/performance/legacy-presentation and historical data-access uncertainties stay OPEN. No production enable, deploy, real DB test, whole-M1 or all-provider acceptance follows.
