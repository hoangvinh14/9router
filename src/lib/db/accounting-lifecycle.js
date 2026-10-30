import { recoverPendingSync } from "./repos/api-key-accounting-repo.js";
import { stopAccountingWrites } from "../accounting/write-coordinator.js";
import { unavailable } from "../accounting/attempt-payload.js";

// Called only after exclusive acquisition and before publishing this lifetime.
export function installAccountingLifecycle(db) {
  if (db.get("SELECT attemptId FROM apiKeyAccounting WHERE state='pending' AND ownerInstanceId=? LIMIT 1", [db.ownerInstanceId])) throw unavailable("Invalid current-lifetime pending attempt at startup");
  recoverPendingSync(db);
  let finalized = false;
  db.beforeClose = () => {
    if (finalized) return;
    // Synchronous final-close boundary, not a live-request timeout. Stop the
    // sole write lane before retiring this adapter lifetime; subsequent
    // callbacks cannot acquire an ACK from the closed adapter. Storage/coverage
    // failures remain independent and are never cleared by this disposition.
    stopAccountingWrites(db);
    if (!db.health().healthy) throw unavailable("Uncertain accounting storage retains writer exclusion");
    recoverPendingSync(db, db.ownerInstanceId);
    finalized = true;
  };
}
