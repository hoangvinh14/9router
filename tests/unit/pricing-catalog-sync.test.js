import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from 'next/server';
import { validateCatalog, fetchCatalog } from "@/lib/pricing/catalogSync.js";
const fixture = fs.readFileSync(new URL("../fixtures/pricing/models-dev-minimal.json", import.meta.url), "utf8");
describe("pricing-only catalog boundary", () => {
  it("keeps validated decimal source rates, explicit zero, and unavailable/unsupported metadata", () => {
    const catalog = validateCatalog(fixture);
    expect(catalog.entries["openai/gpt-5"].rates).toMatchObject({ input: "1.25", output: "10", cached: "0.125" });
    expect(catalog.entries["openai/free-fixture"].rates.input).toBe("0");
    expect(catalog.entries["openai/unknown-fixture"].status).toBe("missing");
    expect(catalog.entries["openai/tier-fixture"].status).toBe("unsupported");
    expect(catalog.entries["openai/audio-fixture"].status).toBe("unsupported");
    expect(catalog.entries["anthropic/claude-sonnet-4-6"].rates.cache_creation).toBe("3.75");
    expect(catalog).not.toHaveProperty("api");
  });
  it("valid public @cf and tilde model identifiers are opaque bounded IDs", () => {
    const catalog = validateCatalog('{"cloudflare-workers-ai":{"id":"cloudflare-workers-ai","models":{"@cf/meta/fixture":{"id":"@cf/meta/fixture","cost":{"input":1,"output":2}}}},"kilo":{"id":"kilo","models":{"~lab/latest":{"id":"~lab/latest","cost":{"input":1,"output":2}}}}}');
    expect(catalog.entries["cloudflare-workers-ai/@cf/meta/fixture"].rates.input).toBe("1");
    expect(catalog.entries["kilo/~lab/latest"].status).toBe("priced");
  });
  it("preserves exact numeric lexemes rather than rounding through JSON Number", () => {
    const catalog = validateCatalog('{"p":{"id":"p","models":{"m":{"id":"m","cost":{"input":0.000000001,"output":1e-3}}}}}');
    expect(catalog.entries["p/m"].rates).toMatchObject({ input: "0.000000001", output: "0.001" });
    expect(() => validateCatalog('{"p":{"id":"p","models":{"m":{"id":"m","cost":{"input":0.0000000009999999999,"output":1}}}}}')).toThrow(/precision/);
  });
  it("rejects malformed batches, prototype keys, duplicate keys and invalid supplied rates", () => {
    for (const text of ['{"p":{"id":"p","models":{"m":{"id":"m","cost":{"input":{"numericLexeme":"0"},"output":1}}}}}', "{}", "{",  '{"__proto__":{}}', '{"p":{"id":"p","models":{"m":{"id":"m","cost":{"input":null,"output":1}}}}}', '{"p":{"id":"p","models":{"m":{"id":"m","cost":{"input":-1,"output":1}}}}}', '{"p":{"id":"p","models":{"m":{"id":"m","cost":{"input":1,"input":2,"output":1}}}}}']) expect(() => validateCatalog(text)).toThrow();
  });
  it("rejects composite-key collisions and invalid nested tier prices", () => {
    expect(() => validateCatalog('{"a/b":{"id":"a/b","models":{"c":{"id":"c","cost":{"input":1,"output":2}}}},"a":{"id":"a","models":{"b/c":{"id":"b/c","cost":{"input":1,"output":2}}}}}')).toThrow(/provider/);
    expect(() => validateCatalog(fixture.replace('"input": 2, "output": 4', '"input": -2, "output": 4'))).toThrow(/Negative/);
    const tierOnly = '{"p":{"id":"p","models":{"m":{"id":"m","cost":{"tiers":[{"tier":{"type":"context","size":100},"input":1,"output":2}]}}}}}';
    expect(() => validateCatalog(tierOnly)).toThrow(/Incomplete/);
  });
  it("fetches fixed HTTPS source without credentials, redirects or arbitrary URL input", async () => {
    let args;
    const catalog = await fetchCatalog({ fetchImpl: async (...input) => { args = input; return new Response(fixture, { headers: { "content-type": "application/json" } }); } });
    expect(args[0]).toBe("https://models.dev/api.json"); expect(args[1].redirect).toBe("error");
    expect(args[1].headers).not.toHaveProperty("Authorization"); expect(catalog.entries["openai/gpt-5"]).toBeDefined();
    await expect(fetchCatalog({ fetchImpl: async () => new Response("", { status: 302, headers: { location: "http://127.0.0.1" } }) })).rejects.toThrow();
    await expect(fetchCatalog({ fetchImpl: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
  });
  it("enforces decompressed byte limit during streaming, not after full buffering", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(128)); controller.enqueue(new Uint8Array(128)); controller.close(); } });
    await expect(fetchCatalog({ fetchImpl: async () => new Response(stream), maxBytes: 200 })).rejects.toThrow(/size/);
  });
});

