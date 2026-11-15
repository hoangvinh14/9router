import { timestamp } from './attempt-payload.js';

export const BUDGET_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const BUDGET_CALENDAR_REVISION = 'hcm-monday-month-v1';
const OFFSET = 7 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
export const serverBudgetClock = () => new Date().toISOString();

export function budgetInstant(clock = serverBudgetClock) {
  if (typeof clock !== 'function' || clock.constructor?.name === 'AsyncFunction') throw new Error('Synchronous budget clock required');
  return timestamp(clock());
}

// Arithmetic uses only UTC accessors on a fixed +07 shifted instant. Never the
// host-local timezone or a rolling number of days. No clock deletes history.
export function budgetWindows(instant, timezone = BUDGET_TIMEZONE) {
  timestamp(instant);
  if (timezone !== BUDGET_TIMEZONE) throw new Error('Unsupported budget timezone');
  const shifted = new Date(Date.parse(instant) + OFFSET);
  const midnight = new Date(shifted);
  midnight.setUTCHours(0, 0, 0, 0);
  const monday = midnight.getTime() - ((midnight.getUTCDay() + 6) % 7) * DAY;
  const month = new Date(midnight);
  month.setUTCDate(1);
  const monthAt = delta => {
    const date = new Date(month);
    date.setUTCMonth(date.getUTCMonth() + delta);
    return date.getTime();
  };
  const range = (start, end) => Object.freeze({ startAt: new Date(start - OFFSET).toISOString(), resetAt: new Date(end - OFFSET).toISOString() });
  return Object.freeze({ timezone, weekly: range(monday, monday + 7 * DAY), monthly: range(monthAt(0), monthAt(1)),
    previousWindows: Object.freeze({ weekly: range(monday - 7 * DAY, monday), monthly: range(monthAt(-1), monthAt(0)) }) });
}
