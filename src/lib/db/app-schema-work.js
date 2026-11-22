import { TABLES, SCHEMA_VERSION, buildCreateTableSql } from './schema.js';
import { latestVersion } from './migrations/index.js';
import { canonical, unavailable } from '../accounting/attempt-payload.js';
import { createNodeOuterTransaction } from '../accounting/node-outer-transaction.js';

// Named current-owner shape, NOT arbitrary SQL equivalence or a migration engine.
// Internal scoped validator is composable with the existing startup owner later;
// this module is not imported by startup and does not open/repair/stamp a DB.
const storedSql = sql => sql.replace(' IF NOT EXISTS ', ' ');
const shape = (columns, unique, origin, desc = []) => ({ columns, unique, origin, desc });
const plans = Object.entries(TABLES).map(([name, definition]) => {
  const columns = Object.entries(definition.columns).map(([column, declaration], cid) => {
    const type = /^(TEXT|INTEGER|REAL)\b/.exec(declaration)?.[1];
    if (!type) throw unavailable(); // Review this profile when declarative grammar grows.
    const composite = definition.primaryKey?.match(/^PRIMARY KEY \((\w+(?:, \w+)*)\)$/)?.[1].split(', ') ?? [];
    if (definition.primaryKey && !composite.length) throw unavailable();
    return { cid, name: column, type, notnull: declaration.includes('NOT NULL') ? 1 : 0,
      dflt_value: / DEFAULT (-?\d+)$/.exec(declaration)?.[1] ?? null,
      pk: declaration.includes('PRIMARY KEY') ? 1 : composite.indexOf(column) + 1, hidden: 0 };
  });
  const indexes = [];
  let ordinal = 0;
  for (const [column, declaration] of Object.entries(definition.columns)) {
    if (declaration.includes('PRIMARY KEY') && !declaration.startsWith('INTEGER ')) {
      indexes.push({ name: `sqlite_autoindex_${name}_${++ordinal}`, sql: null, ...shape([column], 1, 'pk') });
    }
    if (declaration.includes('UNIQUE')) {
      indexes.push({ name: `sqlite_autoindex_${name}_${++ordinal}`, sql: null, ...shape([column], 1, 'u') });
    }
  }
  if (definition.primaryKey) indexes.push({ name: `sqlite_autoindex_${name}_${++ordinal}`, sql: null,
    ...shape(columns.filter(column => column.pk).sort((a,b) => a.pk-b.pk).map(column => column.name), 1, 'pk') });
  for (const sql of definition.indexes ?? []) {
    // Parse ONLY trusted declarative owner grammar, never incoming SQLite SQL.
    const match = /^CREATE INDEX IF NOT EXISTS (\w+) ON (\w+)\((\w+(?: DESC)?(?:, \w+(?: DESC)?)*)\)$/.exec(sql);
    if (!match || match[2] !== name) throw unavailable();
    const terms = match[3].split(', ');
    indexes.push({ name: match[1], sql: storedSql(sql), ...shape(terms.map(term => term.split(' ')[0]), 0, 'c', terms.map(term => term.endsWith(' DESC') ? 1 : 0)) });
  }
  return { name, sql: storedSql(buildCreateTableSql(name, definition)), columns, indexes };
});
const definitions = {
  appObjects: { method: 'all', sql: 'SELECT type, name, tbl_name, sql FROM main.sqlite_schema ORDER BY name LIMIT 257' },
  appVersions: { method: 'all', sql: "SELECT key, value FROM main._meta WHERE key IN ('schemaVersion', 'backupSchemaVersion') ORDER BY key" },
};
for (const [i, plan] of plans.entries()) {
  definitions[`columns${i}`] = { method: 'all', sql: `PRAGMA main.table_xinfo("${plan.name}")` };
  definitions[`indexes${i}`] = { method: 'all', sql: `PRAGMA main.index_list("${plan.name}")` };
  for (const [j, index] of plan.indexes.entries()) definitions[`index${i}x${j}`] = { method: 'all', sql: `PRAGMA main.index_xinfo("${index.name}")` };
}
export const APP_SCHEMA_READ_DEFINITIONS = Object.freeze(Object.fromEntries(
  Object.entries(definitions).map(([name, definition]) => [name, Object.freeze(definition)])
));
const result = (kind, reasons = []) => Object.freeze({ kind, profile: 'app-current-v1', reasons: Object.freeze(reasons) });
const same = (a, b) => canonical(a) === canonical(b);
const accountingTables = new Set(['accounting_attempts_v1', 'accounting_terminals_v1', 'accounting_key_policy_v1', 'accounting_key_generations_v1', 'accounting_admin_events_v1']);

