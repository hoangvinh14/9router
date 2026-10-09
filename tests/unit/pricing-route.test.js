import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from 'next/server';
import { createDashboardAuthToken } from '@/lib/auth/dashboardSession.js';
const mocks = vi.hoisted(() => ({ getPricing: vi.fn(), updatePricing: vi.fn(), resetPricing: vi.fn(), resetAllPricing: vi.fn() }));
vi.mock("@/lib/localDb.js", () => mocks);
const { GET, PATCH, DELETE } = await import("@/app/api/pricing/route.js");
let token;
beforeAll(async () => { token = await createDashboardAuthToken(); });
const authorized = (method = 'GET', query = '', body) => new NextRequest(`http://localhost/api/pricing${query}`, {
  method, headers: { host: 'localhost', origin: 'http://localhost', cookie: `auth_token=${token}` },
  ...(body === undefined ? {} : { body }),
});
const request = body => authorized('PATCH', '', JSON.stringify(body));
beforeEach(() => { vi.resetAllMocks(); mocks.getPricing.mockResolvedValue({ openai: { fixture: { input: 1, output: 2 } } }); mocks.updatePricing.mockImplementation(async data => Object.fromEntries(Object.entries(data).map(([provider, models]) => [provider, Object.fromEntries(Object.entries(models).map(([model, rates]) => [model, Object.fromEntries(Object.entries(rates).map(([field, rate]) => [field, Number(rate)]))]))]))); });
describe("legacy pricing HTTP contract with exact ingress", () => {
  it("GET remains the numeric provider/model map, no sync metadata", async () => {
    const response = await GET(authorized()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ openai: { fixture: { input: 1, output: 2 } } });
  });
  it("PATCH validates lexical decimals and legacy finite numbers, returning numeric rates", async () => {
    const response = await PATCH(request({ openai: { fixture: { input: "0.000000001", output: 2, cached: "0" } } }));
    expect(response.status).toBe(200);
    expect(mocks.updatePricing.mock.calls[0][0].openai.fixture).toEqual({ input: "0.000000001", output: "2", cached: "0" });
    expect(await response.json()).toEqual({ openai: { fixture: { input: 0.000000001, output: 2, cached: 0 } } });
  });
  it("input-only known embeddings are complete, unknown models still need output", async () => {
    expect((await PATCH(request({ mistral: { "mistral-embed": { input: "0.1" } } }))).status).toBe(200);
    expect(mocks.updatePricing.mock.calls[0][0].mistral["mistral-embed"]).toEqual({ input: "0.1", output: "0" });
    expect((await PATCH(request({ arbitrary: { fixture: { input: "0.1" } } }))).status).toBe(400);
  });
  it("invalid complete batches/malformed JSON fail before storage without reflecting payload", async () => {
    const invalid = [null, [], { openai: [] }, { openai: { fixture: [] } }, { openai: { fixture: { input: "1" } } }, { openai: { fixture: { input: "1", output: "0.0000000001" } } }, { openai: { fixture: { input: "1", output: "2", cached: null } } }, { openai: { fixture: { input: "1", output: "2", url: "secret-fixture" } } }, JSON.parse('{"__proto__":{"fixture":{"input":1,"output":2}}}')];
    for (const body of invalid) {
      const response = await PATCH(request(body)); expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain("secret-fixture");
    }
    expect((await PATCH(authorized('PATCH', '', '{'))).status).toBe(400);
    expect(mocks.updatePricing).not.toHaveBeenCalled();
  });
  it("storage failures are 500, redacted rather than masquerading as invalid input", async () => {
    mocks.updatePricing.mockRejectedValue(new Error("secret-fixture"));
    const response = await PATCH(request({ openai: { fixture: { input: "1", output: "2" } } }));
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("secret-fixture");
  });
  it("DELETE returns effective synced prices and rejects ambiguous/invalid targets", async () => {
    const response = await DELETE(authorized('DELETE', '?provider=openai&model=fixture'));
    expect(response.status).toBe(200); expect(mocks.resetPricing).toHaveBeenCalledWith("openai", "fixture");
    expect(await response.json()).toEqual(await mocks.getPricing());
    mocks.resetPricing.mockClear();
    for (const query of ["model=fixture", "provider=", "provider=__proto__", "provider=openai&model="]) expect((await DELETE(authorized('DELETE', `?${query}`))).status).toBe(400);
    expect(mocks.resetPricing).not.toHaveBeenCalled(); expect(mocks.resetAllPricing).not.toHaveBeenCalled();
    expect((await DELETE(authorized('DELETE'))).status).toBe(200);
    expect(mocks.resetAllPricing).toHaveBeenCalledTimes(1);
  });
});
