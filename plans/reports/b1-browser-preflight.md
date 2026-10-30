# B1 Phase 2 browser/CLI preflight

Current source build required, never historical `.next-*` artifacts. Production activation OFF; hybrid browser source-route fixture is not detached shipping-server acceptance.

## Inspected owners

`tests/fixtures/accounting/budget-web-fixture.mjs`, `budget-web-loader.mjs`, `chat-loopback.js`, `test-database.js`, `tests/browser/budget-panel-checks.mjs`, `budget-cli-checks.mjs`, `scripts/copy-standalone-assets.mjs`, `next.config.mjs`, P4 `verification-261028-p4-acceptance-trace.md`.

Installed runtime: Node v24.21.0, Next 16.4.3 (runner asserts exact version), Vitest4.1.12, installed tests Playwright package. Browser binary availability is verified by actual launch, not inferred.

## Exact intended commands

Build from repository root, unique source-current artifact, isolated environment directories:

```bash
sandbox=$(mktemp -d /tmp/9router-b1-build-XXXXXX)
mkdir -p "$sandbox/home" "$sandbox/data" "$sandbox/appdata"
HOME="$sandbox/home" DATA_DIR="$sandbox/data" APPDATA="$sandbox/appdata" NEXT_DIST_DIR=.next-b1-recorded-spend NEXT_TELEMETRY_DISABLED=1 MODEL_CATALOG_SYNC=off DISABLE_BACKGROUND_TOKEN_REFRESH=true npm run build
```

Build timeout 600s; background task owns command. Retain build logs and artifact; never delete pre-existing artifacts. Build may expose existing tracing/worker warnings; classify rather than silently ignore. Only build output under `.next-b1-recorded-spend` is used.

After successful build, root execution, one adapter at a time, timeout 240s each. Export the existing binary cache first (profiles remain disposable):

```bash
export PLAYWRIGHT_BROWSERS_PATH=/home/gmo/.cache/ms-playwright
```

Initial Node launch without this override failed before checks because disposable HOME hid the installed browser; receipt preserved as `b1-browser-node-initial.json`. Executable verified with `test -x`; original process absent before retry. No browser installation or sandbox relaxation.

```bash
BUDGET_STANDALONE="$PWD/.next-b1-recorded-spend/standalone" node --import ./tests/fixtures/accounting/budget-web-loader.mjs ./tests/fixtures/accounting/budget-web-fixture.mjs "$PWD/plans/reports/b1-browser-node.json" --panel
BUDGET_STANDALONE="$PWD/.next-b1-recorded-spend/standalone" node --import ./tests/fixtures/accounting/budget-web-loader.mjs ./tests/fixtures/accounting/budget-web-fixture.mjs "$PWD/plans/reports/b1-browser-sqljs.json" --panel --engine=sqljs
```

Runner binds server and dummy upstream to `127.0.0.1` ephemeral ports. It creates its own temporary DATA_DIR/HOME/APPDATA, synthetic session/provider/key secrets and Node/SQL.js DB. Browser headless, Chromium sandbox enabled, no user profile/focus. Browser network is restricted to fixture origin. Compiled login/UI hydration is real; API routes execute current source through Next AppRouteRouteModule, exact delivered Request WeakMaps, not public activation headers/settings.

Each runner finally closes browser/context, sockets, source fixture/DB, clears known usage timers and writes receipt. On wall-time termination inspect for orphan children before cleanup; never claim runner finally executed after forced kill. Temporary root/screenshots are retained for inspection as recorded in receipt, never copied into shipping patch. Record BUILD_ID and existing source/HTML hashes; source changes after build require rebuilding relevant artifact.

CLI checks import real CommonJS management client and perform guarded login/key CRUD against same disposable HTTP server. No external credentials or production key management.

## Added acceptance

Existing full browser checks retain guards, dirty draft/CAS/freshness, zero/rollover/overshoot, key isolation, UI keyboard/mobile, late GET unmount and completed-without-usage safety. New final check uses key B: two absent interrupted SSEs add no spend/work/blocker; authoritative usage before EOF charges exactly once without finish/DONE. Source projection describes durable-evidence policy and possible undercount; UI contains no admin recovery requirement for exempt attempts. Existing safety evidence/gaps remain visible.

## Remaining distinct acceptance

Detached shipping-server smoke, broad regression comparator and final current-source review still require separate evidence. Browser success alone is not production activation, invoice accuracy or broader provider support.
