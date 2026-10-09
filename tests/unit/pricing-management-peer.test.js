import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import http from "node:http";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/auth/dashboardSession.js", () => ({ getDashboardAuthSession: mocks.session }));
vi.mock("@/lib/db/index.js", () => ({ getSettings: mocks.settings }));
import { authorizeManagement } from "@/lib/auth/managementGuard.js";
const require = createRequire(import.meta.url);
let server, base;
const priorToken = process.env.NINEROUTER_PEER_TOKEN;
beforeAll(async () => {
  mocks.session.mockResolvedValue(null); mocks.settings.mockResolvedValue({ requireLogin: false });
  require("../../custom-server.js");
  server = http.createServer(async (incoming, response) => {
    try {
      const request = new NextRequest(`http://${incoming.headers.host}/api/pricing/sync`, { method: incoming.method, headers: incoming.headers });
      const authorization = await authorizeManagement(request, { mutation: incoming.method === "POST" });
      response.setHeader("x-fixture-observed-host", incoming.headers.host);
      response.writeHead(authorization.response?.status || 200);
      response.end(JSON.stringify(authorization.response ? await authorization.response.json() : { actor: authorization.actor }));
    } catch { response.writeHead(500); response.end("fixture failure"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  if (priorToken === undefined) delete process.env.NINEROUTER_PEER_TOKEN; else process.env.NINEROUTER_PEER_TOKEN = priorToken;
});
function rawRequest(host) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ hostname: "127.0.0.1", port: server.address().port, path: "/", headers: { host } }, response => {
      response.resume(); response.once("end", () => resolve({ status: response.statusCode, observedHost: response.headers["x-fixture-observed-host"] }));
    });
    outgoing.once("error", reject); outgoing.end();
  });
}
describe("actual TCP wrapper to management guard", () => {
  it("socket provenance replaces forged stamps and permits only same-origin direct local mutation", async () => {
    const direct = await fetch(base, { method: "POST", headers: { origin: base, "x-9r-peer-token": "forged", "x-9r-real-ip": "203.0.113.1" } });
    expect(direct.status).toBe(200); expect(await direct.json()).toEqual({ actor: "local-management" });
    expect((await fetch(base, { method: "POST", headers: { origin: "http://localhost:" + server.address().port } })).status).toBe(403);
  });
  it("loopback reverse-proxy hop is never a sessionless local management identity", async () => {
    for (const forwarded of ["127.0.0.1", "203.0.113.3"]) {
      const result = await fetch(base, { headers: { "x-forwarded-for": forwarded, "x-9r-peer-token": process.env.NINEROUTER_PEER_TOKEN, "x-9r-via-proxy": "" } });
      expect(result.status).not.toBe(200);
    }
  });
  it("raw HTTP canonical loopback control permits direct local management", async () => {
    const host = `127.0.0.1:${server.address().port}`;
    expect(await rawRequest(host)).toEqual({ status: 200, observedHost: host });
  });
  it.each([["attacker.example", 401], ["127.1", 403]])("transmitted hostile Host %s cannot rebind actual loopback socket", async (name, expected) => {
    const host = name === "127.1" ? `${name}:${server.address().port}` : name;
    const result = await rawRequest(host);
    expect(result.observedHost).toBe(host);
    expect(result.status).toBe(expected);
  });
});
