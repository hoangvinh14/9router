# Single isolated host build preflight

UI focused tests: 27/27; lint5 exit0; frozen source/helper hashes verified. This is not rendered/browser/build acceptance.

## Read-only discovery
Broad home-directory Playwright discovery timed out at 10s after lint archival completed. Counsel preceded correction; no identical search retry. Exact root/tests package resolution did not resolve Playwright/Puppeteer/ws. Cached Chromium1228 executable exists at `/home/gmo/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`; Node24 has native WebSocket. The `/usr/bin/chromium-browser` executable is only a missing-snap wrapper and will not be used. No dependency/browser install authorized or attempted.

Host resource observation: ~14GiB total, ~5.8GiB available, 12 logical CPUs; current cgroup leaf/ancestors report memory.max=max, no CPU quota at user.slice. These are observations, not reserved build resources. `bwrap` available; actual unshare-user/unshare-net no-op and namespace-local loopback connection probes passed. No network or live-container change.

## Proposed build execution, not yet launched
- One `npm run build` (including existing standalone asset-copy postbuild), unique project-relative NEXT_DIST_DIR; existing next.config is unchanged. Disposable HOME/DATA_DIR/TMP/cache outside source tree.
- Repository/node_modules read-only except that exact new dist directory; no writes to .next, dependency replacement, persistent build knobs or source changes. Capture source hashes before/after.
- Clean explicit environment; repository has only .env.example, no .env secrets. Do not inherit upstream credentials/proxy values. Build-only NEXT_PHASE=phase-production-build, MODEL_CATALOG_SYNC=off, DISABLE_BACKGROUND_TOKEN_REFRESH=true, telemetry disabled. Do not carry build phase into serving tests.
- Taskset2CPU + Node max-old-space-size2048 + external900s process-group timeout. This is a timed/CPU-affinity build, NOT an aggregate-memory-bounded build: Node workers/native allocations may exceed per-process heap. No tuning/retry loop on timeout/OOM; retain failure and counsel.
- Layout uses next/font/google Inter. Next's installed font downloader explicitly supports HTTPS_PROXY. Proposed unshared network namespace denies direct external networking, with a test-owned numeric-loopback proxy bridged over a private Unix socket to an outer enforcing CONNECT-only proxy. Only exact fonts.googleapis.com:443 and fonts.gstatic.com:443 destinations allowed, no generic HTTPS or provider/catalog destinations. Validate controls before build; do not describe a JS preload as OS-level enforcement.
- Chromium/CDP capability and actual compiled-server/API/page/mobile/restart acceptance remain separate; no --no-sandbox shortcut. Existing Docker0.5.104/container/volume untouched. Future Alpine image tests use separate tag/container/data/port; user owns live replacement. No shutdown redesign.

See Advisor counsel on resource/network isolation: disable flags alone are not egress enforcement, and disposable HOME alone does not scrub inherited/repository credentials. Native mount/network namespace boundaries must be validated before the font-only claim.
