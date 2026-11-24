import { createHash } from 'node:crypto';
import { createNodeKeyPolicy } from './node-key-policy.js';
import { createNodeAttemptLedger } from './node-attempt-ledger.js';
import { unavailable } from './attempt-payload.js';
import { faultAccounting } from './process-state.js';

// Only a thrown adapter read publishes storage failure. Invalid input, absent
// schema or an unbound key must not spuriously trip process-wide dispatch.
function readAccountingQuery(read) {
  try { return read(); }
  catch { faultAccounting(); throw unavailable(); }
}

export function isCodexBudgetEndpoint(pathname) {
  return pathname === '/v1/responses' || pathname === '/v1/chat/completions';
}

// Keep the public guard/key-access precedence, including an empty Bearer value.
// No client key ID, local/CLI shortcut or request accounting flag is authority.
export function selectedAccountingSecret(request) {
  const headers = request?.headers;
  if (!headers?.get) return null;
  const auth = headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  for (const header of ['x-api-key', 'x-goog-api-key']) {
    const value = headers.get(header);
    if (value) return value;
  }
  try { return new URL(request.url).searchParams.get('key') || null; }
  catch { return null; }
}

const TABLES = ['accounting_attempts_v1', 'accounting_terminals_v1', 'accounting_key_policy_v1', 'accounting_key_generations_v1', 'accounting_admin_events_v1'];
// Internal classification only, not a dispatch capability or admission. Until a
// complete enrollment lifecycle exists, an entirely absent schema can only mean
// "not installed in this observed DB", NOT proof it was never installed before
// a restore/drop. Activation stays blocked. No external anchor is introduced.
export function classifyAccountingSecret(adapter, secret) {
  if (secret === null) return Object.freeze({ kind: 'ordinary' });
  try {
    if (typeof secret !== 'string' || secret.includes('\0')) throw unavailable();
    const names = readAccountingQuery(() => adapter.all('SELECT name FROM sqlite_schema WHERE name IN (?, ?, ?, ?, ?)', TABLES));
    if (names.length === 0) return Object.freeze({ kind: 'ordinary', installation: 'absent-in-observed-db' });
    if (names.length !== TABLES.length || !TABLES.every(name => names.some(row => row.name === name))) throw unavailable();
    // Existing schema validators, not a permissive column-name approximation.
    // No DDL/migration, terminal acquisition, ledger prepare or network call.
    const policy = createNodeKeyPolicy(adapter);
    createNodeAttemptLedger(adapter);
    const key = readAccountingQuery(() => adapter.get('SELECT id, isActive FROM apiKeys WHERE key = ?', [secret]));
    const fingerprint = createHash('sha256').update(secret).digest('hex');
    const bindings = readAccountingQuery(() => adapter.all('SELECT key_id FROM accounting_key_policy_v1 WHERE key_id = ? OR fingerprint = ? UNION SELECT key_id FROM accounting_key_generations_v1 WHERE fingerprint = ?', [key?.id ?? '', fingerprint, fingerprint]));
    if (bindings.length === 0) return Object.freeze({ kind: 'ordinary' });
    if (!key || key.isActive !== 1 || bindings.length !== 1 || bindings[0].key_id !== key.id || !policy.resolve(secret)) throw unavailable();
    // Same installed adapter qualification is required before returning controlled
    // identity; this function alone deliberately does not grant that authority.
    return Object.freeze({ kind: 'controlled', keyId: key.id });
  } catch {
    return Object.freeze({ kind: 'indeterminate' });
  }
}

export async function inspectAccountingRequest(request) {
  const secret = selectedAccountingSecret(request);
  if (secret === null) return Object.freeze({ kind: 'ordinary' });
  try {
    const { getAdapter, getAccountingAdapter } = await import('../db/driver.js');
    const observed = classifyAccountingSecret(await getAdapter(), secret);
    if (observed.kind !== 'controlled') return observed;
    const adapter = await getAccountingAdapter();
    const policy = createNodeKeyPolicy(adapter).resolve(secret);
    if (!policy || policy.keyId !== observed.keyId) throw unavailable();
    // No retained secret or dispatch right leaves this inspection boundary.
    return Object.freeze({ kind: 'controlled', keyId: policy.keyId });
  } catch {
    return Object.freeze({ kind: 'indeterminate' });
  }
}

// Empty production registry means all controlled execution is presently refused.
// Do not grow an invented nonbillable allowlist or return permission based on a
// profile count. Each future positive operation needs exact full-path admission.
export async function refuseUnadmittedAccountingRequest(request) {
  const state = await inspectAccountingRequest(request);
  if (state.kind === 'ordinary') return null; // existing auth still decides
  return accountingUnavailableResponse();
}

export function accountingUnavailableResponse() {
  return Response.json({ error: { message: 'Accounting profile unavailable', type: 'api_key_accounting_unavailable' } },
    { status: 503, headers: { 'cache-control': 'no-store' } });
}
