import { claimWriter } from "../writerOwnership.js";
import { wrapNativeAdapter } from "./nativeAdapter.js";

export async function createNodeSqliteAdapter(filePath, suppliedOwner) {
  const { DatabaseSync } = await import("node:sqlite");
  const { owner, file } = claimWriter(filePath, suppliedOwner);
  let db;
  try { db = new DatabaseSync(file); }
  catch (error) { owner.release(); throw error; }
  return wrapNativeAdapter(db, owner, "node:sqlite", () => db.close(), () => new DatabaseSync(file, { readOnly: true }));
}
