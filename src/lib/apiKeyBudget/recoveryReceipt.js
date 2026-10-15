import { isDeepStrictEqual } from "node:util";
import { costFromExactUsageSnapshot, nanoUsdToDecimal } from "../pricing/money.js";
function unavailable() { throw Object.assign(new Error("api_key_accounting_unavailable"), { status: 503, code: "api_key_accounting_unavailable" }); }
// Receipt comes from the committed operation audit, never a request echo or a
// mutable latest attempt projection. Call only after DB acknowledgement and,
// for coverage, the independent sidecar CAS acknowledgement.
export function recoveryReceiptSync(db, apiKeyId, target, operation) {
  try {
    const audit = db.get("SELECT * FROM apiKeyAccountingAudit WHERE operationId=?", [operation.operationId]);
    if (!audit || audit.apiKeyId !== apiKeyId || audit.operationId !== operation.operationId) unavailable();
    const after = JSON.parse(audit.afterJson), before = JSON.parse(audit.beforeJson);
    const expected = target.kind === "gap" ? Object.fromEntries(Object.entries(operation).filter(([key]) => key !== "operationId")) : operation;
    if (!isDeepStrictEqual(after, expected)) unavailable();
    if (target.kind === "attempt") {
      if (audit.attemptId !== target.id || audit.gapId !== null || audit.action !== operation.action || !Number.isSafeInteger(before.resolutionVersion) || before.resolutionVersion !== operation.expectedVersion) unavailable();
      let cost = "0";
      if (audit.action === "cost_correction") cost = operation.costNanoUsd;
      else if (audit.action === "exact_usage") cost = costFromExactUsageSnapshot(after.usage, before.priceSnapshot);
      return { version: 1, operationId: audit.operationId, apiKeyId: audit.apiKeyId, kind: "attempt", targetId: audit.attemptId, action: audit.action,
        resolutionVersion: before.resolutionVersion + 1, state: audit.action === "waive" ? "waived" : "settled", costUsd: nanoUsdToDecimal(String(cost)) };
    }
    if (target.kind !== "gap" || audit.gapId !== target.id || audit.attemptId !== null || audit.action !== "coverage_waiver") unavailable();
    const gap = db.coverage.status(apiKeyId).gaps.find(row => row.id === target.id);
    if (!gap || gap.apiKeyId !== apiKeyId || gap.operationId !== audit.operationId || !gap.resolvedAt || gap.generation !== after.expectedGeneration) unavailable();
    return { version: 1, operationId: audit.operationId, apiKeyId: audit.apiKeyId, kind: "gap", targetId: audit.gapId, action: audit.action, generation: after.expectedGeneration };
  } catch { unavailable(); }
}
