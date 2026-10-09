import { MAX_NANO_USD } from "../../../open-sse/config/apiKeyBudgetConstants.js";

const USD_SCALE = 1_000_000_000n;
const TOKEN_UNIT = 1_000_000n;

// Monetary ingress is lexical decimal, never parseFloat -> scaled multiplication.
// Legacy finite numeric rates may be String-converted at their dedicated ingress;
// exponential/over-precision representations still fail validation here.
export function decimalToNanoUsd(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,6})(\.\d{1,9})?$/.test(value)) throw new Error("Invalid USD decimal precision/range");
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * USD_SCALE + BigInt(fraction.padEnd(9, "0"));
  if (amount > MAX_NANO_USD) throw new Error("USD range exceeded");
  return amount.toString();
}
// Formatting-only: indexed ledger aggregates may exceed the per-row/limit bound.
// Ingress/storage always use decimalToNanoUsd/validateNanoUsd for bounded values.
export function nanoUsdToDecimal(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) throw new Error("Invalid nanoUSD decimal");
  const amount = BigInt(value);
  const whole = amount / USD_SCALE;
  const fractional = (amount % USD_SCALE).toString().padStart(9, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}
export function validateRate(value) {
  return nanoUsdToDecimal(decimalToNanoUsd(value));
}
function tokens(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid exact ${field} token count`);
  return BigInt(value);
}
export function costFromExactUsage(usage, rates) {
  if (!usage || usage.exact !== true || typeof usage.reasoningIncludedInOutput !== "boolean") throw new Error("Exact usage inclusion provenance required");
  const input = tokens(usage.input, "input"), output = tokens(usage.output, "output");
  const read = tokens(usage.cacheRead, "cached read"), write = tokens(usage.cacheWrite, "cache write");
  const reasoning = tokens(usage.reasoning, "reasoning");
  if (read + write > input || usage.reasoningIncludedInOutput && reasoning > output) throw new Error("Invalid exact usage subsets");
  const inputRate = BigInt(decimalToNanoUsd(rates.input));
  const outputRate = BigInt(decimalToNanoUsd(rates.output));
  // Explicit documented fallback to normal input/output rates; zero remains zero.
  const readRate = BigInt(decimalToNanoUsd(rates.cached === undefined ? rates.input : rates.cached));
  const writeRate = BigInt(decimalToNanoUsd(rates.cache_creation === undefined ? rates.input : rates.cache_creation));
  const reasoningRate = BigInt(decimalToNanoUsd(rates.reasoning === undefined ? rates.output : rates.reasoning));
  const plainOutput = usage.reasoningIncludedInOutput ? output - reasoning : output;
  const numerator = (input - read - write) * inputRate + read * readRate + write * writeRate + plainOutput * outputRate + reasoning * reasoningRate;
  const rounded = (numerator + TOKEN_UNIT / 2n) / TOKEN_UNIT;
  if (rounded > MAX_NANO_USD) throw new Error("Attempt cost range exceeded");
  return rounded.toString();
}
