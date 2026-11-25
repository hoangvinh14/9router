import { BUDGET_REFERENCE_SCOPE, codexStandardReferenceKey, MAX_NANO_USD } from '../pricing/constants.js';
import { canonical, conflict, snapshotPayload, text, timestamp, unavailable } from './attempt-payload.js';
import { budgetInstant, budgetWindows } from './budget-windows.js';
import { codexModelFromReference, nanoUsd, validateCodexStandardReference, validatePriceSnapshot } from './exact-money.js';
import { terminalCost, EXCLUSIVE_USAGE } from './terminal-cost.js';
import { assertAccountingHealthy, faultAccounting, finalAccountingDispatch } from './process-state.js';
import { createNodeOuterTransaction, quarantineNodeAccountingConnection } from './node-outer-transaction.js';
import { KEY_POLICY_EVENT_BY_KEY, KEY_POLICY_AUDIT_DEFINITIONS, KEY_POLICY_RESOLVE_DEFINITIONS, createKeyPolicyReadValidator } from './node-key-policy.js';

// Unhooked internal store on the EXISTING selected SQLite connection. No startup
// migration, connection factory, key authentication, producer or transport policy.
const ATTEMPTS = 'CREATE TABLE accounting_attempts_v1 (id TEXT PRIMARY KEY NOT NULL, key_id TEXT NOT NULL, started_at TEXT NOT NULL, week_start TEXT NOT NULL, month_start TEXT NOT NULL, original TEXT NOT NULL)';
const TERMINALS = 'CREATE TABLE accounting_terminals_v1 (attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES accounting_attempts_v1(id), amount TEXT NOT NULL, evidence TEXT NOT NULL)';
const DEFINITIONS = Object.freeze({
  createAttempts: { method: 'run', sql: ATTEMPTS },
  createTerminals: { method: 'run', sql: TERMINALS },
  schema: { method: 'get', sql: 'SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?' },
  original: { method: 'get', sql: 'SELECT original FROM accounting_attempts_v1 WHERE id = ?' },
  putIntent: { method: 'run', sql: 'INSERT INTO accounting_attempts_v1 VALUES (?, ?, ?, ?, ?, ?)' },
  terminal: { method: 'get', sql: 'SELECT amount, evidence FROM accounting_terminals_v1 WHERE attempt_id = ?' },
  putTerminal: { method: 'run', sql: 'INSERT INTO accounting_terminals_v1 VALUES (?, ?, ?)' },
  auditPage: { method: 'all', sql: 'SELECT a.id, a.key_id, a.started_at, a.week_start, a.month_start, t.amount, t.evidence FROM accounting_attempts_v1 a LEFT JOIN accounting_terminals_v1 t ON t.attempt_id = a.id WHERE a.id > ? ORDER BY a.id LIMIT 3' },
  emptyAttempt: { method: 'get', sql: "SELECT id FROM accounting_attempts_v1 WHERE id = '' LIMIT 1" },
  orphanTerminal: { method: 'get', sql: 'SELECT t.attempt_id FROM accounting_terminals_v1 t LEFT JOIN accounting_attempts_v1 a ON a.id = t.attempt_id WHERE a.id IS NULL LIMIT 1' },
  page: { method: 'all', sql: 'SELECT a.id, a.key_id, a.started_at, a.week_start, a.month_start, t.amount, t.evidence FROM accounting_attempts_v1 a LEFT JOIN accounting_terminals_v1 t ON t.attempt_id = a.id WHERE a.key_id = ? AND a.id > ? ORDER BY a.id LIMIT 3' },
});
const RECOVERY_READS = Object.freeze({
  recovery: { method: 'get', sql: "SELECT value FROM kv WHERE scope = 'budgetUsageRecovery' AND key = ?" },
});
const RECOVERY_ACTIONS = new Set(['waive', 'cost_correction']);
const RECOVERY_WRITE = { method: 'run', sql: "INSERT INTO kv(scope, key, value) VALUES ('budgetUsageRecovery', ?, ?)" };

