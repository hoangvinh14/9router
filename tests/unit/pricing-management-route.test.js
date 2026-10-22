import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), settings: vi.fn(), status: vi.fn(), sync: vi.fn(), schedule: vi.fn() }));
vi.mock("@/lib/auth/dashboardSession.js", () => ({ getDashboardAuthSession: mocks.session }));
vi.mock("@/lib/db/index.js", () => ({ getSettings: mocks.settings }));
vi.mock("@/lib/pricing/catalogSync.js", () => ({ CATALOG_SOURCE: "https://models.dev/api.json", getCatalogStatus: mocks.status, syncCatalog: mocks.sync }));
vi.mock("@/lib/pricing/catalogSchedule.js", () => ({ setCatalogSchedule: mocks.schedule }));
import { GET, POST, PUT } from "@/app/api/pricing/sync/route.js";
const stored = { revision: "a".repeat(64), syncedAt: "2026-10-03T01:02:03.000Z", pricedCount: 3, schedulerEnabled: false };
function request({ method = "GET", url = "http://localhost:20128/api/pricing/sync", headers = {}, body } = {}) {
  return new NextRequest(url, { method, headers: { host: new URL(url).host, ...headers }, ...(body === undefined ? {} : { body }) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NINEROUTER_PEER_TOKEN", "fixture-stamp"); vi.stubEnv("NINEROUTER_MANAGEMENT_ORIGIN", "");
  mocks.session.mockResolvedValue(null); mocks.settings.mockResolvedValue({ requireLogin: false }); mocks.status.mockResolvedValue(stored); mocks.sync.mockResolvedValue(stored);
});
afterEach(() => vi.unstubAllEnvs());
const local = { "x-9r-peer-token": "fixture-stamp", "x-9r-real-ip": "127.0.0.1" };
describe("strict pricing management boundary", () => {
  it.each([
    { "x-api-key": "gateway-key" }, { "x-9r-cli-token": "cli-key" }, { host: "localhost:20128" },
    { ...local, "x-9r-peer-token": "forged" }, { ...local, "x-9r-real-ip": "203.0.113.5" },
    { ...local, "x-9r-via-proxy": "1" }, { "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1" },
  ])("denies unauthenticated/forged/proxy credentials before disclosure or fetch %j", async headers => {
    expect((await GET(request({ headers }))).status).toBe(401);
    expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("rejects remote anonymous when login disabled and loopback DNS rebinding", async () => {
    expect((await GET(request({ url: "https://attacker.example/api/pricing/sync", headers: local }))).status).toBe(401);
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
  });
  it("accepts verified direct IPv4/IPv6 loopback only with login disabled", async () => {
    expect((await GET(request({ headers: local }))).status).toBe(200);
    expect((await GET(request({ url: "http://[::1]:20128/api/pricing/sync", headers: { ...local, "x-9r-real-ip": "::1" } }))).status).toBe(200);
    mocks.settings.mockResolvedValue({ requireLogin: true });
    expect((await GET(request({ headers: local }))).status).toBe(401);
    mocks.settings.mockRejectedValue(new Error("fixture storage secret"));
    expect((await GET(request({ headers: local }))).status).toBe(401);
  });
  it("trusted framework-normalized IPv4/IPv6 retains exact mutation Origin", async () => {
    for (const host of ["127.0.0.1", "[::1]"]) {
      const url = `http://${host}:20128/api/pricing/sync`;
      const headers = { ...local, origin: `http://${host}:20128` };
      expect((await POST(request({ method: "POST", url, headers }))).status).toBe(200);
      expect((await POST(request({ method: "POST", url, headers: { ...headers, origin: "http://localhost:20128" } }))).status).toBe(403);
    }
  });
  it("normalized authority needs verified direct peer even with valid JWT", async () => {
    mocks.session.mockResolvedValue({ authenticated: true });
    const url = "http://127.0.0.1:20128/api/pricing/sync";
    for (const headers of [{}, { ...local, "x-9r-peer-token": "forged" }, { ...local, "x-9r-via-proxy": "1" }, { ...local, "x-forwarded-host": "router.example" }]) {
      expect((await POST(request({ method: "POST", url, headers: { ...headers, origin: "http://127.0.0.1:20128" } }))).status).toBe(403);
    }
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("valid dashboard session can read but GET never triggers sync", async () => {
    mocks.session.mockResolvedValue({ authenticated: true });
    expect((await GET(request({ url: "https://dashboard.example/api/pricing/sync" }))).status).toBe(200);
    expect(mocks.sync).not.toHaveBeenCalled(); expect(mocks.settings).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ authenticated: false });
    expect((await GET(request())).status).toBe(401);
  });
  it.each([undefined, "null", "https://evil.example", "http://localhost:20129", "http://localhost:20128/", "http://user@localhost:20128", "http://localhost:20128, http://evil.example", "http://localhost:20128?x=1"])("JWT mutation origin %j denies without sync", async origin => {
    mocks.session.mockResolvedValue({ authenticated: true });
    const headers = origin === undefined ? {} : { origin };
    expect((await POST(request({ method: "POST", headers }))).status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
  });
  it("local login-disabled mutation requires exact origin too", async () => {
    expect((await POST(request({ method: "POST", headers: local }))).status).toBe(403);
    expect((await POST(request({ method: "POST", headers: { ...local, origin: "http://localhost:20128" } }))).status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith();
  });
  it("cross-site metadata rejects even matching Origin; same-site is no bypass", async () => {
    mocks.session.mockResolvedValue({ authenticated: true });
    expect((await POST(request({ method: "POST", headers: { origin: "http://localhost:20128", "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect((await POST(request({ method: "POST", headers: { origin: "https://evil.example", "sec-fetch-site": "same-site" } }))).status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("proxy-rewritten external HTTPS requires configured authority, never trusts forwarding", async () => {
    mocks.session.mockResolvedValue({ authenticated: true });
    const headers = { origin: "https://dashboard.example", "x-forwarded-host": "dashboard.example", "x-forwarded-proto": "https" };
    expect((await POST(request({ method: "POST", headers }))).status).toBe(403);
    vi.stubEnv("NINEROUTER_MANAGEMENT_ORIGIN", "https://dashboard.example");
    expect((await POST(request({ method: "POST", headers }))).status).toBe(200);
    expect((await POST(request({ method: "POST", headers: { ...headers, origin: "https://evil.example" } }))).status).toBe(403);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
  it.each(["attacker.example", "localhost:20129", "localhost:20128,evil.example", "localhost:20128/path", "user@localhost:20128", "127.1:20128", "2130706433:20128", "localhost.:20128", "localhost:20128:"])("malformed/inconsistent host %s denies even valid session", async host => {
    mocks.session.mockResolvedValue({ authenticated: true });
    expect((await GET(request({ headers: { host } }))).status).toBe(403);
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("payload-free POST permits an empty framework body stream, never actual payload bytes", async () => {
    mocks.session.mockResolvedValue({ authenticated: true });
    const headers = { origin: 'http://localhost:20128' };
    const empty = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(0)); controller.close(); } });
    const req = new NextRequest('http://localhost:20128/api/pricing/sync', { method: 'POST', headers: { host: 'localhost:20128', ...headers }, body: empty, duplex: 'half' });
    expect((await POST(req)).status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    mocks.sync.mockClear();
    for (const body of [' ', '{}', 'x']) {
      expect((await POST(request({ method: 'POST', headers, body }))).status).toBe(400);
    }
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('empty-stream inspection is bounded and unauthorized streams are never read', async () => {
    const headers = { host: 'localhost:20128', origin: 'http://localhost:20128' };
    const make = stream => new NextRequest('http://localhost:20128/api/pricing/sync', { method: 'POST', headers, body: stream, duplex: 'half' });
    const unauthorized = make(new ReadableStream({ start(controller) { controller.close(); } }));
    const reader = vi.spyOn(unauthorized.body, 'getReader');
    expect((await POST(unauthorized)).status).toBe(401);
    expect(reader).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ authenticated: true });
    let cancelled = false;
    const endless = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(0)); }, cancel() { cancelled = true; } });
    expect((await POST(make(endless))).status).toBe(400);
    expect(cancelled).toBe(true);
    const broken = new ReadableStream({ start(controller) { controller.error(new Error('fixture')); } });
    expect((await POST(make(broken))).status).toBe(400);
    const held = new ReadableStream({ cancel() { cancelled = true; } });
    cancelled = false;
    expect((await POST(make(held))).status).toBe(400);
    expect(cancelled).toBe(true);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("auth precedes body, source input/options prohibited before fetch", async () => {
    expect((await POST(request({ method: "POST", body: "secret" }))).status).toBe(401);
    mocks.session.mockResolvedValue({ authenticated: true });
    expect((await POST(request({ method: "POST", headers: { origin: "http://localhost:20128" }, body: '{"url":"http://private"}' }))).status).toBe(400);
    expect((await POST(request({ method: "POST", url: "http://localhost:20128/api/pricing/sync?url=http://private", headers: { origin: "http://localhost:20128" } }))).status).toBe(400);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("scheduler mutation authenticates before bounded body and rejects extras", async () => {
    expect((await PUT(request({ method: "PUT", body: "invalid" }))).status).toBe(401);
    mocks.session.mockResolvedValue({ authenticated: true });
    for (const body of ['{"schedulerEnabled":"true"}', '{"schedulerEnabled":true,"url":"http://private"}', "[true]", "x".repeat(1025)]) {
      expect((await PUT(request({ method: "PUT", headers: { origin: "http://localhost:20128" }, body }))).status).toBe(400);
    }
    expect(mocks.schedule).not.toHaveBeenCalled();
    mocks.schedule.mockResolvedValue({ schedulerConfigured: true, schedulerEnabled: true });
    expect((await PUT(request({ method: "PUT", headers: { origin: "http://localhost:20128" }, body: '{"schedulerEnabled":true}' }))).status).toBe(200);
    expect(mocks.schedule).toHaveBeenCalledWith(true); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("read projection allowlists fields and redacts errors, no raw status leaks", async () => {
    mocks.session.mockResolvedValue({ authenticated: true });
    mocks.status.mockResolvedValue({ ...stored, source: "http://attacker", error: "SECRET stack", secret: "SECRET", lastAttempt: "evil" });
    const response = await GET(request()); const result = await response.json();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(result).toMatchObject({ source: "https://models.dev/api.json", error: "pricing_sync_failed", lastAttempt: null });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("sync failure exposes retained revision but storage failure redacted503", async () => {
    mocks.session.mockResolvedValue({ authenticated: true }); mocks.sync.mockRejectedValue(new Error("SECRET catalog"));
    const req = () => request({ method: "POST", headers: { origin: "http://localhost:20128" } });
    const response = await POST(req()); expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ revision: stored.revision, error: "pricing_sync_failed" });
    mocks.status.mockRejectedValue(new Error("SECRET db"));
    const failed = await POST(req()); expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain("SECRET");
  });
});
