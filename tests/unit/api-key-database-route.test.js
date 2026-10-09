import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exportDb: vi.fn(), importDb: vi.fn(), getSettings: vi.fn(), password: vi.fn(), cli: vi.fn(), proxy: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } }));
vi.mock("@/lib/localDb", () => ({ exportDb: mocks.exportDb, importDb: mocks.importDb, getSettings: mocks.getSettings }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardPassword: mocks.password }));
vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: mocks.cli }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: mocks.proxy }));
const { GET, POST } = await import("@/app/api/settings/database/route.js");
beforeEach(() => { vi.resetAllMocks(); mocks.cli.mockResolvedValue(false); mocks.password.mockResolvedValue(false); mocks.exportDb.mockResolvedValue({ exportVersion: 2, accounting: { completeBackup: false } }); });
describe("configuration import/export accounting boundary", () => {
  it("header presence alone cannot skip password reauthentication", async () => {
    const request = new Request("http://localhost/api/settings/database", { headers: { "x-9r-cli-token": "forged" } });
    expect((await GET(request)).status).toBe(401);
    expect(mocks.exportDb).not.toHaveBeenCalled();
  });
  it("verified CLI can export configuration with non-complete accounting metadata", async () => {
    mocks.cli.mockResolvedValue(true);
    const response = await GET(new Request("http://localhost/api/settings/database"));
    expect(response.status).toBe(200); expect(response.body.accounting.completeBackup).toBe(false);
  });
  it("identity conflict returns 409 without leaking payload secrets", async () => {
    mocks.password.mockResolvedValue(true);
    mocks.importDb.mockRejectedValue(Object.assign(new Error("API key identity binding conflict; import unchanged"), { status: 409, code: "api_key_identity_conflict" }));
    const response = await POST(new Request("http://localhost/api/settings/database", { method: "POST", body: JSON.stringify({ password: "fixture", apiKeys: [{ id: "a", key: "secret-fixture" }] }) }));
    expect(response.status).toBe(409); expect(response.body.code).toBe("api_key_identity_conflict");
    expect(JSON.stringify(response)).not.toContain("secret-fixture"); expect(mocks.proxy).not.toHaveBeenCalled();
  });
  it("unexpected SQL errors are redacted instead of exposing payload values", async () => {
    mocks.cli.mockResolvedValue(true); mocks.importDb.mockRejectedValue(new Error("bad SQL value secret-fixture"));
    const response = await POST(new Request("http://localhost/api/settings/database", { method: "POST", body: "{}" }));
    expect(response.status).toBe(400); expect(JSON.stringify(response)).not.toContain("secret-fixture");
  });
});
