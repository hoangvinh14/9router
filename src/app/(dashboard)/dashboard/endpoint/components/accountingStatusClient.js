// Display/request boundary only. The server remains the policy/audit authority;
// none of this data grants dispatch, recovery, mutation or credential rights.
const unavailable = () => new Error("Accounting status unavailable. No policy or retirement conclusion can be drawn.");
const validId = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value >= 1;
const generation = value => typeof value === "string" && /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
const amount = value => value === null || typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);

export function accountingStatusView(body, keyId) {
  const policy = body?.policy;
  const readiness = body?.readiness;
  const validReadiness = (readiness?.ready === false && readiness.reason === "no_admitted_profile") ||
    (readiness?.ready === true && readiness.reason === null);
  if (!validId(keyId) || !validReadiness ||
      body.usage !== null || policy?.keyId !== keyId || !positive(policy.version) ||
      !generation(policy.bindingGeneration) || !["active", "disabled", "retired"].includes(policy.lifecycle) ||
      !policy.limits || !amount(policy.limits.weekly) || !amount(policy.limits.monthly)) throw unavailable();
  let retirementEvent = null;
  if (body.retirementEvent !== null) {
    const event = body.retirementEvent;
    if (!event || policy.lifecycle !== "retired" || event.action !== "retire" || event.actorClass !== "dashboard-session" ||
        event.version !== policy.version || !positive(event.previousVersion) || event.version !== event.previousVersion + 1 ||
        event.bindingGeneration !== policy.bindingGeneration || typeof event.occurredAt !== "string" ||
        !Number.isFinite(Date.parse(event.occurredAt)) || new Date(event.occurredAt).toISOString() !== event.occurredAt) throw unavailable();
    retirementEvent = Object.freeze({ occurredAt: event.occurredAt, actorClass: event.actorClass,
      version: event.version, previousVersion: event.previousVersion, bindingGeneration: event.bindingGeneration });
  }
  // Project explicitly: never pass unknown server fields or credential material
  // to the component, even if a future/incorrect response includes them.
  return Object.freeze({ lifecycle: policy.lifecycle, version: policy.version, bindingGeneration: policy.bindingGeneration,
    weekly: policy.limits.weekly, monthly: policy.limits.monthly, retirementEvent });
}

function budgetView(body, keyId) {
  const { policy, usage, readiness } = body;
  if (readiness?.ready === false && readiness.reason === "no_admitted_profile" && policy === null && usage === null) {
    return { available: false };
  }
  if (readiness?.ready !== true || readiness.reason !== null || policy?.keyId !== keyId ||
      !positive(policy.version) || !generation(policy.bindingGeneration) ||
      !["active", "disabled", "retired"].includes(policy.lifecycle) || usage?.timezone !== "Asia/Ho_Chi_Minh" ||
      ![usage.unknownDefaulted, usage.unrecorded, usage.estimated ?? 0].every(n => Number.isSafeInteger(n) && n >= 0)) throw unavailable();
  const periods = ["weekly", "monthly"].map(name => {
    const limit = policy.limits[name];
    const { spent, remaining, resetAt } = usage[name];
    if (!amount(limit) || spent === null || !amount(spent) || !amount(remaining) ||
        (limit === null) !== (remaining === null) || typeof resetAt !== "string" ||
        new Date(resetAt).toISOString() !== resetAt) throw unavailable();
    return { name, limit, spent, remaining, resetAt };
  });
  const price = body.referencePrice;
  const rates = price?.rates;
  const referencePrice = price?.revision === "openai:codex/gpt-6.2-sol:standard:v1" &&
    Number.isSafeInteger(price.syncedAt) && price.syncedAt > 0 && price.syncedAt <= 8640000000000000 &&
    [rates?.input, rates?.cached, rates?.output].every(rate => typeof rate === "string" && /^\d+(?:\.\d+)?$/.test(rate))
    ? { input: rates.input, cached: rates.cached, output: rates.output, syncedAt: new Date(price.syncedAt).toISOString() }
    : null;
  const referencePrices = Array.isArray(body.referencePrices)
    ? body.referencePrices.slice(0, 128).flatMap(price => {
      const match = /^(anthropic:claude|openai:codex)\/([a-z0-9][a-z0-9.-]+):standard:v1$/.exec(price?.revision);
      const codex = match?.[1] === "openai:codex";
      const rates = price?.rates;
      const required = ["input", "output", "cached", ...(codex ? [] : ["cache_creation", "cache_creation_1h"])];
      if (!match || !Number.isSafeInteger(price.syncedAt) || price.syncedAt <= 0 || price.syncedAt > 8640000000000000 ||
          !required.every(field => typeof rates?.[field] === "string" && /^\d+(?:\.\d+)?$/.test(rates[field]))) return [];
      return [{ model: match[2], rates, codex, syncedAt: new Date(price.syncedAt).toISOString() }];
    })
    : [];
  const unresolvedAttempts = usage.blockedByUnresolvedUsage === true && Array.isArray(usage.unresolvedAttempts)
    ? usage.unresolvedAttempts.slice(0, 20)
      .filter(item => validId(item?.attemptId) && typeof item.startedAt === "string" &&
        Number.isFinite(Date.parse(item.startedAt)) && item.knownCost !== null && amount(item.knownCost))
      .map(({ attemptId, startedAt, knownCost }) => ({ attemptId, startedAt, knownCost }))
    : [];
  return { available: true, version: policy.version, lifecycle: policy.lifecycle, periods, unresolvedAttempts,
    ...(referencePrice ? { referencePrice } : {}),
    ...(referencePrices.length ? { referencePrices } : {}),
    ...(usage.blockedByUnresolvedUsage === true ? { blockedByUnresolvedUsage: true } : {}),
    ...(usage.estimated ? { estimated: usage.estimated } : {}),
    unknownDefaulted: usage.unknownDefaulted, unrecorded: usage.unrecorded, timezone: usage.timezone };
}

