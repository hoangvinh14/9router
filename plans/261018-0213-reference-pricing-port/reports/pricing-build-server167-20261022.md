# Compiled build verification — server 167 — 2026-10-22

The host build command completed successfully on server 167. The disposable output was checked locally at `/tmp/9router-phase3-build-261022/phase3-dist-261022`.

Verified artifacts:

- `BUILD_ID` exists and contains `z85MUvnPO0F1YP23bHoBh`.
- `standalone/server.js` exists (8,556 bytes; SHA-256 `945d4e3db571e7aaae1d5cc417fd41dc641cf84ba16a883e2fc72237443d9958`).
- `standalone/custom-server.js` exists (6,182 bytes; SHA-256 `e7ea12080dbbc24f7cc606b0d466bdc1afa6f962a0464efdec53ecbd914cd8b9`).
- Build log ends with the successful Next.js route summary and `postbuild` asset-copy messages.

A disposable compiled server was started from this standalone directory on `127.0.0.1:23128` with a disposable `DATA_DIR`; it reached `Ready` and applied the initial database migration. It was stopped cleanly with SIGINT. No production data or live Docker service was touched.

This receipt covers build and startup smoke only. API/page behavior, browser interaction, restart persistence, security controls, and final Phase 3 closure remain open.

## Disposable compiled-server smoke

With `NODE_ENV=production`, `DATA_DIR=/tmp/9router-phase3-runtime-261022`, and `PORT=23128`, the standalone wrapper reached `Ready` and served:

- `GET /api/pricing` → `401 Unauthorized` with `{"error":"Unauthorized"}`.
- `GET /api/pricing/sync` → `401 Unauthorized` with `{"error":"Unauthorized"}`.
- `GET /dashboard/settings/pricing` → `307` to `/login`.

The server created the disposable SQLite files and was stopped cleanly. This verifies compiled serving and auth-first behavior only; it does not establish authenticated CRUD, browser interaction, or restart durability.

## Authenticated compiled API and restart proof

On the compiled server with disposable `DATA_DIR`, password login returned `{"success":true,"mustChangePassword":false}`. An authenticated `GET /api/pricing` returned `200` with the numeric compatibility map, and the rendered pricing page returned `200` with `Pricing Settings` content.

An authenticated `PATCH /api/pricing` wrote the exact fixture `{input:"0.000000001", output:"7.125", cached:"0"}`. The editor projection returned the same lexical strings before shutdown. After a clean process stop and restart against the same disposable DB, login succeeded and the editor projection returned the same exact strings. This proves compiled Node SQLite reopen for the exercised pricing row.

Focused source/integration acceptance also passed: 5 test files, 65 tests, 0 failures/pending/todo. This covered issued JWT auth ordering, exact editor persistence, explicit zero, coverage revision `409`, scheduler enable/disable persistence, no-fetch-on-configure, and offline last-good behavior.

A real browser automation runner is not installed in this checkout, so rendered click/keyboard/mobile interaction remains unverified. Docker acceptance also remains outside this run.

The later rebuilt artifact and browser acceptance supersede the earlier browser-unavailable status; see [browser acceptance](./pricing-browser-20261022/disposition.md).
