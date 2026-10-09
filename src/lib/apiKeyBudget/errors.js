import { BUDGET_ERROR, BUDGET_TIMEZONE } from "../../../open-sse/config/apiKeyBudgetConstants.js";

const MESSAGES = Object.freeze({
  [BUDGET_ERROR.EXCEEDED]: "API key recorded-spend budget exceeded",
  [BUDGET_ERROR.UNRESOLVED]: "API key accounting requires audited recovery",
  [BUDGET_ERROR.UNAVAILABLE]: "API key accounting storage unavailable",
  [BUDGET_ERROR.PRICING]: "Model reference pricing unavailable",
  [BUDGET_ERROR.UNSUPPORTED]: "Model attempt accounting unsupported",
  [BUDGET_ERROR.CONFLICT]: "API key accounting observation conflict",
});
export class ApiKeyBudgetError extends Error {
  constructor(code, { requestId = null, blockedWindows = [], now = new Date() } = {}) {
    if (!Object.hasOwn(MESSAGES, code)) throw new Error("Unknown budget error code");
    super(MESSAGES[code]);
    this.name = "ApiKeyBudgetError";
    this.code = code;
    this.status = code === BUDGET_ERROR.EXCEEDED ? 429 : code === BUDGET_ERROR.CONFLICT ? 409 : 503;
    this.candidateLocal = [BUDGET_ERROR.PRICING, BUDGET_ERROR.UNSUPPORTED].includes(code);
    this.requestId = requestId;
    this.timezone = BUDGET_TIMEZONE;
    this.blockedWindows = blockedWindows.map(({ window, resetAt }) => ({ window, resetAt }));
    if (code === BUDGET_ERROR.EXCEEDED && blockedWindows.length) {
      this.resetAt = new Date(Math.max(...blockedWindows.map(w => new Date(w.resetAt).getTime()))).toISOString();
      this.retryAfter = Math.max(1, Math.ceil((new Date(this.resetAt).getTime() - new Date(now).getTime()) / 1000));
    }
  }
}
export function isApiKeyBudgetError(error) { return error instanceof ApiKeyBudgetError; }
// Response identity is an internal provenance boundary. JSON code/type and
// client-visible headers are never proof that accounting produced an error.
// Clones/new Response objects deliberately lose this marker; future wrappers
// must explicitly preserve trusted context, never fall back to wire guessing.
const localErrorResponses = new WeakMap();
export function budgetErrorResponse(error) {
  if (!isApiKeyBudgetError(error)) throw new Error("Expected local budget error");
  const headers = { "Cache-Control": "no-store", "Access-Control-Expose-Headers": "Retry-After, X-Request-Id" };
  if (error.requestId) headers["X-Request-Id"] = error.requestId;
  if (error.retryAfter !== undefined) headers["Retry-After"] = String(error.retryAfter);
  const response = new Response(JSON.stringify({ error: { message: error.message, type: "api_key_budget_error", code: error.code, param: null,
    requestId: error.requestId, timezone: error.timezone, ...(error.resetAt ? { resetAt: error.resetAt, windows: error.blockedWindows } : {}) } }),
  { status: error.status, headers: { ...headers, "Content-Type": "application/json" } });
  // Snapshot producer metadata rather than retaining a mutable Error reference.
  localErrorResponses.set(response, structuredClone({ code: error.code, requestId: error.requestId,
    resetAt: error.resetAt, windows: error.blockedWindows, retryAfter: error.retryAfter }));
  return response;
}

// Pre-stream only: stream-terminal frames need event-specific trusted provenance,
// not a blanket response flag that would trust provider-originated JSON frames.
export function geminiBudgetErrorResponse(response) {
  const local = localErrorResponses.get(response);
  if (!local) return null;
  if (!Object.hasOwn(MESSAGES, local.code) || local.requestId !== null && (typeof local.requestId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(local.requestId))) throw new Error("Invalid local accounting error metadata");
  const exceeded = local.code === BUDGET_ERROR.EXCEEDED;
  const status = exceeded ? 429 : local.code === BUDGET_ERROR.CONFLICT ? 409 : 503;
  const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Retry-After, X-Request-Id" };
  if (local.requestId) headers["X-Request-Id"] = local.requestId;
  if (local.retryAfter !== undefined) {
    if (!exceeded || !Number.isSafeInteger(local.retryAfter) || local.retryAfter < 1) throw new Error("Invalid local accounting retry metadata");
    headers["Retry-After"] = String(local.retryAfter);
  }
  let reset = {};
  if (local.resetAt !== undefined) {
    if (!exceeded || !Array.isArray(local.windows) || !local.windows.length || !local.windows.every(row => ["weekly", "monthly"].includes(row.window) && typeof row.resetAt === "string" && Number.isFinite(Date.parse(row.resetAt)) && new Date(row.resetAt).toISOString() === row.resetAt) || new Date(Math.max(...local.windows.map(row => Date.parse(row.resetAt)))).toISOString() !== local.resetAt) throw new Error("Invalid local accounting reset metadata");
    reset = { resetAt: local.resetAt, windows: local.windows };
  }
  return Response.json({ error: { code: status, status: exceeded ? "RESOURCE_EXHAUSTED" : status === 409 ? "ABORTED" : "UNAVAILABLE",
    message: MESSAGES[local.code], gatewayCode: local.code, requestId: local.requestId, timezone: BUDGET_TIMEZONE, ...reset } }, { status, headers });
}
