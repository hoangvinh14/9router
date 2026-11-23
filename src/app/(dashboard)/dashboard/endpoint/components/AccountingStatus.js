"use client";

import { useEffect, useId, useRef, useState } from "react";
import PropTypes from "prop-types";
import { loadAccountingStatus, loadBudget, saveBudget, resolveBudgetUsage } from "./accountingStatusClient";

function useSnapshot(keyId, load) {
  const [state, setState] = useState({ loading: true, value: null, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    load(keyId, { signal: controller.signal }).then(
      value => { if (current) setState({ loading: false, value, error: null }); },
      error => { if (current) setState({ loading: false, value: null, error: error.message }); },
    );
    return () => { current = false; controller.abort(); };
  }, [keyId, load, revision]);
  function refresh() {
    setState({ loading: true, value: null, error: null });
    setRevision(n => n + 1);
  }
  return { state, refresh };
}

function StatusSnapshot({ keyId }) {
  const { state, refresh } = useSnapshot(keyId, loadAccountingStatus);
  const value = state.value;
  return (
    <div className="mt-2 rounded border border-border p-3 text-xs text-text-muted" aria-busy={state.loading}>
      <p>Recorded policy and retirement status.</p>
      <div className="mt-2 min-h-6" role="status" aria-live="polite">
        {state.loading && <p>Loading accounting status…</p>}
        {state.error && <p>{state.error}</p>}
        {value && (
          <>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-1 break-words">
              <div><dt className="inline font-medium">Policy state: </dt><dd className="inline">{value.lifecycle}</dd></div>
              <div><dt className="inline font-medium">Policy version: </dt><dd className="inline">{value.version}</dd></div>
              <div><dt className="inline font-medium">Binding generation: </dt><dd className="inline">{value.bindingGeneration}</dd></div>
              <div><dt className="inline font-medium">Weekly limit (nano-USD): </dt><dd className="inline">{value.weekly ?? "Unlimited"}</dd></div>
              <div><dt className="inline font-medium">Monthly limit (nano-USD): </dt><dd className="inline">{value.monthly ?? "Unlimited"}</dd></div>
            </dl>
            {value.retirementEvent ? (
              <div className="mt-2 break-words">
                <p className="font-medium">Recorded retirement event</p>
                <p>Recorded time: <time dateTime={value.retirementEvent.occurredAt}>{value.retirementEvent.occurredAt}</time></p>
                <p>Actor class: {value.retirementEvent.actorClass} (shared authentication class, not an individual).</p>
                <p>Policy version {value.retirementEvent.previousVersion} → {value.retirementEvent.version}.</p>
              </div>
            ) : <p className="mt-2">No recorded retirement event. This does not mean this key was never retired.</p>}
            <p className="mt-2">Not a complete or tamper-proof audit history. Recorded time is not independently trusted chronology. Retired credentials remain stored; retirement is not secret erasure.</p>
          </>
        )}
      </div>
      <button type="button" className="mt-2 text-primary underline disabled:opacity-50" disabled={state.loading}
        onClick={refresh}>
        Refresh accounting status
      </button>
    </div>
  );
}

const resetFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh", dateStyle: "medium", timeStyle: "short",
});

function BudgetEditor({ keyId, budget, refresh }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event) {
    event.preventDefault();
    if (pending.current) return;
    const data = new FormData(event.currentTarget);
    const limits = {};
    for (const period of ["weekly", "monthly"]) {
      const input = data.get(period).trim();
      if (input.toLowerCase() === "unlimited") limits[period] = null;
      else if (/^(0|[1-9][0-9]{0,15})$/.test(input)) limits[period] = input;
      else { setError("Enter a whole nano-USD amount or Unlimited for each period."); return; }
    }
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    try {
      await saveBudget(keyId, budget.version, limits, controller.signal);
      if (!controller.signal.aborted) refresh();
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }
  return <form className="mt-3 space-y-2" onSubmit={submit}>
    <fieldset disabled={saving} className="grid gap-2 sm:grid-cols-2">
      <legend className="mb-1 font-medium">{budget.canCreate ? "Set budget limits" : "Edit budget limits"}</legend>
      {["weekly", "monthly"].map(name => {
        const period = budget.periods.find(item => item.name === name);
        return <label key={name} className="grid gap-1 capitalize">{name} limit (nano-USD)
          <input name={name} required autoComplete="off" className="rounded border border-border bg-transparent px-2 py-1"
            defaultValue={period ? period.limit ?? "Unlimited" : ""} />
        </label>;
      })}
    </fieldset>
    <p>Enter 0 to block the next request, or Unlimited for no limit.</p>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={saving} className="text-primary underline disabled:opacity-50">{saving ? "Saving…" : "Save budget"}</button>
  </form>;
}
BudgetEditor.propTypes = { keyId: PropTypes.string.isRequired, budget: PropTypes.object.isRequired, refresh: PropTypes.func.isRequired };

