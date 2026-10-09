import { NextResponse } from "next/server";
import { authorizeManagement } from "@/lib/auth/managementGuard.js";
import { CATALOG_SOURCE, getCatalogStatus, syncCatalog } from "@/lib/pricing/catalogSync.js";
import { setCatalogSchedule } from "@/lib/pricing/catalogSchedule.js";

const headers = { "Cache-Control": "no-store" };
function statusProjection(status) {
  const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
  return {
    source: CATALOG_SOURCE,
    revision: typeof status?.revision === "string" && /^[a-f0-9]{64}$/.test(status.revision) ? status.revision : null,
    syncedAt: timestamp(status?.syncedAt), lastAttempt: timestamp(status?.lastAttempt), lastSuccess: timestamp(status?.lastSuccess),
    error: status?.error ? "pricing_sync_failed" : null,
    pricedCount: Number.isSafeInteger(status?.pricedCount) && status.pricedCount >= 0 ? status.pricedCount : 0,
    schedulerEnabled: status?.schedulerEnabled === true,
    schedulerConfigured: status?.schedulerConfigured === true,
    virtualReference: true,
  };
}
export async function GET(request) {
  const authorization = await authorizeManagement(request);
  if (authorization.response) return authorization.response;
  try { return NextResponse.json(statusProjection(await getCatalogStatus()), { headers }); }
  catch { return NextResponse.json({ error: "Pricing status unavailable", code: "pricing_storage_unavailable" }, { status: 503, headers }); }
}
export async function PUT(request) {
  const authorization = await authorizeManagement(request, { mutation: true });
  if (authorization.response) return authorization.response;
  let input;
  try {
    if (new URL(request.url).search || !request.body) throw new Error("Invalid schedule request");
    const reader = request.body.getReader(); const chunks = []; let bytes = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1024) { await reader.cancel(); throw new Error("Schedule body too large"); }
        chunks.push(Buffer.from(part.value));
      }
    } finally { reader.releaseLock(); }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!input || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.schedulerEnabled !== "boolean") throw new Error("Invalid schedule fields");
  } catch { return NextResponse.json({ error: "Expected schedulerEnabled boolean only", code: "invalid_pricing_schedule" }, { status: 400, headers }); }
  try { return NextResponse.json(await setCatalogSchedule(input.schedulerEnabled), { headers }); }
  catch (error) { return NextResponse.json({ error: "Pricing schedule unavailable", code: "pricing_storage_unavailable", configurationSaved: error?.configurationSaved === true }, { status: 503, headers }); }
}
export async function POST(request) {
  const authorization = await authorizeManagement(request, { mutation: true });
  if (authorization.response) return authorization.response;
  // There is deliberately no source/options payload. Reject it before any fetch.
  try {
    if (new URL(request.url).search) throw new Error("Unexpected sync parameters");
    // Next's compiled HTTP adapter may expose an empty stream even when the
    // browser sends no payload. Require bounded EOF, not null stream identity.
    if (request.body !== null) {
      const reader = request.body.getReader();
      let timer;
      try {
        const empty = async () => {
          for (let chunks = 0; chunks < 32; chunks++) {
            const part = await reader.read();
            if (part.done) return;
            if (part.value.byteLength !== 0) throw new Error("Unexpected sync payload");
          }
          throw new Error("Sync stream did not end");
        };
        await Promise.race([empty(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Sync stream did not end")), 2000);
        })]);
      } finally {
        clearTimeout(timer);
        reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  } catch { return NextResponse.json({ error: "Pricing sync accepts no parameters", code: "invalid_pricing_sync_request" }, { status: 400, headers }); }
  try { return NextResponse.json(statusProjection(await syncCatalog()), { headers }); }
  catch {
    try {
      const status = await getCatalogStatus();
      return NextResponse.json({ ...statusProjection(status), error: "pricing_sync_failed" }, { status: 502, headers });
    } catch { return NextResponse.json({ error: "Pricing sync storage unavailable", code: "pricing_storage_unavailable" }, { status: 503, headers }); }
  }
}
