import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
let db, api, dir;
const original = process.env.DATA_DIR;
const secret = "sk-secret-fixture-never-in-stats";
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-redact-")); process.env.DATA_DIR = dir; delete global._dbAdapter; delete global._recentRing; vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter(); api = await import("@/lib/db/index.js");
  await api.importDb({ apiKeys: [{ id: "stable-key-id", key: secret, name: "Fixture key" }] });
});
afterEach(() => { db?.close(); delete global._dbAdapter; delete global._recentRing; fs.rmSync(dir, { recursive: true, force: true }); if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original; });
describe("legacy stats response credential boundary", () => {
  it("live/daily/history responses never expose raw bucket secrets and deletion retains ID", async () => {
    await api.saveRequestUsage({ timestamp: new Date().toISOString(), apiKey: secret, provider: "openai", model: "gpt-4", tokens: { prompt_tokens: 10, completion_tokens: 5 } });
    for (const period of ["24h", "all", "7d"]) {
      const stats = await api.getUsageStats(period);
      expect(JSON.stringify(stats)).not.toContain(secret);
      const buckets = Object.values(stats.byApiKey);
      expect(buckets).toHaveLength(1); expect(buckets[0].apiKeyId).toBe("stable-key-id"); expect(buckets[0].requests).toBe(1);
      expect(buckets[0].apiKeyKey).toBe("key:stable-key-id");
    }
    expect(JSON.stringify(await api.getUsageHistory())).not.toContain(secret);
    await api.deleteApiKey("stable-key-id");
    expect(Object.values((await api.getUsageStats("all")).byApiKey)[0].apiKeyId).toBe("stable-key-id");
  });
  it("unknown legacy secrets get separate stable HMAC grouping; no-key remains no-key", async () => {
    const now = Date.now();
    for (const [i, key] of ["unknown-secret-a", "unknown-secret-b", null].entries()) await api.saveRequestUsage({ timestamp: new Date(now + i).toISOString(), apiKey: key, provider: "openai", model: "gpt-4", tokens: { prompt_tokens: 10 + i, completion_tokens: 5 } });
    const stats = await api.getUsageStats("all");
    expect(JSON.stringify(stats)).not.toContain("unknown-secret");
    const ids = Object.values(stats.byApiKey).map(v => v.apiKeyKey);
    expect(ids.filter(id => id.startsWith("legacy:"))).toHaveLength(2); expect(new Set(ids).size).toBe(3); expect(ids).toContain("local-no-key");
    expect(Object.values((await api.getUsageStats("all")).byApiKey).map(v => v.apiKeyKey)).toEqual(ids);
  });
  it("normalized bucket collisions merge counters rather than dropping old/new attribution", async () => {
    const { redactUsageBuckets } = await import("@/lib/db/helpers/usageAttribution.js");
    const values = { rawModel: "fixture", provider: "openai", requests: 1, promptTokens: 2, completionTokens: 3, cachedTokens: 0, cost: 0.1, lastUsed: "2026-10-03T00:00:00.000Z" };
    const result = redactUsageBuckets(db, { [`${secret}|fixture|openai`]: values, other: { ...values, apiKeyId: "stable-key-id" } });
    expect(Object.values(result)).toHaveLength(1); expect(Object.values(result)[0].requests).toBe(2); expect(Object.values(result)[0].promptTokens).toBe(4); expect(JSON.stringify(result)).not.toContain(secret);
  });
});
