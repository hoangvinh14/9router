import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import initSqlJs from 'sql.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fingerprintLogicalSnapshot } from '@/lib/db/logicalFingerprint.js';
const cleanups = [];
afterEach(() => { while (cleanups.length) cleanups.pop()(); });
function native(file = ':memory:') { const db = new DatabaseSync(file); cleanups.push(() => db.close()); return { db, reader: { all: sql => db.prepare(sql).all() } }; }
function jsReader(db) { return { all: sql => { const statement = db.prepare(sql); try { const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; } finally { statement.free(); } } }; }
const seed = `CREATE TABLE items(id INTEGER PRIMARY KEY, t TEXT, b BLOB, n, r REAL); INSERT INTO items VALUES(9007199254740993,'text'||char(0)||'é',x'00FF',9223372036854775807,1.25); INSERT INTO items VALUES(2,'',x'',NULL,4.9406564584124654e-324); CREATE TABLE pairs(a TEXT,b INTEGER,PRIMARY KEY(a,b)) WITHOUT ROWID; INSERT INTO pairs VALUES('x',7); CREATE INDEX idx ON items(t); CREATE VIEW v AS SELECT id FROM items; CREATE TRIGGER tr AFTER INSERT ON pairs BEGIN UPDATE items SET t=t WHERE id=2; END; PRAGMA user_version=2; PRAGMA application_id=19;`;
describe('unused bounded logical SQLite snapshot identity', () => {
  it('matches independently reopened SQL.js and Node typed rows including big integer/rowid, NUL and blob', async () => {
    const { db, reader } = native(); db.exec(seed); const before = fingerprintLogicalSnapshot(reader);
    const SQL = await initSqlJs(); const live = new SQL.Database(); live.run(seed); const image = live.export(); const reopened = new SQL.Database(image);
    try { expect(fingerprintLogicalSnapshot(jsReader(reopened))).toEqual(before); expect(fingerprintLogicalSnapshot(jsReader(live))).toEqual(before); } finally { reopened.close(); live.close(); }
    expect(before.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('distinguishes type, exact schema, meta, empty blob/text/null and duplicate multiplicity', () => {
    const { db, reader } = native(); db.exec('CREATE TABLE t(v); INSERT INTO t VALUES(NULL);'); let previous = fingerprintLogicalSnapshot(reader).sha256;
    for (const sql of ["UPDATE t SET v=''", "UPDATE t SET v=x''", 'UPDATE t SET v=1', "UPDATE t SET v='1'", 'INSERT INTO t SELECT v FROM t', 'PRAGMA user_version=1', 'CREATE INDEX i ON t(v)']) { db.exec(sql); const next = fingerprintLogicalSnapshot(reader).sha256; expect(next).not.toBe(previous); previous = next; }
  });
  it('retains INTEGER PRIMARY KEY DESC hidden rowid and rejects all case-insensitive aliases shadowed', () => {
    const { db, reader } = native(); db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY DESC,v); INSERT INTO t(rowid,id,v) VALUES(9007199254740993,7,NULL);'); const first = fingerprintLogicalSnapshot(reader).sha256; db.exec('UPDATE t SET rowid=9007199254740994'); expect(fingerprintLogicalSnapshot(reader).sha256).not.toBe(first);
    db.exec('CREATE TABLE shadow(ROWID, _RowID_, OID)'); expect(() => fingerprintLogicalSnapshot(reader)).toThrow('Logical snapshot unsupported');
  });
  it('rejects generated columns, virtual/shadow tables, attached or temp objects and UTF16', () => {
    for (const setup of ['CREATE TABLE t(v,w AS (v+1))', 'CREATE VIRTUAL TABLE t USING fts5(v)', "ATTACH ':memory:' AS extra", 'CREATE TEMP TABLE t(v)', "PRAGMA encoding='UTF-16'; CREATE TABLE t(v)"]) { const { db, reader } = native(); db.exec(setup); expect(() => fingerprintLogicalSnapshot(reader)).toThrow('Logical snapshot unsupported'); }
  });
  it('finite REAL values have Node/SQL.js identity; infinity fails closed', async () => {
    const sql = 'CREATE TABLE t(v REAL); INSERT INTO t VALUES(-0.0),(1.7976931348623157e308),(4.9406564584124654e-324);'; const { db, reader } = native(); db.exec(sql); const SQL = await initSqlJs(); const other = new SQL.Database(); try { other.run(sql); expect(fingerprintLogicalSnapshot(jsReader(other))).toEqual(fingerprintLogicalSnapshot(reader)); } finally { other.close(); } db.exec('INSERT INTO t VALUES(1e999)'); expect(() => fingerprintLogicalSnapshot(reader)).toThrow('Logical snapshot unsupported');
  });
  it('holds one reader snapshot across a concurrent committed WAL change', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logical-snapshot-')); cleanups.unshift(() => fs.rmSync(dir, { recursive: true, force: true })); const file = path.join(dir, 'data.sqlite'); const writer = native(file); writer.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE t(v); INSERT INTO t VALUES(1);'); const held = native(file); held.db.exec('BEGIN'); const first = fingerprintLogicalSnapshot(held.reader); writer.db.exec('INSERT INTO t VALUES(2)'); expect(fingerprintLogicalSnapshot(held.reader)).toEqual(first); held.db.exec('COMMIT'); expect(fingerprintLogicalSnapshot(held.reader).sha256).not.toBe(first.sha256);
  });
  it('supports escaped Unicode identifiers/defaults and malformed row-text bytes without lossy schema metadata', () => {
    const { db, reader } = native(); db.exec(`CREATE TABLE "é'\"\"table"("\uFEFFcol" TEXT DEFAULT 'é'); INSERT INTO "é'\"\"table" VALUES(CAST(x'80' AS TEXT));`);
    const first = fingerprintLogicalSnapshot(reader); db.exec(`UPDATE "é'\"\"table" SET "\uFEFFcol"=CAST(x'81' AS TEXT)`); expect(fingerprintLogicalSnapshot(reader).sha256).not.toBe(first.sha256);
    for (const field of ['name', 'tbl_name', 'type', 'sql']) {
      expect(() => fingerprintLogicalSnapshot({ all: sql => reader.all(sql).map(row => sql.includes('FROM main.sqlite_schema') ? { ...row, [`${field}Hex`]: '80' } : row) })).toThrow('Logical snapshot unsupported');
    }
    for (const field of ['name', 'type', 'dflt_value']) {
      expect(() => fingerprintLogicalSnapshot({ all: sql => reader.all(sql).map(row => sql.includes('FROM pragma_table_xinfo') ? { ...row, [`${field}Hex`]: '80' } : row) })).toThrow('Logical snapshot unsupported');
    }
    expect(() => fingerprintLogicalSnapshot({ all: sql => reader.all(sql).map(row => sql.includes('FROM main.sqlite_schema') ? { ...row, name: 'bad\u0000name', nameHex: '626164006E616D65' } : row) })).toThrow();
  });
  it('includes internal sequence/statistics and excludes physical rootpage with stable explicit rowids', () => {
    const { db, reader } = native(); db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY AUTOINCREMENT,v); INSERT INTO t(v) VALUES(1);'); const first = fingerprintLogicalSnapshot(reader).sha256;
    db.exec('UPDATE sqlite_sequence SET seq=10'); const next = fingerprintLogicalSnapshot(reader).sha256; expect(next).not.toBe(first);
    db.exec('CREATE INDEX i ON t(v); ANALYZE;'); const statistics = fingerprintLogicalSnapshot(reader).sha256; db.exec("UPDATE sqlite_stat1 SET stat='999 1'"); expect(fingerprintLogicalSnapshot(reader).sha256).not.toBe(statistics);
    const stable = fingerprintLogicalSnapshot(reader); db.exec('VACUUM'); expect(fingerprintLogicalSnapshot(reader)).toEqual(stable);
  });
  it('rejects inconsistent table inventory and invalid column metadata without partial hashes', () => {
    const { db, reader } = native(); db.exec('CREATE TABLE t(v);');
    for (const change of [{ cid: -1 }, { hidden: 1 }, { pk: 2 }, { notnull: 3 }]) expect(() => fingerprintLogicalSnapshot({ all: sql => reader.all(sql).map(row => sql.includes('FROM pragma_table_xinfo') ? { ...row, ...change } : row) })).toThrow();
    expect(() => fingerprintLogicalSnapshot({ all: sql => sql === 'PRAGMA main.table_list' ? [...reader.all(sql), { schema: 'main', name: 'phantom', type: 'table', ncol: 1, wr: 0, strict: 0 }] : reader.all(sql) })).toThrow();
  });
  it('rejects missing PRAGMAs, row/byte limits and does not modify the queried DB', () => {
    const { db, reader } = native(); db.exec('CREATE TABLE t(v); INSERT INTO t VALUES(1),(1),(1)'); const before = db.prepare('SELECT * FROM t').all(); expect(() => fingerprintLogicalSnapshot(reader, { maxRows: 2 })).toThrow(); expect(() => fingerprintLogicalSnapshot(reader, { maxBytes: 30 })).toThrow(); expect(() => fingerprintLogicalSnapshot({ all: sql => sql === 'PRAGMA main.table_list' ? [] : reader.all(sql) })).toThrow(); expect(() => fingerprintLogicalSnapshot({ all: sql => sql === 'PRAGMA main.encoding' ? [] : reader.all(sql) })).toThrow(); expect(db.prepare('SELECT * FROM t').all()).toEqual(before);
  });
});
