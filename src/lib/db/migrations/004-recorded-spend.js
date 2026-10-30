import { TABLES, buildCreateTableSql } from '../schema.js';
import { verifyAccountingSchema, verifyLegacyAccountingSchema } from './002-accounting-foundation.js';

export default {
  version: 4,
  name: 'recorded-spend-disposition',
  up(db) {
    const definition = db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='apiKeyAccounting'")?.sql;
    const current = buildCreateTableSql('apiKeyAccounting', TABLES.apiKeyAccounting).replace('IF NOT EXISTS ', '');
    if (definition !== current) {
      verifyLegacyAccountingSchema(db);
      // The migration runner owns the transaction. Keep original columns/values,
      // including snapshots, usage, audit references and idempotency payloads.
      const columns = Object.keys(TABLES.apiKeyAccounting.columns).join(',');
      db.exec('CREATE TABLE accounting_b1_copy AS SELECT * FROM apiKeyAccounting');
      db.exec('DROP TABLE apiKeyAccounting');
      db.exec(buildCreateTableSql('apiKeyAccounting', TABLES.apiKeyAccounting));
      db.exec(`INSERT INTO apiKeyAccounting(${columns}) SELECT ${columns} FROM accounting_b1_copy`);
      db.exec('DROP TABLE accounting_b1_copy');
      for (const index of TABLES.apiKeyAccounting.indexes) db.exec(index);
    }
    verifyAccountingSchema(db);
    // Classify canonical historical interruption/abandonment only. Do not
    // waive stored usage/cost, completed-without-usage, newly classified
    // invalid usage, or contrary audit evidence.
    const candidates = db.all(`SELECT attemptId,outcome,terminalJson FROM apiKeyAccounting
      WHERE state='unresolved' AND usageJson IS NULL AND costNanoUsd IS NULL AND manuallyResolved=0
      AND NOT EXISTS (SELECT 1 FROM apiKeyAccountingAudit a WHERE a.attemptId=apiKeyAccounting.attemptId)`);
    for (const row of candidates) {
      let eligible = row.outcome === 'network_unknown' && row.terminalJson === null;
      if (row.terminalJson !== null) {
        let terminal;
        try { terminal = JSON.parse(row.terminalJson); }
        catch (cause) { throw new Error('Invalid legacy terminal evidence; migration refused', { cause }); }
        if (!terminal || typeof terminal !== 'object' || Array.isArray(terminal)) throw new Error('Invalid legacy terminal evidence; migration refused');
        // Historical transport-interrupted terminals predate classification.
        // Approved ambiguity applies only without stored contrary evidence.
        eligible = ['network_unknown','body_unknown','stream_unknown'].includes(row.outcome)
          && terminal.state === 'unresolved' && terminal.outcome === row.outcome
          && Object.keys(terminal).every(key => ['state','outcome','finishedAt'].includes(key));
      }
      if (eligible) db.run("UPDATE apiKeyAccounting SET state='unrecorded',resolutionVersion=resolutionVersion+1 WHERE attemptId=?", [row.attemptId]);
    }
  },
};
