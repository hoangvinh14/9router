import { NextResponse } from "next/server";
import { authorizeManagement } from "../auth/managementGuard.js";
const headers = { "Cache-Control": "no-store" };
const codes = new Set(["invalid_accounting_identifier", "api_key_not_found", "api_key_inactive", "invalid_budget_policy", "accounting_not_ready", "accounting_coverage_gap", "invalid_accounting_query", "invalid_accounting_recovery", "accounting_attempt_not_found", "invalid_gap_recovery", "invalid_maintenance_recovery", "accounting_gap_not_found", "api_key_accounting_conflict", "api_key_accounting_unavailable"]);
export async function accountingManagementRoute(request, context, { mutation = false, action }) {
  const authorization = await authorizeManagement(request, { mutation });
  if (authorization.response) return authorization.response;
  try {
    const params = await context.params;
    let body;
    if (mutation) {
      if (!request.body) throw Object.assign(new Error(), { status: 400 });
      const reader = request.body.getReader(), chunks = []; let bytes = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 16384) { await reader.cancel(); throw Object.assign(new Error(), { status: 400 }); }
          chunks.push(Buffer.from(part.value));
        }
      } finally { reader.releaseLock(); }
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw Object.assign(new Error(), { status: 400 }); }
    }
    return NextResponse.json(await action(params, body, authorization.actor), { headers });
  } catch (error) {
    const status = [400, 404, 409, 503].includes(error?.status) ? error.status : 503;
    const code = codes.has(error?.code) ? error.code : status === 400 ? "invalid_accounting_request" : "api_key_accounting_unavailable";
    return NextResponse.json({ error: status === 400 ? "Invalid accounting request" : status === 404 ? "Accounting resource not found" : status === 409 ? "Accounting state conflict" : "Accounting unavailable", code }, { status, headers });
  }
}
export function accountingQuery(request) {
  let query;
  try { query = new URL(request.url).searchParams; }
  catch { throw Object.assign(new Error(), { status: 400 }); }
  if ([...query.keys()].some(key => !["limit", "afterAttemptId", "state"].includes(key))) throw Object.assign(new Error(), { status: 400 });
  const raw = query.get("limit");
  if (raw !== null && !/^[1-9]\d{0,2}$/.test(raw)) throw Object.assign(new Error(), { status: 400 });
  for (const key of query.keys()) if (query.getAll(key).length !== 1) throw Object.assign(new Error(), { status: 400 });
  return { limit: raw === null ? 50 : Number(raw), afterAttemptId: query.get("afterAttemptId"), state: query.get("state") };
}
