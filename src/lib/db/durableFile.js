import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

// A failure after rename is uncertain ACK, not proof of rollback.
export function atomicDurableWrite(file, bytes) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function synchronousResult(value) {
  if (value && typeof value.then === "function") {
    Promise.resolve(value).catch(() => {});
    throw new Error("Database transaction callback must be synchronous");
  }
  return value;
}

// Bounded lexical boundary for trusted application SQL (not a SQL sandbox).
// Quoted values/identifiers and comments never become statement keywords.
function sqlTokens(sql) {
  if (typeof sql !== "string" || sql.length > 1_048_576) throw new Error("Bounded SQL string required");
  const tokens = [];
  for (let i = 0; i < sql.length;) {
    const char = sql[i];
    if (/\s/.test(char)) { i++; continue; }
    if (sql.startsWith("--", i)) { const end = sql.indexOf("\n", i); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Unterminated SQL comment");
      i = end + 2; continue;
    }
    if (["'", '"', '`', '['].includes(char)) {
      const close = char === '[' ? ']' : char;
      let ended = false; i++;
      while (i < sql.length) {
        if (sql[i++] !== close) continue;
        if (close !== ']' && sql[i] === close) { i++; continue; }
        ended = true; break;
      }
      if (!ended) throw new Error("Unterminated SQL quote");
      tokens.push('#'); continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9]*/.exec(sql.slice(i));
    if (word) { tokens.push(word[0].toUpperCase()); i += word[0].length; }
    else { tokens.push(char); i++; }
  }
  return tokens;
}
const TRANSACTION_WORDS = new Set(['BEGIN', 'END', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE']);
export function assertManagedSql(sql) {
  const tokens = sqlTokens(sql);
  let start = true, trigger = false, body = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === ';') { start = true; continue; }
    if (start) {
      if (trigger && body && token === 'END') {
        trigger = false; body = false; start = false; continue;
      }
      if (TRANSACTION_WORDS.has(token)) throw new Error("Use managed database transactions");
      if (token === 'CREATE') {
        let j = i + 1;
        if (['TEMP', 'TEMPORARY'].includes(tokens[j])) j++;
        trigger = tokens[j] === 'TRIGGER';
      }
      start = false;
    }
    if (trigger && !body && token === 'BEGIN') { body = true; start = true; }
  }
  if (trigger) throw new Error("Incomplete SQL trigger");
}
const READ_PRAGMAS = new Set(['TABLE_INFO', 'TABLE_XINFO', 'INDEX_LIST', 'INDEX_INFO', 'INDEX_XINFO', 'FOREIGN_KEY_LIST', 'QUICK_CHECK', 'INTEGRITY_CHECK', 'JOURNAL_MODE', 'SYNCHRONOUS', 'USER_VERSION']);
// get/all are strictly read-only. Mutation-returning statements and CTEs must
// use the managed write surface, never silently evade SQL.js dirty tracking.
export function assertReadSql(sql) {
  assertManagedSql(sql);
  const tokens = sqlTokens(sql);
  if (tokens.at(-1) === ';') tokens.pop();
  if (!tokens.length || tokens.includes(';')) throw new Error("Single read-only SQL statement required");
  if (tokens[0] === 'SELECT') return;
  if (tokens[0] === 'PRAGMA') {
    let at = 1;
    if (tokens[at + 1] === '.') at += 2;
    if (READ_PRAGMAS.has(tokens[at])) {
      const tail = tokens.slice(at + 1);
      if (!tail.length || ['TABLE_INFO', 'TABLE_XINFO', 'INDEX_LIST', 'INDEX_INFO', 'INDEX_XINFO', 'FOREIGN_KEY_LIST', 'QUICK_CHECK', 'INTEGRITY_CHECK'].includes(tokens[at]) && tail[0] === '(' && tail.at(-1) === ')' && !tail.includes('=')) return;
    }
  }
  throw new Error("Read-only SELECT or introspection PRAGMA required");
}
