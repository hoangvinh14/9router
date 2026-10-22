import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";
import { retainKeyBindings, retireKeyBindings, validateKeyBindings } from "../helpers/api-key-bindings.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  if (row) {
    if (!db.get("SELECT apiKeyId FROM apiKeyBindings WHERE apiKeyId=?", [row.id])) throw new Error("Retained key binding missing");
    validateKeyBindings(db, db.coverage, [row]);
  }
  return rowToKey(row);
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: { restricted: false, allow: [] },
  };
  const cols = keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  db.durableTransaction(() => {
    retainKeyBindings(db, db.coverage, [apiKey]);
    db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow]
    );
  });
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.durableTransaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    if (data.id !== undefined && data.id !== id) throw new Error("API key ID is immutable");
    const merged = { ...rowToKey(row), ...data };
    validateKeyBindings(db, db.coverage, [merged]);
    const cols = keyAccessToColumns(merged.access);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, cols.accessRestricted, cols.accessAllow, id]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  return db.durableTransaction(() => {
    const row = db.get("SELECT * FROM apiKeys WHERE id=?", [id]);
    if (!row) return false;
    retireKeyBindings(db, db.coverage, [row]);
    return Number(db.run("DELETE FROM apiKeys WHERE id=?", [id]).changes) > 0;
  });
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  if (!db.get("SELECT apiKeyId FROM apiKeyBindings WHERE apiKeyId=?", [row.id])) throw new Error("Retained key binding missing");
  validateKeyBindings(db, db.coverage, [row]);
  return row.isActive === 1 || row.isActive === true;
}
