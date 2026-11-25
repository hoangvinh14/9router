import { openNativeSqliteAttempt } from "./nodeSqliteAdapter.js";

const closed = new WeakSet();
const state = Object.freeze({
  open: db => closed.has(db) ? false : typeof db.inTransaction === "boolean",
  inTransaction: db => db.inTransaction,
  close(db) {
    db.close(true);
    closed.add(db);
  },
});

async function openBunSqliteAttempt(filePath, options) {
  const { Database } = await import("bun:sqlite");
  return openNativeSqliteAttempt(() => new Database(filePath, { create: true }), { driver: "bun:sqlite", state, ...options });
}

export function openInstalledBunSqliteAttempt(filePath, { requireMarked = false } = {}) {
  return openBunSqliteAttempt(filePath, { requireMarked });
}

export async function createBunSqliteAdapter(filePath) {
  const result = await openBunSqliteAttempt(filePath, { installed: false });
  if (!result.ok) throw result.error;
  return result.adapter;
}
