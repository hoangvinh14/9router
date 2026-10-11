"use client";
import { useEffect, useState } from "react";

export default function PricingCoverage({ refreshRevision = 0 }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState({ offset: 0, revision: null });
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let active = true;
    const load = async () => {
      setBusy(true); setError("");
      try {
        const params = new URLSearchParams({ limit: "50", offset: String(query.offset) });
        if (query.revision) params.set("revision", query.revision);
        const response = await fetch(`/api/pricing/coverage?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 409 ? "Pricing changed during pagination. Restart the report." : "Pricing coverage unavailable or access denied.");
        const result = await response.json();
        if (!active) return;
        setReport(result);
      } catch (error) { if (active && !controller.signal.aborted) { setReport(null); setError(error.message || "Pricing coverage unavailable."); } }
      finally { if (active) setBusy(false); }
    };
    load(); return () => { active = false; controller.abort(); };
  }, [open, query, reload, refreshRevision]);
  const restart = () => { setQuery({ offset: 0, revision: null }); setReload(value => value + 1); };
  return <section className="bg-surface border border-border-subtle rounded-[14px] p-6 space-y-3" aria-label="Reference pricing coverage">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">Effective reference price coverage</h2>
      <button type="button" className="px-3 py-2 rounded-lg border border-border-subtle" onClick={() => { if (!open) restart(); setOpen(value => !value); }} aria-expanded={open}>{open ? "Hide coverage" : "Inspect coverage"}</button>
    </div>
    <p className="text-sm text-text-muted">Registry chat and embedding references, not provider invoices. A valid price does not certify exact usage or enable budget enforcement. Unavailable models need an approved mapping or a complete manual override.</p>
    {open && <>
      <button type="button" className="px-3 py-2 rounded-lg border border-border-subtle" disabled={busy} onClick={restart}>Restart coverage report</button>
      {busy && <p role="status">Loading effective pricing coverage…</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {report && !busy && !error && <>
        <p className="text-sm">All registry references: <strong>{report.counts.total}</strong>; priced: <strong>{report.counts.priced}</strong>; unavailable: <strong>{report.counts.unavailable}</strong>. Counts cover the complete registry, not only this page.</p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Pricing coverage columns; scroll horizontally">
          <table className="w-full text-sm text-left">
            <caption className="text-left text-text-muted pb-2">USD per million tokens — effective precedence and optional-rate fallback</caption>
            <thead><tr>{["Provider / model", "Endpoint", "Source", "Input / output", "Cache / reasoning", "Availability"].map(label => <th key={label} scope="col" className="p-2 border-b border-border-subtle">{label}</th>)}</tr></thead>
            <tbody>{report.rows.map(row => <tr key={JSON.stringify([row.provider, row.model, row.endpoint])}>
              <th scope="row" className="p-2 border-b border-border-subtle font-normal break-all">{row.provider} / {row.model}</th>
              <td className="p-2">{row.endpoint}</td>
              <td className="p-2">{row.source || "None"}{row.virtual ? " (virtual mapping)" : ""}</td>
              <td className="p-2 whitespace-nowrap">{row.rates ? `${row.rates.input} / ${row.rates.output}` : "Unavailable"}</td>
              <td className="p-2">{row.rates ? `Read ${row.rates.cached ?? "input fallback"}; write/5m ${row.rates.cache_creation ?? "input fallback"}; write/1h ${row.rates.cache_creation_1h ?? "unavailable"}; reasoning ${row.rates.reasoning ?? "output fallback"}` : "Unknown"}</td>
              <td className="p-2">{row.status === "priced" ? "Reference available" : row.reason}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">Showing {query.offset + 1}–{query.offset + report.rows.length} of {report.counts.total}</span>
          <button type="button" disabled={query.offset === 0} className="px-3 py-2 rounded-lg border border-border-subtle disabled:opacity-50" onClick={() => setQuery({ offset: Math.max(0, query.offset - 50), revision: report.revision })}>Previous coverage page</button>
          <button type="button" disabled={report.nextOffset === null} className="px-3 py-2 rounded-lg border border-border-subtle disabled:opacity-50" onClick={() => setQuery({ offset: report.nextOffset, revision: report.revision })}>Next coverage page</button>
        </div>
      </>}
    </>}
  </section>;
}
