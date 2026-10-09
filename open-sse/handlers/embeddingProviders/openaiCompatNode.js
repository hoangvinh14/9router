// Custom node providers (openai-compatible-* / custom-embedding-*) — baseUrl from credentials
import createOpenAIEmbeddingAdapter from "./openai.js";

const baseAdapter = createOpenAIEmbeddingAdapter("openai");

export default {
  ...baseAdapter,
  accountingSchema: null, // Custom endpoint has no trusted usage contract yet.
  buildUrl: (_model, creds) => {
    const rawBaseUrl = creds?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
    const baseUrl = rawBaseUrl.replace(/\/$/, "").replace(/\/embeddings$/, "");
    return `${baseUrl}/embeddings`;
  },
};