export function createAppSchemaReadValidator() {
  return Object.freeze({ classify(scope) {
    const objects = scope.appObjects();
    if (objects.length > 256) return result('unsupported-shape', ['object-capacity']);
    const byName = new Map(objects.map(object => [object.name, object]));
    const expected = new Set(plans.flatMap(plan => [plan.name, ...plan.indexes.map(index => index.name)]));
    for (const object of objects) {
      if (expected.has(object.name)) continue;
      if (accountingTables.has(object.name) && object.type === 'table') continue;
      if (object.type === 'index' && object.sql === null && accountingTables.has(object.tbl_name)) continue;
      if (object.name === 'sqlite_sequence' && object.type === 'table' && object.sql === 'CREATE TABLE sqlite_sequence(name,seq)') continue;
      // Unknown triggers anywhere can write protected rows; don't ignore them.
      return result('unsupported-shape', ['unrecognized-object']);
    }
    const work = new Set();
    for (const [i, plan] of plans.entries()) {
      const table = byName.get(plan.name);
      if (!table) { work.add('missing-table'); continue; }
      // One explicitly named predecessor, not arbitrary missing-column inference.
      const preAccessColumns = plan.name === 'apiKeys' ? plan.columns.slice(0, -2) : null;
      const preAccessSql = plan.name === 'apiKeys' ? storedSql(buildCreateTableSql('apiKeys', {
        ...TABLES.apiKeys, columns: Object.fromEntries(Object.entries(TABLES.apiKeys.columns).slice(0, -2)),
      })) : null;
      const predecessor = preAccessSql !== null && table.sql === preAccessSql;
      if (table.type !== 'table' || table.tbl_name !== plan.name || (table.sql !== plan.sql && !predecessor)) return result('unsupported-shape', ['table-definition']);
      if (predecessor) work.add('known-pre-access-columns');
      const columns = scope[`columns${i}`]();
      if (!same(columns, predecessor ? preAccessColumns : plan.columns)) return result('unsupported-shape', ['column-semantics']);
      const indexes = scope[`indexes${i}`]();
      if (indexes.some(index => !plan.indexes.some(expectedIndex => expectedIndex.name === index.name))) return result('unsupported-shape', ['unexpected-index']);
      for (const [j, index] of plan.indexes.entries()) {
        const actual = indexes.find(value => value.name === index.name);
        const object = byName.get(index.name);
        if (!actual && !object && index.origin === 'c') { work.add('missing-index'); continue; }
        if (!actual || !object || object.type !== 'index' || object.tbl_name !== plan.name || object.sql !== index.sql ||
            actual.unique !== index.unique || actual.origin !== index.origin || actual.partial !== 0) return result('unsupported-shape', ['index-definition']);
        const terms = scope[`index${i}x${j}`]();
        const keys = terms.filter(term => term.key === 1);
        if (keys.length !== index.columns.length || terms.length !== keys.length + 1 ||
            keys.some((term, k) => term.seqno !== k || term.name !== index.columns[k] ||
              term.cid !== plan.columns.find(column => column.name === term.name)?.cid || term.desc !== (index.desc[k] ?? 0) || term.coll !== 'BINARY') ||
            !terms.some(term => term.key === 0 && term.cid === -1 && term.name === null && term.desc === 0 && term.coll === 'BINARY')) return result('unsupported-shape', ['index-semantics']);
      }
    }
    if (byName.get('_meta')?.type === 'table') {
      const versions = scope.appVersions();
      for (const [key, target] of [['schemaVersion', latestVersion()], ['backupSchemaVersion', SCHEMA_VERSION]]) {
        const row = versions.find(version => version.key === key);
        if (!row) { work.add('missing-version'); continue; }
        if (typeof row.value !== 'string' || !/^(0|[1-9]\d*)$/.test(row.value) ||
            !Number.isSafeInteger(Number(row.value)) || Number(row.value) > target) return result('unsupported-shape', ['version-value']);
        if (Number(row.value) < target) work.add('older-version');
      }
    } else work.add('missing-version');
    // This only classifies schema/work facts, never legacy import completion.
    return result(work.size ? 'required-work' : 'current', [...work].sort());
  } });
}

export function classifyNodeAppSchemaWork(adapter) {
  const transact = createNodeOuterTransaction(adapter, APP_SCHEMA_READ_DEFINITIONS);
  const value = transact(createAppSchemaReadValidator().classify).value;
  return Object.freeze({ ...value, reasons: Object.freeze(value.reasons) });
}
