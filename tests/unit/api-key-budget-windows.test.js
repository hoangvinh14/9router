import { describe, expect, it } from "vitest";
import { budgetWindows } from "@/lib/apiKeyBudget/windows.js";
describe("fixed Asia/Ho_Chi_Minh calendar budgets", () => {
  it("Monday and month midnight map to previous UTC day 17:00", () => {
    const windows = budgetWindows("2026-10-04T17:00:00.000Z");
    expect(windows.weekly).toEqual({ start: "2026-10-04T17:00:00.000Z", end: "2026-10-11T17:00:00.000Z" });
    expect(windows.monthly).toEqual({ start: "2026-09-30T17:00:00.000Z", end: "2026-10-31T17:00:00.000Z" });
    const before = budgetWindows("2026-10-04T16:59:59.999Z");
    expect(before.weekly.end).toBe(windows.weekly.start);
    expect(budgetWindows("2026-10-31T17:00:00.000Z").monthly.start).toBe(windows.monthly.end);
  });
  it.each([2024, 2025])("February %s resets by calendar not fixed duration", year => {
    const windows = budgetWindows(`${year}-02-15T00:00:00.000Z`);
    expect(windows.monthly.start).toBe(`${year}-01-31T17:00:00.000Z`);
    const last = year === 2024 ? "29" : "28";
    expect(windows.monthly.end).toBe(`${year}-02-${last}T17:00:00.000Z`);
  });
  it("December/January handles year rollover", () => {
    expect(budgetWindows("2026-12-31T17:00:00.000Z").monthly).toEqual({ start: "2026-12-31T17:00:00.000Z", end: "2027-01-31T17:00:00.000Z" });
  });
  it("does not depend on the server timezone", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const first = budgetWindows("2026-10-04T17:00:00.000Z");
      process.env.TZ = "UTC";
      expect(budgetWindows(new Date("2026-10-04T17:00:00.000Z"))).toEqual(first);
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it("rejects bad clocks or unsupported timezone instead of using host defaults", () => {
    for (const value of [null, {}, "not a date", NaN]) expect(() => budgetWindows(value)).toThrow(/clock/);
    expect(() => budgetWindows(new Date(), "UTC")).toThrow(/timezone/);
  });
});
