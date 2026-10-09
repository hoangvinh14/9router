export const ACCOUNTING_GEMINI_MESSAGE_FIELDS = Object.freeze(['candidates', 'usageMetadata', 'modelVersion', 'responseId', 'promptFeedback']);
export const ACCOUNTING_GEMINI_CANDIDATE_FIELDS = Object.freeze(['content', 'finishReason', 'index', 'safetyRatings', 'avgLogprobs', 'tokenCount']);
export const ACCOUNTING_GEMINI_USAGE_FIELDS = Object.freeze(['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount', 'toolUsePromptTokenCount', 'promptTokensDetails', 'cacheTokensDetails', 'candidatesTokensDetails', 'toolUsePromptTokensDetails', 'serviceTier']);
export const ACCOUNTING_GEMINI_FINISH = Object.freeze(['STOP', 'MAX_TOKENS']);
export const ACCOUNTING_GEMINI_TEXT_MODALITY = 'TEXT';
