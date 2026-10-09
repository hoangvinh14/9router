import { NextResponse } from "next/server";
import { getDashboardAuthSession } from "./dashboardSession.js";
import { hasTrustedPeerHeaders } from "./trustedPeer.js";
import { getSettings } from "../db/index.js";

function deny(status, code) {
  return { response: NextResponse.json({ error: status === 401 ? "Management authentication required" : "Management request forbidden", code }, { status, headers: { "Cache-Control": "no-store" } }) };
}
function origin(value) {
  if (typeof value !== "string" || !value || /[\s,]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    // Origin headers have no path/trailing slash; configured base URLs may have one.
    return url.origin;
  } catch { return null; }
}
function authority(request) {
  try {
    const url = new URL(request.url), host = request.headers.get("host");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !host || /[\s,@/\\?#]/.test(host)) return null;
    const hostUrl = new URL(`${url.protocol}//${host}`);
    // Reject URL parser aliases (127.1, decimal IPs, trailing dots, empty ports),
    // rather than letting canonicalization turn attacker authority into local.
    if (host.toLowerCase() !== hostUrl.host) return null;
    if (hostUrl.origin === url.origin) return url;
    // NextRequest normalizes literal loopback URLs to localhost. Only trusted
    // direct socket provenance permits recovering the original Host authority.
    if (url.hostname === "localhost" && ["127.0.0.1", "[::1]"].includes(hostUrl.hostname)
      && hostUrl.port === url.port && directLocal(request, hostUrl)
      && normalizationProvenance(request, url, host)) return hostUrl;
    return null;
  } catch { return null; }
}
function normalizationProvenance(request, url, host) {
  const headers = request.headers;
  const originalForwarding = headers.get("x-9r-authority-forwarded");
  const socketProtocol = headers.get("x-9r-socket-proto");
  // directLocal authenticates these wrapper-owned stamps before this helper.
  // Original wire authority must not become trusted by downstream deletion.
  if (headers.has("x-9r-authority-forwarded") && originalForwarding !== "0") return false;
  if (headers.has("x-9r-socket-proto") && socketProtocol !== url.protocol) return false;
  const hasHost = headers.has("x-forwarded-host"), hasProto = headers.has("x-forwarded-proto");
  // Preserve the old genuinely absent-forwarding path. Missing evidence never
  // grants the NEW permission to reconcile framework-populated forwarding.
  if (!hasHost && !hasProto) return true;
  return originalForwarding === "0" && socketProtocol === url.protocol
    && ["http:", "https:"].includes(socketProtocol) && hasHost && hasProto
    && headers.get("x-forwarded-host") === host
    && headers.get("x-forwarded-proto") === socketProtocol.slice(0, -1);
}
function loopback(url) { return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname); }
function directLocal(request, url) {
  return hasTrustedPeerHeaders(request) && !request.headers.get("x-9r-via-proxy") && loopback(url)
    && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.headers.get("x-9r-real-ip"));
}
function mutationAllowed(request, url) {
  const supplied = request.headers.get("origin");
  if (!supplied || origin(supplied) !== supplied || request.headers.get("sec-fetch-site") === "cross-site") return false;
  const forwardedHost = request.headers.get("x-forwarded-host"), forwardedProto = request.headers.get("x-forwarded-proto");
  const rewritten = request.headers.get("x-9r-via-proxy") || (forwardedHost && forwardedHost !== request.headers.get("host")) || (forwardedProto && `${forwardedProto}:` !== url.protocol);
  if (rewritten) {
    // A proxy's internal Host is not authority for the browser's external Origin.
    // Explicit deployment configuration is required, never forwarded input.
    const configured = origin(process.env.NINEROUTER_MANAGEMENT_ORIGIN);
    return configured !== null && supplied === configured;
  }
  return supplied === url.origin;
}
// New privileged APIs use this in-route, irrespective of the permissive outer
// middleware. No CLI/gateway credential or development Host-only exemption.
export async function authorizeManagement(request, { mutation = false } = {}) {
  const url = authority(request);
  if (!url) return deny(403, "management_authority_invalid");
  let session;
  try { session = await getDashboardAuthSession(request.cookies?.get("auth_token")?.value); }
  catch { return deny(401, "management_unauthorized"); }
  let local = false;
  if (session?.authenticated !== true) {
    if (!directLocal(request, url)) return deny(401, "management_unauthorized");
    try { local = (await getSettings())?.requireLogin === false; }
    catch { return deny(401, "management_unauthorized"); }
    if (!local) return deny(401, "management_unauthorized");
  }
  if (mutation && !mutationAllowed(request, url)) return deny(403, "management_csrf_rejected");
  return { actor: local ? "local-management" : "dashboard-session" };
}
