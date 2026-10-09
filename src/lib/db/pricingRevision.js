// SQLite owns revision invalidation, including raw/config-import kv writes.
// The revision rolls back with the mutation; readers never memoize inside a
// transaction or from a SQL.js dirty image awaiting persistence acknowledgement.
export const PRICING_REVISION_KEY = 'referencePricingRevision';
const relevant = alias => `(${alias}.scope='pricing' OR (${alias}.scope='referencePricing' AND ${alias}.key='catalog'))`;
// Exact sqlite_schema definitions shared by installer and offline validator.
// No normalization or name/prefix-only trust; preserve the installed SQL bytes.
export const PRICING_REVISION_TRIGGERS = Object.freeze(['INSERT', 'UPDATE', 'DELETE'].map(event => {
  const condition = event === 'UPDATE' ? `${relevant('OLD')} OR ${relevant('NEW')}` : relevant(event === 'DELETE' ? 'OLD' : 'NEW');
  const name = `pricing_revision_${event.toLowerCase()}`;
  return Object.freeze({ name, table: 'kv', sql: `CREATE TRIGGER ${name} AFTER ${event} ON kv
      WHEN ${condition}
      BEGIN
        SELECT CASE WHEN (SELECT CAST(value AS INTEGER) FROM _meta WHERE key='${PRICING_REVISION_KEY}') >= 9007199254740991
          THEN RAISE(ABORT,'Pricing revision exhausted') END;
        UPDATE _meta SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='${PRICING_REVISION_KEY}';
      END` });
}));
export function installPricingRevision(db) {
  db.exec(`INSERT OR IGNORE INTO _meta(key,value) VALUES('${PRICING_REVISION_KEY}','0')`);
  for (const { sql } of PRICING_REVISION_TRIGGERS) {
    db.exec(sql.replace(/^CREATE TRIGGER /, 'CREATE TRIGGER IF NOT EXISTS '));
  }
}
