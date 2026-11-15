import { MAX_NANO_USD } from "./constants.js";

const USD_SCALE = 1_000_000_000n;

// Pure/client-safe ingress. Decimal strings never use scaled floating arithmetic.
export function decimalToNanoUsd(value) {
  if (typeof value !== "string" || value.trim() !== value || !/^(0|[1-9]\d{0,6})(\.\d{1,9})?$/.test(value)) {
    throw new Error("Invalid USD decimal precision/range");
  }
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * USD_SCALE + BigInt(fraction.padEnd(9, "0"));
  if (amount > MAX_NANO_USD) throw new Error("USD range exceeded");
  return amount.toString();
}

// Formatting permits aggregates above the per-rate ingress bound.
export function nanoUsdToDecimal(value) {
  if (typeof value !== "string" || value.trim() !== value || !/^(0|[1-9]\d*)$/.test(value)) throw new Error("Invalid nanoUSD decimal");
  const amount = BigInt(value);
  const whole = amount / USD_SCALE;
  const fractional = (amount % USD_SCALE).toString().padStart(9, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}

export function validateRate(value) {
  return nanoUsdToDecimal(decimalToNanoUsd(value));
}
