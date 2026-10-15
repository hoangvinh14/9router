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
  it('per-use explicit unit survives coverage projection/revision but never certifies tool usage', async () => {
    const pricing = await import('@/lib/db/repos/pricingRepo.js');
    const flat = { input: '1', output: '2' };
    await pricing.updatePricing({ openai: { 'gpt-5': flat } });
    const before = await report.getPricingCoverage();
    expect(before.rows.find(row => row.model === 'gpt-5')).not.toHaveProperty('rateUnits');
    await pricing.updatePricing({ openai: { 'gpt-5': { ...flat, web_search_per_1000: '0' } } });
    const result = await report.getPricingCoverage();
    expect(result.revision).not.toBe(before.revision);
    expect(result.usageCertified).toBe(false);
    expect(result.rows.find(row => row.model === 'gpt-5')).toMatchObject({ rates: { ...flat, web_search_per_1000: '0' },
      rateUnits: { web_search_per_1000: 'USD/1000 uses' } });
    expect(result.rows.find(row => row.endpoint === 'embeddings')).not.toHaveProperty('rateUnits');
    const response = await route.GET(request());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).rows.find(row => row.model === 'gpt-5').rateUnits).toEqual({ web_search_per_1000: 'USD/1000 uses' });
    await pricing.updatePricing({ openai: { 'gpt-5': flat } });
    expect((await report.getPricingCoverage()).revision).toBe(before.revision);
    expect(db.get("SELECT * FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it('explicit image/document units remain observational in coverage; rate drift invalidates pagination and removal restores legacy projection', async () => {
    const pricing = await import('@/lib/db/repos/pricingRepo.js'), flat = { input: '1', output: '2', cached: '0.1' };
    await pricing.updatePricing({ openai: { 'gpt-5': flat } }); const before = await report.getPricingCoverage();
    const rates = { ...flat, input_image: '3', cached_image: '0', input_document: '4', cached_document: '0.2' };
    await pricing.updatePricing({ openai: { 'gpt-5': rates } }); const current = await report.getPricingCoverage();
    expect(current.usageCertified).toBe(false); expect(current.revision).not.toBe(before.revision);
    const row = current.rows.find(row => row.model === 'gpt-5'); expect(row.rates).toEqual(rates);
    expect(row.rateUnits).toEqual({ input: 'USD/1M tokens', cached: 'USD/1M tokens', input_image: 'USD/1M tokens', cached_image: 'USD/1M tokens', input_document: 'USD/1M tokens', cached_document: 'USD/1M tokens' });
    expect(row).not.toHaveProperty('usageSemantics'); expect((await route.GET(request(`?offset=1&revision=${before.revision}`))).status).toBe(409);
    await pricing.updatePricing({ openai: { 'gpt-5': flat } }); expect((await report.getPricingCoverage()).revision).toBe(before.revision);
    expect(db.get("SELECT * FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it('processing tool-prompt rates and typed units survive observational coverage without usage authority; drift pins revisions and removal restores projection', async () => {
    const pricing = await import('@/lib/db/repos/pricingRepo.js'), flat = { input: '1', output: '2' };
    await pricing.updatePricing({ openai: { 'gpt-5': flat } }); const before = await report.getPricingCoverage();
    const rates = { ...flat, processing_tool_text: '13', processing_tool_image: '17', processing_tool_document: '29', processing_tool_audio: '19', processing_tool_video: '0' };
    await pricing.updatePricing({ openai: { 'gpt-5': rates } }); const current = await report.getPricingCoverage(), row = current.rows.find(row => row.model === 'gpt-5');
    expect(current.usageCertified).toBe(false); expect(row.rates).toEqual(rates); expect(row).not.toHaveProperty('usageSemantics');
    expect(row.rateUnits).toEqual(Object.fromEntries(Object.keys(rates).filter(key => key.startsWith('processing_tool_')).map(key => [key, 'USD/1M tokens'])));
    expect(current.revision).not.toBe(before.revision); expect((await route.GET(request(`?offset=1&revision=${before.revision}`))).status).toBe(409);
    const response = await route.GET(request()); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect((await response.json()).rows.find(row => row.model === 'gpt-5').rateUnits).toEqual(row.rateUnits);
    expect(current.rows.find(item => item.endpoint === 'embeddings')).not.toHaveProperty('rateUnits');
    await pricing.updatePricing({ openai: { 'gpt-5': flat } }); expect((await report.getPricingCoverage()).revision).toBe(before.revision); expect(db.get("SELECT * FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
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
