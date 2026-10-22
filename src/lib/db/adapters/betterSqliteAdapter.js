import Database from "better-sqlite3";
import { claimWriter } from "../writerOwnership.js";
import { wrapNativeAdapter } from "./nativeAdapter.js";

export function createBetterSqliteAdapter(filePath, suppliedOwner) {
  const { owner, file } = claimWriter(filePath, suppliedOwner);
  let db;
  try { db = new Database(file); }
  catch (error) { owner.release(); throw error; }
  return wrapNativeAdapter(db, owner, "better-sqlite3");
}
