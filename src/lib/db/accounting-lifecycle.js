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
    stopAccountingWrites(db);
    if (!db.health().healthy) throw unavailable("Uncertain accounting storage retains writer exclusion");
    recoverPendingSync(db, db.ownerInstanceId);
    finalized = true;
  };
}
