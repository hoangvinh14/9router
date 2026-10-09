import { createHash } from "node:crypto";

export const LOGICAL_FINGERPRINT_VERSION = "sqlite-logical-v1";
const MAX_ROWS = 100000;
const MAX_BYTES = 64 * 1024 * 1024;
const fail = () => { throw new Error("Logical snapshot unsupported"); };
const quote = value => {
  if (typeof value !== "string" || !value || value.includes("\0")) fail();
  return `"${value.replaceAll('"', '""')}"`;
};
const hex = value => {
  if (typeof value !== "string" || !/^(?:[0-9A-F]{2})*$/.test(value)) fail();
  return value;
};
function textMetadata(row, name, { nullable = false, identifier = false } = {}) {
  const type = row[`${name}Storage`], bytes = hex(row[`${name}Hex`]);
  if (nullable && type === "null" && row[name] === null && bytes === "") return;
  if (type !== "text" || typeof row[name] !== "string" || Buffer.from(row[name], "utf8").toString("hex").toUpperCase() !== bytes) fail();
  if (identifier && (!row[name] || row[name].includes("\0"))) fail();
}
const metadataProjection = name => `${quote(name)}, typeof(${quote(name)}) AS ${quote(`${name}Storage`)}, hex(CAST(${quote(name)} AS BLOB)) AS ${quote(`${name}Hex`)}`;
const literal = value => `'${value.replaceAll("'", "''")}'`;
function cell(type, value) {
  if (type === "null" && value === null) return ["null"];
  if (type === "integer" && typeof value === "string" && /^(?:0|-?[1-9]\d*)$/.test(value)) {
    const number = BigInt(value);
    if (number < -(2n ** 63n) || number > 2n ** 63n - 1n) fail();
    return ["integer", value];
  }
  if (type === "text" || type === "blob") return [type, hex(value)];
  if (type === "real" && typeof value === "number" && Number.isFinite(value)) {
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleBE(value);
    return ["real-f64be", bytes.toString("hex")];
  }
  fail();
}
function projection(expression, index) {
  return `typeof(${expression}) AS t${index}, CASE typeof(${expression}) WHEN 'integer' THEN CAST(${expression} AS TEXT) WHEN 'text' THEN hex(CAST(${expression} AS BLOB)) WHEN 'blob' THEN hex(${expression}) ELSE ${expression} END AS v${index}`;
}

