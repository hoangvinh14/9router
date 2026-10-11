"use client";

import { useState, useEffect, useId, useRef } from "react";
import { pricingDraft, submitPricingDraft, PRICING_FIELDS } from "../utils/pricingDraft.js";

export default function PricingModal({ isOpen, onClose, onSave }) {
  const titleId = useId();
  const panel = useRef(null), close = useRef(null), inFlight = useRef(false);
  const [pricingData, setPricingData] = useState({});
  const [baseline, setBaseline] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; close.current?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    let active = true;
    const loadPricing = async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch("/api/pricing", { signal: controller.signal });
        if (!response.ok) throw new Error("Failed to load effective pricing. Editing is unavailable.");
        const draft = pricingDraft(await response.json());
        if (!active) return;
        setPricingData(draft); setBaseline(draft);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setPricingData({}); setBaseline({});
        setError(error.message || "Failed to load effective pricing");
      } finally {
        if (active) setLoading(false);
      }
    };
    loadPricing();
    return () => { active = false; controller.abort(); };
  }, [isOpen]);

  useEffect(() => {
    // Disabling a focused submit/reset control can drop focus onto BODY. Once
    // settled, return it inside the still-open dialog so Escape/Tab still work.
    if (isOpen && !saving && !loading && panel.current && !panel.current.contains(document.activeElement)) close.current?.focus();
  }, [isOpen, saving, loading, error]);

  const handlePricingChange = (provider, model, field, value) => {
    setError("");
    setPricingData(prev => ({ ...prev, [provider]: { ...prev[provider], [model]: { ...prev[provider][model], [field]: value } } }));
  };

  const dismiss = () => { if (!inFlight.current) onClose(); };
  const trap = event => {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key !== 'Tab') return;
    const items = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); panel.current.focus(); }
    else if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  };

  const handleSave = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      if (await submitPricingDraft(baseline, pricingData)) onSave?.();
      onClose();
    } catch (error) {
      setError(error.message || "Failed to save pricing");
    } finally {
      inFlight.current = false; setSaving(false);
    }
  };

  const handleReset = async (provider = null, model = null) => {
    if (inFlight.current) return;
    if (!confirm(provider ? "Remove this model override and inherit effective reference pricing? Unsaved edits will be discarded." : "Remove all manual overrides and inherit effective reference pricing? Unsaved edits will be discarded.")) return;
    inFlight.current = true;
    setSaving(true); setError("");
    let removed = false;
    try {
      const query = provider ? `?${new URLSearchParams({ provider, model })}` : "";
      const response = await fetch(`/api/pricing${query}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to remove pricing overrides");
      removed = true;
      onSave?.();
      const draft = pricingDraft(await response.json());
      setPricingData(draft); setBaseline(draft);
    } catch (error) {
      if (removed) {
        setPricingData({}); setBaseline({});
        setError("Overrides removed, but effective pricing could not be refreshed. Close and reopen the editor.");
      } else setError(error.message || "Failed to reset pricing");
    }
    finally { inFlight.current = false; setSaving(false); }
  };

  if (!isOpen) return null;

  // Get all unique providers and models for display
  const allProviders = Object.keys(pricingData).sort();
  const pricingFields = PRICING_FIELDS;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div ref={panel} tabIndex={-1} onKeyDown={trap} role="dialog" aria-modal="true" aria-labelledby={titleId} className="bg-surface text-text-main border border-border rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 id={titleId} className="text-xl font-semibold">Pricing Configuration</h2>
          <button
            ref={close}
            onClick={dismiss}
            aria-label="Close pricing editor"
            disabled={saving}
            className="text-text-muted hover:text-text text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {error && <p role="alert" className="mb-3 text-red-500">{error}</p>}
          {loading ? (
            <div className="text-center py-8 text-text-muted">Loading pricing data...</div>
          ) : (
            <div className="space-y-6">
              {/* Instructions */}
              <div className="bg-surface-2 border border-border rounded-lg p-3 text-sm">
                <p className="font-medium mb-1">Pricing Rates Format</p>
                <p className="text-text-muted">
                  All rates are in <strong>dollars per million tokens</strong> ($/1M tokens).
                  These are virtual reference costs, not upstream invoices. Blank optional rates inherit input/output rates except 1h cache writes, which require an explicit reference rate. Explicit zero stays zero. Only edited model rows are saved.
                </p>
              </div>

              {/* Pricing Tables */}
              {allProviders.map(provider => {
                const models = Object.keys(pricingData[provider]).sort();
                return (
                  <div key={provider} className="border border-border rounded-lg overflow-hidden">
                    <div className="bg-surface-2 px-4 py-2 font-semibold text-sm">
                      {provider.toUpperCase()}
                    </div>
                    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${provider} pricing rates; scroll horizontally for all columns`} onKeyDown={event => {
                      // Native End scrolls the vertical ancestor in Chromium.
                      // These bindings belong to the region, never rate inputs.
                      if (event.target !== event.currentTarget) return;
                      const pane = event.currentTarget;
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                      event.preventDefault();
                      if (event.key === 'Home') pane.scrollLeft = 0;
                      else if (event.key === 'End') pane.scrollLeft = pane.scrollWidth;
                      else pane.scrollLeft += (event.key === 'ArrowRight' ? 1 : -1) * Math.max(40, pane.clientWidth / 2);
                    }}>
                      <table className="w-full text-sm">
                        <thead className="bg-surface-3 text-text-muted uppercase text-xs">
                          <tr>
                            <th className="px-3 py-2 text-left">Model</th>
                            <th className="px-3 py-2 text-right">Input</th>
                            <th className="px-3 py-2 text-right">Output</th>
                            <th className="px-3 py-2 text-right">Cached</th>
                            <th className="px-3 py-2 text-right">Reasoning</th>
                            <th className="px-3 py-2 text-right">Cache Creation / 5m</th>
                            <th className="px-3 py-2 text-right">Cache Creation 1h</th>
                            <th className="px-3 py-2 text-right">Override</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {models.map(model => (
                            <tr key={model} className="hover:bg-surface-2/50">
                              <td className="px-3 py-2 font-medium">{model}</td>
                              {pricingFields.map(field => (
                                <td key={field} className="px-3 py-2">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    aria-label={`${provider} ${model} ${field} rate`}
                                    placeholder={field === "input" || field === "output" ? "Required" : "Inherit"}
                                    disabled={saving}
                                    value={pricingData[provider][model][field] ?? ""}
                                    onChange={(e) => handlePricingChange(provider, model, field, e.target.value)}
                                    className="w-20 px-2 py-1 text-right bg-surface border border-border rounded focus:outline-none focus:border-primary"
                                  />
                                </td>
                              ))}
                              <td className="px-3 py-2"><button type="button" disabled={saving} onClick={() => handleReset(provider, model)} className="text-primary hover:underline">Inherit</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              {allProviders.length === 0 && (
                <div className="text-center py-8 text-text-muted">
                  No pricing data available
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-between gap-2">
          <button
            onClick={() => handleReset()}
            className="px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 rounded border border-red-500/20 transition-colors"
            disabled={saving || loading || allProviders.length === 0}
          >
            Remove All Overrides
          </button>
          <div className="flex gap-2">
            <button
              onClick={dismiss}
              className="px-4 py-2 text-sm text-text-muted hover:text-text border border-border rounded transition-colors"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-primary text-white rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
              disabled={saving || loading || allProviders.length === 0}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}