# Pricing coverage — captured, unvalidated inventory

**NOT an active catalog or validated live price matrix.** The complete captured batch is rejected: 69 original rate lexemes exceed the accepted nine-decimal rate precision. No rounding, pruning, sync publication, or change to the monetary contract.

- Source: `https://models.dev/api.json`; capture file mtime `2026-10-03T11:45:57.366Z` (not independently attested HTTP time).
- SHA-256: `0c8a1d4e6374b5a5765c76da38aa5d32fdbd3200a53ba28ea2b3a82ac490aa7b`; 5311759 bytes, 226 source providers, 8385 source models.
- Mapping: `reference-mapping-v1`; audited `2026-10-04T02:49:33.600Z`.
- Reproduce: `node scripts/pricing-coverage-inventory.mjs /tmp/9router-models-dev.json /tmp/9router-pricing-coverage-inventory.json`.
- Detailed model rows/original invalid literals: `/tmp/9router-pricing-coverage-inventory.json` (machine-local, may need restored public capture). No DB/secrets read.

## Inventory summary

Registry chat/embedding rows: 821; 82 mapped entries with unvalidated cost present, 1 with absent cost, 738 missing/unmapped. Exact offline provider references: 22; explicit canonical virtual references: 47; 752 require manual reference under current mappings. Offline presence is not full token-semantic validation. Registry rows are not unique global model identities.

## Per-provider matrix

Mapped = exact provider mapping, not successful pricing validation. Cost-present = cached raw presence only, never usable synced pricing while whole batch fails. Offline = exact provider/approved canonical bundled source presence, not model-name guesses. Embeddings = registry-declared kind/type.

