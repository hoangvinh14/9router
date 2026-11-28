"use client";

import { useEffect, useId, useRef, useState } from "react";
import PropTypes from "prop-types";
import { decimalToNanoUsd, nanoUsdToDecimal } from "@/lib/pricing/decimalMoney.js";

const displayUsd = amount => amount === null ? "Unlimited" : nanoUsdToDecimal(amount);
import { loadAccountingStatus, loadBudget, saveBudget, resolveBudgetUsage, rotateBudgetKey } from "./accountingStatusClient";

function useSnapshot(keyId, load) {
  const [snapshot, setState] = useState(null);
  const state = snapshot?.keyId === keyId ? snapshot : { loading: true, value: null, error: null };
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    load(keyId, { signal: controller.signal }).then(
      value => { if (current) setState({ keyId, loading: false, value, error: null }); },
      error => { if (current) setState({ keyId, loading: false, value: null, error: error.message }); },
    );
    return () => { current = false; controller.abort(); };
  }, [keyId, load, revision]);
  function refresh() {
    setState({ keyId, loading: true, value: null, error: null });
    setRevision(n => n + 1);
  }
  return { state, refresh };
}

function StatusSnapshot({ keyId, onRotated }) {
  const { state, refresh } = useSnapshot(keyId, loadAccountingStatus);
  const value = state.value;
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState(null);
  const [rotationError, setRotationError] = useState("");
  async function rotate() {
    if (pending || !window.confirm("Rotate this API key? The old key will stop working immediately.")) return;
    setPending(true);
    setRotationError("");
    try {
      const { key } = await rotateBudgetKey(keyId, value.version);
      setSecret(key);
      if (!key) setRotationError("Rotation committed. Confirm a new rotation to obtain a fresh key.");
      onRotated?.(keyId);
    } catch (error) {
      setRotationError(error.message);
    } finally {
      setPending(false);
      refresh();
    }
  }
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
              <div><dt className="inline font-medium">Weekly limit (USD): </dt><dd className="inline">{displayUsd(value.weekly)}</dd></div>
              <div><dt className="inline font-medium">Monthly limit (USD): </dt><dd className="inline">{displayUsd(value.monthly)}</dd></div>
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
      {value?.lifecycle === "active" && !secret && (
        <button type="button" className="mt-2 mr-3 text-primary underline disabled:opacity-50"
          disabled={pending} onClick={rotate}>Rotate API key</button>
      )}
      {rotationError && <p role="alert" className="mt-2">{rotationError}</p>}
      {secret && (
        <div className="mt-2">
          <p>Copy the new API key now. It is shown once.</p>
          <code className="block break-all select-all">{secret}</code>
          <button type="button" className="mt-2 text-primary underline" onClick={() => setSecret(null)}>Done</button>
        </div>
      )}
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
      if (input === "" || input.toLowerCase() === "unlimited") limits[period] = null;
      else {
        try { limits[period] = decimalToNanoUsd(input); }
        catch { setError("Enter a USD amount from 0 to 9,000,000 with up to nine decimal places, or Unlimited."); return; }
      }
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
        return <label key={name} className="grid gap-1 capitalize">{name} limit (USD)
          <input name={name} autoComplete="off" className="rounded border border-border bg-transparent px-2 py-1"
            defaultValue={period ? displayUsd(period.limit) : ""} />
        </label>;
      })}
    </fieldset>
    <p>Leave a limit blank or enter Unlimited for no limit. Enter 0 to block the next request.</p>
    <p>Saving a budget can block requests when the router cannot find an account with supported usage accounting and pricing.</p>
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
        <option value="cost_correction">Add a charge</option>
      </select></label>
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

function BudgetSnapshot({ keyId, state, refresh }) {
  const budget = state.value;
  return (
    <div className="mt-2 rounded border border-border p-3 text-xs text-text-muted" aria-busy={state.loading}>
      <div role="status" aria-live="polite">
        {state.loading && <p>Loading budget…</p>}
        {state.error && <p>{state.error}</p>}
        {budget?.available === false && !budget.canCreate && <p>Budget storage is unavailable for this key.</p>}
        {budget?.available && <>
          <p>Policy version {budget.version} ({budget.lifecycle})</p>
          <div className="my-2 grid gap-3 sm:grid-cols-2">
            {budget.periods.map(period => <section key={period.name}>
              <h4 className="font-medium capitalize">{period.name} budget</h4>
              <p>Limit (USD): {displayUsd(period.limit)}</p>
              <p>Recorded spend (USD): {displayUsd(period.spent)}</p>
              <p>Remaining (USD): {displayUsd(period.remaining)}</p>
              <p>Resets <time dateTime={period.resetAt}>{resetFormat.format(new Date(period.resetAt))}</time> ({budget.timezone})</p>
            </section>)}
          </div>
          {budget.blockedByUnresolvedUsage && <p>Requests are blocked because a previous Codex response has unresolved usage.</p>}
          {budget.estimated > 0 && <p>Recorded spend includes estimated usage on {budget.estimated} attempt(s).</p>}
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
BudgetSnapshot.propTypes = { keyId: PropTypes.string.isRequired, state: PropTypes.object.isRequired, refresh: PropTypes.func.isRequired };

export default function AccountingStatus({ keyId, onRotated }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const [budgetOpen, setBudgetOpen] = useState(false);
  const budget = useSnapshot(keyId, loadBudget);
  const budgetId = useId();
  return (
    <div className="mt-2">
      <button type="button" className="text-xs text-primary underline" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(value => !value)}>
        {open ? "Hide accounting status" : "Accounting status"}
      </button>
      <button type="button" className="ml-3 text-xs text-primary underline" aria-expanded={budgetOpen} aria-controls={budgetId}
        onClick={() => setBudgetOpen(value => !value)}>
        {budgetOpen ? "Hide budget" : budget.state.value?.canCreate ? "Set budget" : "View budget"}
      </button>
      <div id={budgetId}>{budgetOpen && <BudgetSnapshot key={keyId} keyId={keyId} {...budget} />}</div>
      <div id={panelId}>{open && <StatusSnapshot key={keyId} keyId={keyId} onRotated={onRotated} />}</div>
    </div>
  );
}
StatusSnapshot.propTypes = { keyId: PropTypes.string.isRequired, onRotated: PropTypes.func };
AccountingStatus.propTypes = { keyId: PropTypes.string.isRequired, onRotated: PropTypes.func };
