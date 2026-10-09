import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
vi.mock("../../open-sse/providers/registry/index.js", () => ({ default: [
  { id: "openai", alias: "oai", models: [{ id: "gpt-5", type: "llm" }, { id: "text-embedding-3-small", type: "embedding" }, { id: "excluded-image", type: "image" }] },
  { id: "unmapped", models: [{ id: "unknown" }] },
] }));
let dir, db, report, route, token;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-coverage-report-")); vi.stubEnv("DATA_DIR", dir); vi.stubEnv("JWT_SECRET", "isolated-coverage-secret"); delete global._dbAdapter; vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter(); report = await import("@/lib/pricing/coverageReport.js"); route = await import("@/app/api/pricing/coverage/route.js");
  token = await (await import("@/lib/auth/dashboardSession.js")).createDashboardAuthToken();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db?.close(); delete global._dbAdapter; vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
function request(query = "", authenticated = true) { return new NextRequest(`http://localhost:20128/api/pricing/coverage${query}`, { headers: { host: "localhost:20128", ...(authenticated ? { cookie: `auth_token=${token}` } : {}) } }); }
function catalog(entries) { db.durableTransaction(() => db.run("INSERT OR REPLACE INTO kv(scope,key,value) VALUES('referencePricing','catalog',?)", [JSON.stringify({ entries, revision: "a".repeat(64), syncedAt: "2026-10-04T00:00:00.000Z" })])); }
describe("effective reference pricing coverage, observational not raw usage certification", () => {
  it("auth before reads; warm adapter no fetch/report writes and global counts across bounded page", async () => {
    const read = vi.spyOn(db, "get"); expect((await route.GET(request("", false))).status).toBe(401); expect(read).not.toHaveBeenCalled();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const run = vi.spyOn(db, "run");
    const response = await route.GET(request("?limit=1")); expect(response.status).toBe(200); const page = await response.json();
    expect(page).toMatchObject({ virtualReference: true, usageCertified: false, counts: { total: 3, byEndpoint: { chat: { total: 2 }, embeddings: { total: 1 } } }, nextOffset: 1 }); expect(page.rows).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
    expect(db.get("SELECT * FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it("manual overrides unsupported synced entry; unsupported never falls through bundled, embedding input-only", async () => {
    catalog({ "openai/gpt-5": { status: "unsupported", rates: { input: "1", output: "2" } } });
    let result = await report.getPricingCoverage(); expect(result.rows.find(row => row.model === "gpt-5")).toMatchObject({ status: "unavailable", reason: "unsupported_catalog_price_semantics" });
    await (await import("@/lib/db/repos/pricingRepo.js")).updatePricing({ openai: { "gpt-5": { input: "0", output: "2" }, "text-embedding-3-small": { input: "0.02" } } });
    result = await report.getPricingCoverage();
    expect(result.rows.find(row => row.model === "gpt-5")).toMatchObject({ status: "priced", source: "manual", rates: { input: "0", output: "2" } });
    expect(result.rows.find(row => row.endpoint === "embeddings")).toMatchObject({ source: "manual", rates: { input: "0.02", output: "0" } });
    expect(result.counts).toMatchObject({ priced: 2, unavailable: 1, bySource: { manual: 2 } });
    const prices = await import("@/lib/db/repos/pricingRepo.js");
    await prices.updatePricing({ oai: { "text-embedding-3-small": { input: "0", cached: "0" } } });
    const resolver = await import("@/lib/pricing/referenceResolver.js");
    expect(resolver.resolveReferencePriceSync(db, "oai", "text-embedding-3-small", "embeddings").snapshot.rates).toEqual({ input: "0", output: "0", cached: "0" });
    expect(resolver.resolveReferencePriceSync(db, "openai", "text-embedding-3-small", "embeddings").snapshot.rates.input).toBe("0.02");
  });
  it("revision pinned pagination detects effective pricing changes; malformed/corrupt storage sanitized", async () => {
    const first = await report.getPricingCoverage({ limit: 1 });
    expect((await report.getPricingCoverage({ limit: 1, offset: 1, revision: first.revision })).rows).toHaveLength(1);
    await (await import("@/lib/db/repos/pricingRepo.js")).updatePricing({ unmapped: { unknown: { input: "1", output: "2" } } });
    expect((await route.GET(request(`?offset=1&revision=${first.revision}`))).status).toBe(409);
    for (const query of ["?limit=201", "?offset=-1", "?limit=1&limit=2", "?source=https://evil", "?revision=bad"]) expect((await route.GET(request(query))).status).toBe(400);
    db.durableTransaction(() => db.run("INSERT OR REPLACE INTO kv(scope,key,value) VALUES('referencePricing','catalog','private/path invalid-json')"));
    const r = await route.GET(request()); expect(r.status).toBe(503); expect(r.headers.get("cache-control")).toBe("no-store"); expect(JSON.stringify(await r.json())).not.toMatch(/private\/path/);
  });
  it("catalog/override lookup and parsing bounded to unique providers not each model", async () => {
    const reads = vi.spyOn(db, "get"); await report.getPricingCoverage();
    const lookups = reads.mock.calls.filter(([sql]) => sql === "SELECT value FROM kv WHERE scope=? AND key=?");
    expect(lookups).toHaveLength(3);
  });
});
