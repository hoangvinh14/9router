export const ACCOUNTING_GEMINI_MESSAGE_FIELDS = Object.freeze(['candidates', 'usageMetadata', 'modelVersion', 'responseId', 'promptFeedback']);
export const ACCOUNTING_GEMINI_CANDIDATE_FIELDS = Object.freeze(['content', 'finishReason', 'index', 'safetyRatings', 'avgLogprobs', 'tokenCount']);
export const ACCOUNTING_GEMINI_USAGE_FIELDS = Object.freeze(['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount', 'toolUsePromptTokenCount', 'promptTokensDetails', 'cacheTokensDetails', 'candidatesTokensDetails', 'toolUsePromptTokensDetails', 'serviceTier']);
export const ACCOUNTING_GEMINI_FINISH = Object.freeze(['STOP', 'MAX_TOKENS']);
export const ACCOUNTING_GEMINI_TEXT_MODALITY = 'TEXT';

// Text embedContent/batchEmbedContents response shapes. Tensor `shape` is not
// the public float-vector response accepted by this accounting prerequisite.
export const ACCOUNTING_GEMINI_EMBED_SINGLE_FIELDS = Object.freeze(['embedding', 'usageMetadata']);
export const ACCOUNTING_GEMINI_EMBED_BATCH_FIELDS = Object.freeze(['embeddings', 'usageMetadata']);
export const ACCOUNTING_GEMINI_EMBED_VECTOR_FIELDS = Object.freeze(['values']);
export const ACCOUNTING_GEMINI_EMBED_INSPECTION_FIELDS = Object.freeze(['inputCount', 'batch', 'dimensions']);
