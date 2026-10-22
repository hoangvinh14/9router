# Browser acceptance — 2026-10-22

## Current status

Playwright 1.64.1 is installed in `tests/`. Its matching Chromium and headless shell revision 1248 were installed in the user cache. Chromium launches with `chromiumSandbox: true`; no sandbox-disable flags were added. Browser tests use compiled Next.js 16.4.2 on port 23128 with a fresh disposable Node SQLite database. Browser requests outside localhost are aborted. Catalog requests in the final harness use an explicit server fixture, not a live catalog.

## Findings and fixes

The first attempt stopped because an unscoped alert selector also matched the Next route announcer. The second stopped because the controlled scheduler checkbox updates only after its persisted PUT response; the test now awaits that response. These are harness fixes and do not turn the failed runs into passes.

The third attempt found a real scheduler restart defect: `schedulerConfigured` remained true but `schedulerEnabled` became false. A bounded read-only preload observed that the standalone process has no `NEXT_RUNTIME` variable when loading the pricing startup chunk. Next substitutes literal runtime accesses at compile time, while the previous helper read the environment indirectly. The implementation now passes only the four explicit runtime/phase/test fields into its existing guard, preserving build/test exclusions. Focused startup/schedule tests pass 9/9.

Visual inspection also found a transparent modal: its background class names were absent from the current theme. The modal now uses existing surface tokens, with a browser assertion against a transparent computed background.

The scheduler-only rebuild was intentionally stopped with SIGTERM (exit 143) after the modal finding so both fixes could be built together. It was not a completed build or a timeout. The combined bounded rebuild completed successfully, including postbuild asset copies. The final browser run passed all 16 checks; the successful result, server log and inspected mobile screenshot are archived under `pass/`. A later harness correction expects the specific forwarded-authority rejection (`403`, `management_authority_invalid`) rather than `401`; that failed attempt is also retained.

## Reproduction

```bash
cd /home/gmo/projects/9router/tests
PRICING_STANDALONE=/tmp/9router-phase3-build-261022/phase3-dist-261022/standalone npm run test:pricing-browser
```

The harness owns its child server/browser, refuses an occupied fixed port, uses a new temporary directory, and records JSON results, server logs and a mobile screenshot. It stops owned processes in cleanup. A disposable SQLite backup is taken after shutdown before restart and later writes.

## Open acceptance

Combined build and complete browser acceptance now pass. The build emitted writer-exclusion warnings during shared page-data initialization and 27 outside-tracing-root warnings from the disposable symlink dependency layout; these are retained limitations, not a claim of a warning-free build. The exercised host runtime uses Node SQLite on Node 24.21.0. The isolated Node 22 Alpine source-image build completed with exit 0, and all three container smoke groups passed, including exact persistence and active scheduler across stop/start. Phase 3 is complete within the accepted conditional Linux development boundary; no production activation, commit, push or merge is performed.

## Bounded pricing security review

The management guard authenticates dashboard JWTs, requires a persisted login-disabled preference plus trusted direct-loopback provenance for the local exception, rejects hostile origins, and checks authority provenance before privileged route work. The compiled browser suite exercises these decisions, including forwarded-authority denial. Mutations validate complete bounded decimal sources before DB writes; sync accepts no caller-selected URL or parameters, uses a fixed source, rejects redirects, and bounds decompressed data. React renders editor and coverage values as text. No pricing code was changed to call inference, ACL mutation, ledger or debit paths. The successful browser run queried disposable DB metadata and accounting table counts without finding accounting activation.

An observed dependency warning remains separate from this bounded pricing review: Docker's install reported 9 audit findings including dev dependencies. A fresh production-only audit of host staging reports 6 affected packages (4 high, 2 moderate), inherited through proxy-pattern matching, Monaco/DOMPurify, and node-forge. The raw advisory report is retained. These dependencies are not imported by the pricing editor or pricing service, and no new pricing exploit path was established; this is not a claim of whole-product dependency security. No audit-driven downgrades, forced fixes or unrelated dependency upgrades were applied.

