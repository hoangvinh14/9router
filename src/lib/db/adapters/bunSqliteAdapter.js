import { claimWriter } from "../writerOwnership.js";
import { wrapNativeAdapter } from "./nativeAdapter.js";

export async function createBunSqliteAdapter(filePath, suppliedOwner) {
  const { Database } = await import("bun:sqlite");
  const { owner, file } = claimWriter(filePath, suppliedOwner);
  let db;
  try { db = new Database(file, { create: true }); }
  catch (error) { owner.release(); throw error; }
  // Bun's default close defers native shutdown until prepared statements are
  // collected. Ownership must outlive deterministic statement finalization.
  return wrapNativeAdapter(db, owner, "bun:sqlite", () => db.close(true));
}