function UsageResolution({ keyId, attempt, version, refresh }) {
  const [action, setAction] = useState("waive");
  const [operation, setOperation] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = operation ?? { operationId: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join(""), expectedVersion: version,
      reason: form.get("reason"), evidence: form.get("evidence"), action,
      ...(action === "exact_usage" ? { counts: Object.fromEntries(attempt.unknown.map(category => [category, Number(form.get(category))])) } : {}),
      ...(action === "cost_correction" ? { additionalNanoUsd: form.get("additionalNanoUsd") } : {}),
    };
    setOperation(next);
    setPending(true);
    setError("");
    try {
      await resolveBudgetUsage(keyId, attempt.attemptId, next);
      refresh();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }
  return <details className="my-2">
    <summary>Resolve missing usage from {resetFormat.format(new Date(attempt.startedAt))}</summary>
    <form onSubmit={submit} className="mt-2 space-y-2">
      <p>Recorded cost of {attempt.knownCost} nano-USD stays charged. Resolve only the unknown usage.</p>
      <label className="block">Reason <input className="border border-border" name="reason" maxLength={512} required readOnly={Boolean(operation)} /></label>
      <label className="block">Evidence reference <input className="border border-border" name="evidence" maxLength={1000} required readOnly={Boolean(operation)} /></label>
      <label className="block">Resolution <select value={action} onChange={event => setAction(event.target.value)} disabled={Boolean(operation)}>
        <option value="waive">Waive missing usage</option>
        <option value="exact_usage" disabled={!attempt.unknown.length}>Enter exact token counts</option>
        <option value="cost_correction">Add a charge</option>
      </select></label>
      {action === "exact_usage" && attempt.unknown.map(category => (
        <label key={category} className="block">{category === "cached" ? "Cached input" : category} tokens
          <input className="border border-border" name={category} type="number" min="0" max="9007199254740991" step="1" required readOnly={Boolean(operation)} />
        </label>
      ))}
      {action === "cost_correction" && <label className="block">Additional charge (nano-USD)
        <input className="border border-border" name="additionalNanoUsd" inputMode="numeric" pattern="0|[1-9][0-9]{0,15}" required readOnly={Boolean(operation)} />
      </label>}
      {error && <p role="alert">{error}</p>}
      <button className="text-primary underline" disabled={pending} type="submit">
        {pending ? "Saving resolution..." : operation ? "Retry resolution" : "Confirm resolution"}
      </button>
    </form>
  </details>;
}
UsageResolution.propTypes = {
  keyId: PropTypes.string.isRequired, attempt: PropTypes.object.isRequired, version: PropTypes.number.isRequired,
  refresh: PropTypes.func.isRequired,
};

function BudgetSnapshot({ keyId }) {
  const { state, refresh } = useSnapshot(keyId, loadBudget);
  const budget = state.value;
  return (
    <div className="mt-2 rounded border border-border p-3 text-xs text-text-muted" aria-busy={state.loading}>
      <div role="status" aria-live="polite">
        {state.loading && <p>Loading budget…</p>}
        {state.error && <p>{state.error}</p>}
        {budget?.available === false && !budget.canCreate && <p>No budget profile is available for this key.</p>}
        {budget?.available && <>
          <p>Policy version {budget.version} ({budget.lifecycle})</p>
          {budget.referencePrice && <p>
            OpenAI Codex Standard reference (USD per million tokens): input {budget.referencePrice.input},
            cached input {budget.referencePrice.cached}, output {budget.referencePrice.output}.
            Synced <time dateTime={budget.referencePrice.syncedAt}>{resetFormat.format(new Date(budget.referencePrice.syncedAt))}</time>.
          </p>}
          <div className="my-2 grid gap-3 sm:grid-cols-2">
            {budget.periods.map(period => <section key={period.name}>
              <h4 className="font-medium capitalize">{period.name} budget</h4>
              <p>Limit (nano-USD): {period.limit ?? "Unlimited"}</p>
              <p>Recorded spend (nano-USD): {period.spent}</p>
              <p>Remaining (nano-USD): {period.remaining ?? "Unlimited"}</p>
              <p>Resets <time dateTime={period.resetAt}>{resetFormat.format(new Date(period.resetAt))}</time> ({budget.timezone})</p>
            </section>)}
          </div>
          {budget.blockedByUnresolvedUsage && <p>Requests are blocked because a previous Codex response has unresolved usage.</p>}
          {budget.unknownDefaulted > 0 && <p>Unknown/defaulted usage on {budget.unknownDefaulted} attempt(s). Recorded spend may be understated.</p>}
          {budget.unrecorded > 0 && <p>{budget.unrecorded} attempt(s) have no recorded terminal cost. Their cost is excluded from recorded spend.</p>}
        </>}
      </div>
      {budget?.lifecycle === "active" && budget.unresolvedAttempts?.map(attempt => (
        <UsageResolution key={attempt.attemptId} keyId={keyId} attempt={attempt} version={budget.version} refresh={refresh} />
      ))}
      {(budget?.canCreate || budget?.lifecycle === "active") && <BudgetEditor key={budget.version} keyId={keyId} budget={budget} refresh={refresh} />}
      <button type="button" className="mt-2 text-primary underline disabled:opacity-50" disabled={state.loading} onClick={refresh}>
        Refresh budget
      </button>
    </div>
  );
}
BudgetSnapshot.propTypes = { keyId: PropTypes.string.isRequired };

export default function AccountingStatus({ keyId }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const [budgetOpen, setBudgetOpen] = useState(false);
  const budgetId = useId();
  return (
    <div className="mt-2">
      <button type="button" className="text-xs text-primary underline" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(value => !value)}>
        {open ? "Hide accounting status" : "Accounting status"}
      </button>
      <button type="button" className="ml-3 text-xs text-primary underline" aria-expanded={budgetOpen} aria-controls={budgetId}
        onClick={() => setBudgetOpen(value => !value)}>
        {budgetOpen ? "Hide budget" : "View budget"}
      </button>
      <div id={budgetId}>{budgetOpen && <BudgetSnapshot key={keyId} keyId={keyId} />}</div>
      <div id={panelId}>{open && <StatusSnapshot key={keyId} keyId={keyId} />}</div>
    </div>
  );
}
StatusSnapshot.propTypes = { keyId: PropTypes.string.isRequired };
AccountingStatus.propTypes = { keyId: PropTypes.string.isRequired };
