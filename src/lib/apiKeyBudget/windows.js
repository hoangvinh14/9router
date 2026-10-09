import { BUDGET_TIMEZONE } from "../../../open-sse/config/apiKeyBudgetConstants.js";

// V1's fixed Asia/Ho_Chi_Minh uses UTC+07:00 without DST. All arithmetic is
// UTC calendar arithmetic on the shifted clock, never host-local dates or a
// rolling 7/30-day duration. Reject other zones instead of silently misbilling.
const OFFSET_MS = 7 * 60 * 60 * 1000;
export function budgetWindows(now = new Date(), timezone = BUDGET_TIMEZONE) {
  if (timezone !== BUDGET_TIMEZONE) throw new Error("Unsupported budget timezone");
  const instant = now instanceof Date ? now.getTime() : typeof now === "number" || typeof now === "string" ? new Date(now).getTime() : NaN;
  if (!Number.isFinite(instant)) throw new Error("Invalid budget clock");
  const local = new Date(instant + OFFSET_MS);
  const year = local.getUTCFullYear(), month = local.getUTCMonth(), day = local.getUTCDate();
  const monday = day - (local.getUTCDay() + 6) % 7;
  const utc = (y, m, d) => new Date(Date.UTC(y, m, d) - OFFSET_MS).toISOString();
  return { timezone, weekly: { start: utc(year, month, monday), end: utc(year, month, monday + 7) },
    monthly: { start: utc(year, month, 1), end: utc(year, month + 1, 1) } };
}