const CODEX_PRICE_READS = Object.freeze({
  referencePrice: Object.freeze({ method: 'get', sql: 'SELECT value FROM kv WHERE scope = ? AND key = ?' }),
});

function readCodexPrice(scope, revision) {
  if (!revision) return null;
  const row = scope.referencePrice([BUDGET_REFERENCE_SCOPE, revision]);
  if (!row) return null;
  try {
    const price = validateCodexStandardReference(JSON.parse(row.value));
    return price.revision === revision ? price : null;
  }
  catch { return null; }
}

const identifier = value => {
  text(value, 'accounting identity', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw unavailable();
  return value;
};
function boundedCanonical(value) {
  const encoded = canonical(value);
  if (Buffer.byteLength(encoded) > 4096) throw unavailable();
  return encoded;
}
function checkSchema(scope) {
  if (scope.schema(['table', 'accounting_attempts_v1'])?.sql !== ATTEMPTS ||
      scope.schema(['table', 'accounting_terminals_v1'])?.sql !== TERMINALS) throw unavailable();
}
export const LEDGER_SETUP_DEFINITIONS = Object.freeze({
  createAttempts: Object.freeze(DEFINITIONS.createAttempts),
  createTerminals: Object.freeze(DEFINITIONS.createTerminals),
});

// EXPLICIT isolated setup seam. Not called by application driver/startup. Existing
// DB migration/import/restore requires separate reviewed mapping before wiring.
export function initializeNodeAttemptLedger(adapter) {
  const transact = createNodeOuterTransaction(adapter, DEFINITIONS);
  return transact(scope => {
    scope.createAttempts(); scope.createTerminals(); checkSchema(scope);
  });
}

function originalSnapshot(command) {
  const value = snapshotPayload(command);
  if (!value || Object.keys(value).sort().join(',') !== 'attemptId,bindingGeneration,keyId,model,price,provider,startedAt') throw unavailable();
  for (const name of ['attemptId', 'bindingGeneration', 'keyId']) identifier(value[name]);
  for (const name of ['model', 'provider']) {
    text(value[name], name, 256);
    if (value[name].includes('\0')) throw unavailable();
  }
  timestamp(value.startedAt);
  value.price = validatePriceSnapshot(value.price);
  const windows = budgetWindows(value.startedAt);
  return { ...value, windows };
}

const LEGACY_STATES = ['pending', 'settled', 'unresolved', 'not_dispatched', 'waived', 'unrecorded'];
function legacySnapshot(command, legacy) {
  if (!legacy || Object.keys(legacy).sort().join(',') !== 'amount,sourceDigest,state' ||
      !LEGACY_STATES.includes(legacy.state) || typeof legacy.sourceDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(legacy.sourceDigest)) throw unavailable();
  if (legacy.state === 'settled' || legacy.state === 'waived') nanoUsd(legacy.amount);
  else if (legacy.amount !== null) throw unavailable();
  if (legacy.state === 'waived' && legacy.amount !== '0') throw unavailable();
  if (command.bindingGeneration !== 'legacy') throw unavailable();
  return { ...originalSnapshot(command), legacy };
}

function legacyTerminal(original) {
  return { amountNanoUsd: original.legacy.amount, provenance: 'legacy-recorded' };
}

// Offline copy only. The caller validates the donor and owns the new file.
// This writer preserves historical IDs without creating any live attempt ACK.
export function writeLegacyNodeAttempts(adapter, entries) {
  const transact = createNodeOuterTransaction(adapter, {
    schema: DEFINITIONS.schema, putIntent: DEFINITIONS.putIntent, putTerminal: DEFINITIONS.putTerminal,
  });
  transact(scope => {
    checkSchema(scope);
    for (const { legacy, ...command } of entries) {
      const original = legacySnapshot(command, legacy);
      scope.putIntent([original.attemptId, original.keyId, original.startedAt,
        original.windows.weekly.startAt, original.windows.monthly.startAt, boundedCanonical(original)]);
      if (legacy.amount !== null) {
        scope.putTerminal([original.attemptId, legacy.amount, boundedCanonical(legacyTerminal(original))]);
      }
    }
    return true;
  });
}
export const LEDGER_AUDIT_DEFINITIONS = Object.freeze(Object.fromEntries(
  ['schema', 'original', 'auditPage', 'emptyAttempt', 'orphanTerminal'].map(name => [name, Object.freeze({ ...DEFINITIONS[name] })])
));
export function createLedgerReadValidator(corrupt) {
  const checkedSchema = scope => { try { checkSchema(scope); } catch { corrupt(); } };
  const parseOriginal = encoded => {
    try {
      const stored = JSON.parse(encoded);
      const { windows, legacy, ...command } = stored;
      const original = legacy === undefined ? originalSnapshot(command) : legacySnapshot(command, legacy);
      if (!legacy && original.bindingGeneration === 'legacy') throw unavailable();
      if (boundedCanonical(original) !== encoded || canonical(windows) !== canonical(original.windows)) throw unavailable();
      return original;
    } catch { corrupt(); }
  };
  const verifyOriginal = (scope, original, encoded) => {
    if (scope.original([original.attemptId])?.original !== encoded) {
      corrupt();
    }
  };
  // One interpretation of stored facts for both runtime totals and audit.
  const validateStoredRow = (scope, row, validateGeneration) => {
    try {
      identifier(row.id);
      const original = parseOriginal(scope.original([row.id])?.original);
      if (original.attemptId !== row.id || original.keyId !== row.key_id ||
          original.startedAt !== row.started_at || original.windows.weekly.startAt !== row.week_start ||
          original.windows.monthly.startAt !== row.month_start) throw unavailable();
      if (original.legacy) {
        if (original.legacy.amount === null) {
          if (row.amount !== null || row.evidence !== null) throw unavailable();
          // Preserve source classifications in the attempt without creating a debit.
          return original.legacy.state === 'unrecorded' ? null : { provenance: 'legacy-no-recorded-cost' };
        }
        const evidence = legacyTerminal(original);
        if (row.amount !== evidence.amountNanoUsd || row.evidence !== boundedCanonical(evidence)) throw unavailable();
        return evidence;
      }
      validateGeneration?.(scope, row.key_id, original.bindingGeneration);
      if (row.evidence === null && row.amount === null) return null;
      nanoUsd(row.amount);
      const value = JSON.parse(row.evidence);
      if (value.amountNanoUsd !== row.amount ||
          boundedCanonical(terminalCost({ semantics: EXCLUSIVE_USAGE, components: value.known,
            ...(value.estimated !== undefined ? { estimated: value.estimated } : {}) }, original.price)) !== row.evidence) throw unavailable();
      return {
        ...value,
        supportsRecovery: original.provider === 'codex' && codexModelFromReference(original.price.revision) === original.model &&
          value.provenance === 'unknown/defaulted',
      };
    } catch { corrupt(); }
  };
  return Object.freeze({
    checkedSchema, parseOriginal, verifyOriginal, validateStoredRow,
    // Trusted internal composition hook only; cannot supply SQL or write scope.
    // Standalone primitive audit intentionally remains policy-independent.
    audit(scope, validateGeneration = null) {
      checkedSchema(scope);
      if (scope.emptyAttempt() || scope.orphanTerminal()) corrupt();
      let attempts = 0; let terminals = 0; let after = '';
      for (let pages = 0; pages < 33334; pages++) {
        const rows = scope.auditPage([after]);
        for (const row of rows) {
          if (row.id <= after) corrupt();
          validateStoredRow(scope, row);
          if (row.evidence !== null) terminals++;
          if (validateGeneration) {
            const original = parseOriginal(scope.original([row.id])?.original);
            validateGeneration(original.keyId, original.legacy ? '1' : original.bindingGeneration);
          }
          attempts++; after = row.id;
        }
        if (rows.length < 3) return Object.freeze({ validatedAttempts: attempts, validatedTerminals: terminals });
      }
      throw unavailable();
    },
  });
}

export function createNodeAttemptLedger(adapter, { requireRoute = false, requireAccount = false } = {}) {
  const { createAttempts, createTerminals, ...runtimeDefinitions } = DEFINITIONS;
  const transact = createNodeOuterTransaction(adapter, runtimeDefinitions);
  transact(checkSchema); // No row presence/read can manufacture an own ACK.
  const ownAcks = new WeakMap();
  const corrupt = () => {
    quarantineNodeAccountingConnection(adapter); faultAccounting(); throw unavailable();
  };
  const { checkedSchema, parseOriginal, verifyOriginal, validateStoredRow, audit } = createLedgerReadValidator(corrupt);
  const { resolve, inspectPolicy, validateAttemptGeneration } = createKeyPolicyReadValidator(corrupt);
  const finalReads = { ...runtimeDefinitions, ...KEY_POLICY_RESOLVE_DEFINITIONS, ...RECOVERY_READS };
  const finalTransaction = createNodeOuterTransaction(adapter, finalReads);
  const ownRoutes = new WeakMap();
  const ownAccounts = new WeakMap();
  let checkRouteTransaction;
  function readRecovery(scope, keyId, attemptId) {
    const row = scope.recovery([`attempt:${attemptId}`]);
    if (!row) return null;
    try {
      const record = JSON.parse(row.value);
      if (record.keyId !== keyId || record.attemptId !== attemptId ||
          record.actor !== 'dashboard-admin' || (!RECOVERY_ACTIONS.has(record.action) && record.action !== 'exact_usage') ||
          scope.recovery([`operation:${identifier(record.operationId)}`])?.value !== row.value) throw unavailable();
      if (record.action !== 'waive') nanoUsd(record.adjustmentNanoUsd);
      return record;
    } catch { corrupt(); }
  }
  const totals = (scope, keyId, windows, observation) => {
    let after = ''; let weekly = 0n; let monthly = 0n; let unknown = 0; let estimated = 0;
    // Bounded pages keep fixed-scope snapshots below payload limits. No REAL SUM
    // or signed64 aggregate overflow, no unrelated keys loaded into this process.
    for (let pages = 0; pages < 33334; pages++) {
      const rows = scope.page([keyId, after]);
      for (const row of rows) {
        if (row.id <= after || row.key_id !== keyId) corrupt();
        const value = validateStoredRow(scope, row, observation && validateAttemptGeneration);
        after = row.id;
        if (value === null) {
          if (observation && (row.week_start === windows.weekly.startAt || row.month_start === windows.monthly.startAt)) observation.unrecorded++;
          continue;
        }
        const recovery = value.supportsRecovery ? readRecovery(scope, keyId, row.id) : null;
        if (row.amount === null) continue;
        const amount = BigInt(row.amount) + BigInt(recovery?.adjustmentNanoUsd ?? '0');
        if (row.week_start === windows.weekly.startAt) weekly += amount;
        if (row.month_start === windows.monthly.startAt) monthly += amount;
        if (row.week_start === windows.weekly.startAt || row.month_start === windows.monthly.startAt) {
          if (value.unknown?.length) unknown++;
          if (value.estimated?.length) estimated++;
        }
      }
      if (rows.length < 3) return { weekly: weekly.toString(), monthly: monthly.toString(), unknown, estimated };
    }
    throw unavailable(); // Explicit capacity refusal, never silently truncate spend.
  };

  return Object.freeze({
    resolveUnresolvedUsage(keyId, attemptId, command, clock) {
      assertAccountingHealthy();
      identifier(keyId);
      identifier(attemptId);
      const { operationId, expectedVersion, reason, evidence, action, additionalNanoUsd } = command;
      identifier(operationId);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw conflict();
      text(reason, 'reason');
      text(evidence, 'evidence', 1000);
      if (!RECOVERY_ACTIONS.has(action)) throw conflict();
      const requested = { keyId, attemptId, operationId, expectedVersion, reason, evidence,
        actor: 'dashboard-admin', action,
        ...(action === 'cost_correction' ? { additionalNanoUsd: nanoUsd(additionalNanoUsd) } : {}),
      };
      const { value } = createNodeOuterTransaction(adapter, {
        ...runtimeDefinitions, ...KEY_POLICY_AUDIT_DEFINITIONS, ...KEY_POLICY_EVENT_BY_KEY,
        ...RECOVERY_READS, storeRecovery: RECOVERY_WRITE,
      })(scope => {
        checkedSchema(scope);
        const existing = scope.recovery([`operation:${operationId}`]);
        if (existing) {
          const { resolvedAt, adjustmentNanoUsd } = JSON.parse(existing.value);
          const replay = { ...requested, resolvedAt, ...(action === 'waive' ? {} : { adjustmentNanoUsd }) };
          if (boundedCanonical(replay) !== existing.value) return null;
          if (!readRecovery(scope, keyId, attemptId)) corrupt();
          return { operationId, resolvedAt };
        }
        const policy = inspectPolicy(scope, keyId);
        if (policy?.lifecycle !== 'active' || policy.version !== expectedVersion) return null;
        const originalRow = scope.original([attemptId]);
        const terminal = scope.terminal([attemptId]);
        if (!originalRow || !terminal) return null;
        const original = parseOriginal(originalRow.original);
        if (original.keyId !== keyId || readRecovery(scope, keyId, attemptId)) return null;
        const value = validateStoredRow(scope, { ...terminal, id: attemptId, key_id: keyId,
          started_at: original.startedAt, week_start: original.windows.weekly.startAt, month_start: original.windows.monthly.startAt },
        validateAttemptGeneration);
        if (!value?.supportsRecovery) return null;
        const resolvedAt = budgetInstant(clock);
        const adjustmentNanoUsd = additionalNanoUsd;
        if (action !== 'waive' && BigInt(terminal.amount) + BigInt(adjustmentNanoUsd) > MAX_NANO_USD) return null;
        const record = boundedCanonical({ ...requested, resolvedAt,
          ...(action === 'waive' ? {} : { adjustmentNanoUsd }),
        });
        scope.storeRecovery([`attempt:${attemptId}`, record]);
        scope.storeRecovery([`operation:${operationId}`, record]);
        return { operationId, resolvedAt };
      });
      if (!value) throw conflict();
      return value;
    },
    // Read-only startup prerequisite, not a new ACK or startup admission.
    // Unsettled intents remain unsettled (E2); never fabricate terminal zero.
    validateExistingAttempts() {
      assertAccountingHealthy();
      // Scope returns a detached JSON copy; freeze at the public boundary.
      return Object.freeze(transact(audit).value);
    },
    // Only this ledger can mint a proof for its own SQLite snapshot. Import the
    // router only for this candidate lane, not for storage/startup callers.
    async captureRoute(keyId) {
      identifier(keyId);
      const [{ captureNodeRoutingSnapshot, routingSnapshotMatches, ROUTING_READS }, { checkAccountedRoute }] = await Promise.all([
        import('./node-routing-snapshot.js'), import('../../sse/services/accounted-route.js'),
      ]);
      const accountOwner = requireAccount ? await import('./node-anthropic-account.js') : null;
      const priceOwner = requireAccount ? await import('./anthropic-reference-price.js') : null;
      const snapshot = captureNodeRoutingSnapshot(adapter, keyId);
      checkRouteTransaction ??= createNodeOuterTransaction(adapter, {
        ...finalReads, ...ROUTING_READS, ...accountOwner?.PROVIDER_ACCOUNT_READS, ...priceOwner?.ANTHROPIC_PRICE_READS, ...(requireAccount ? CODEX_PRICE_READS : {}),
      });
      let selectedOnce = false;
      return Object.freeze({ access: snapshot.access, reads: snapshot.reads, async select(branch, { provider, model }) {
        if (selectedOnce) throw unavailable();
        selectedOnce = true;
        await checkAccountedRoute(snapshot, branch, { provider, model });
        const proof = Object.freeze(Object.create(null));
        ownRoutes.set(proof, Object.freeze({ keyId, provider, model, stamp: snapshot.stamp, matches: routingSnapshotMatches }));
        return proof;
      } });
    },
    async bindAnthropicAccount(routeProof, connectionId, apiKey, inferenceGeo, requireSynced, expectedProxy = null) {
      const route = ownRoutes.get(routeProof);
      if (!requireAccount || route?.provider !== 'anthropic') throw unavailable();
      identifier(connectionId);
      const [owner, { readAnthropicReferencePrice }] = await Promise.all([
        import('./node-anthropic-account.js'), import('./anthropic-reference-price.js'),
      ]);
      const digest = owner.credentialDigest(apiKey);
      const accountMatches = scope => owner.readAnthropicAccount(scope, connectionId, route.model, expectedProxy) === digest;
      const readPrice = scope => readAnthropicReferencePrice(scope, route.model, inferenceGeo, requireSynced);
      const { value: price } = checkRouteTransaction(scope =>
        route.matches(scope, route.keyId, route.stamp) && accountMatches(scope) ? readPrice(scope) : null);
      if (!price) throw unavailable();
      const encodedPrice = canonical(price);
      const proof = Object.freeze(Object.create(null));
      ownAccounts.set(proof, { routeProof, encodedPrice,
        matches: scope => accountMatches(scope) && canonical(readPrice(scope)) === encodedPrice });
      return Object.freeze({ proof, price: Object.freeze({ ...price, rates: Object.freeze(price.rates) }) });
    },
    async bindOpenAIAccount(routeProof, connectionId, apiKey, expectedProxy = null) {
      const route = ownRoutes.get(routeProof);
      if (!requireAccount || route?.provider !== 'openai') throw unavailable();
      identifier(connectionId);
      const [{ credentialDigest, readApiKeyAccount }, { readOpenAIStandardReference }] = await Promise.all([
        import('./node-anthropic-account.js'), import('../pricing/openai-standard-reference.js'),
      ]);
      const digest = credentialDigest(apiKey);
      const matches = scope => readApiKeyAccount(scope, connectionId, route.model, 'openai', expectedProxy) === digest;
      const readPrice = scope => readOpenAIStandardReference(scope, route.model);
      const { value: price } = checkRouteTransaction(scope =>
        route.matches(scope, route.keyId, route.stamp) && matches(scope) ? readPrice(scope) : null);
      if (!price) throw unavailable();
      const encodedPrice = canonical(price);
      const proof = Object.freeze(Object.create(null));
      ownAccounts.set(proof, { routeProof, encodedPrice,
        matches: scope => matches(scope) && canonical(readPrice(scope)) === encodedPrice });
      return Object.freeze({ proof, price });
    },
    async bindCodexAccount(routeProof, connectionId, accessToken, accountId, priceBasis, expectedProxy = null) {
      const route = ownRoutes.get(routeProof);
      if (!requireAccount || route?.provider !== 'codex' || !priceBasis ||
          priceBasis !== codexStandardReferenceKey(route.model)) throw unavailable();
      identifier(connectionId);
      if (typeof accountId !== 'string' || !accountId) throw unavailable();
      const { credentialDigest, readCodexAccount } = await import('./node-anthropic-account.js');
      const digest = credentialDigest(accessToken);
      const matches = scope => {
        const current = readCodexAccount(scope, connectionId, route.model, Date.now(), expectedProxy);
        return current?.digest === digest && current.accountId === accountId;
      };
      const { value: price } = checkRouteTransaction(scope =>
        route.matches(scope, route.keyId, route.stamp) && matches(scope) ? readCodexPrice(scope, priceBasis) : null);
      if (!price) throw unavailable();
      const encodedPrice = canonical(price);
      const proof = Object.freeze(Object.create(null));
      ownAccounts.set(proof, { routeProof, encodedPrice,
        matches: scope => matches(scope) && canonical(readCodexPrice(scope, priceBasis)) === encodedPrice });
      return Object.freeze({ proof, price: Object.freeze({ ...price, rates: Object.freeze(price.rates) }) });
    },
    async bindClaudeAccount(routeProof, connectionId, accessToken, expectedProxy = null) {
      const route = ownRoutes.get(routeProof);
      if (!requireAccount || route?.provider !== 'claude') throw unavailable();
      identifier(connectionId);
      const [{ credentialDigest, readClaudeAccount }, { readClaudeStandardReference }] = await Promise.all([
        import('./node-anthropic-account.js'), import('../pricing/claude-standard-reference.js'),
      ]);
      const digest = credentialDigest(accessToken);
      const matches = scope => readClaudeAccount(scope, connectionId, route.model, Date.now(), expectedProxy) === digest;
      const readPrice = scope => readClaudeStandardReference(scope, route.model);
      const { value: price } = checkRouteTransaction(scope =>
        route.matches(scope, route.keyId, route.stamp) && matches(scope) ? readPrice(scope) : null);
      if (!price) throw unavailable();
      const encodedPrice = canonical(price);
      const proof = Object.freeze(Object.create(null));
      ownAccounts.set(proof, { routeProof, encodedPrice,
        matches: scope => matches(scope) && canonical(readPrice(scope)) === encodedPrice });
      return Object.freeze({ proof, price });
    },
    prepare(command, routeProof, accountProof) {
      assertAccountingHealthy();
      const original = originalSnapshot(command);
      if (original.bindingGeneration === 'legacy') throw unavailable();
      const route = ownRoutes.get(routeProof);
      if ((requireRoute || requireAccount || routeProof !== undefined) && (!route || route.keyId !== original.keyId ||
          route.provider !== original.provider || route.model !== original.model)) throw unavailable();
      const account = ownAccounts.get(accountProof);
      if ((requireAccount || accountProof !== undefined) && (!account || account.routeProof !== routeProof ||
          account.encodedPrice !== canonical(original.price))) throw unavailable();
      if (route) ownRoutes.delete(routeProof);
      if (account) ownAccounts.delete(accountProof);
      const encoded = boundedCanonical(original);
      let replay = false; let mismatched = false;
      transact(scope => {
        checkedSchema(scope);
        const previous = scope.original([original.attemptId]);
        if (previous) {
          parseOriginal(previous.original);
          replay = true; mismatched = previous.original !== encoded; return;
        }
        scope.putIntent([original.attemptId, original.keyId, original.startedAt,
          original.windows.weekly.startAt, original.windows.monthly.startAt, encoded]);
      });
      if (mismatched) throw conflict();
      if (replay) return Object.freeze({ replay: true }); // NEVER fresh network rights.
      let terminalPayload;
      // Authority bound now to this original command and this transaction engine.
      const record = transact.retainTerminal(scope => {
        checkedSchema(scope); verifyOriginal(scope, original, encoded);
        const previous = scope.terminal([original.attemptId]);
        if (previous) {
          if (previous.evidence !== terminalPayload || previous.amount !== JSON.parse(terminalPayload).amountNanoUsd) {
            corrupt();
          }
          return;
        }
        scope.putTerminal([original.attemptId, JSON.parse(terminalPayload).amountNanoUsd, terminalPayload]);
      });
      const ack = Object.freeze(Object.create(null));
      const state = { used: false, terminal: false, original, encoded, route, account };
      ownAcks.set(ack, state);
      let successorIssued = false;
      return Object.freeze({ replay: false, ack, successorRoute() {
        if (!route || !state.terminal || successorIssued) throw unavailable();
        successorIssued = true;
        const proof = Object.freeze(Object.create(null));
        ownRoutes.set(proof, route);
        return proof;
      }, settle(evidence) {
        const encodedTerminal = boundedCanonical(terminalCost(evidence, original.price));
        if (terminalPayload !== undefined) {
          if (terminalPayload !== encodedTerminal) throw conflict();
          if (!state.terminal) throw unavailable();
          return Object.freeze({ recorded: true, replay: true });
        }
        terminalPayload = encodedTerminal;
        state.used = true; // Even an unexposed terminal closes intent rights.
        record(); // Observed outer commit + restore; failure keeps sticky latch.
        state.terminal = true;
        return Object.freeze({ recorded: true, replay: false });
      } });
    },
    dispatch(ack, context, initiate) {
      const state = ownAcks.get(ack);
      if (!state || state.used || state.terminal) throw unavailable();
      const copy = snapshotPayload(context);
      if (!copy || Object.keys(copy).sort().join(',') !== 'now,presentedSecret') throw unavailable();
      const windows = budgetWindows(copy.now);
      if (windows.weekly.startAt !== state.original.windows.weekly.startAt ||
          windows.monthly.startAt !== state.original.windows.monthly.startAt) throw unavailable();
      return finalAccountingDispatch(() => {
        const { route } = state;
        const { value: allowed } = (route ? checkRouteTransaction : finalTransaction)(scope => {
          const binding = resolve(scope, copy.presentedSecret);
          if (!binding || binding.key_id !== state.original.keyId ||
              String(binding.generation) !== state.original.bindingGeneration) return false;
          if (route && !route.matches(scope, route.keyId, route.stamp)) return false;
          if (state.account && !state.account.matches(scope)) return false;
          checkedSchema(scope); verifyOriginal(scope, state.original, state.encoded);
          if (scope.terminal([state.original.attemptId])) throw unavailable();
          const spend = totals(scope, state.original.keyId, windows);
          return ['weekly', 'monthly'].every(period => binding[period] === null || BigInt(spend[period]) < BigInt(binding[period]));
        });
        // COMMIT orders concurrent changes; only successful cleanup and the
        // final process health check can lead to actual invocation.
        if (!allowed || state.used || state.terminal) return false;
        state.used = true; // Before actual synchronous invocation, even if it throws.
        return true;
      }, initiate);
    },
    inspectBudget(keyId, clock, priceBasis) {
      identifier(keyId);
      const readSnapshot = createNodeOuterTransaction(adapter, {
        ...KEY_POLICY_AUDIT_DEFINITIONS, ...KEY_POLICY_EVENT_BY_KEY, ...LEDGER_AUDIT_DEFINITIONS, page: DEFINITIONS.page, ...CODEX_PRICE_READS, ...RECOVERY_READS,
      });
      return readSnapshot(scope => {
        const windows = budgetWindows(budgetInstant(clock));
        const policy = inspectPolicy(scope, keyId, true);
        checkedSchema(scope);
        if (scope.emptyAttempt() || scope.orphanTerminal()) corrupt();
        if (!policy) {
          if (scope.page([keyId, '']).length) corrupt();
          return { policy: null, usage: null };
        }
        const observation = { unrecorded: 0 };
        const spend = totals(scope, keyId, windows, observation);
        const period = name => {
          const limit = policy.limits[name];
          const difference = limit === null ? null : BigInt(limit) - BigInt(spend[name]);
          return { spent: spend[name], remaining: difference === null ? null : String(difference > 0n ? difference : 0n),
            resetAt: windows[name].resetAt };
        };
        const reference = readCodexPrice(scope, priceBasis);
        return { ...(reference ? { referencePrice: reference } : {}), policy, usage: { weekly: period('weekly'), monthly: period('monthly'), timezone: windows.timezone,
          unknownDefaulted: spend.unknown, unrecorded: observation.unrecorded,
          ...(spend.estimated ? { estimated: spend.estimated } : {}) } };
      }).value;
    },
    totals(keyId, instant) {
      identifier(keyId); const windows = budgetWindows(instant);
      return finalTransaction(scope => {
        checkedSchema(scope);
        const { weekly, monthly, unknown } = totals(scope, keyId, windows);
        return { weekly, monthly, unknown };
      }).value;
    },
  });
}