async function loadSnapshot(keyId, suffix, project, failure, { signal, fetcher = fetch } = {}) {
  if (!validId(keyId)) throw failure();
  let response;
  try {
    response = await fetcher(`/api/keys/${encodeURIComponent(keyId)}/budget${suffix}`, {
      method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    });
  } catch { throw failure(); }
  if (response.status === 401) throw new Error("A signed dashboard session is required to read accounting status.");
  if (response.status === 503 && suffix === "") {
    const body = await response.json().catch(() => null);
    if (body?.keyId === keyId && body.error?.code === "budget_not_configured") {
      return { available: false, canCreate: true, version: 0, periods: [] };
    }
  }
  if (!response.ok) throw failure();
  try { return project(await response.json(), keyId); }
  catch { throw failure(); }
}

export function loadAccountingStatus(keyId, options) {
  return loadSnapshot(keyId, "/retire", accountingStatusView, unavailable, options);
}

export function loadBudget(keyId, options) {
  return loadSnapshot(keyId, "", budgetView, () => new Error("Budget data unavailable."), options);
}

export async function saveBudget(keyId, version, limits, signal) {
  const failure = "Save could not be confirmed. Refresh the budget before trying again.";
  let response;
  try {
    response = await fetch(`/api/keys/${encodeURIComponent(keyId)}/budget`, {
      method: "PUT", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
      headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: version, limits }),
    });
  } catch { throw new Error(failure); }
  if (response.status === 400) throw new Error("Enter a limit from 0 to 9000000000000000 nano-USD, or Unlimited.");
  if (response.status === 409) throw new Error("The policy changed. Refresh the budget to edit the current limits.");
  if (response.status === 401) throw new Error("Sign in to the dashboard and refresh the budget.");
  if (!response.ok) throw new Error(failure);
  const policy = (await response.json().catch(() => null))?.policy;
  if (policy?.keyId !== keyId || policy.version !== version + 1 ||
      policy.limits?.weekly !== limits.weekly || policy.limits?.monthly !== limits.monthly) throw new Error(failure);
}

export async function resolveBudgetUsage(keyId, attemptId, operation) {
  const response = await fetch(`/api/keys/${encodeURIComponent(keyId)}/budget/attempts/${encodeURIComponent(attemptId)}/resolve`, {
    method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(operation),
  });
  if (response.status === 409) throw new Error("The attempt or policy changed. Refresh the budget.");
  const receipt = response.ok ? await response.json().catch(() => null) : null;
  if (receipt?.operationId !== operation.operationId) throw new Error("Resolution could not be confirmed. Refresh the budget or retry.");
}
