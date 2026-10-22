// Transactional invalidation including raw/import writes. No schema version change.
export const PRICING_REVISION_KEY = "referencePricingRevision";
const MAX_REVISION = 9007199254740991n;
const relevant = alias => `(${alias}.scope='pricing' OR (${alias}.scope='referencePricing' AND ${alias}.key='catalog'))`;
const validSql = `(SELECT COUNT(*) FROM _meta WHERE key='${PRICING_REVISION_KEY}' AND typeof(value)='text' AND length(value) BETWEEN 1 AND 16 AND value NOT GLOB '*[^0-9]*' AND (value='0' OR substr(value,1,1) BETWEEN '1' AND '9') AND CAST(value AS INTEGER)<9007199254740991)=1`;
export const PRICING_REVISION_TRIGGERS = Object.freeze(["INSERT", "UPDATE", "DELETE"].map(event => {
  const condition = event === "UPDATE" ? `${relevant("OLD")} OR ${relevant("NEW")}` : relevant(event === "DELETE" ? "OLD" : "NEW");
  const name = `pricing_revision_${event.toLowerCase()}`;
  return Object.freeze({ name, table: "kv", sql: `CREATE TRIGGER ${name} AFTER ${event} ON kv
      WHEN ${condition}
      BEGIN
        SELECT CASE WHEN NOT (${validSql}) THEN RAISE(ABORT,'Pricing revision invalid or exhausted') END;
        UPDATE _meta SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='${PRICING_REVISION_KEY}';
      END` });
}));
export function readPricingRevision(db) {
  const value = db.get("SELECT value FROM _meta WHERE key=?", [PRICING_REVISION_KEY])?.value;
  if (typeof value !== "string" || value.trim() !== value || !/^(0|[1-9]\d*)$/.test(value) || value.length > 16 || BigInt(value) > MAX_REVISION) {
    throw new Error("Reference pricing revision unavailable");
  }
  return value;
}
export function installPricingRevision(db) {
  db.durableTransaction(() => {
    const existing = db.get("SELECT value FROM _meta WHERE key=?", [PRICING_REVISION_KEY]);
    const triggers = db.all("SELECT name,sql,tbl_name FROM sqlite_master WHERE type='trigger' AND name IN (?,?,?)", PRICING_REVISION_TRIGGERS.map(item => item.name));
    if (!existing) {
      if (triggers.length) throw new Error("Reference pricing revision missing with existing triggers");
      db.run("INSERT INTO _meta(key,value) VALUES(?,?)", [PRICING_REVISION_KEY, "0"]);
    } else readPricingRevision(db);
    for (const definition of PRICING_REVISION_TRIGGERS) {
      const installed = triggers.find(item => item.name === definition.name);
      if (installed && (installed.sql !== definition.sql || installed.tbl_name !== definition.table)) throw new Error("Reference pricing trigger mismatch");
      if (!installed) db.exec(definition.sql);
    }
  });
}
