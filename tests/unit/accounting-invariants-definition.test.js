import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import initSqlJs from 'sql.js';
import { ACCOUNTING_INVARIANT_TRIGGERS, installAccountingInvariants } from '@/lib/db/accountingInvariants.js';
import { TABLES, buildCreateTableSql } from '@/lib/db/schema.js';
import { installLegacyAccountingInvariants } from '../fixtures/accounting-invariants-legacy.mjs';
describe('exact accounting invariant stored-schema compatibility', () => {
  it.each(['node:sqlite', 'sql.js'])('legacy and shared installer preserve SQL bytes on %s', async engine => {
    const SQL = engine === 'sql.js' ? await initSqlJs() : null;
    const results = [];
    for (const install of [installLegacyAccountingInvariants, installAccountingInvariants]) {
      const db = SQL ? new SQL.Database() : new DatabaseSync(':memory:');
      try {
        for (const table of ['apiKeyAccounting', 'apiKeyAccountingAudit']) db.exec(buildCreateTableSql(table, TABLES[table]));
        install(db); install(db);
        const sql = "SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name";
        const rows = SQL ? (() => { const result = db.exec(sql)[0]; return result.values.map(values => Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))); })() : db.prepare(sql).all().map(row => ({ ...row }));
        results.push(rows);
      } finally { db.close(); }
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[1]).toEqual(ACCOUNTING_INVARIANT_TRIGGERS.map(row => ({ name: row.name, tbl_name: row.table, sql: row.sql })).sort((a,b) => a.name.localeCompare(b.name)));
  });
});
