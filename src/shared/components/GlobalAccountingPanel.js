"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { GLOBAL_RECOVERY_STORAGE_KEY, globalRecoveryDraft, validateRetainedGlobalRecovery, validateGlobalRecoveryAcknowledgement } from '../utils/globalAccountingDraft.js';

export default function GlobalAccountingPanel({ onClose }) {
  const label = useId(), panel = useRef(null), close = useRef(null), mounted = useRef(false), restored = useRef(false), inFlight = useRef(false);
  const [status, setStatus] = useState(null), [target, setTarget] = useState(null), [pending, setPending] = useState(null);
  const [reason, setReason] = useState(''), [evidence, setEvidence] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; close.current?.focus();
    return () => { mounted.current = false; document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const load = async () => {
      setLoading(true); setError('');
      if (!restored.current) {
        try { const stored = sessionStorage.getItem(GLOBAL_RECOVERY_STORAGE_KEY); if (stored) { if (stored.length > 16384) throw new Error('Invalid retry state'); setPending(validateRetainedGlobalRecovery(JSON.parse(stored))); setNotice('An earlier global recovery is awaiting acknowledgement. Retry the unchanged operation only.'); } }
        catch { setBlocked(true); setError('Global recovery retry state is unavailable. Reconcile with an operator before creating another operation.'); }
        restored.current = true;
      }
      try {
        const response = await fetch('/api/accounting/gaps', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Global accounting unavailable or access denied. No readiness is inferred.');
        const result = await response.json();
        if (result.enforcementActive !== false || !Number.isSafeInteger(result.generation) || !Array.isArray(result.gaps) || result.gaps.some(gap => gap.scope !== 'global')) throw new Error('Invalid global accounting response');
        if (active) setStatus(result);
      } catch (err) { if (active && !controller.signal.aborted) { setStatus(null); setError(err.message || 'Global accounting unavailable'); } }
      finally { if (active) setLoading(false); }
    };
    load(); return () => { active = false; controller.abort(); };
  }, [revision]);
  const dismiss = () => { if (!inFlight.current) onClose(); };
  const trap = event => {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key !== 'Tab') return;
    const items = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')].filter(element => element.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); panel.current.focus(); }
    else if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const submit = async retained => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const checked = validateRetainedGlobalRecovery(retained);
      const response = await fetch(checked.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(checked.payload) });
      if (!response.ok) throw new Error(response.status === 409 ? 'Recovery conflicts. Retain this operation identity for operator reconciliation; do not create a replacement.' : 'Recovery acknowledgement is uncertain. Retry the unchanged operation; do not assume rollback.');
      validateGlobalRecoveryAcknowledgement(await response.json(), checked);
      sessionStorage.removeItem(GLOBAL_RECOVERY_STORAGE_KEY);
      if (mounted.current) { setPending(null); setTarget(null); setReason(''); setEvidence(''); setConfirmed(false); setNotice('Original operation acknowledged. Refreshing current coverage; newer gaps or maintenance may still block admissions.'); setRevision(value => value + 1); }
    } catch (err) { if (mounted.current) setError(err.message || 'Recovery acknowledgement uncertain. Keep the original operation.'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const create = () => {
    if (inFlight.current || pending || blocked || loading || !status || !confirmed) return;
    try {
      const retained = globalRecoveryDraft(target, { reason, evidence }, crypto.randomUUID());
      // No POST if retry identity cannot be retained. Never auto-submit restore.
      sessionStorage.setItem(GLOBAL_RECOVERY_STORAGE_KEY, JSON.stringify(retained)); setPending(retained); submit(retained);
    } catch (err) { setError(err.message || 'Recovery draft unavailable'); }
  };
  const choose = value => { setTarget(value); setReason(''); setEvidence(''); setConfirmed(false); };
  const disabled = busy || loading || !status || Boolean(pending) || blocked;
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
    <div className="absolute inset-0 bg-black/50" onClick={dismiss} aria-hidden="true" />
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={label} tabIndex={-1} onKeyDown={trap} className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-[14px] bg-surface border border-border-subtle p-4 sm:p-6 space-y-4">
      <header className="flex items-center justify-between gap-3"><h2 id={label} className="text-lg font-semibold">Global accounting recovery</h2><button ref={close} type="button" onClick={dismiss} disabled={busy} className="p-2 border border-border-subtle rounded-lg">Close</button></header>
      <p className="font-semibold">Enforcement OFF — recovery only, no protection advertised</p>
      <p className="text-sm">Scope-wide operator review, not a key waiver. Releasing maintenance does not clear gaps, resolve attempts, reset spend or activate enforcement. An old receipt does not prove current readiness.</p>
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
      {loading && <p role="status">Loading global coverage…</p>}
      <button type="button" disabled={busy || loading} onClick={() => { setTarget(null); setRevision(value => value + 1); }} className="px-3 py-2 border border-border-subtle rounded-lg">Refresh global coverage</button>
      {pending && <div className="border border-border-subtle rounded-lg p-3 space-y-2"><p className="text-sm break-all">Retained operation: {pending.payload.operationId}. New operations are blocked until acknowledgement or operator reconciliation.</p><button type="button" disabled={busy} onClick={() => submit(pending)} className="px-3 py-2 border border-border-subtle rounded-lg">Retry unchanged global recovery</button></div>}
      {status && <>
        <h3 className="font-semibold">Maintenance</h3>
        {status.maintenance ? <div className="border border-border-subtle rounded-lg p-3 space-y-2"><p>Active maintenance, generation {status.maintenance.generation}</p><p className="text-sm break-all">Started: {status.maintenance.startedAt}</p><button type="button" disabled={disabled} onClick={() => choose({ kind: 'maintenance', row: status.maintenance })} className="px-3 py-2 border border-border-subtle rounded-lg">Review maintenance release</button></div> : <p className="text-sm">No active maintenance recorded. This is not an admission-readiness certificate.</p>}
        <h3 className="font-semibold">Global coverage gaps</h3>
        {status.gaps.length === 0 ? <p className="text-sm">No recorded global gaps.</p> : status.gaps.map(gap => <div key={gap.id} className="border border-border-subtle rounded-lg p-3 space-y-2"><p className="text-sm break-all">Generation {gap.generation} — {gap.resolvedAt ? 'Audited waiver, not restored exact coverage' : 'Unreconciled'}; {gap.startedAt}</p>{!gap.resolvedAt && <button type="button" disabled={disabled} onClick={() => choose({ kind: 'gap', row: gap })} className="px-3 py-2 border border-border-subtle rounded-lg">Review global gap</button>}</div>)}
      </>}
      {target && !pending && <fieldset disabled={disabled} className="border border-border-subtle rounded-lg p-3 space-y-3"><legend>Audited {target.kind === 'gap' ? 'global-gap waiver' : 'maintenance release'} — generation {target.row.generation}</legend>
        <p className="text-sm">No secrets, prompts or credentials in reason/evidence. These drafts are retained in this tab until acknowledged; never log or export them.</p>
        <label className="block">Global recovery reason<textarea maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} className="block w-full bg-surface border border-border-subtle rounded-lg p-2" /></label>
        <label className="block">Global recovery evidence<textarea maxLength={4000} value={evidence} onChange={event => setEvidence(event.target.value)} className="block w-full bg-surface border border-border-subtle rounded-lg p-2" /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed this exact global target. This action does not certify current readiness or remove other restrictions.</label>
        <button type="button" disabled={!confirmed || !reason.trim() || !evidence.trim()} onClick={create} className="px-3 py-2 border border-border-subtle rounded-lg">Submit audited global recovery</button>
      </fieldset>}
    </section>
  </div>;
}
