"use client";
import { useEffect, useId, useRef, useState } from "react";
import { attemptRecoveryDraft, budgetPolicyDraft, gapRecoveryDraft, retainedRecoveryMutation, validateBudgetPolicyDraft, validateRecoveryAcknowledgement } from "../utils/budgetManagementDraft.js";

const defaultUsage = "";
export default function ApiKeyBudgetPanel({ apiKeyId, keyName, onClose }) {
  const label = useId(), panel = useRef(null), close = useRef(null), mounted = useRef(true), restored = useRef(false);
  const [status, setStatus] = useState(null), [attempts, setAttempts] = useState([]), [usage, setUsage] = useState(null);
  const [policy, setPolicy] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(null), [retentionError, setRetentionError] = useState(false);
  const [target, setTarget] = useState(null), [action, setAction] = useState("waive"), [reason, setReason] = useState(""), [evidence, setEvidence] = useState(""), [costUsd, setCostUsd] = useState(""), [usageJson, setUsageJson] = useState(defaultUsage);
  const storageKey = `9router:accounting-recovery:${apiKeyId}`;
  const base = `/api/keys/${encodeURIComponent(apiKeyId)}`;
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; close.current?.focus();
    return () => { mounted.current = false; document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, [storageKey, base]);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const load = async () => {
      setLoading(true); setError("");
      try {
        const responses = await Promise.all([fetch(`${base}/budget`, { signal: controller.signal }), fetch(`${base}/accounting?state=unresolved&limit=50`, { signal: controller.signal }), fetch(`${base}/usage?limit=50`, { signal: controller.signal })]);
        if (!active) return;
        if (!restored.current) {
          try {
            const stored = sessionStorage.getItem(storageKey);
            if (stored) {
              const retained = JSON.parse(stored), prefix = `${base}/accounting/`;
              if (typeof retained.url !== "string" || !retained.url.startsWith(prefix) || !/^(gaps|[^/?#]+)\/resolve$/.test(retained.url.slice(prefix.length)) || !retained.payload || typeof retained.payload.operationId !== "string" || stored.length > 16384) throw new Error("Invalid retained operation");
              setPending(retained); setNotice("An earlier recovery has an uncertain acknowledgement. Retry the unchanged operation; do not create a second correction.");
            }
          } catch { setRetentionError(true); setError("Recovery retry state is unavailable. Reconcile the earlier operation with an operator before submitting another correction."); }
          restored.current = true;
        }
        if (responses.some(response => !response.ok)) throw new Error("Accounting data unavailable or access denied. No allowance is inferred.");
        const [budget, ledger, pageUsage] = await Promise.all(responses.map(response => response.json()));
        if (!active) return;
        setStatus(budget); setPolicy(budgetPolicyDraft(budget)); setAttempts(ledger.attempts); setUsage(pageUsage);
      } catch (error) { if (active && !controller.signal.aborted) { setStatus(null); setPolicy(null); setAttempts([]); setUsage(null); setError(error.message || "Accounting unavailable"); } }
      finally { if (active) setLoading(false); }
    };
    load(); return () => { active = false; controller.abort(); };
  }, [base, storageKey, revision]);
  const dismiss = () => { if (!busy) onClose(); };
  const trap = event => {
    if (event.key === "Escape") { event.preventDefault(); dismiss(); }
    if (event.key !== "Tab") return;
    const items = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')].filter(element => element.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); panel.current.focus(); }
    else if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const savePolicy = async () => {
    setError(""); setNotice("");
    let payload; try { payload = validateBudgetPolicyDraft(policy); } catch (error) { setError(error.message); return; }
    setBusy(true);
    try {
      const response = await fetch(`${base}/budget`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(response.status === 409 ? "Policy state changed or enforcement is not ready. Refresh before editing." : "Policy save unavailable; acknowledgement may be uncertain. Refresh and inspect the version before retrying.");
      const result = await response.json();
      if (mounted.current) { setStatus(result); setPolicy(budgetPolicyDraft(result)); setNotice("Policy saved. Recorded spend and history are unchanged."); }
    } catch (error) { if (mounted.current) setError(error.message || "Policy acknowledgement uncertain; refresh before retrying"); }
    finally { if (mounted.current) setBusy(false); }
  };
  const submitRecovery = async retained => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(retained.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(retained.payload) });
      if (!response.ok) throw new Error(response.status === 409 ? "Recovery state conflicts. Keep this operation identity and reconcile before creating another correction." : "Recovery not acknowledged. Retry the unchanged operation; do not assume rollback.");
      validateRecoveryAcknowledgement(await response.json(), retained, apiKeyId);
      // Remove only after a committed, scope/operation-bound receipt. If storage cleanup
      // fails, replaying this same operation is safer than a new correction.
      sessionStorage.removeItem(storageKey);
      if (mounted.current) { setPending(null); setTarget(null); setReason(""); setEvidence(""); setNotice("Recovery saved. Refreshing status; a refresh failure does not undo recovery."); setRevision(value => value + 1); }
    } catch (error) { if (mounted.current) setError(error.message || "Recovery acknowledgement uncertain. Retry the unchanged operation."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const createRecovery = () => {
    try {
      const operationId = crypto.randomUUID();
      const payload = target.kind === "gap" ? gapRecoveryDraft(target.row, { reason, evidence }, operationId) : attemptRecoveryDraft(target.row, { action, reason, evidence, costUsd, usageJson }, operationId);
      const retained = retainedRecoveryMutation(apiKeyId, { kind: target.kind, attemptId: target.row.attemptId }, payload);
      // Persist retry identity BEFORE POST; storage failure never dispatches.
      sessionStorage.setItem(storageKey, JSON.stringify(retained)); setPending(retained); submitRecovery(retained);
    } catch (error) { setError(error.message || "Recovery draft unavailable"); }
  };
  const disabled = busy || loading || !status || Boolean(pending) || retentionError;
  const restricted = policy && (policy.weeklyLimitUsd !== null || policy.monthlyLimitUsd !== null);
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
    <div className="absolute inset-0 bg-black/50" onClick={dismiss} aria-hidden="true" />
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={label} tabIndex={-1} onKeyDown={trap} className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[14px] bg-surface border border-border-subtle p-4 sm:p-6 space-y-4">
      <header className="flex justify-between items-center gap-3"><h2 id={label} className="text-lg font-semibold">Budget and accounting — {keyName || apiKeyId}</h2><button ref={close} type="button" onClick={dismiss} disabled={busy} aria-label="Close budget and accounting" className="p-2 border border-border-subtle rounded-lg">Close</button></header>
      <p className="text-sm text-text-muted">Virtual reference costs, not invoices. Chat and embeddings only. Weekly/monthly recorded-spend gates are not a hard cap: concurrent admissions may overshoot. Requests can create multiple charged upstream attempts through retry, fallback and fusion.</p>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      {loading && <p role="status">Loading key accounting…</p>}
      <button type="button" disabled={busy || loading} onClick={() => setRevision(value => value + 1)} className="px-3 py-2 border border-border-subtle rounded-lg">Refresh accounting</button>
      {pending && <div className="border border-border-subtle p-3 rounded-lg space-y-2"><p className="text-sm">Retained recovery operation: <code className="break-all">{pending.payload.operationId}</code>. New corrections are disabled until this operation is acknowledged or reconciled by an operator.</p><button type="button" disabled={busy} onClick={() => submitRecovery(pending)} className="px-3 py-2 border border-border-subtle rounded-lg">Retry unchanged recovery</button></div>}
      {status && <>
        <p className="font-semibold">Enforcement: {status.enforcementActive ? "Active" : "OFF — no protection advertised"}; state: {status.status}</p>
        <p className="text-sm">Coverage starts: {status.ledgerStartedAt || "Not activated"}. Timezone: {status.timezone}. Pending attempts: {status.counts.pending}; unresolved: {status.counts.unresolved}. Unresolved usage is not zero and never expires at a calendar reset.</p>
        <div className="grid sm:grid-cols-2 gap-3">{["weekly", "monthly"].map(window => <div key={window} className="border border-border-subtle p-3 rounded-lg space-y-1"><h3 className="font-semibold capitalize">{window}</h3><p>Recorded spend: ${status[window].spentUsd}</p><p>Remaining: {status[window].remainingUsd === null ? "Unlimited" : `$${status[window].remainingUsd}`}; overshoot: ${status[window].overshootUsd}</p><p className="text-sm break-all">Reset: {status[window].resetAt} ({status.timezone})</p><label className="flex gap-2 items-center"><input type="checkbox" checked={policy[`${window}LimitUsd`] === null} disabled={disabled} onChange={event => setPolicy(value => ({ ...value, [`${window}LimitUsd`]: event.target.checked ? null : "0" }))} />{window} unlimited</label>{policy[`${window}LimitUsd`] !== null && <label className="block text-sm">{window} limit USD<input type="text" inputMode="decimal" value={policy[`${window}LimitUsd`]} disabled={disabled} onChange={event => setPolicy(value => ({ ...value, [`${window}LimitUsd`]: event.target.value }))} className="block w-full p-2 border border-border-subtle rounded-lg bg-surface" /></label>}</div>)}</div>
        <p className="text-sm text-text-muted">null = unlimited; zero denies immediately once enforcement is ready. Editing never resets spend. Missing exact usage or unsupported provider semantics requires audited recovery. Global gaps require separate scope-wide operator reconciliation; key waiver cannot clear them.</p>
        {!status.enforcementActive && <p className="text-sm">Accounting integration is inactive. Non-unlimited limits cannot be saved yet.</p>}
        <button type="button" disabled={disabled || restricted && !status.enforcementActive || !status.active} onClick={savePolicy} className="px-3 py-2 border border-border-subtle rounded-lg">Save budget policy</button>
        <h3 className="font-semibold">Coverage gaps</h3>
        {status.coverage.gaps.length === 0 ? <p className="text-sm">No recorded coverage gaps.</p> : status.coverage.gaps.map(gap => <div key={gap.id} className="border border-border-subtle p-3 rounded-lg text-sm"><p>{gap.apiKeyId === null ? "Global gap" : "Key gap"} — {gap.resolvedAt ? "Audited waiver recorded, not restored exact coverage" : "Unreconciled"}; generation {gap.generation}</p><p>{gap.startedAt} — {gap.lastObservedAt}</p>{!gap.resolvedAt && gap.apiKeyId === apiKeyId && <button type="button" disabled={disabled || Boolean(status.coverage.maintenance)} onClick={() => setTarget({ kind: "gap", row: gap })} className="px-3 py-2 border border-border-subtle rounded-lg">Review key gap</button>}</div>)}
        <h3 className="font-semibold">Unresolved attempts (first 50)</h3>
        {attempts.length === 0 ? <p className="text-sm">No unresolved attempts in this page.</p> : <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{["Attempt / request", "Provider / model", "Started UTC", "Cost", "Recovery"].map(value => <th scope="col" key={value} className="p-2">{value}</th>)}</tr></thead><tbody>{attempts.map(row => <tr key={row.attemptId}><th scope="row" className="p-2 font-normal break-all">{row.attemptId}<br />{row.requestId}</th><td className="p-2">{row.provider} / {row.model}</td><td className="p-2">{row.startedAt}</td><td className="p-2">{row.costUsd === null ? "Unknown" : `$${row.costUsd}`}</td><td className="p-2"><button type="button" disabled={disabled || Boolean(status.coverage.maintenance)} onClick={() => setTarget({ kind: "attempt", row })}>Review attempt</button></td></tr>)}</tbody></table></div>}
        <h3 className="font-semibold">Usage breakdown (current first 50 attempts only)</h3>
        {usage?.breakdown.map(group => <p key={JSON.stringify([group.provider, group.model, group.endpoint])} className="text-sm break-all">{group.provider} / {group.model} / {group.endpoint}: {group.attempts} attempts, known recorded cost ${group.knownCostUsd}, total {group.totalCostUsd === null ? "Unknown (pending/unresolved)" : `$${group.totalCostUsd}`}</p>)}
      </>}
      {target && !pending && <fieldset disabled={disabled} className="border border-border-subtle p-3 rounded-lg space-y-3"><legend>Audited {target.kind === "gap" ? "key-gap waiver" : "attempt recovery"}</legend>
        <p className="text-sm">No secrets, prompts, response content or credentials in reason/evidence. Review exact provider evidence before submitting; waiver explicitly records zero without claiming exact coverage.</p>
        {target.kind === "attempt" && <label className="block">Recovery action<select value={action} onChange={event => setAction(event.target.value)} className="block p-2 bg-surface border border-border-subtle rounded-lg"><option value="waive">Explicit zero waiver</option><option value="exact_usage">Exact usage with original stored prices</option><option value="cost_correction">Manual exact cost adjustment with proof</option></select></label>}
        {target.kind === "attempt" && action === "exact_usage" && <label className="block">Exact usage JSON<textarea value={usageJson} placeholder="Enter all exact token counts and reasoningIncludedInOutput from provider evidence; no values are inferred" onChange={event => setUsageJson(event.target.value)} className="block w-full p-2 bg-surface border border-border-subtle rounded-lg" rows={4} /></label>}
        {target.kind === "attempt" && action === "cost_correction" && <label className="block">Correction USD<input value={costUsd} inputMode="decimal" onChange={event => setCostUsd(event.target.value)} className="block w-full p-2 bg-surface border border-border-subtle rounded-lg" /></label>}
        <label className="block">Recovery reason<textarea maxLength={512} value={reason} onChange={event => setReason(event.target.value)} className="block w-full p-2 bg-surface border border-border-subtle rounded-lg" /></label>
        <label className="block">Recovery evidence<textarea maxLength={target.kind === "gap" ? 4000 : 512} value={evidence} onChange={event => setEvidence(event.target.value)} className="block w-full p-2 bg-surface border border-border-subtle rounded-lg" /></label>
        <button type="button" onClick={createRecovery} disabled={!reason.trim() || !evidence.trim()} className="px-3 py-2 border border-border-subtle rounded-lg">Submit audited recovery</button>
      </fieldset>}
    </section>
  </div>;
}
