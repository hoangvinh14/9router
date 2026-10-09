import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
let directory, db, route, session;
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pricing-management-"));
  vi.stubEnv("DATA_DIR", directory); vi.stubEnv("JWT_SECRET", "isolated-management-fixture-only-secret"); vi.stubEnv("NINEROUTER_PEER_TOKEN", "fixture-peer");
  delete global._dbAdapter; vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  route = await import("@/app/api/pricing/sync/route.js"); session = await import("@/lib/auth/dashboardSession.js");
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); db?.close(); delete global._dbAdapter; vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true });
});
async function request({ method = "GET", origin, token, local = false } = {}) {
  const headers = { host: "localhost:20128" };
  if (token) headers.cookie = `auth_token=${token}`;
  if (origin) headers.origin = origin;
  if (local) { headers["x-9r-peer-token"] = "fixture-peer"; headers["x-9r-real-ip"] = "127.0.0.1"; }
  return new NextRequest("http://localhost:20128/api/pricing/sync", { method, headers });
}
describe("actual session/storage pricing route integration", () => {
  it("actual signed dashboard read is observational; anonymous/expired/claimless sessions denied", async () => {
    const fetcher = vi.fn(() => { throw new Error("unexpected source call"); }); vi.stubGlobal("fetch", fetcher);
    const token = await session.createDashboardAuthToken();
    const result = await route.GET(await request({ token })); expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ revision: null, schedulerEnabled: false });
    for (const supplied of [undefined, "invalid-jwt", await session.createDashboardAuthToken({ authenticated: false })]) {
      expect((await route.GET(await request({ token: supplied }))).status).toBe(401);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.get("SELECT * FROM kv WHERE scope='referencePricing'")).toBeUndefined();
    expect(db.get("SELECT * FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  });
  it("fixed fixture source publication, rejected sync keeps original persisted catalog and override", async () => {
    const token = await session.createDashboardAuthToken();
    const fixture = fs.readFileSync(new URL("../fixtures/pricing/models-dev-minimal.json", import.meta.url), "utf8");
    const fetcher = vi.fn().mockResolvedValue(new Response(fixture)); vi.stubGlobal("fetch", fetcher);
    const prices = await import("@/lib/db/repos/pricingRepo.js"); await prices.updatePricing({ openai: { "gpt-5": { input: "0", output: "2" } } });
    const mutation = () => request({ method: "POST", origin: "http://localhost:20128", token });
    expect((await route.POST(await request({ method: "POST", origin: "https://evil.example", token }))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    const first = await route.POST(await mutation()); expect(first.status).toBe(200);
    const original = await first.json(); expect(original.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(fetcher.mock.calls[0][0]).toBe("https://models.dev/api.json");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { Accept: "application/json" } });
    fetcher.mockResolvedValue(new Response('{"invalid":true}'));
    const failed = await route.POST(await mutation()); expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ revision: original.revision, error: "pricing_sync_failed" });
    expect((await prices.getPricing()).openai["gpt-5"]).toEqual({ input: 0, output: 2 });
    const catalog = JSON.parse(db.get("SELECT value FROM kv WHERE scope='referencePricing' AND key='catalog'").value);
    expect(catalog.revision).toBe(original.revision);
  });
  it("actual settings do not permit anonymous remote, direct proof with disabled login only", async () => {
    const settings = await import("@/lib/db/repos/settingsRepo.js");
    await settings.updateSettings({ requireLogin: false });
    expect((await route.GET(await request())).status).toBe(401);
    expect((await route.GET(await request({ local: true }))).status).toBe(200);
    await settings.updateSettings({ requireLogin: true });
    expect((await route.GET(await request({ local: true }))).status).toBe(401);
  });
});
