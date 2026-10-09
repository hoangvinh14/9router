import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
let db, dir, identity;
const original = process.env.DATA_DIR;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-budget-identity-")); process.env.DATA_DIR = dir; delete global._dbAdapter; vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  await (await import("@/lib/db/index.js")).importDb({ apiKeys: [{ id: "active", key: "fixture-active" }, { id: "disabled", key: "fixture-disabled", isActive: false }] });
  identity = await import("@/lib/apiKeyBudget/identity.js");
});
afterEach(() => { db?.close(); delete global._dbAdapter; fs.rmSync(dir, { recursive: true, force: true }); if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original; });
const request = (headers = {}, query = "") => new Request(`http://localhost/api/v1beta/models/fixture${query}`, { headers });
describe("inactive gateway identity context", () => {
  it("resolves active stable ID with each credential location without returning secret", async () => {
    for (const r of [request({ Authorization: "Bearer fixture-active" }), request({ "x-api-key": "fixture-active" }), request({ "x-goog-api-key": "fixture-active" }), request({}, "?key=fixture-active")]) {
      expect(await identity.resolveGatewayIdentity(r)).toEqual({ status: "active", apiKeyId: "active" });
    }
  });
  it("matches Bearer > Anthropic > Google > query; invalid higher credentials do not fall back", async () => {
    expect(await identity.resolveGatewayIdentity(request({ Authorization: "Bearer fixture-disabled", "x-api-key": "fixture-active" }, "?key=fixture-active"))).toEqual({ status: "disabled", apiKeyId: "disabled" });
    expect(await identity.resolveGatewayIdentity(request({ "x-api-key": "unknown", "x-goog-api-key": "fixture-active" }))).toEqual({ status: "unknown", apiKeyId: null });
    expect(await identity.resolveGatewayIdentity(request({ "x-goog-api-key": "fixture-disabled" }, "?key=fixture-active"))).toEqual({ status: "disabled", apiKeyId: "disabled" });
  });
  it("known disabled never downgrades to absent; unknown and no-key retain distinct compatibility status", async () => {
    expect(await identity.resolveGatewayIdentity(request())).toEqual({ status: "absent", apiKeyId: null });
    expect(await identity.resolveGatewayIdentity(request({ "x-api-key": "fixture-disabled" }))).toEqual({ status: "disabled", apiKeyId: "disabled" });
    expect(await identity.resolveGatewayIdentity(request({ "x-api-key": "fixture-missing" }))).toEqual({ status: "unknown", apiKeyId: null });
  });
  it("no-key cannot bypass ownership, and malformed URL cannot become absent", async () => {
    await expect(identity.resolveGatewayIdentity(request(), { adapter: async () => { throw new Error("writer not owned"); } })).rejects.toThrow(/writer/);
    expect(() => identity.extractGatewayCredential({ headers: new Headers(), url: "not a URL" })).toThrow(/URL/);
  });
});
