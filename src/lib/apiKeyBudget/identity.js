import { getAdapter } from "../db/driver.js";
import { validateKeyBindings } from "../db/helpers/apiKeyBindings.js";

// Same precedence as outer public inference guard and Gemini wrapper. A supplied
// invalid higher-precedence credential never falls back to a valid lower one.
export function extractGatewayCredential(request) {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  for (const name of ["x-api-key", "x-goog-api-key"]) {
    const value = request.headers.get(name);
    if (value) return value;
  }
  try {
    const url = request.nextUrl || new URL(request.url);
    return url.searchParams.get("key") || null;
  } catch {
    // Invalid request metadata must fail, never become the no-key exemption.
    const error = new Error("Invalid gateway request URL");
    error.status = 400;
    throw error;
  }
}
// No inference caller yet. This differentiates disabled known identity from
// unknown/no-key local compatibility; it never exports secret or mask matching.
export async function resolveGatewayIdentity(request, { adapter = getAdapter } = {}) {
  const db = await adapter(); // No-key exemption does not bypass writer ownership.
  const credential = extractGatewayCredential(request);
  if (credential === null) return { status: "absent", apiKeyId: null };
  const row = db.get("SELECT * FROM apiKeys WHERE key=?", [credential]);
  if (!row) return { status: "unknown", apiKeyId: null };
  validateKeyBindings(db, db.coverage, [row]);
  if (![1, true].includes(row.isActive)) return { status: "disabled", apiKeyId: row.id };
  return { status: "active", apiKeyId: row.id };
}
