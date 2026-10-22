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
    return url.origin;
  } catch { return null; }
}
function loopback(url) { return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname); }
function directLocal(request, url) {
  return hasTrustedPeerHeaders(request) && !request.headers.get("x-9r-via-proxy") && loopback(url)
    && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.headers.get("x-9r-real-ip"));
}
function normalizationProvenance(request, url, host) {
  const headers = request.headers;
  const originalForwarding = headers.get("x-9r-authority-forwarded"), socketProtocol = headers.get("x-9r-socket-proto");
  if (headers.has("x-9r-authority-forwarded") && originalForwarding !== "0") return false;
  if (headers.has("x-9r-socket-proto") && socketProtocol !== url.protocol) return false;
  const hasHost = headers.has("x-forwarded-host"), hasProto = headers.has("x-forwarded-proto");
  if (!hasHost && !hasProto) return true;
  return originalForwarding === "0" && socketProtocol === url.protocol
    && ["http:", "https:"].includes(socketProtocol) && hasHost && hasProto
    && headers.get("x-forwarded-host") === host
    && headers.get("x-forwarded-proto") === socketProtocol.slice(0, -1);
}
function authority(request) {
  try {
    const url = new URL(request.url), host = request.headers.get("host");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !host || /[\s,@/\\?#]/.test(host)) return null;
    const hostUrl = new URL(`${url.protocol}//${host}`);
    if (host.toLowerCase() !== hostUrl.host) return null;
    if (hostUrl.origin === url.origin) return url;
    // Only authenticated direct socket provenance can undo Next loopback normalization.
    if (url.hostname === "localhost" && ["127.0.0.1", "[::1]"].includes(hostUrl.hostname)
        && hostUrl.port === url.port && directLocal(request, hostUrl)
        && normalizationProvenance(request, url, host)) return hostUrl;
    return null;
  } catch { return null; }
}
function mutationAllowed(request, url) {
  const supplied = request.headers.get("origin");
  if (!supplied || origin(supplied) !== supplied || request.headers.get("sec-fetch-site") === "cross-site") return false;
  const forwardedHost = request.headers.get("x-forwarded-host"), forwardedProto = request.headers.get("x-forwarded-proto");
  const rewritten = request.headers.get("x-9r-via-proxy") || forwardedHost && forwardedHost !== request.headers.get("host")
    || forwardedProto && `${forwardedProto}:` !== url.protocol;
  if (rewritten) {
    const configured = origin(process.env.NINEROUTER_MANAGEMENT_ORIGIN);
    return configured !== null && supplied === configured;
  }
  return supplied === url.origin;
}
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