// UNUSED read-only foundation. The caller must supply one consistent SQL view.
// This function neither opens a transaction nor proves ownership, commitment,
// fsync, freshness or recoverability. No initializer/startup caller is installed.
// v1 conservatively supports UTF-8 ordinary tables; generated/hidden/virtual/
// shadow tables, attached databases and temp objects deny. REAL is the finite
// SQLite-delivered value, not physical storage bytes. Rootpage is intentionally
// excluded (physical layout); exact schema SQL bytes are included.
export function fingerprintLogicalSnapshot(reader, { maxRows = MAX_ROWS, maxBytes = MAX_BYTES } = {}) {
  if (!reader || typeof reader.all !== "function" || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) fail();
  const read = sql => {
    const rows = reader.all(sql);
    if (!Array.isArray(rows)) fail();
    return rows;
  };
  const single = (sql, name) => {
    const rows = read(sql);
    if (rows.length !== 1 || !Object.hasOwn(rows[0], name)) fail();
    return rows[0][name];
  };
  const databases = read("PRAGMA database_list");
  if (!databases.some(row => row.name === "main") || databases.some(row => !["main", "temp"].includes(row.name))) fail();
  if (read("SELECT name FROM temp.sqlite_schema LIMIT 1").length) fail();
  const encoding = single("PRAGMA main.encoding", "encoding");
  if (encoding !== "UTF-8") fail();
  const userVersion = single("PRAGMA main.user_version", "user_version");
  const applicationId = single("PRAGMA main.application_id", "application_id");
  if (![userVersion, applicationId].every(Number.isSafeInteger)) fail();
  const hash = createHash("sha256");
  let rowCount = 0, encodedBytes = 0;
  const encode = value => Buffer.from(JSON.stringify(value), "utf8");
  const charge = bytes => {
    encodedBytes += bytes.length + 4;
    if (encodedBytes > maxBytes) fail();
  };
  const frame = (bytes, charged = false) => {
    if (!charged) charge(bytes);
    const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
    hash.update(length); hash.update(bytes);
  };
  frame(encode([LOGICAL_FINGERPRINT_VERSION, encoding, userVersion, applicationId]));
  const schema = read(`SELECT ${["type", "name", "tbl_name", "sql"].map(metadataProjection).join(",")} FROM main.sqlite_schema LIMIT ${maxRows + 1}`);
  if (schema.length > maxRows) fail();
  rowCount += schema.length;
  const encodedSchema = schema.map(row => {
    for (const name of ["type", "name", "tbl_name"]) textMetadata(row, name, { identifier: true });
    textMetadata(row, "sql", { nullable: true });
    if (!["table", "index", "view", "trigger"].includes(row.type)) fail();
    const bytes = encode([row.type, row.nameHex, row.tbl_nameHex, row.sqlStorage, row.sqlHex]); charge(bytes); return bytes;
  }).sort(Buffer.compare);
  frame(encode(["schema", encodedSchema.length]));
  for (const row of encodedSchema) frame(row, true);
  const tables = read("PRAGMA main.table_list");
  if (tables.length > maxRows || tables.some(row => !["main", "temp"].includes(row.schema)
    || row.schema === "main" && (!["table", "view"].includes(row.type) || !Number.isSafeInteger(row.ncol) || row.ncol < 1 || ![0, 1].includes(row.wr) || ![0, 1].includes(row.strict)))) fail();
  // sqlite_schema is encoded above, not silently treated as ordinary data.
  const mainObjects = tables.filter(row => row.schema === "main" && row.name !== "sqlite_schema");
  const expectedObjects = schema.filter(row => ["table", "view"].includes(row.type));
  if (mainObjects.length !== expectedObjects.length || mainObjects.some(row => expectedObjects.filter(object => object.name === row.name && object.type === row.type).length !== 1)
    || expectedObjects.some(object => mainObjects.filter(row => row.name === object.name && row.type === object.type).length !== 1)) fail();
  const objects = schema.filter(row => row.type === "table").sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  for (const object of objects) {
    const matches = tables.filter(row => row.schema === "main" && row.name === object.name);
    if (matches.length !== 1 || matches[0].type !== "table" || ![0, 1].includes(matches[0].wr)) fail();
    const columns = read(`SELECT cid,"notnull",pk,hidden,${["name", "type", "dflt_value"].map(metadataProjection).join(",")} FROM pragma_table_xinfo(${literal(object.name)},'main') LIMIT ${maxRows + 1}`).sort((a, b) => a.cid - b.cid);
    if (!columns.length || columns.length !== matches[0].ncol || columns.some((column, index) => column.cid !== index || column.hidden !== 0
      || ![0, 1].includes(column.notnull) || !Number.isSafeInteger(column.pk) || column.pk < 0 || column.pk > columns.length)) fail();
    rowCount += columns.length;
    if (rowCount > maxRows) fail();
    for (const column of columns) {
      textMetadata(column, "name", { identifier: true }); textMetadata(column, "type"); textMetadata(column, "dflt_value", { nullable: true });
    }
    const names = new Set(columns.map(column => column.name.toLowerCase()));
    const alias = matches[0].wr === 1 ? null : ["rowid", "_rowid_", "oid"].find(name => !names.has(name));
    if (matches[0].wr === 0 && !alias) fail();
    frame(encode(["table", object.name, matches[0].wr, columns.map(column => [column.cid, column.nameHex, column.typeHex, column.notnull, column.dflt_valueStorage, column.dflt_valueHex, column.pk])]));
    const expressions = [...(alias ? [quote(alias)] : []), ...columns.map(column => quote(column.name))];
    const rows = read(`SELECT ${expressions.map(projection).join(",")} FROM main.${quote(object.name)} LIMIT ${maxRows - rowCount + 1}`);
    rowCount += rows.length;
    if (rowCount > maxRows) fail();
    const encodedRows = rows.map(row => {
      const bytes = encode(expressions.map((_, index) => cell(row[`t${index}`], row[`v${index}`]))); charge(bytes); return bytes;
    }).sort(Buffer.compare);
    frame(encode(["rows", encodedRows.length]));
    for (const row of encodedRows) frame(row, true);
  }
  return Object.freeze({ version: LOGICAL_FINGERPRINT_VERSION, sha256: hash.digest("hex"), rowCount, encodedBytes });
}
