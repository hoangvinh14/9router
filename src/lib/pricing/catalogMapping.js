import REGISTRY from "../../../open-sse/providers/registry/index.js";

export const MAPPING_REVISION = "reference-mapping-v1";
// Approved provider identities. Exact model identity only; this never strips
// suffixes/vendor prefixes or maps arbitrary compatible-node names.
const SOURCE_PROVIDERS = Object.freeze({
  openai: "openai", anthropic: "anthropic", gemini: "google", deepseek: "deepseek",
  minimax: "minimax", openrouter: "openrouter", mistral: "mistral", cohere: "cohere",
  groq: "groq", xai: "xai", together: "togetherai", fireworks: "fireworks-ai",
  claude: "anthropic", codex: "openai", "gemini-cli": "google", github: "github-copilot",
});
const VIRTUAL_PROVIDERS = new Set(["claude", "codex", "gemini-cli", "github"]);
const providerLookup = new Map();
for (const provider of REGISTRY) {
  providerLookup.set(provider.id, provider);
  if (provider.alias) providerLookup.set(provider.alias, provider);
}
export function providerIdentity(provider) {
  return providerLookup.get(provider)?.id ?? provider;
}
export function mappedProviderReference(provider) {
  const id = providerIdentity(provider);
  const sourceProvider = Object.hasOwn(SOURCE_PROVIDERS, id) ? SOURCE_PROVIDERS[id] : null;
  return sourceProvider ? { provider: sourceProvider, virtual: VIRTUAL_PROVIDERS.has(id), revision: MAPPING_REVISION } : null;
}
export function mappedReference(provider, model) {
  const source = mappedProviderReference(provider);
  if (!source || typeof model !== "string") return null;
  return { ...source, model, canonicalModel: model };
}
// The legacy analytics namespace matcher is provider-agnostic. Monetary
// enforcement must not let a custom/reseller node claim another upstream's
// free namespace. Only the transport whose namespace evidence is documented.
export function isApprovedFreeReference(provider) {
  return providerIdentity(provider) === "cline";
}
export function knownCanonicalReference(provider, model) {
  const id = providerIdentity(provider);
  const entry = providerLookup.get(id);
  // Canonical fallback is approved only for exact known model IDs from these
  // first-party/reference transports; reseller/custom-node similarity is not evidence.
  if (!Object.hasOwn(SOURCE_PROVIDERS, id) || id === "openrouter" || id === "github" || !entry?.models?.some(m => m.id === model)) return null;
  return mappedReference(id, model);
}
export function pricingCoverage(catalog) {
  const rows = [];
  for (const provider of REGISTRY) {
    for (const model of provider.models || []) {
      if (!["llm", "embedding"].includes(model.kind || model.type || "llm")) continue;
      const mapping = mappedReference(provider.id, model.id);
      const entry = mapping && catalog?.entries?.[`${mapping.provider}/${mapping.model}`];
      rows.push({ provider: provider.id, model: model.id, mapped: Boolean(mapping), virtual: mapping?.virtual ?? false,
        catalogStatus: entry?.status ?? "unmapped_or_missing" });
    }
  }
  return rows;
}
