import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { access, readFile, readdir } from "fs/promises";
import { GET as cursorImport } from "@/app/api/oauth/cursor/auto-import/route";
import { GET as kiroImport } from "@/app/api/oauth/kiro/auto-import/route";
import { GET as coworkSettings } from "@/app/api/cli-tools/cowork-settings/route";
import { resolveZedCredentialsUrl, getZedGlobalDbPaths } from "@/lib/oauth/utils/zedCredentials";

vi.mock("next/server", () => ({ NextResponse: { json: body => ({ json: async () => body }) } }));
vi.mock("os", async importOriginal => {
  const actual = await importOriginal();
  const overrides = { homedir: () => "/fixture-home", platform: () => process.platform };
  return { ...actual, ...overrides, default: { ...actual.default, ...overrides } };
});
vi.mock("fs/promises", () => {
  const access = vi.fn(), readFile = vi.fn(), readdir = vi.fn();
  return { access, readFile, readdir, constants: { R_OK: 4 }, default: { access, readFile, readdir } };
});
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn() }));

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const platform = value => Object.defineProperty(process, "platform", { value, configurable: true });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APPDATA", ""); vi.stubEnv("LOCALAPPDATA", "");
  vi.stubEnv("XDG_CONFIG_HOME", ""); vi.stubEnv("XDG_DATA_HOME", "");
  vi.stubEnv("ProgramFiles", "");
  vi.mocked(access).mockRejectedValue(new Error("Fixture absent"));
  vi.mocked(readFile).mockRejectedValue(new Error("Fixture absent"));
});
afterEach(() => { Object.defineProperty(process, "platform", originalPlatform); vi.unstubAllEnvs(); });

describe("runtime host configuration candidates", () => {
  it.each([
    ["C:\\Fixture\\Roaming", "C:\\Fixture\\Local"],
    ["\\\\server\\profile\\Roaming", "\\\\server\\profile\\Local"],
    ["", ""],
  ])("preserves native joins and ordered Windows candidates: %s", async (roaming, local) => {
    platform("win32"); vi.stubEnv("APPDATA", roaming); vi.stubEnv("LOCALAPPDATA", local);
    const app = roaming || path.join("/fixture-home", "AppData", "Roaming");
    const loc = local || path.join("/fixture-home", "AppData", "Local");
    expect((await (await cursorImport()).json()).found).toBe(false);
    expect(access.mock.calls.map(([candidate]) => candidate)).toEqual([
      path.join(app, "Cursor/User/globalStorage/state.vscdb"),
      path.join(app, "Cursor - Insiders/User/globalStorage/state.vscdb"),
      path.join(loc, "Cursor/User/globalStorage/state.vscdb"),
      path.join(loc, "Programs/Cursor/User/globalStorage/state.vscdb"),
    ]);
    access.mockClear();
    await resolveZedCredentialsUrl();
    expect(access.mock.calls[0][0]).toBe(path.join(loc, "Zed/settings.json"));
    expect(getZedGlobalDbPaths()).toEqual(["0-global", "0-stable", "0-preview"].map(channel => path.join(loc, "Zed/db", channel, "db.sqlite")));
    access.mockClear();
    expect((await (await coworkSettings()).json()).installed).toBe(false);
    const candidates = access.mock.calls.map(([candidate]) => candidate);
    expect(candidates.slice(0, 4)).toEqual([
      path.join(loc, "Claude-3p"), path.join(app, "Claude-3p"),
      path.join(loc, "Claude"), path.join(app, "Claude"),
    ]);
  });

  it("resolves changed XDG settings on each call", async () => {
    platform("linux"); vi.stubEnv("XDG_CONFIG_HOME", "/fixture/first");
    await resolveZedCredentialsUrl();
    vi.stubEnv("XDG_CONFIG_HOME", "/fixture/second");
    await resolveZedCredentialsUrl();
    expect(access.mock.calls.map(([candidate]) => candidate)).toEqual(["/fixture/first/zed/settings.json", "/fixture/second/zed/settings.json"]);
    vi.stubEnv("XDG_DATA_HOME", "/fixture/data");
    expect(getZedGlobalDbPaths()[0]).toBe("/fixture/data/zed/db/0-global/db.sqlite");
  });

  it.each(["/fixture/posix-appdata", ""])("keeps Kiro APPDATA candidate on Linux, including fallback: %s", async appdata => {
    platform("linux"); vi.stubEnv("APPDATA", appdata);
    vi.mocked(readdir).mockResolvedValue(["kiro-auth-token.json"]);
    vi.mocked(readFile).mockImplementation(async candidate => {
      if (candidate === "/fixture-home/.aws/sso/cache/kiro-auth-token.json") return JSON.stringify({ refreshToken: "aorAAAAAG-fixture" });
      if (candidate === "/fixture-home/.config/Kiro/User/globalStorage/kiro.kiroagent/profile.json") return JSON.stringify({ arn: "arn:aws:codewhisperer:eu-west-1:fixture" });
      throw new Error("Fixture absent");
    });
    const result = await (await kiroImport()).json();
    expect(result.found).toBe(true);
    expect(result.profileArn).toBe("arn:aws:codewhisperer:us-east-1:fixture");
    expect(readFile.mock.calls.map(([candidate]) => candidate)).toEqual([
      "/fixture-home/.aws/sso/cache/kiro-auth-token.json",
      path.join(appdata || "/fixture-home/AppData/Roaming", "Kiro/User/globalStorage/kiro.kiroagent/profile.json"),
      "/fixture-home/.config/Kiro/User/globalStorage/kiro.kiroagent/profile.json",
    ]);
  });
});
