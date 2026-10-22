"use client";
import { useEffect, useState } from "react";
import { EXTENDED_RATE_FIELDS, RATE_UNITS } from "../../lib/pricing/constants.js";

export default function PricingCoverage({ refreshRevision = 0 }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState({ offset: 0, revision: null });
  const [report, setReport] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let active = true;
    const load = async () => {
      setBusy(true); setError("");
      try {
        const params = new URLSearchParams({ limit: "50", offset: String(query.offset) });
        if (query.revision) params.set("revision", query.revision);
        const response = await fetch(`/api/pricing/coverage?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 409 ? "Pricing changed during pagination. Restart the report." : "Pricing coverage unavailable or access denied.");
        const result = await response.json(); if (active) setReport(result);
      } catch (failure) {
        if (active && !controller.signal.aborted) { setReport(null); setError(failure.message || "Pricing coverage unavailable."); }
      } finally { if (active) setBusy(false); }
    };
    load(); return () => { active = false; controller.abort(); };
  }, [open, query, reload, refreshRevision]);
  const restart = () => { setQuery({ offset: 0, revision: null }); setReload(value => value + 1); };
  return <section className="border border-border rounded-lg p-4 sm:p-6 space-y-3" aria-label="Reference pricing coverage">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Reference price coverage</h2><button type="button" className="px-3 py-2 border border-border rounded" aria-expanded={open} onClick={() => { if (!open) restart(); setOpen(value => !value); }}>{open ? "Hide coverage" : "Inspect coverage"}</button></div>
    <p className="text-sm text-text-muted">Current registry chat and embedding references only. Price availability does not certify usage, invoices or budget enforcement. Custom-only override rows are available in the editor, not this registry report.</p>
    {open && <>
      <button type="button" disabled={busy} onClick={restart} className="px-3 py-2 border border-border rounded disabled:opacity-50">Restart coverage report</button>
      {busy && <p role="status">Loading reference pricing coverage…</p>}
      {error && <p role="alert" className="text-red-500">{error}</p>}
      {report && !busy && !error && <>
        <p className="text-sm">All registry references: <strong>{report.counts.total}</strong>; priced: <strong>{report.counts.priced}</strong>; unavailable: <strong>{report.counts.unavailable}</strong>. Counts cover the full registry, not just this page.</p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Pricing coverage columns; scroll horizontally">
          <table className="w-full text-sm text-left"><caption className="text-left text-text-muted pb-2">Token rates: USD/1M tokens. Embedded search: USD/1,000 uses. Missing extended rates remain unavailable.</caption>
            <thead><tr>{["Provider / model", "Endpoint", "Source", "Input / output", "Cache / reasoning", "Extended reference rates", "Availability"].map(label => <th key={label} scope="col" className="p-2 border-b border-border">{label}</th>)}</tr></thead>
            <tbody>{report.rows.map(row => <tr key={JSON.stringify([row.provider, row.model, row.endpoint])}>
              <th scope="row" className="p-2 border-b border-border font-normal break-all min-w-48">{row.provider} / {row.model}</th><td className="p-2">{row.endpoint}</td>
              <td className="p-2">{row.source || "None"}{row.virtual ? " (virtual mapping)" : ""}</td>
              <td className="p-2 whitespace-nowrap">{row.rates ? `${row.rates.input} / ${row.rates.output}` : "Unavailable"}</td>
              <td className="p-2 min-w-48">{row.rates ? `Read ${row.rates.cached ?? "input fallback"}; write/5m ${row.rates.cache_creation ?? "input fallback"}; write/1h ${row.rates.cache_creation_1h ?? "unavailable"}; reasoning ${row.rates.reasoning ?? "output fallback"}` : "Unknown"}</td>
              <td className="p-2 min-w-64">{EXTENDED_RATE_FIELDS.filter(field => row.rates?.[field] !== undefined).map(field => <div key={field}>{field}: {row.rates[field]} {row.rateUnits?.[field] || RATE_UNITS[field]}</div>)}{!EXTENDED_RATE_FIELDS.some(field => row.rates?.[field] !== undefined) && "No explicit extended rates"}</td>
              <td className="p-2">{row.status === "priced" ? "Reference available" : row.reason}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3"><span className="text-sm">Showing {report.rows.length ? query.offset + 1 : 0}–{query.offset + report.rows.length} of {report.counts.total}</span>
          <button type="button" disabled={!query.offset} className="px-3 py-2 border border-border rounded disabled:opacity-50" onClick={() => setQuery({ offset: Math.max(0, query.offset - 50), revision: report.revision })}>Previous coverage page</button>
          <button type="button" disabled={report.nextOffset === null} className="px-3 py-2 border border-border rounded disabled:opacity-50" onClick={() => setQuery({ offset: report.nextOffset, revision: report.revision })}>Next coverage page</button>
        </div>
      </>}
    </>}
  </section>;
}
