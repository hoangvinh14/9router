export const ACCOUNTING_STATE = Object.freeze({
  PENDING: "pending", SETTLED: "settled", UNRESOLVED: "unresolved",
  NOT_DISPATCHED: "not_dispatched", WAIVED: "waived",
});
export const MAX_ACCOUNTED_COMBO_DEPTH = 16;
export const BUDGET_TIMEZONE = "Asia/Ho_Chi_Minh";
export const BUDGET_SCOPE = Object.freeze(["chat", "embeddings"]);
export const MAX_NANO_USD = 9_000_000_000_000_000n;
export const BUDGET_ERROR = Object.freeze({
  EXCEEDED: "api_key_budget_exceeded", UNRESOLVED: "api_key_accounting_unresolved",
  UNAVAILABLE: "api_key_accounting_unavailable", PRICING: "model_pricing_unavailable",
  UNSUPPORTED: "model_accounting_unsupported", CONFLICT: "api_key_accounting_conflict",
});
