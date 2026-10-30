"use client";

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { budgetDraft, budgetDraftDirty, budgetDraftPayload, mergeBudgetRefresh } from '../utils/budgetManagementDraft.js';

export default function ApiKeyBudgetPanel({apiKeyId,keyName,isActive=true}) {
  const title=useId(),sequence=useRef(0),mounted=useRef(true),flight=useRef(false),deferredRefresh=useRef(false);
  const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
  const [state,setState]=useState({apiKeyId,snapshot:null,baseline:null,draft:null});
  const [unknownSave,setUnknownSave]=useState(false),[reviewed,setReviewed]=useState(false),[readStale,setReadStale]=useState(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const refresh=useCallback(async()=>{
    if(flight.current){deferredRefresh.current=true;return;}
    const ticket=++sequence.current;setLoading(true);setReadStale(true);setError('');
    try{
      const response=await fetch(`/api/keys/${encodeURIComponent(apiKeyId)}/budget`,{cache:'no-store'});
      const snapshot=await response.json();if(!response.ok)throw new Error(snapshot.error||'Budget unavailable');
      if(snapshot.apiKeyId!==apiKeyId)throw new Error('Budget identity mismatch');
      if(mounted.current&&ticket===sequence.current){setState(previous=>mergeBudgetRefresh(previous,snapshot));setReviewed(true);setReadStale(false);}
    }catch(failure){if(mounted.current&&ticket===sequence.current)setError(failure.message||'Budget unavailable; values may be stale.');}
    finally{if(mounted.current&&ticket===sequence.current)setLoading(false);}
  },[apiKeyId]);
  useEffect(()=>{
    let active=true;
    // Start the external request after effect setup; cleanup cancels stale starts.
    if(open)Promise.resolve().then(()=>{if(active)refresh();});
    return()=>{active=false;};
  },[open,refresh,isActive]);
  useEffect(()=>{if(!open)return;const focus=()=>{if(!flight.current)refresh();};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[open,refresh]);
  const {snapshot,draft,baseline}=state;
  const dirty=budgetDraftDirty(draft,baseline);
  let payload=null;try{if(draft)payload=budgetDraftPayload(draft);}catch{/* Invalid draft remains explicit, never zero/unlimited. */}
  const finite=payload&&(payload.weeklyLimitUsd!==null||payload.monthlyLimitUsd!==null);
  const save=async event=>{
    event.preventDefault();if(flight.current||readStale||!payload||!dirty||conflict||unknownSave)return;
    flight.current=true;setSaving(true);setReadStale(true);setError('');const ticket=++sequence.current;
    let definiteFailure=false;
    try{
      const response=await fetch(`/api/keys/${encodeURIComponent(apiKeyId)}/budget`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const next=await response.json();
      if(!mounted.current||ticket!==sequence.current)return;
      if(!response.ok){definiteFailure=[400,401,403,404,409].includes(response.status);if(response.status===409&&next.code==='budget_policy_conflict')setConflict(true);throw new Error(next.error||'Budget save unavailable');}
      if(next.apiKeyId!==apiKeyId)throw new Error('Budget identity mismatch');
      if(mounted.current&&ticket===sequence.current){setState({apiKeyId,snapshot:next,baseline:next,draft:budgetDraft(next)});setConflict(false);setReadStale(false);}
    }catch(failure){if(mounted.current&&ticket===sequence.current){setUnknownSave(!definiteFailure);setReviewed(false);setError(definiteFailure?(failure.message||'Budget save rejected.'):'Save outcome unknown; refresh and review the policy before retrying.');}}
    finally{if(mounted.current&&ticket===sequence.current){flight.current=false;setSaving(false);setLoading(false);if(deferredRefresh.current){deferredRefresh.current=false;refresh();}}}
  };
  const edit=(field,value)=>{setState(previous=>({...previous,draft:{...previous.draft,[field]:value}}));setError('');};
  const reload=()=>{if(!snapshot||unknownSave&&!reviewed)return;setState(previous=>({...previous,baseline:snapshot,draft:budgetDraft(snapshot)}));setConflict(false);setUnknownSave(false);setError('');};
  const money=value=>value===null?'Unlimited':`$${value}`;
  return <section className="mt-3 rounded-lg border border-border p-3 text-sm" aria-labelledby={title} data-testid={`budget-${apiKeyId}`}>
    <button type="button" id={title} aria-expanded={open} onClick={()=>setOpen(value=>!value)} className="font-medium text-primary py-1">{open?'Hide':'Manage'} budget for {keyName||apiKeyId}</button>
    {open&&<div className="mt-3 space-y-3">
      <p className="text-text-muted">Virtual reference cost, not an invoice. Budget uses durably recorded evidence and may undercount upstream charges after an interruption or crash. Soft recorded-spend threshold, not a hard cap: concurrent in-flight requests may overshoot without a one-request bound.</p>
      {loading&&<p role="status">Refreshing budget…</p>}
      {error&&<p role="alert" className="text-red-500">{error} {snapshot?'Displayed values may be stale; allowance is unknown until refreshed.':'Allowance and accounting health are unknown.'}</p>}
      {snapshot&&<>
        {readStale&&<p role="status" className="text-orange-600">Displayed projection is stale; allowance and current health are unknown until a successful refresh. Editing or reloading a draft does not refresh accounting.</p>}
        <p role="status" className={snapshot.enforcementActive?'text-text-muted':'text-orange-600'}>{snapshot.enforcementActive?'Selected fixture enforcement only':'Not activated — production budget enforcement is OFF'}. Scope: {snapshot.scope}.</p>
        <p className="text-xs text-text-muted">Coverage start: {snapshot.coverageStartedAt||snapshot.ledgerStartedAt||'Not active'}. Timezone: {snapshot.timezone}. Server time: {snapshot.serverNow}.</p>
        <p>Health: {readStale?'unknown (stale projection)':snapshot.health.healthy?'recording available':'unavailable'}; unresolved coverage gaps: {snapshot.health.gapCount}; maintenance: {snapshot.health.maintenance?'yes':'no'}.</p>
        <p>Live pending attempts: {snapshot.pendingCount}. Interrupted requests without recoverable usage do not add spend or require an admin action. Valid late usage is recorded once in its original period.</p>
        {snapshot.unresolvedCount>0&&<p className="text-orange-600">Accounting safety errors: {snapshot.unresolvedCount}. Invalid or conflicting evidence is not treated as missing usage; safety restrictions remain in effect.</p>}
        {snapshot.eligibility.blockReason&&<p className="text-orange-600">Admission status: {readStale?'unknown (stale projection)':snapshot.eligibility.blockReason}.</p>}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {['weekly','monthly'].map(dimension=>{const window=snapshot[dimension],previous=snapshot.previousWindows[dimension];
            // Rendering-only ratio is bounded; monetary admission never uses it.
            const progress=window.limitUsd===null?0:window.limitUsd==='0'?100:Math.min(100,Math.max(0,Number(window.spentUsd)/Number(window.limitUsd)*100));
            return <div key={dimension} className="rounded border border-border p-3 space-y-1" aria-label={`${dimension} budget summary`}>
              <h4 className="font-semibold capitalize">{dimension}</h4>
              <p>Limit: {money(window.limitUsd)} · Known spent: {money(window.spentUsd)}{readStale?' (stale)':''}</p>
              <p>Remaining: {readStale?'Unknown (refresh required)':money(window.remainingUsd)} · Overshoot: {money(window.overshootUsd)}</p>
              <progress aria-label={`${dimension} recorded spend progress`} max="100" value={progress} className="w-full"/>
              <p className="text-xs break-all">{window.startAt} → reset {window.resetAt}</p>
              <p className="text-xs">Current pending: {window.pendingCount}; accounting safety errors: {window.unresolvedCount}.</p>
              <p className="text-xs">Previous window known spent: {money(previous.spentUsd)}; overshoot against current policy: {money(previous.overshootUsd)}. Late settlements retain their original window.</p>
              {window.limitUsd==='0'&&<p className="text-orange-600">0 blocks until policy changes. Reset / Retry-After is advisory, not an automatic unblock.</p>}
            </div>;
          })}
        </div>
        {draft&&<form onSubmit={save} className="space-y-3">
          <fieldset disabled={saving||!snapshot.active} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <legend className="font-medium mb-2">Budget policy (USD, up to 9 decimal places)</legend>
            {['weekly','monthly'].map(dimension=><div key={dimension} className="space-y-2">
              <label className="flex gap-2 items-center"><input type="checkbox" checked={draft[`${dimension}Unlimited`]} onChange={event=>edit(`${dimension}Unlimited`,event.target.checked)}/><span className="capitalize">{dimension} unlimited</span></label>
              <label className="block capitalize">{dimension} limit USD<input type="text" inputMode="decimal" disabled={draft[`${dimension}Unlimited`]} value={draft[`${dimension}LimitUsd`]} onChange={event=>edit(`${dimension}LimitUsd`,event.target.value)} className="block mt-1 w-full rounded border border-border bg-surface px-3 py-2"/></label>
            </div>)}
          </fieldset>
          {!payload&&<p role="alert">Enter a plain non-negative decimal amount, or explicitly select unlimited. Empty is not zero.</p>}
          {!snapshot.canSetFinite&&<p className="text-orange-600">Finite budget saves are unavailable until accounting is ready for this scope. Unlimited can be saved only with healthy active identity and current version.</p>}
          {unknownSave&&<p role="alert">Save may have committed. Your draft and base version are preserved. Refresh and review the displayed policy, then explicitly discard/reload before saving again.</p>}
          {conflict&&<p role="alert">Policy changed in another tab. Your draft and base version are preserved. Refresh, review the latest policy, then explicitly discard/reload before saving again.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving||loading||readStale||!dirty||!payload||conflict||unknownSave||!snapshot.active||Boolean(finite&&!snapshot.canSetFinite)} className="rounded bg-primary px-3 py-2 text-white disabled:opacity-50">{saving?'Saving…':'Save budget'}</button>
            <button type="button" disabled={saving||loading} onClick={refresh} className="rounded border border-border px-3 py-2">Refresh budget</button>
            <button type="button" disabled={saving||unknownSave&&!reviewed||!dirty&&!conflict&&!unknownSave} onClick={reload} className="rounded border border-border px-3 py-2">Discard draft and load displayed policy</button>
          </div>
          <p className="text-xs text-text-muted">Draft base version: {draft.expectedVersion}; displayed policy version: {snapshot.version}. Refresh does not overwrite dirty edits. Budget and access-control saves are separate.</p>
        </form>}
      </>}
      {!snapshot&&!loading&&<button type="button" onClick={refresh} className="rounded border border-border px-3 py-2">Retry budget load</button>}
    </div>}
  </section>;
}
