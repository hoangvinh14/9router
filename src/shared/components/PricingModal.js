"use client";

import { useState, useEffect, useId, useRef } from "react";
import { pricingDraft, submitPricingDraft, PRICING_FIELDS } from "../utils/pricingDraft.js";
import { EXTENDED_RATE_FIELDS, RATE_UNITS } from "../../lib/pricing/constants.js";

export default function PricingModal({ isOpen, onClose, onSave }) {
  const titleId = useId(), panel = useRef(null), close = useRef(null), inFlight = useRef(false);
  const [draft, setDraft] = useState({}), [baseline, setBaseline] = useState({});
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; close.current?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController(); let active = true;
    const load = async () => {
      setLoading(true); setError(""); setFilter("");
      try {
        const response = await fetch("/api/pricing?view=editor", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Exact pricing could not be loaded. Editing is unavailable.");
        const next = pricingDraft((await response.json()).exact);
        if (active) { setDraft(next); setBaseline(next); }
      } catch {
        if (active && !controller.signal.aborted) { setDraft({}); setBaseline({}); setError("Exact pricing could not be loaded. Close and reopen to retry."); }
      } finally { if (active) setLoading(false); }
    };
    load(); return () => { active = false; controller.abort(); };
  }, [isOpen]);
  useEffect(() => {
    if (isOpen && !saving && !loading && !panel.current?.contains(document.activeElement)) close.current?.focus();
  }, [isOpen, saving, loading, error]);
  const dismiss = () => { if (!inFlight.current) onClose(); };
  const trap = event => {
    if (event.key === "Escape") { event.preventDefault(); dismiss(); }
    if (event.key !== "Tab") return;
    const items = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); panel.current.focus(); }
    else if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  };
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setSaving(true); setError("");
    try { if (await submitPricingDraft(baseline, draft)) onSave?.(); onClose(); }
    catch (failure) { setError(failure.message || "Pricing save unavailable"); }
    finally { inFlight.current = false; setSaving(false); }
  };
  const reset = async (provider, model) => {
    if (inFlight.current || !confirm(provider ? "Remove this model override and inherit effective reference pricing? Unsaved edits will be discarded." : "Remove all manual overrides? Unsaved edits will be discarded.")) return;
    inFlight.current = true; setSaving(true); setError(""); let removed = false;
    try {
      const query = provider ? `?${new URLSearchParams({ provider, model })}` : "";
      const response = await fetch(`/api/pricing${query}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Override removal denied or unavailable");
      removed = true; onSave?.();
      // DELETE preserves the legacy numeric response; refresh exact metadata
      // instead of ever turning that numeric map into the editable baseline.
      const refresh = await fetch("/api/pricing?view=editor", { cache: "no-store" });
      if (!refresh.ok) throw new Error("Exact pricing unavailable");
      const next = pricingDraft((await refresh.json()).exact); setDraft(next); setBaseline(next);
    } catch {
      if (removed) { setDraft({}); setBaseline({}); }
      setError(removed ? "Overrides removed, but exact pricing could not be refreshed. Close and reopen the editor." : "Override removal denied or unavailable. No removal confirmed.");
    } finally { inFlight.current = false; setSaving(false); }
  };
  if (!isOpen) return null;
  const providers = Object.keys(draft).sort();
  const visible = providers.map(provider => [provider, Object.keys(draft[provider]).sort().filter(model => `${provider} ${model}`.toLowerCase().includes(filter.toLowerCase()))]).filter(([, models]) => models.length);
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div ref={panel} tabIndex={-1} onKeyDown={trap} role="dialog" aria-modal="true" aria-labelledby={titleId} className="bg-surface text-text-main border border-border rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
      <header className="p-4 border-b border-border flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-xl font-semibold">Pricing Configuration</h2>
        <button ref={close} type="button" onClick={dismiss} aria-label="Close pricing editor" disabled={saving} className="text-2xl px-2 disabled:opacity-50">×</button>
      </header>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {error && <p role="alert" className="text-red-500">{error}</p>}
        <p className="text-sm text-text-muted">Reference rates only, not invoices or certified usage. Token rates use USD/1M tokens; web search uses USD/1,000 uses. Only edited model rows are saved. Zero is explicit. Blank cache/reasoning fields inherit input/output except 1h cache writes; blank extended rates remain unavailable. A rate does not activate accounting or budgets. Concurrent edits to the same model may overwrite one another.</p>
        <label className="block text-sm">Filter provider or model<input type="search" value={filter} onChange={event => setFilter(event.target.value)} disabled={loading || saving} className="block mt-1 w-full bg-surface border border-border rounded px-3 py-2" /></label>
        {loading ? <p role="status">Loading exact pricing…</p> : visible.map(([provider, models]) => <section key={provider} className="border border-border rounded-lg overflow-hidden">
          <h3 className="bg-surface-2 px-4 py-2 font-semibold">{provider}</h3>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${provider} pricing rates; scroll horizontally for all columns`} onKeyDown={event => {
            if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault(); const pane = event.currentTarget;
            if (event.key === "Home") pane.scrollLeft = 0;
            else if (event.key === "End") pane.scrollLeft = pane.scrollWidth;
            else pane.scrollLeft += (event.key === "ArrowRight" ? 1 : -1) * Math.max(40, pane.clientWidth / 2);
          }}>
            <table className="w-full text-sm"><caption className="sr-only">{provider} exact reference rates</caption>
              <thead className="bg-surface-3 text-text-muted"><tr><th scope="col" className="p-3 text-left">Model</th>{PRICING_FIELDS.map(field => <th scope="col" key={field} className="p-3 min-w-36 text-right">{field.replaceAll("_", " ")}<span className="block font-normal text-xs">{RATE_UNITS[field]}</span></th>)}<th scope="col" className="p-3">Override</th></tr></thead>
              <tbody>{models.map(model => <tr key={model} className="border-t border-border">
                <th scope="row" className="p-3 text-left font-medium min-w-48 break-all">{model}</th>
                {PRICING_FIELDS.map(field => <td key={field} className="p-2"><input type="text" inputMode="decimal" aria-label={`${provider} ${model} ${field} rate`} disabled={saving}
                  placeholder={field === "input" || field === "output" ? "Required" : field === "cache_creation_1h" || EXTENDED_RATE_FIELDS.includes(field) ? "Unavailable" : "Inherit"}
                  value={draft[provider][model][field] ?? ""} onChange={event => {
                    const value = event.target.value; setError("");
                    setDraft(previous => ({ ...previous, [provider]: { ...previous[provider], [model]: { ...previous[provider][model], [field]: value } } }));
                  }} className="w-36 px-2 py-2 text-right bg-surface border border-border rounded focus:outline-none focus:border-primary" /></td>)}
                <td className="p-3"><button type="button" disabled={saving} onClick={() => reset(provider, model)} aria-label={`Inherit ${provider} ${model} pricing`} className="text-primary hover:underline disabled:opacity-50">Inherit</button></td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>)}
        {!loading && !visible.length && <p className="text-text-muted">No editable pricing rows match. No defaults are fabricated when loading fails.</p>}
      </div>
      <footer className="p-4 border-t border-border flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => reset()} disabled={saving || loading || !providers.length} className="px-3 py-2 border border-red-500/30 text-red-500 rounded disabled:opacity-50">Remove All Overrides</button>
        <div className="flex gap-2"><button type="button" onClick={dismiss} disabled={saving} className="px-4 py-2 border border-border rounded">Cancel</button><button type="button" onClick={save} disabled={saving || loading || !providers.length} className="px-4 py-2 bg-primary text-white rounded disabled:opacity-50">{saving ? "Saving…" : "Save Changes"}</button></div>
      </footer>
    </div>
  </div>;
}
