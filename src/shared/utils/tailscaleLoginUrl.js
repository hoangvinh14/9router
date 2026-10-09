// The local Tailscale binary emits https://login.tailscale.com/a/<token>.
// Status JSON is not trusted browser navigation authority. Reject everything
// except that exact HTTPS login resource, without credentials/ports/query/hash.
export function tailscaleLoginUrl(value) {
  if (typeof value !== "string" || !/^https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+$/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.href === value && url.protocol === "https:" && url.host === "login.tailscale.com" && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}
export function openTailscaleLogin(value) {
  const trusted = tailscaleLoginUrl(value);
  if (!trusted) return false;
  window.open(trusted, "tailscale_auth", "width=600,height=700,noopener,noreferrer");
  return true;
}
