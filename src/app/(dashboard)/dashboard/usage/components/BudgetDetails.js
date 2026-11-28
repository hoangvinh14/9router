"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { decimalToNanoUsd, nanoUsdToDecimal } from "@/lib/pricing/decimalMoney.js";
import { resolveBudgetUsage, saveBudget } from "../../endpoint/components/accountingStatusClient";

export const displayUsd = amount => amount === null ? "Unlimited" : nanoUsdToDecimal(amount);

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

function BudgetPeriod({ period, timezone }) {
  const limit = period.limit === null ? null : BigInt(period.limit);
  const spent = BigInt(period.spent);
  const used = limit === null ? null : spent >= limit ? 100 : Number(spent * 1000n / limit) / 10;

  return (
    <section className="min-w-0 break-words rounded-brand border border-border-subtle bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="font-medium capitalize text-text-main">{period.name} budget</h4>
        <p>Limit (USD): {displayUsd(period.limit)}</p>
      </div>
      {used !== null && (
        <progress
          className="my-2 block h-1.5 w-full appearance-none overflow-hidden rounded-full bg-surface-2 [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-surface-2 [&::-webkit-progress-value]:bg-primary"
          aria-label={`${period.name} budget used`}
          value={used}
          max={100}
        />
      )}
      <div className="mt-1 flex flex-wrap justify-between gap-x-3 tabular-nums">
        <p>Recorded spend (USD): {displayUsd(period.spent)}</p>
        <p>Remaining (USD): {displayUsd(period.remaining)}</p>
      </div>
      <p className="mt-1 text-xs">Resets <time dateTime={period.resetAt}>{resetFormat.format(new Date(period.resetAt))}</time> ({timezone})</p>
    </section>
  );
}

BudgetPeriod.propTypes = { period: PropTypes.object.isRequired, timezone: PropTypes.string.isRequired };

export default function BudgetDetails({ keyId, state, refresh }) {
  const budget = state.value;
  const [editing, setEditing] = useState(false);
  const canEdit = budget?.canCreate || budget?.lifecycle === "active";
  return (
    <div className="mt-2 text-sm text-text-muted" aria-busy={state.loading}>
      <div role="status" aria-live="polite">
        {state.loading && <p>Loading budget…</p>}
        {state.error && <p>{state.error}</p>}
        {budget?.canCreate && <p>No budget configured.</p>}
        {budget?.available === false && !budget.canCreate && <p>Budget storage is unavailable for this key.</p>}
        {budget?.available && <>
          <p className="text-xs">Policy version {budget.version} ({budget.lifecycle})</p>
          <div className="my-2 grid gap-3 sm:grid-cols-2">
            {budget.periods.map(period => <BudgetPeriod key={period.name} period={period} timezone={budget.timezone} />)}
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
      {canEdit && editing && <BudgetEditor key={budget.version} keyId={keyId} budget={budget} refresh={refresh} />}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        <button type="button" className="min-h-9 text-primary underline disabled:opacity-50" disabled={state.loading} onClick={refresh}>
          Refresh budget
        </button>
        {canEdit && (
          <button type="button" className="min-h-9 rounded-lg border border-border bg-surface px-3 font-medium text-text-main hover:bg-surface-2"
            aria-expanded={editing} onClick={() => setEditing(value => !value)}>
            {editing ? "Close editor" : budget.canCreate ? "Set budget" : "Edit budget"}
          </button>
        )}
      </div>
    </div>
  );
}
BudgetDetails.propTypes = { keyId: PropTypes.string.isRequired, state: PropTypes.object.isRequired, refresh: PropTypes.func.isRequired };
