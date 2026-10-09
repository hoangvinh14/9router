"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import PricingModal from "@/shared/components/PricingModal";
import PricingCoverage from "@/shared/components/PricingCoverage";

export default function PricingSettingsPage() {
  const [showModal, setShowModal] = useState(false);
  const [currentPricing, setCurrentPricing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [catalogStatus, setCatalogStatus] = useState(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const load = async () => {
      setLoading(true); setError("");
      try {
        const [pricing, status] = await Promise.all([
          fetch("/api/pricing", { signal: controller.signal }),
          fetch("/api/pricing/sync", { signal: controller.signal }),
        ]);
        if (!pricing.ok) throw new Error("Effective pricing could not be loaded");
        const prices = await pricing.json();
        const catalog = status.ok ? await status.json() : null;
        if (!active) return;
        setCurrentPricing(prices); setCatalogStatus(catalog);
        if (!status.ok) setError("Pricing sync status unavailable or access denied");
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setCurrentPricing(null); setCatalogStatus(null);
        setError(error.message || "Pricing unavailable");
      } finally { if (active) setLoading(false); }
    };
    load();
    return () => { active = false; controller.abort(); };
  }, [revision]);

  const handlePricingUpdated = () => setRevision(value => value + 1);
  const handleSync = async () => {
    setSyncing(true); setError("");
    try {
      const response = await fetch("/api/pricing/sync", { method: "POST" });
      const status = await response.json();
      if (response.ok || response.status === 502) setCatalogStatus(status);
      if (!response.ok) throw new Error(response.status === 502 ? "Catalog sync degraded. Last-known-good pricing is retained; invalid rates are not rounded." : "Pricing sync denied or storage unavailable");
      handlePricingUpdated();
    } catch (error) { setError(error.message || "Pricing sync failed"); }
    finally { setSyncing(false); }
  };

  const handleSchedule = async enabled => {
    setScheduling(true); setError("");
    try {
      const response = await fetch("/api/pricing/sync", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schedulerEnabled: enabled }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.configurationSaved ? "Schedule preference saved, but timer configuration failed. Reload and retry." : "Schedule change denied or storage unavailable");
      setCatalogStatus(previous => ({ ...previous, ...result }));
    } catch (error) { setError(error.message || "Schedule change failed"); }
    finally { setScheduling(false); }
  };

  // Count total models with pricing
  const getModelCount = () => {
    if (!currentPricing) return 0;
    let count = 0;
    for (const provider in currentPricing) {
      count += Object.keys(currentPricing[provider]).length;
    }
    return count;
  };

  // Get providers list
  const getProviders = () => {
    if (!currentPricing) return [];
    return Object.keys(currentPricing).sort();
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pricing Settings</h1>
          <p className="text-text-muted mt-1">
            Configure pricing rates for cost tracking and calculations
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors"
        >
          Edit Pricing
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-text-muted text-sm uppercase font-semibold">
            Total Models
          </div>
          <div className="text-2xl font-bold mt-1">
            {loading ? "..." : getModelCount()}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-text-muted text-sm uppercase font-semibold">
            Providers
          </div>
          <div className="text-2xl font-bold mt-1">
            {loading ? "..." : getProviders().length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-text-muted text-sm uppercase font-semibold">
            Status
          </div>
          <div className="text-2xl font-bold mt-1">
            {loading ? "..." : !catalogStatus ? "Unavailable" : catalogStatus.error ? "Degraded" : catalogStatus.revision ? "Synced" : "Not synced"}
          </div>
        </Card>
      </div>

      {error && <p role="alert" className="text-danger">{error}</p>}
      <Card className="p-6 space-y-3">
        <h2 className="text-xl font-semibold">Reference pricing catalog</h2>
        <p className="text-sm text-text-muted">Virtual reference costs, not upstream invoices. Manual overrides take priority. Sync only updates pricing, never routing models or capabilities.</p>
        <dl className="text-sm space-y-1">
          <div><dt className="inline font-semibold">Source: </dt><dd className="inline">https://models.dev/api.json</dd></div>
          <div><dt className="inline font-semibold">Last successful sync: </dt><dd className="inline">{catalogStatus?.lastSuccess || "None"}</dd></div>
          <div><dt className="inline font-semibold">Validated catalog prices: </dt><dd className="inline">{catalogStatus?.pricedCount ?? "Unknown"}</dd></div>
          <div><dt className="inline font-semibold">24-hour scheduler: </dt><dd className="inline">{catalogStatus?.schedulerConfigured ? catalogStatus.schedulerEnabled ? "Enabled" : "Configured, not running" : "Off"}</dd></div>
        </dl>
        <button type="button" onClick={handleSync} disabled={loading || syncing || scheduling || !catalogStatus} className="px-4 py-2 bg-primary text-white rounded disabled:opacity-50">
          {syncing ? "Syncing catalog..." : "Sync reference pricing"}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={catalogStatus?.schedulerConfigured === true} disabled={loading || syncing || scheduling || !catalogStatus} onChange={event => handleSchedule(event.target.checked)} />
          Enable automatic reference pricing sync every 24 hours
        </label>
        <p className="text-sm text-text-muted">Default off. First scheduled sync is 24 hours after timer startup. Disabling prevents new scheduled fetches; an already running sync may finish.</p>
        <p className="text-sm text-text-muted">Unsupported, missing or overprecision prices are not treated as free. A rejected batch keeps the last-known-good catalog.</p>
      </Card>

      <PricingCoverage refreshRevision={revision} />

      {/* Info Section */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">How Pricing Works</h2>
        <div className="space-y-3 text-sm text-text-muted">
          <p>
            <strong>Cost Calculation:</strong> Costs are calculated based on token usage and pricing rates.
            Reference cost applies USD-per-million rates to exact usage components. Cached input subsets are subtracted from ordinary input; included reasoning is not charged twice. Unknown usage is not zero.
          </p>
          <p>
            <strong>Pricing Format:</strong> All rates are in <strong>dollars per million tokens</strong> ($/1M tokens).
            Example: An input rate of 2.50 means $2.50 per 1,000,000 input tokens.
          </p>
          <p>
            <strong>Token Types:</strong>
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li><strong>Input:</strong> Standard prompt tokens</li>
            <li><strong>Output:</strong> Completion/response tokens</li>
            <li><strong>Cached:</strong> Cached input tokens (typically 50% of input rate)</li>
            <li><strong>Reasoning:</strong> Special reasoning/thinking tokens (fallback to output rate)</li>
            <li><strong>Cache Creation:</strong> Tokens used to create cache entries (fallback to input rate)</li>
          </ul>
          <p>
            <strong>Custom Pricing:</strong> You can override default pricing for specific models.
            Reset to defaults anytime to restore standard rates.
          </p>
        </div>
      </Card>

      {/* Current Pricing Preview */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Current Pricing Overview</h2>
          <button
            onClick={() => setShowModal(true)}
            className="text-primary hover:underline text-sm"
          >
            View Full Details
          </button>
        </div>

        {loading ? (
          <div className="text-center py-4 text-text-muted">Loading pricing data...</div>
        ) : currentPricing ? (
          <div className="space-y-3">
            {Object.keys(currentPricing).slice(0, 5).map(provider => (
              <div key={provider} className="text-sm">
                <span className="font-semibold">{provider.toUpperCase()}:</span>{" "}
                <span className="text-text-muted">
                  {Object.keys(currentPricing[provider]).length} models
                </span>
              </div>
            ))}
            {Object.keys(currentPricing).length > 5 && (
              <div className="text-sm text-text-muted">
                + {Object.keys(currentPricing).length - 5} more providers
              </div>
            )}
          </div>
        ) : (
          <div className="text-text-muted">No pricing data available</div>
        )}
      </Card>

      {/* Pricing Modal */}
      {showModal && (
        <PricingModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onSave={handlePricingUpdated}
        />
      )}
    </div>
  );
}