import Database from "better-sqlite3";
import { openNativeSqliteAttempt } from "./nodeSqliteAdapter.js";

const state = Object.freeze({ open: db => db.open, inTransaction: db => db.inTransaction });

export function openInstalledBetterSqliteAttempt(filePath, { requireMarked = false } = {}) {
  return openNativeSqliteAttempt(() => new Database(filePath), { driver: "better-sqlite3", filePath, requireMarked, state });
}

export function createBetterSqliteAdapter(filePath) {
  const result = openNativeSqliteAttempt(() => new Database(filePath), { driver: "better-sqlite3", filePath, installed: false, state });
  if (!result.ok) throw result.error;
  return result.adapter;
}
