// Closure observation only: never overrides a thrown native close, checkpoint
// failure, or accounting fault. Missing/unreadable runtime state is not evidence.
export function nodeClosureConfirmed(db) {
  try { return db.isOpen === false; } catch { return false; }
}