describe("opt-in scheduler", () => {
  it("default off, 24h single timer, maintenance/ownership failures never fetch", async () => {
    vi.useFakeTimers();
    const scheduler = await import("@/lib/pricing/catalogScheduler.js");
    const sync = vi.fn(async () => {});
    const adapter = vi.fn(async () => ({ health: () => ({ healthy: true }), coverage: { status: () => ({ maintenance: null }) } }));
    try {
      scheduler.configureCatalogScheduler(false);
      expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
      scheduler.configureCatalogScheduler(true, { sync, adapter });
      scheduler.configureCatalogScheduler(true, { sync, adapter });
      expect(sync).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(sync).toHaveBeenCalledTimes(1);
      adapter.mockResolvedValue({ health: () => ({ healthy: true }), coverage: { status: () => ({ maintenance: { reason: "restore" } }) } });
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(sync).toHaveBeenCalledTimes(1);
      adapter.mockRejectedValue(new Error("not owner"));
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(sync).toHaveBeenCalledTimes(1);
      scheduler.configureCatalogScheduler(false);
      expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
    } finally { scheduler.configureCatalogScheduler(false); vi.useRealTimers(); }
  });
});

describe("durable catalog and reference snapshots", () => {
  let dir, db, sync, resolver;
  const original = process.env.DATA_DIR;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pricing-"));
    process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
    db = await (await import("@/lib/db/driver.js")).getAdapter();
    sync = await import("@/lib/pricing/catalogSync.js");
    resolver = await import("@/lib/pricing/referenceResolver.js");
  });
  afterEach(() => {
    vi.restoreAllMocks(); db?.close(); delete global._dbAdapter;
    fs.rmSync(dir, { recursive: true, force: true });
    if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original;
  });
  const response = () => new Response(fixture);
  it("sync is single flight and failure retains last-good revision/overrides", async () => {
    const pricing = await import("@/lib/db/repos/pricingRepo.js");
    await pricing.updatePricing({ openai: { "gpt-5": { input: "0", output: "2" } } });
    const fetchImpl = vi.fn(async () => response());
    await Promise.all([sync.syncCatalog({ fetchImpl }), sync.syncCatalog({ fetchImpl })]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const previous = await sync.getStoredCatalog();
    await expect(sync.syncCatalog({ fetchImpl: async () => new Response("malformed") })).rejects.toThrow();
    expect((await sync.getStoredCatalog()).revision).toBe(previous.revision);
    expect((await sync.getCatalogStatus()).error).toBe("pricing_sync_failed");
    expect(resolver.resolveReferencePriceSync(db, "openai", "gpt-5").snapshot).toMatchObject({ source: "manual", rates: { input: "0", output: "2" } });
    const legacy = await pricing.getPricing();
    expect(legacy.openai["gpt-5"]).toEqual({ input: 0, output: 2 });
    expect(legacy.anthropic["claude-sonnet-4-6"].cached).toBe(0.3);
    const { isValidModel } = await import("open-sse/config/providerModels.js");
    expect(isValidModel("anthropic", "claude-sonnet-4-6")).toBe(false);
    expect(legacy).not.toHaveProperty("revision");
    const before = db.get("SELECT value FROM kv WHERE scope='pricing' AND key='openai'").value;
    for (const rates of [{ input: "1" }, { input: "1", output: Infinity }, { input: "1", output: "2", cached: null }]) await expect(pricing.updatePricing({ openai: { bad: rates } })).rejects.toThrow();
    expect(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='openai'").value).toBe(before);
    await pricing.resetAllPricing();
    expect((await pricing.getPricing()).openai["gpt-5"].input).toBe(1.25);
    expect((await sync.getStoredCatalog()).revision).toBe(previous.revision);
  });
  it("complete sources preserve snapshots and unsupported prices do not fall through", async () => {
    await sync.syncCatalog({ fetchImpl: async () => response() });
    const first = resolver.resolveReferencePriceSync(db, "cx", "gpt-5");
    expect(first.snapshot).toMatchObject({ source: "synced", virtual: true, rates: { input: "1.25", output: "10" } });
    expect(resolver.resolveReferencePriceSync(db, "openai", "tier-fixture")).toMatchObject({ status: "unavailable", reason: "unsupported_catalog_price_semantics" });
    expect(resolver.resolveReferencePriceSync(db, "compatible-node-test", "gpt-5")).toMatchObject({ status: "unavailable" });
    expect(resolver.resolveReferencePriceSync(db, "reseller", "vendor/gpt-5")).toMatchObject({ status: "unavailable" });
    const pricing = await import("@/lib/db/repos/pricingRepo.js");
    await pricing.updatePricing({ codex: { "gpt-5": { input: "3", output: "4" } } });
    expect(resolver.resolveReferencePriceSync(db, "cx", "gpt-5").snapshot.source).toBe("manual");
    expect(first.snapshot.rates.input).toBe("1.25");
    await pricing.resetPricing("codex", "gpt-5");
    expect(resolver.resolveReferencePriceSync(db, "cx", "gpt-5").snapshot.source).toBe("synced");
    expect(resolver.resolveReferencePriceSync(db, "openai", "free-fixture").snapshot.rates.input).toBe("0");
    expect(() => resolver.completeReferenceRates({ input: null, output: "1" })).toThrow();
  });
  it("free namespaces require approved transport and snapshots are immutable complete sources", async () => {
    const free = resolver.resolveReferencePriceSync(db, "cl", "cline-free/fixture");
    expect(free.snapshot).toMatchObject({ source: "approved_free_namespace", rates: { input: "0", output: "0" } });
    expect(resolver.resolveReferencePriceSync(db, "custom-node", "cline-free/fixture").status).toBe("unavailable");
    expect(resolver.resolveReferencePriceSync(db, "cline", "unknown-fixture").status).toBe("unavailable");
    expect(resolver.resolveReferencePriceSync(db, "openai", "gpt-5", "audio").status).toBe("unavailable");
    const pricing = await import("@/lib/db/repos/pricingRepo.js");
    await pricing.updatePricing({ mistral: { "mistral-embed": { input: "0.1" } } });
    expect(resolver.resolveReferencePriceSync(db, "mistral", "mistral-embed", "embeddings").snapshot.rates).toEqual({ input: "0.1", output: "0" });
    await pricing.updatePricing({ openai: { "gpt-5": { input: "2", output: "3" } } });
    const selected = resolver.resolveReferencePriceSync(db, "openai", "gpt-5").snapshot;
    expect(selected.fallbackSemantics).toEqual({ cached: "input_rate", cache_creation: "input_rate", reasoning: "output_rate" });
    expect(selected.rates).toEqual({ input: "2", output: "3" });
    expect(() => { selected.rates.input = "0"; }).toThrow();
    expect(() => { selected.source = "synced"; }).toThrow();
  });
  it("canonical and explicit alias overrides have consistent map/model/snapshot precedence", async () => {
    await sync.syncCatalog({ fetchImpl: async () => response() });
    const pricing = await import("@/lib/db/repos/pricingRepo.js");
    await pricing.updatePricing({ codex: { "gpt-5": { input: "0", output: "4" } } });
    expect((await pricing.getPricing()).cx["gpt-5"]).toEqual({ input: 0, output: 4 });
    expect(await pricing.getPricingForModel("cx", "gpt-5")).toEqual({ input: 0, output: 4 });
    await pricing.updatePricing({ cx: { "gpt-5": { input: "2", output: "3" } } });
    expect((await pricing.getPricing()).cx["gpt-5"]).toEqual({ input: 2, output: 3 });
    expect(resolver.resolveReferencePriceSync(db, "cx", "gpt-5").snapshot.rates).toEqual({ input: "2", output: "3" });
    expect(resolver.resolveReferencePriceSync(db, "codex", "gpt-5").snapshot.rates).toEqual({ input: "0", output: "4" });
    await pricing.resetPricing("cx", "gpt-5");
    expect((await pricing.getPricing()).cx["gpt-5"]).toEqual({ input: 0, output: 4 });
  });
  it("unsupported synced models cannot fall through legacy defaults; complete manual override wins", async () => {
    const source = JSON.parse(fixture);
    source.openai.models["gpt-5"].cost.input_audio = 1;
    await sync.syncCatalog({ fetchImpl: async () => new Response(JSON.stringify(source)) });
    const pricing = await import("@/lib/db/repos/pricingRepo.js");
    expect(await pricing.getPricingForModel("openai", "gpt-5")).toBeNull();
    expect((await pricing.getPricing()).openai).not.toHaveProperty("gpt-5");
    expect(resolver.resolveReferencePriceSync(db, "openai", "gpt-5").status).toBe("unavailable");
    await pricing.updatePricing({ openai: { "gpt-5": { input: "0", output: "0" } } });
    expect(await pricing.getPricingForModel("openai", "gpt-5")).toEqual({ input: 0, output: 0 });
    expect(resolver.resolveReferencePriceSync(db, "openai", "gpt-5").snapshot).toMatchObject({ source: "manual", virtual: true, rates: { input: "0", output: "0" } });
  });
  it("actual HTTP mutations retain catalog and settle selected rates across later changes", async () => {
    await sync.syncCatalog({ fetchImpl: async () => response() });
    const route = await import("@/app/api/pricing/route.js");
    const token = await (await import('@/lib/auth/dashboardSession.js')).createDashboardAuthToken();
    const headers = { host: 'localhost', origin: 'http://localhost', cookie: `auth_token=${token}` };
    const send = data => new NextRequest("http://localhost/api/pricing", { method: "PATCH", headers, body: JSON.stringify(data) });
    const first = resolver.resolveReferencePriceSync(db, "openai", "gpt-5").snapshot;
    expect((await route.PATCH(send({ openai: { "gpt-5": { input: "0.0028", output: "0", cached: "0" } } }))).status).toBe(200);
    const selected = resolver.resolveReferencePriceSync(db, "openai", "gpt-5").snapshot;
    expect(selected.rates).toEqual({ input: "0.0028", output: "0", cached: "0" });
    const before = db.get("SELECT value FROM kv WHERE scope='pricing' AND key='openai'").value;
    expect((await route.PATCH(send({ openai: { "gpt-5": { input: "2", output: "3" }, bad: { input: "1" } } }))).status).toBe(400);
    expect(db.get("SELECT value FROM kv WHERE scope='pricing' AND key='openai'").value).toBe(before);
    const reset = await route.DELETE(new NextRequest("http://localhost/api/pricing?provider=openai&model=gpt-5", { method: 'DELETE', headers }));
    expect(reset.status).toBe(200);
    expect((await reset.json()).openai["gpt-5"].input).toBe(1.25);
    expect(first.rates.input).toBe("1.25"); expect(selected.rates.input).toBe("0.0028");
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
    const scheduler = await import("@/lib/pricing/catalogScheduler.js");
    expect(scheduler.isCatalogSchedulerEnabled()).toBe(false);
  });
  it("live overprecision is degraded on first sync and preserves last-good on later sync", async () => {
    const overprecision = fs.readFileSync(new URL("../fixtures/pricing/models-dev-overprecision.json", import.meta.url), "utf8");
    await expect(sync.syncCatalog({ fetchImpl: async () => new Response(overprecision) })).rejects.toThrow(/precision/);
    expect(await sync.getStoredCatalog()).toBeNull();
    expect((await sync.getCatalogStatus()).error).toBe("pricing_sync_failed");
    expect(resolver.resolveReferencePriceSync(db, "unmapped-provider", "inception/mercury-2").status).toBe("unavailable");
    await sync.syncCatalog({ fetchImpl: async () => response() });
    const previous = await sync.getStoredCatalog();
    await expect(sync.syncCatalog({ fetchImpl: async () => new Response(overprecision) })).rejects.toThrow(/precision/);
    expect(await sync.getStoredCatalog()).toEqual(previous);
  });
  it("manual sync never fetches during scope-wide maintenance", async () => {
    db.coverage.enterMaintenance("managed restore");
    const fetchImpl = vi.fn(async () => response());
    await expect(sync.syncCatalog({ fetchImpl })).rejects.toThrow(/maintenance/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("failed durable publication cannot advertise a new catalog revision", async () => {
    await sync.syncCatalog({ fetchImpl: async () => response() });
    const previous = await sync.getStoredCatalog();
    const actual = db.durableTransaction.bind(db); let calls = 0;
    vi.spyOn(db, "durableTransaction").mockImplementation(fn => { calls++; if (calls === 2) throw new Error("catalog disk failed"); return actual(fn); });
    await expect(sync.syncCatalog({ fetchImpl: async () => new Response(fixture.replace('"input": 1.25', '"input": 2.25')) })).rejects.toThrow("catalog disk failed");
    expect((await sync.getStoredCatalog()).revision).toBe(previous.revision);
  });
});
