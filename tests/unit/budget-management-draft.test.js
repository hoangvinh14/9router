import { describe, it, expect } from "vitest";
import { attemptRecoveryDraft, budgetPolicyDraft, gapRecoveryDraft, retainedRecoveryMutation, validateBudgetPolicyDraft, validateRecoveryAcknowledgement } from "@/shared/utils/budgetManagementDraft.js";
const evidence = { reason: "Reviewed usage", evidence: "Provider exact accounting proof" };
const usage = { exact: true, input: 1000000, output: 3, cacheRead: 0, cacheWrite: 0, reasoning: 1, reasoningIncludedInOutput: true };
describe("budget/recovery lexical drafts and explicit retry identity", () => {
  it("null vs explicit0, nine decimals preserved; no numeric/exponent/overprecision coercion", () => {
    const draft = budgetPolicyDraft({ version: 4, weekly: { limitUsd: null }, monthly: { limitUsd: "0" } });
    expect(validateBudgetPolicyDraft(draft)).toEqual({ expectedVersion: 4, weeklyLimitUsd: null, monthlyLimitUsd: "0" });
    expect(validateBudgetPolicyDraft({ ...draft, weeklyLimitUsd: "1.000000001" }).weeklyLimitUsd).toBe("1.000000001");
    for (const value of [1, "1e-9", "0.0000000001", "-1", "", "9000000.000000001"]) expect(() => validateBudgetPolicyDraft({ ...draft, weeklyLimitUsd: value })).toThrow();
  });
  it("original usage request complete exactonly, no fabricatedcounts/actor/price; manual cost exact nanos", () => {
    const attempt = { resolutionVersion: 2 };
    expect(attemptRecoveryDraft(attempt, { ...evidence, action: "exact_usage", usageJson: JSON.stringify(usage) }, "operation-a")).toEqual({ ...evidence, action: "exact_usage", usage, expectedVersion: 2, operationId: "operation-a" });
    expect(attemptRecoveryDraft(attempt, { ...evidence, action: "cost_correction", costUsd: "1.000000001" }, "operation-b").costNanoUsd).toBe("1000000001");
    for (const value of ["", "{", JSON.stringify({ ...usage, exact: false }), JSON.stringify({ ...usage, cacheRead: 1000001 }), JSON.stringify({ ...usage, prompt: "not allowed" }), JSON.stringify({ ...usage, reasoning: 4 })]) expect(() => attemptRecoveryDraft(attempt, { ...evidence, action: "exact_usage", usageJson: value }, "operation-c")).toThrow();
    expect(() => attemptRecoveryDraft(attempt, { ...evidence, reason: "", action: "waive" }, "operation-d")).toThrow();
  });
  it("global/resolved gaps cannot be waived here; keygeneration/operation preserved", () => {
    expect(gapRecoveryDraft({ id: "gap-a", apiKeyId: "key-a", generation: 5 }, evidence, "operation-a")).toMatchObject({ gapId: "gap-a", expectedGeneration: 5, operationId: "operation-a" });
    for (const gap of [{ id: "g", apiKeyId: null, generation: 5 }, { id: "g", apiKeyId: "key-a", generation: 5, resolvedAt: "now" }]) expect(() => gapRecoveryDraft(gap, evidence, "operation-a")).toThrow();
  });
  it("only committed operation-bound receipt acknowledges, empty/wrongscope/action/version/cost denied", () => {
    const payload = attemptRecoveryDraft({ resolutionVersion: 1 }, { ...evidence, action: "waive" }, "operation-a");
    const retained = retainedRecoveryMutation("key-a", { kind: "attempt", attemptId: "attempt-a" }, payload);
    const receipt = { version: 1, operationId: "operation-a", apiKeyId: "key-a", kind: "attempt", targetId: "attempt-a", action: "waive", resolutionVersion: 2, state: "waived", costUsd: "0" };
    expect(validateRecoveryAcknowledgement({ recoveryReceipt: receipt }, retained, "key-a")).toEqual(receipt);
    for (const change of [{ operationId: "different" }, { apiKeyId: "key-b" }, { targetId: "attempt-b" }, { action: "cost_correction" }, { version: 2 }, { resolutionVersion: 3 }, { state: "settled" }, { costUsd: "1" }, { costUsd: null }]) expect(() => validateRecoveryAcknowledgement({ recoveryReceipt: { ...receipt, ...change } }, retained, "key-a")).toThrow(/acknowledgement/);
    for (const result of [{}, null, { state: "waived", resolutionVersion: 2, costUsd: "0" }]) expect(() => validateRecoveryAcknowledgement(result, retained, "key-a")).toThrow();
    const correction = retainedRecoveryMutation("key-a", { kind: "attempt", attemptId: "attempt-a" }, { ...payload, action: "cost_correction", costNanoUsd: "1000000001" });
    expect(validateRecoveryAcknowledgement({ recoveryReceipt: { ...receipt, action: "cost_correction", state: "settled", costUsd: "1.000000001" } }, correction, "key-a")).toMatchObject({ costUsd: "1.000000001" });
    expect(() => validateRecoveryAcknowledgement({ recoveryReceipt: { ...receipt, action: "cost_correction", state: "settled", costUsd: "1" } }, correction, "key-a")).toThrow();
    const gap = retainedRecoveryMutation("key-a", { kind: "gap" }, gapRecoveryDraft({ id: "gap-a", apiKeyId: "key-a", generation: 5 }, evidence, "operation-gap"));
    const gapReceipt = { version: 1, operationId: "operation-gap", apiKeyId: "key-a", kind: "gap", targetId: "gap-a", action: "coverage_waiver", generation: 5 };
    expect(validateRecoveryAcknowledgement({ recoveryReceipt: gapReceipt }, gap, "key-a")).toEqual(gapReceipt);
    expect(() => validateRecoveryAcknowledgement({ recoveryReceipt: { ...gapReceipt, generation: 6 } }, gap, "key-a")).toThrow();
  });
  it("bounded retry stores same immutable operation identity and escapedtarget no auto dispatch", () => {
    const payload = attemptRecoveryDraft({ resolutionVersion: 1 }, { ...evidence, action: "waive" }, "operation-a");
    const retained = retainedRecoveryMutation("key/a", { kind: "attempt", attemptId: "attempt/b" }, payload);
    payload.reason = "edited";
    expect(retained.url).toBe("/api/keys/key%2Fa/accounting/attempt%2Fb/resolve"); expect(retained.payload.reason).toBe(evidence.reason);
    expect(JSON.parse(JSON.stringify(retained)).payload).toMatchObject({ operationId: "operation-a", expectedVersion: 1 });
    expect(Object.isFrozen(retained.payload)).toBe(true);
    expect(() => retainedRecoveryMutation("key", { kind: "attempt" }, payload)).toThrow();
    expect(() => retainedRecoveryMutation("key", { kind: "gap" }, { huge: "x".repeat(16385) })).toThrow();
  });
});