The first Docker context filter omitted two unrelated logging route files. That image build was cancelled (exit 130) before completion; both source files were restored, and the corrected context now matches all 1,007 runtime-source manifest entries. The second container build reuses completed dependency layers and keeps the same resource profile.

## Container acceptance and closure

The corrected Docker build completed successfully using the recorded temporary [Dockerfile](./container-pass/Dockerfile), with no repository Dockerfile edits. [Build receipt](./container-pass/build-receipt.json) identifies image digest `sha256:ae17569a1e40e33de61e8e04580d0be9c8c51b5ee2d6c53f7110de2428f4f8dc`. The [runtime](./container-pass/runtime.json) is Node 22.23.4 on Alpine/musl, application PID 1 runs as uid 1000, and [logs](./container-pass/server.log) confirm **better-sqlite3**. The container had no networking or published host ports and used only a disposable bind-mounted DB.

All [three smoke groups](./container-pass/result.json) passed: runtime identity, authenticated exact override plus schedule enable, and same-container stop/start preserving decimal strings/explicit zero and a running scheduler without an immediate catalog attempt. Scheduler disable succeeded at the end. The post-start ownership probe observed no lock at that instant; this is not a general stale-lock recovery proof. The suspected PID-reuse refusal did not occur in this tested orderly stop/start. Existing adapter signal handlers close the engine and release its lease; none were changed here. The prerequisite's excluded broader shutdown/competing-handler issue remains excluded, with no general graceful-stop or crash/power-loss assurance.

| Acceptance obligation | Evidence and scope |
|---|---|
| Rendered page/modal, no-op/invalid/no-write, decimal/zero/inherit, keyboard/mobile | [16 browser checks](./pass/result.json), [mobile screenshot](./pass/mobile-editor.png), no page JS errors |
| Login, hostile Origin, forwarded authority, direct-loopback exception | Compiled browser requests plus earlier Phase 2 guard/route barriers; direct source review |
| Valid/malformed/offline last-good; coverage stale409 restart | Browser/API paths with explicit server catalog fixtures, not live catalog access |
| Scheduler configured/running, restart, disable, exact durable reopen | Host Node SQLite plus Docker better-sqlite3 stop/start; no immediate fetch |
| Frozen snapshots/mapping, import, concurrency, DB/ACL/usage compatibility | Retained source-bound Phase 2 affected barrier 275/275 across 26 files; not rerun or added to overlapping counts |
| Startup correction and final lint | Focused startup/schedule 9/9; [final touched-file lint](./lint-result.json) exit 0 |
| Source identity, build and process cleanup | [1,007-entry manifest](./runtime-source-manifest.json), [final comparison](./final-source-verification.json), host build and Docker exit 0; owned servers, browsers, container and build processes ended |

Final direct review checked the literal-runtime guard correction against build, export and test exclusions, the modal's existing theme tokens, management authorization before privileged work, fixed-source sync with redirect rejection and size bounds, exact legacy/editor contract separation, and harness isolation/cleanup. No additional pricing defect was identified within that inspected scope. This is executor review, not a new independent review of the shared DB prerequisite. Comparing the prior affected-source manifest found only `servingStartup.js` changed among its 86 inputs; shared DB, ACL, usage and pricing persistence source remained unchanged. Container and host staging match all 1,007 runtime entries at closure. Test harness commands and hashes are recorded in this directory and `tests/README.md`.

The browser and container artifacts above close P1 pricing-only acceptance. P2 accounting remains a separate consumer effort: no inference settlement, ledger, debit or budget activation is claimed. Existing conditional prerequisite limits (Windows, independent review and shutdown) and observed dependency/build warnings remain disclosed. The retained local test image is an acceptance artifact, not a deployed service. Raw failed attempts remain archived.
