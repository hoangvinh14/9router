import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { retainKeyBindings, retireKeyBindings, validateKeyBindings } from "../helpers/apiKeyBindings.js";
import { prepareExplicitKeyPolicies } from "../explicitPolicy.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
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
  };
  db.durableTransaction(() => {
    validateKeyBindings(db, db.coverage, [apiKey]);
    prepareExplicitKeyPolicies(db, [apiKey]);
    retainKeyBindings(db, db.coverage, [apiKey]);
    db.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt]
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
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  return db.durableTransaction(() => {
    const row = db.get("SELECT * FROM apiKeys WHERE id=?", [id]);
    if (!row) return false;
    retireKeyBindings(db, db.coverage, [row]);
    return Number(db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]).changes) > 0;
  });
}

export async function resolveApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ? AND isActive = 1`, [key]);
  if (!row) return null;
  validateKeyBindings(db, db.coverage, [row]);
  const { key: secret, ...identity } = rowToKey(row);
  return identity;
}

export async function validateApiKey(key) {
  return Boolean(await resolveApiKey(key));
}
