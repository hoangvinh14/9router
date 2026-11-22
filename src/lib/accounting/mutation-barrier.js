import { unavailable } from './attempt-payload.js';
import { faultAccounting } from './process-state.js';

const markerNames = ['accounting_attempts_v1', 'accounting_terminals_v1', 'accounting_key_policy_v1', 'accounting_key_generations_v1', 'accounting_admin_events_v1'];

// Inventory only, not startup qualification. Do not mistake a view for a table.
export function readAccountingMarkers(adapter) {
  try {
    const markers = adapter.all('SELECT name, type FROM main.sqlite_schema WHERE name IN (?, ?, ?, ?, ?)', markerNames);
    if (!Array.isArray(markers)) throw unavailable();
    return markers;
  } catch {
    faultAccounting();
    throw unavailable();
  }
}

// Called within the caller's existing synchronous transaction before any writes.
// Never swallow/retry a concurrent-writer conflict as ordinary mutation.
export function assertNoAccountingMutation(adapter) {
  const markers = readAccountingMarkers(adapter);
  // Even empty/partial tables may carry accounting lifecycle authority. Only
  // positively absent schema retains ordinary legacy mutation behavior here.
  // Entire schema loss/pre-enrollment restore cannot be detected by this check.
  if (markers.length) throw unavailable();
}
