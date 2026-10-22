"use client";

import { useState, useEffect, useRef } from "react";
import Card from "@/shared/components/Card";
import PricingModal from "@/shared/components/PricingModal";
import PricingCoverage from "@/shared/components/PricingCoverage";

export default function PricingSettingsPage() {
  const [showModal, setShowModal] = useState(false), [currentPricing, setCurrentPricing] = useState(null);
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState(null), [error, setError] = useState("");
  const [action, setAction] = useState(null), inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const load = async () => {
      setLoading(true); setError("");
      try {
        const [pricing, status] = await Promise.all([
          fetch("/api/pricing", { signal: controller.signal, cache: "no-store" }),
          fetch("/api/pricing/sync", { signal: controller.signal, cache: "no-store" }),
        ]);
        if (!pricing.ok) throw new Error("Effective pricing could not be loaded");
        const prices = await pricing.json(), next = status.ok ? await status.json() : null;
        if (active) { setCurrentPricing(prices); setCatalog(next); if (!status.ok) setError("Pricing sync status unavailable or access denied"); }
      } catch {
        if (active && !controller.signal.aborted) { setCurrentPricing(null); setCatalog(null); setError("Pricing unavailable or access denied. Retry to reload."); }
      } finally { if (active) setLoading(false); }
    };
    load(); return () => { active = false; controller.abort(); };
  }, [revision]);
  const refresh = () => setRevision(value => value + 1);
  const sync = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setAction("sync"); setError("");
    try {
      const response = await fetch("/api/pricing/sync", { method: "POST" });
      const next = await response.json();
      if (response.ok || response.status === 502) setCatalog(next);
      if (!response.ok) throw new Error(response.status === 502 ? "Catalog sync failed. Last-known-good pricing and manual overrides are retained." : "Pricing sync denied or storage unavailable");
      refresh();
    } catch (failure) { setError(failure.message || "Pricing sync failed"); }
    finally { inFlight.current = false; setAction(null); }
  };
  const schedule = async enabled => {
    if (inFlight.current) return;
    inFlight.current = true; setAction("schedule"); setError("");
    try {
      const response = await fetch("/api/pricing/sync", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schedulerEnabled: enabled }) });
      const next = await response.json();
      if (!response.ok) {
        // A durable saved preference with a failed runtime reconcile is not an
        // unsaved change or a running timer. Avoid displaying the old checkbox.
        if (next.configurationSaved === true) setCatalog(previous => ({ ...previous, schedulerConfigured: enabled, schedulerEnabled: false }));
        throw new Error(next.configurationSaved === true ? "Schedule preference saved, but timer is not running. Reload and retry." : "Schedule change denied or storage unavailable");
      }
      setCatalog(previous => ({ ...previous, ...next }));
    } catch (failure) { setError(failure.message || "Schedule change failed"); }
    finally { inFlight.current = false; setAction(null); }
  };
  const providers = Object.keys(currentPricing || {}).sort();
  const modelCount = providers.reduce((total, provider) => total + Object.keys(currentPricing[provider]).length, 0);
  let status = "Unavailable", scheduler = "Unknown";
  if (catalog) {
    status = catalog.error ? "Degraded" : catalog.revision ? "Synced" : "Not synced";
    scheduler = catalog.schedulerConfigured ? catalog.schedulerEnabled ? "Enabled and running" : "Configured, not running" : "Off";
  }
  return <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-3xl font-bold">Pricing Settings</h1><p className="text-text-muted mt-1">Manage virtual reference rates without enabling accounting or budgets.</p></div>
      <button type="button" onClick={() => setShowModal(true)} disabled={loading || !currentPricing || Boolean(action)} className="px-4 py-2 bg-primary text-white rounded disabled:opacity-50">Edit Pricing</button>
    </header>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {[["Models with effective prices", loading ? "…" : currentPricing ? modelCount : "Unavailable"], ["Providers", loading ? "…" : currentPricing ? providers.length : "Unavailable"], ["Catalog status", loading ? "…" : status]].map(([label, value]) => <Card key={label} className="p-4"><div className="text-text-muted text-sm">{label}</div><div className="text-2xl font-bold mt-1">{value}</div></Card>)}
    </div>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    <button type="button" onClick={refresh} disabled={loading || Boolean(action)} className="px-3 py-2 border border-border rounded disabled:opacity-50">Reload pricing status</button>
    <Card className="p-4 sm:p-6 space-y-3">
      <h2 className="text-xl font-semibold">Reference pricing catalog</h2>
      <p className="text-sm text-text-muted">Manual overrides take priority over the validated catalog. Sync updates prices only, never routing models or capabilities.</p>
      <dl className="text-sm space-y-2">
        <div><dt className="font-semibold inline">Source: </dt><dd className="inline break-all">https://models.dev/api.json</dd></div>
        <div><dt className="font-semibold inline">Last successful sync: </dt><dd className="inline">{catalog?.lastSuccess || "None"}</dd></div>
        <div><dt className="font-semibold inline">Validated prices: </dt><dd className="inline">{catalog?.pricedCount ?? "Unknown"}</dd></div>
        <div><dt className="font-semibold inline">24-hour scheduler: </dt><dd className="inline">{scheduler}</dd></div>
      </dl>
      <button type="button" onClick={sync} disabled={loading || Boolean(action) || !catalog} className="px-4 py-2 bg-primary text-white rounded disabled:opacity-50">{action === "sync" ? "Syncing catalog…" : "Sync reference pricing"}</button>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={catalog?.schedulerConfigured === true} disabled={loading || Boolean(action) || !catalog} onChange={event => schedule(event.target.checked)} />Enable automatic reference pricing sync every 24 hours</label>
      <p className="text-sm text-text-muted">Default off. Enabling starts a timer, not an immediate fetch. Disabling prevents new scheduled fetches; an admitted sync may finish. Unsupported or invalid batches retain the last-known-good catalog.</p>
    </Card>
    <PricingCoverage refreshRevision={revision} />
    <Card className="p-4 sm:p-6 space-y-3">
      <h2 className="text-xl font-semibold">How reference pricing works</h2>
      <p className="text-sm text-text-muted">Token rates use USD per million tokens; embedded web-search rates use USD per 1,000 uses. A configured rate is not an invoice, exact usage certification or permission to meter an endpoint.</p>
      <ul className="text-sm text-text-muted list-disc pl-5 space-y-2">
        <li>Complete manual model prices replace a source, not individual fields from different authorities. Only changed model rows are saved.</li>
        <li>Explicit zero remains zero. Blank ordinary cache/write rates inherit input; blank reasoning inherits output. Blank 1h cache writes remain unavailable.</li>
        <li>Image, document, audio, video, processing tool-prompt and per-use rates require their own explicit references. Missing rates do not become free or inherit ordinary token prices.</li>
        <li>Inherit removes a manual override and reloads the effective reference source. Existing immutable snapshots do not change when prices drift.</li>
        <li>The editor preserves exact canonical decimals, including untouched fields. Same-model concurrent saves are not protected by a compare-and-swap contract.</li>
      </ul>
    </Card>
    {showModal && <PricingModal isOpen={showModal} onClose={() => setShowModal(false)} onSave={refresh} />}
  </div>;
}
