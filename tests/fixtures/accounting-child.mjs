// Isolated subprocess fixture: no root alias/production DATA_DIR access.
process.env.DATA_DIR = process.argv[2];
// Vite's loader resolves the application's existing @ alias in the child.
const { createServer } = await import("../node_modules/vite/dist/node/index.js");
const { resolve } = await import("node:path");
const server = await createServer({
  // SSR imports only: a recursive dev watcher/client dependency crawl over
  // captured Next builds is unrelated to the ledger and can starve this child.
  // Keep the original bounded timeout and crash/reopen assertions unchanged.
  configFile: false, root: resolve(import.meta.dirname, "../.."),
  server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { "@": resolve(import.meta.dirname, "../../src"), "open-sse": resolve(import.meta.dirname, "../../open-sse") } },
});
const { getAdapter } = await server.ssrLoadModule("/src/lib/db/driver.js");
const repo = await server.ssrLoadModule("/src/lib/db/repos/apiKeyAccountingRepo.js");
const db = await getAdapter();
const mode = process.argv[3];
if (mode === "intent" || mode === "settled") {
  repo.insertAttemptSync(db, { attemptId: "child-attempt", requestId: "child-request", apiKeyId: "child-key", ownerInstanceId: db.ownerInstanceId,
    startedAt: "2026-10-03T00:00:00.000Z", provider: "openai", model: "fixture", endpoint: "chat" });
  if (mode === "settled") repo.finalizeAttemptSync(db, "child-attempt", { state: "settled", outcome: "success", usage: { input: 1 }, costNanoUsd: "31", finishedAt: "2026-10-03T00:01:00.000Z" });
  process.stdout.write(`ACK:${db.ownerInstanceId}\n`);
  process.kill(process.pid, "SIGKILL");
} else if (mode === "signal") {
  repo.insertAttemptSync(db, { attemptId: "child-attempt", requestId: "child-request", apiKeyId: "child-key", ownerInstanceId: db.ownerInstanceId,
    startedAt: "2026-10-03T00:00:00.000Z", provider: "openai", model: "fixture", endpoint: "chat" });
  process.kill(process.pid, "SIGTERM");
} else if (mode === "inspect") {
  process.stdout.write(`RESULT:${JSON.stringify(repo.getAttemptSync(db, "child-attempt"))}\n`);
  db.close(); await server.close();
} else {
  db.close(); await server.close(); throw new Error("Unknown fixture mode");
}
