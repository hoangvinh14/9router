import { MAX_NANO_USD } from "../../../open-sse/config/apiKeyBudgetConstants.js";

const USD_SCALE = 1_000_000_000n;

// Pure/client-safe monetary ingress. No raw provider, transport, DB or Node-only
// dependencies. Lexical decimals never pass through scaled float arithmetic.
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
