export function unavailable(message = "Accounting storage unavailable") {
  return Object.assign(new Error(message), { status: 503, code: "api_key_accounting_unavailable" });
}
export function conflict(message = "Accounting operation conflict") {
  return Object.assign(new Error(message), { status: 409, code: "api_key_accounting_conflict" });
}
export function text(value, name, limit = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`Invalid ${name}`);
  return value;
}
export function timestamp(value) {
  if (typeof value !== "string" || value.length !== 24 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("Invalid accounting timestamp");
  return value;
}
// Strict JSON snapshotting bounds retained work and rejects executable/accessor input.
export function canonical(value, depth = 0) {
  if (depth > 12) throw new Error("Accounting payload depth exceeded");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== "object" || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Invalid accounting payload");
  const keys = Object.keys(value);
  if (keys.length > 100 || Object.getOwnPropertySymbols(value).length) throw new Error("Accounting payload fields exceeded");
  for (const key of keys) {
    if (["__proto__", "constructor", "prototype"].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")) throw new Error("Invalid accounting payload field");
  }
  if (Array.isArray(value) && (keys.length !== value.length || keys.some((key, i) => key !== String(i)))) throw new Error("Invalid accounting array");
  const result = Array.isArray(value) ? `[${value.map(v => canonical(v, depth + 1)).join(",")}]`
    : `{${keys.sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
  if (Buffer.byteLength(result) > 32768) throw new Error("Accounting payload bytes exceeded");
  return result;
}
export const snapshotPayload = value => JSON.parse(canonical(value));
