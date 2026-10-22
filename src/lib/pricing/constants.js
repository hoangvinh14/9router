// Reference price schema only: no accounting/admission or protocol-usage authority.
export const MAX_NANO_USD = 9_000_000_000_000_000n;
export const REFERENCE_ENDPOINTS = Object.freeze(["chat", "embeddings"]);
export const REFERENCE_RATE_FIELDS = Object.freeze([
  "input", "output", "cached", "reasoning", "cache_creation", "cache_creation_1h",
]);
export const TOOL_RATE_FIELDS = Object.freeze(["web_search_per_1000"]);
export const MODALITY_RATES = Object.freeze([
  ["input_image", "cached_image"], ["input_document", "cached_document"],
  ["input_audio", "cached_audio"], ["input_video", "cached_video"],
].map(pair => Object.freeze(pair)));
export const MODALITY_RATE_FIELDS = Object.freeze(MODALITY_RATES.flat());
export const PROCESSING_RATE_FIELDS = Object.freeze([
  "processing_tool_text", "processing_tool_image", "processing_tool_document",
  "processing_tool_audio", "processing_tool_video",
]);
export const EXTENDED_RATE_FIELDS = Object.freeze([
  ...TOOL_RATE_FIELDS, ...MODALITY_RATE_FIELDS, ...PROCESSING_RATE_FIELDS,
]);
export const ALL_RATE_FIELDS = Object.freeze([...REFERENCE_RATE_FIELDS, ...EXTENDED_RATE_FIELDS]);
export const RATE_UNITS = Object.freeze(Object.fromEntries([
  ...REFERENCE_RATE_FIELDS.map(field => [field, "USD/1M tokens"]),
  ...MODALITY_RATE_FIELDS.map(field => [field, "USD/1M tokens"]),
  ...PROCESSING_RATE_FIELDS.map(field => [field, "USD/1M tokens"]),
  ["web_search_per_1000", "USD/1000 uses"],
]));
