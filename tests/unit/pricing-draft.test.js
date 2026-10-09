import { describe, it, expect, vi } from "vitest";
import { pricingDraft, changedPricingModels, submitPricingDraft } from "@/shared/utils/pricingDraft.js";

const source = { fixture: { one: { input: "1.000000001", output: 2, cached: 0 }, two: { input: "3", output: "4" } } };
describe("changed-only pricing editor draft", () => {
  it("untouched submit performs no network mutation; changed submit sends decimal rows", async () => {
    const baseline = pricingDraft(source), draft = pricingDraft(source), fetcher = vi.fn().mockResolvedValue({ ok: true });
    expect(await submitPricingDraft(baseline, draft, fetcher)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    draft.fixture.two.input = "0";
    expect(await submitPricingDraft(baseline, draft, fetcher)).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ fixture: { two: { input: "0", output: "4" } } });
  });
  it("invalid input and server rejection do not claim successful save", async () => {
    const baseline = pricingDraft(source), draft = pricingDraft(source), fetcher = vi.fn();
    draft.fixture.one.output = "1e9";
    await expect(submitPricingDraft(baseline, draft, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    draft.fixture.one.output = "3";
    fetcher.mockResolvedValue({ ok: false, json: async () => { throw new Error("invalid response"); } });
    await expect(submitPricingDraft(baseline, draft, fetcher)).rejects.toThrow("Failed to save pricing");
  });
  it('legacy numeric small rates display as decimal drafts, not exponent strings rejected on a sibling edit', () => {
    const data = { fixture: { one: { input: 0.000000001, output: 2, cached: 0 } } };
    const baseline = pricingDraft(data), draft = pricingDraft(data);
    expect(draft.fixture.one.input).toBe('0.000000001');
    expect(changedPricingModels(baseline, draft)).toEqual({});
    draft.fixture.one.output = '3';
    expect(changedPricingModels(baseline, draft)).toEqual({ fixture: { one: { input: '0.000000001', output: '3', cached: '0' } } });
    expect(pricingDraft({ fixture: { invalid: { input: 1e-10, output: 1 } } }).fixture.invalid.input).toBe('0.0000000001');
  });
  it("opening and saving untouched pricing creates no overrides", () => {
    const baseline = pricingDraft(source);
    expect(changedPricingModels(baseline, baseline)).toEqual({});
    expect(baseline.fixture.one).toMatchObject({ input: "1.000000001", output: "2", cached: "0", reasoning: "" });
    expect(source.fixture.one.reasoning).toBeUndefined();
  });
  it("one edited row sends a complete string replacement, never the merged catalog", () => {
    const baseline = pricingDraft(source), draft = pricingDraft(source);
    draft.fixture.one.output = "2.5";
    expect(changedPricingModels(baseline, draft)).toEqual({ fixture: { one: { input: "1.000000001", output: "2.5", cached: "0" } } });
    expect(baseline.fixture.one.output).toBe("2");
  });
  it("zero is explicit and optional blank restores fallback", () => {
    const baseline = pricingDraft(source), draft = pricingDraft(source);
    draft.fixture.one.cached = ""; draft.fixture.one.reasoning = "0";
    const row = changedPricingModels(baseline, draft).fixture.one;
    expect(row.cached).toBeUndefined(); expect(row.reasoning).toBe("0");
  });
  it("equivalent decimal edits and reverts remain no-ops", () => {
    const baseline = pricingDraft(source), draft = pricingDraft(source);
    draft.fixture.one.output = "2.000000000";
    expect(changedPricingModels(baseline, draft)).toEqual({});
    draft.fixture.one.output = "5"; draft.fixture.one.output = "2";
    expect(changedPricingModels(baseline, draft)).toEqual({});
  });
  it.each(["", "-1", "1e-9", "NaN", "1.0000000001", "1.2foo", " 1", "10000000"])("invalid edited required rate %j rejects before request", value => {
    const baseline = pricingDraft(source), draft = pricingDraft(source); draft.fixture.one.output = value;
    expect(() => changedPricingModels(baseline, draft)).toThrow();
  });
  it("invalid untouched legacy row is not rounded, pruned or submitted with another edit", () => {
    const data = { fixture: { broken: { input: "1.00000000001", output: 3 }, good: { input: 2, output: 4 } } };
    const baseline = pricingDraft(data), draft = pricingDraft(data); draft.fixture.good.output = "5";
    expect(changedPricingModels(baseline, draft)).toEqual({ fixture: { good: { input: "2", output: "5" } } });
    expect(draft.fixture.broken.input).toBe("1.00000000001");
    draft.fixture.broken.output = "4";
    expect(() => changedPricingModels(baseline, draft)).toThrow();
  });
});
