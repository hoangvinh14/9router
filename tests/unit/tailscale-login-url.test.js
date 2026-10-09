import { it, expect, vi } from "vitest";
import { tailscaleLoginUrl, openTailscaleLogin } from "@/shared/utils/tailscaleLoginUrl.js";
it("only the exact Tailscale HTTPS auth resource may be opened, navigation revalidates", () => {
  const open = vi.fn(); vi.stubGlobal("window", { open });
  try {
    const good = "https://login.tailscale.com/a/Abc123";
    expect(tailscaleLoginUrl(good)).toBe(good); expect(openTailscaleLogin(good)).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(good, "tailscale_auth", "width=600,height=700,noopener,noreferrer");
    for (const value of [undefined, "", "javascript:alert(1)", "http://login.tailscale.com/a/Abc123", "https://login.tailscale.com.evil/a/Abc123", "https://login.tailscale.com@evil.test/a/Abc123", "https://user@login.tailscale.com/a/Abc123", "https://login.tailscale.com:443/a/Abc123", "https://login.tailscale.com./a/Abc123", "https://login.tailscale.com/a/Abc123?redirect=https://evil.test", "https://login.tailscale.com/a/Abc123#fragment", "https://login.tailscale.com/a/../evil", "https://login.tailscale.com/a/Abc%31", " https://login.tailscale.com/a/Abc123", "https://login.tailscale.com/a/Abc123\n"]) {
      expect(tailscaleLoginUrl(value)).toBeNull(); expect(openTailscaleLogin(value)).toBe(false);
    }
    expect(open).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
