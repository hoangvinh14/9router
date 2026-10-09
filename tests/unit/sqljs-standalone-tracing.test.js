import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
import config from "../../next.config.mjs";

const require = createRequire(import.meta.url);
const matches = require("next/dist/compiled/picomatch");

describe("SQL.js standalone runtime asset tracing", () => {
  it("retains the exact dynamically resolved WASM for all serving routes", () => {
    expect(config.output).toBe("standalone");
    expect(config.serverExternalPackages).toContain("sql.js");
    const includes = config.outputFileTracingIncludes;
    expect(includes["/*"]).toEqual(["./node_modules/sql.js/dist/sql-wasm.wasm"]);
    // Same matcher options as installed Next collect-build-traces.js.
    const match = matches("/*", { dot: true, contains: true });
    for (const route of ["/api/v1/chat/completions", "/api/keys", "/api/keys/[id]/accounting/[attemptId]/resolve", "/dashboard/endpoint", "/login"]) {
      expect(match(route)).toBe(true);
    }
  });

  it("points to the installed SQL.js binary, without widening excludes or externals", () => {
    const wasm = fs.readFileSync(new URL("../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url));
    expect(wasm.length).toBeGreaterThan(8);
    expect(wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))).toBe(true);
    expect(config.outputFileTracingExcludes).toEqual({ "*": ["./gitbook/**/*"] });
    expect(config.serverExternalPackages).toEqual(["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "open"]);
    // Config/input checks are not proof of the emitted standalone artifact.
    // The build gate separately checks its installed path and exact input hash.
  });
});
