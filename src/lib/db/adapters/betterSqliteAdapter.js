import Database from "better-sqlite3";
import { openNativeSqliteAttempt } from "./nodeSqliteAdapter.js";

const state = Object.freeze({ open: db => db.open, inTransaction: db => db.inTransaction });

export function openInstalledBetterSqliteAttempt(filePath, { requireMarked = false } = {}) {
  return openNativeSqliteAttempt(() => new Database(filePath), { driver: "better-sqlite3", requireMarked, state });
}

export function createBetterSqliteAdapter(filePath) {
  const result = openNativeSqliteAttempt(() => new Database(filePath), { driver: "better-sqlite3", installed: false, state });
  if (!result.ok) throw result.error;
  return result.adapter;
}
