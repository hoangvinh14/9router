// Bounded JSON with numeric lexemes; monetary values are never first rounded to Number.
const NUMBER_TOKEN = Symbol("catalog-number-token");
export function isCatalogNumber(value) { return value?.[NUMBER_TOKEN] === true; }

export function parseCatalogJson(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 20 * 1024 * 1024) throw new Error("Catalog size exceeded");
  let i = 0, nodes = 0;
  function whitespace() { while (i < text.length && /[\x20\t\r\n]/.test(text[i])) i++; }
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i++] === '"') {
        let result;
        try { result = JSON.parse(text.slice(start, i)); } catch { throw new Error("Malformed catalog string"); }
        if (result.length > 8192) throw new Error("Catalog field size exceeded");
        return result;
      }
    }
    throw new Error("Malformed catalog string");
  }
  function value(depth) {
    whitespace();
    if (depth > 16 || ++nodes > 1_500_000) throw new Error("Catalog depth/entries exceeded");
    const char = text[i];
    if (char === '"') return string();
    if (char === "{" || char === "[") {
      const object = char === "{";
      const result = object ? Object.create(null) : [];
      const close = object ? "}" : "]";
      i++; whitespace();
      if (text[i] === close) { i++; return result; }
      while (i < text.length) {
        let key;
        if (object) {
          if (text[i] !== '"') throw new Error("Malformed catalog key");
          key = string();
          if (["__proto__", "constructor", "prototype"].includes(key) || Object.hasOwn(result, key)) throw new Error("Forbidden/duplicate catalog key");
          whitespace(); if (text[i++] !== ":") throw new Error("Malformed catalog object");
        }
        const item = value(depth + 1);
        if (object) result[key] = item; else result.push(item);
        whitespace();
        if (text[i] === close) { i++; return result; }
        if (text[i++] !== ",") throw new Error("Malformed catalog separator");
        whitespace();
      }
      throw new Error("Truncated catalog");
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(literal, i)) { i += literal.length; return result; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match || match[0].length > 80) throw new Error("Malformed catalog number");
    i += match[0].length;
    return Object.freeze({ [NUMBER_TOKEN]: true, numericLexeme: match[0] });
  }
  const result = value(0); whitespace();
  if (i !== text.length) throw new Error("Malformed catalog trailing data");
  return result;
}

export function decimalLexeme(value) {
  if (!isCatalogNumber(value)) throw new Error("Catalog rate must be numeric");
  const source = value.numericLexeme;
  if (source.startsWith("-")) throw new Error("Negative catalog rate");
  const [mantissa, exponentText = "0"] = source.toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 30) throw new Error("Catalog rate range");
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = whole + fraction;
  const point = whole.length + exponent;
  let result = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const parts = result.split("."); parts[0] = parts[0].replace(/^0+(?=\d)/, "");
  if (parts[1]) parts[1] = parts[1].replace(/0+$/, "");
  result = parts[1] ? parts.join(".") : parts[0];
  return result;
}