| Provider | Alias | Chat/embedding rows | Mapped | Cost present (unvalidated) | Offline reference present | Embeddings |
|---|---|---:|---:|---:|---:|---:|
| alicode-intl | alicode-intl | 7 | 0 | 0 | 0 | 0 |
| alicode | alicode | 8 | 0 | 0 | 0 | 0 |
| anthropic | anthropic | 3 | 3 | 0 | 3 | 0 |
| antigravity | ag | 20 | 0 | 0 | 0 | 0 |
| blackbox | blackbox | 10 | 0 | 0 | 0 | 0 |
| byteplus | byteplus | 7 | 0 | 0 | 0 | 0 |
| cerebras | cerebras | 6 | 0 | 0 | 0 | 0 |
| claude | cc | 7 | 7 | 7 | 4 | 0 |
| cline | cl | 8 | 0 | 0 | 0 | 0 |
| clinepass | clinepass | 10 | 0 | 0 | 0 | 0 |
| cloudflare-ai | cloudflare-ai | 13 | 0 | 0 | 0 | 0 |
| codebuddy-cn | cbcn | 13 | 0 | 0 | 0 | 0 |
| codex | cx | 21 | 21 | 9 | 7 | 0 |
| cohere | cohere | 3 | 3 | 3 | 0 | 0 |
| commandcode | commandcode | 22 | 0 | 0 | 0 | 0 |
| cursor | cu | 14 | 0 | 0 | 0 | 0 |
| deepseek | deepseek | 8 | 8 | 3 | 5 | 0 |
| featherless | featherless | 7 | 0 | 0 | 0 | 0 |
| fireworks | fireworks | 4 | 4 | 0 | 0 | 1 |
| gemini-cli | gc | 7 | 7 | 6 | 5 | 0 |
| gemini | gemini | 16 | 16 | 11 | 8 | 5 |
| github | gh | 19 | 19 | 6 | 1 | 2 |
| glm-cn | glm-cn | 10 | 0 | 0 | 0 | 0 |
| glm | glm | 8 | 0 | 0 | 0 | 0 |
| grok-cli | gcli | 5 | 0 | 0 | 0 | 0 |
| grok-web | grok-web | 12 | 0 | 0 | 0 | 0 |
| groq | groq | 4 | 4 | 2 | 0 | 0 |
| hyperbolic | hyperbolic | 8 | 0 | 0 | 0 | 0 |
| iflow | if | 15 | 0 | 0 | 0 | 0 |
| kilocode | kc | 8 | 0 | 0 | 0 | 0 |
| kimchi | kimchi | 8 | 0 | 0 | 0 | 0 |
| kimi | kimi | 10 | 0 | 0 | 0 | 0 |
| kiro | kr | 48 | 0 | 0 | 0 | 0 |
| mimo-free | mmf | 1 | 0 | 0 | 0 | 0 |
| minimax-cn | minimax-cn | 4 | 0 | 0 | 0 | 0 |
| minimax | minimax | 4 | 4 | 4 | 4 | 0 |
| mistral | mistral | 4 | 4 | 4 | 0 | 1 |
| mmf | mmf | 1 | 0 | 0 | 0 | 0 |
| nebius | nebius | 2 | 0 | 0 | 0 | 1 |
| nvidia | nvidia | 8 | 0 | 0 | 0 | 1 |
| ollama | ollama | 8 | 0 | 0 | 0 | 0 |
| qoder-cn | qdcn | 16 | 0 | 0 | 0 | 0 |
| openai | openai | 24 | 24 | 23 | 10 | 3 |
| opencode-go | opencode-go | 42 | 0 | 0 | 0 | 0 |
| opencode-zen | ocz | 72 | 0 | 0 | 0 | 0 |
| opencode | oc | 3 | 0 | 0 | 0 | 0 |
| openrouter | openrouter | 7 | 7 | 0 | 0 | 7 |
| perplexity-web | perplexity-web | 7 | 0 | 0 | 0 | 0 |
| perplexity | perplexity | 2 | 0 | 0 | 0 | 0 |
| perplexity-agent | perplexity-agent | 11 | 0 | 0 | 0 | 0 |
| qoder | qd | 16 | 0 | 0 | 0 | 0 |
| siliconflow | siliconflow | 16 | 0 | 0 | 0 | 0 |
| together | together | 6 | 6 | 2 | 0 | 2 |
| venice | venice | 12 | 0 | 0 | 0 | 3 |
| vertex-partner | vertex-partner | 4 | 0 | 0 | 0 | 0 |
| vertex | vertex | 4 | 0 | 0 | 0 | 0 |
| volcengine-ark | volcengine-ark | 9 | 0 | 0 | 0 | 0 |
| voyage-ai | voyage-ai | 7 | 0 | 0 | 0 | 7 |
| xai | xai | 6 | 6 | 2 | 1 | 0 |
| xiaomi-mimo | xiaomi-mimo | 7 | 0 | 0 | 0 | 0 |
| xiaomi-tokenplan | xiaomi-tokenplan | 9 | 0 | 0 | 0 | 0 |
| alims-intl | alims-intl | 7 | 0 | 0 | 0 | 0 |
| codebuddy-intl | cbai | 15 | 0 | 0 | 0 | 0 |
| api-airforce | af | 3 | 0 | 0 | 0 | 0 |
| baidu | qianfan | 7 | 0 | 0 | 0 | 0 |
| bazaarlink | bzl | 24 | 0 | 0 | 0 | 0 |
| bluesminds | bm | 14 | 0 | 0 | 0 | 0 |
| kilo-gateway | kgw | 6 | 0 | 0 | 0 | 0 |
| llm7 | llm7 | 5 | 0 | 0 | 0 | 0 |
| sambanova | samba | 1 | 0 | 0 | 0 | 0 |
| tencent | hunyuan | 2 | 0 | 0 | 0 | 0 |
| morph | morph | 6 | 0 | 0 | 0 | 0 |
| poolside | poolside | 2 | 0 | 0 | 0 | 0 |
| tokenrouter | tokenrouter | 22 | 0 | 0 | 21 | 0 |
| selfhosted-embedding | selfhosted-embedding | 1 | 0 | 0 | 0 | 1 |
| alitp-intl | alitp-intl | 6 | 0 | 0 | 0 | 0 |
| tokenharbor | tokenharbor | 6 | 0 | 0 | 0 | 0 |
| dahl | dahl | 3 | 0 | 0 | 0 | 0 |
| atria | atria | 1 | 0 | 0 | 0 | 0 |
| agnes | agnes | 4 | 0 | 0 | 0 | 0 |
| muse | muse | 5 | 0 | 0 | 0 | 0 |

## Dynamic and special namespaces

- Claude OAuth, Codex, Gemini CLI, GitHub: exact reference mappings only, explicitly virtual. No suffix/version normalization or subscription-invoice claim.
- Resellers/custom OpenAI-/Anthropic-compatible nodes, dynamic alias targets: per-instance manual override or separately approved exact mapping required; never inherit vendor/model suffix prices. Client aliases resolve to the actual dispatch candidate before snapshots.
- Confirmed legacy free namespace `cline-free/`: monetary resolver accepts only the approved Cline transport (`cline`/`cl`), not arbitrary nodes claiming that prefix; explicit zero rates still require complete sources. Current registry has no such free row. Legacy analytics matcher remains unchanged.
- Unknown cost is not zero. Non-flat tier/audio/context fields do not become automatic flat references. A complete explicit manual virtual override may supersede unsupported catalog entries.
- Embedding manual ingress may omit output only for registry-declared embedding models (stored output is documented zero because no output generation is priced). Unknown/dynamic models must submit a complete input/output source; enforcement snapshot endpoint independently controls scope.
- No model registration/capability update, source URL execution, live refetch, or enforcement activation occurred.

## Open gates

This inventory closes discovery, not source price validity or release coverage. Mapping/unit/raw-usage/route fixtures must establish each budget-enabled candidate. Phase02/04 release acceptance remains open; scheduler startup/admin wiring and pricing UI changed-only/inherit flows remain pending.
