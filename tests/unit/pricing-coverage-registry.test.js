import { it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { normalizeModel, modelKind } from "../../open-sse/providers/models/schema.js";

it("actual registry coverage identities, exact embeddings and coherent effective pages without network or warm writes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-real-coverage-")); let db;
  vi.stubEnv("DATA_DIR", dir); delete global._dbAdapter;
  try {
    db = await (await import("@/lib/db/driver.js")).getAdapter();
    const prices = await import("@/lib/db/repos/pricingRepo.js");
    await prices.updatePricing({ github: { "text-embedding-3-small": { input: "0.000000001", cached: "0" } } });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const writes = vi.spyOn(db, "run"); const reads = vi.spyOn(db, "get");
    const { getPricingCoverage } = await import("@/lib/pricing/coverageReport.js");
    const expected = REGISTRY.flatMap(provider => (provider.models || []).map(normalizeModel).filter(model => ["llm", "embedding"].includes(modelKind(model))).map(model => ({ provider: provider.id, model: model.id, endpoint: modelKind(model) === "embedding" ? "embeddings" : "chat" }))).sort((a, b) => JSON.stringify([a.provider, a.model, a.endpoint]).localeCompare(JSON.stringify([b.provider, b.model, b.endpoint]), "en"));
    const first = await getPricingCoverage({ limit: 200 }); const rows = [...first.rows];
    expect(first.counts.total).toBe(expected.length); expect(expected.length).toBeGreaterThan(800);
    const initialReads = reads.mock.calls.filter(([sql]) => sql === "SELECT value FROM kv WHERE scope=? AND key=?").length;
    expect(initialReads).toBeLessThanOrEqual(REGISTRY.length + 1);
    let offset = first.nextOffset;
    while (offset !== null) { const next = await getPricingCoverage({ limit: 200, offset, revision: first.revision }); expect(next.counts).toEqual(first.counts); expect(next.revision).toBe(first.revision); rows.push(...next.rows); offset = next.nextOffset; }
    expect(rows.map(({ provider, model, endpoint }) => ({ provider, model, endpoint }))).toEqual(expected);
    expect(new Set(rows.map(({ provider, model, endpoint }) => JSON.stringify([provider, model, endpoint]))).size).toBe(rows.length);
    expect(first.counts.priced + first.counts.unavailable).toBe(rows.length);
    for (const endpoint of ["chat", "embeddings"]) expect(first.counts.byEndpoint[endpoint].total).toBe(rows.filter(row => row.endpoint === endpoint).length);
    expect(rows.find(row => row.provider === "github" && row.model === "text-embedding-3-small")).toMatchObject({ endpoint: "embeddings", source: "manual", rates: { input: "0.000000001", output: "0", cached: "0" } });
    expect(first).toMatchObject({ virtualReference: true, usageCertified: false });
    expect(fetcher).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    expect(db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined();
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); db?.close(); delete global._dbAdapter; vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); }
}, 20000);
