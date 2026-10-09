import { describe, expect, it } from "vitest";
import { decimalToNanoUsd, nanoUsdToDecimal, validateRate, costFromExactUsage } from "@/lib/pricing/money.js";
const usage = (input = 1, output = 0) => ({ input, output, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true, exact: true });
describe("exact reference money", () => {
  it("validates lexical USD decimals, safe bounds and wire-format conversion", () => {
    expect(decimalToNanoUsd("0.0028")).toBe("2800000");
    expect(decimalToNanoUsd("0")).toBe("0");
    expect(nanoUsdToDecimal("2800000")).toBe("0.0028");
    expect(nanoUsdToDecimal("9000000000000000")).toBe("9000000");
    for (const value of ["-1", "1e3", "0.0000000001", "01", "NaN", "Infinity", "9000000.000000001", 0.1, null, " 1"]) expect(() => decimalToNanoUsd(value)).toThrow();
  });
  it("preserves explicit zero and rejects unknown rates", () => {
    expect(validateRate("0")).toBe("0");
    for (const value of [null, undefined, -1, Infinity, NaN, "1e-9"]) expect(() => validateRate(value)).toThrow();
    expect(costFromExactUsage(usage(10, 10), { input: "0", output: "0", cached: "0" })).toBe("0");
    for (const field of ["input", "output", "cached", "cache_creation", "reasoning"]) expect(() => costFromExactUsage(usage(10, 10), { input: "1", output: "1", [field]: null })).toThrow();
    expect(nanoUsdToDecimal("18000000000000000")).toBe("18000000");
  });
  it("rounds half up once after all component numerators", () => {
    expect(costFromExactUsage(usage(1), { input: "0.0028", output: "0" })).toBe("3");
    expect(costFromExactUsage(usage(1), { input: "0.0005", output: "0" })).toBe("1");
    expect(costFromExactUsage(usage(1, 1), { input: "0.00025", output: "0.00025" })).toBe("1");
    expect(costFromExactUsage(usage(1), { input: "0.000499999", output: "0" })).toBe("0");
  });
  it("subtracts inclusive cache subsets and reasons once according to exact schema", () => {
    const tokens = { ...usage(100, 20), cacheRead: 40, cacheWrite: 10, reasoning: 5 };
    const rates = { input: "2", output: "4", cached: "0", cache_creation: "3", reasoning: "8" };
    // 50*2 + 40*0 + 10*3 + 15*4 + 5*8 = 230 microUSD.
    expect(costFromExactUsage(tokens, rates)).toBe("230000");
    expect(costFromExactUsage({ ...tokens, reasoningIncludedInOutput: false }, rates)).toBe("250000");
  });
  it("records known fallback rate semantics and rejects invalid/estimated token counts", () => {
    expect(costFromExactUsage({ ...usage(100, 20), cacheRead: 40, reasoning: 5 }, { input: "2", output: "4" })).toBe("280000");
    for (const tokens of [{ ...usage(), exact: false }, { ...usage(), input: -1 }, { ...usage(), input: 1.2 }, { ...usage(), cacheRead: 2 }, { ...usage(), reasoning: 1 }, { ...usage(), input: Number.MAX_SAFE_INTEGER + 1 }, { ...usage(), reasoningIncludedInOutput: undefined }]) expect(() => costFromExactUsage(tokens, { input: "1", output: "1" })).toThrow();
  });
  it("legacy analytics rates retain explicit zero without altering exported API", async () => {
    const { calculateCostFromTokens } = await import("open-sse/providers/pricing.js");
    expect(calculateCostFromTokens({ prompt_tokens: 10, cached_tokens: 5, cache_creation_input_tokens: 5, completion_tokens: 0, reasoning_tokens: 5 }, { input: 2, output: 4, cached: 0, cache_creation: 0, reasoning: 0 })).toBe(0);
  });
  it("rejects cost overflow before storage conversion", () => {
    expect(() => costFromExactUsage(usage(10000000), { input: "9000000", output: "0" })).toThrow(/range/);
  });
});
