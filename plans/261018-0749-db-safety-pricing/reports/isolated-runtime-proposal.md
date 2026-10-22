# Isolated runtime verification proposal — planning only

## Authorization / outcome
User selected **read-only isolated-runtime planning**, not execution/install. This document does not authorize downloading Bun, installing/rebuilding native modules, running an addon, Docker daemon/pulls, CI pushes, server startup, or support narrowing. DB source/tests remain frozen at [R3 manifest](./candidate-r3-source.json). [Current disposition](./current-disposition.md) stays BLOCKED/unaccepted WIP; no P1 implementation.

## Observed locally (read-only, 2026-10-18)
- Host Linux6.8.0-138-generic x86_64. Active Node24.21.0; existing `/home/gmo/.nvm/versions/node/v22.23.2/bin/node` ELF executable discovered by listing/file metadata only; **not executed** in this planning step.
- No `bun`, Node22 alias, Wine, PowerShell or Podman on PATH. No `$HOME/.bun/bin` found. Absence on PATH is not an exhaustive machine inventory.
- `/usr/bin/docker` exists; daemon, images, networking and socket access **not queried**. Docker cannot prove Windows native filesystem behavior; not needed for the first local Node lane.
- Installed better-sqlite3 **12.11.1** declares Node20/22/23/24/25/26; existing x86_64 ELF `.node` binding found. Package engines do **not** establish binding ABI compatibility, absence of crash, or actual SQL correctness. No binding loaded.
- Installed Vitest4.1.11 declares Node20/22/>=24; Vite8.3.2 requires Node20.19+ or22.12+, so existing Node22.23.2 is declared compatible with the harness. Actual run still required.
- Existing workflow files: gitbook-pages, tray-binaries, docker-publish. No DB multi-runtime workflow was created, edited or launched.

## Lane A — existing Node22, no installs (recommended next bounded authorization)
**Version:** exact existing22.23.2 executable above; better12.11.1 installed binding; current frozen dependencies. No network or package manager, no `npm rebuild`, no nvm mutation, no unsafe Node24 addon load.

1. After approval, capture executable SHA256, actual `process.version/versions.modules/platform/arch`, addon SHA256 and current source/input hashes to a plan-owned receipt. Resolve runner child PATH explicitly to Node22; fork children must report runtime identity, not accidentally use current Node24.
2. Create a disposable private root outside repository (`/tmp/9router-db-safety-node22-…`) with separate HOME/DATA_DIR/TMPDIR/cache. Run a short single fresh-process native-binding availability/actual open-close preflight **only after execution approval**, with offline preload before application imports; inspect only fixture data. Record crash/signal/ABI mismatch as a hard failed lane, not fallback-to-node green.
3. If the preflight fails, stop and counsel before diagnosis/repair. Do not silently install/rebuild/retry using another ABI. Request explicit setup approval only if needed, with exact dependency/runtime versions and artifacts.
4. If preflight proves the installed binding works, actual `createBetterSqliteAdapter` plus real driver selection must be asserted as **better-sqlite3**, not just a passing node:sqlite-focused suite. Current focused tests hardcode Node factory in several places; unchanged117assertions alone cannot certify better. Prepare a separate plan-owned runtime harness or explicit adapter-parameterized tests only in a separately approved implementation step. Do not edit production driver to force lane selection.
5. Required actual controls: private pre-open ownership/second factory or process refusal, WAL/FULL verified, durable commit/reopen, rollback, nested/outermost restrictions, sync callback contract, close guard and retained lease, close-failure fault controls labeled synthetic, read/transaction SQL guard compatibility, migration/schema2/ACL and pricing merge consumers. Keep two analytics reds separate if affected barrier run. Actual driver must report selected engine.
6. One bounded invocation per purpose; fixed timeouts established before launch. No installs, networking, green retry, deadline inflation or production DATA_DIR. Keep raw results/log/hash/input/exit/signal and exact non-skipped test identities. Clean fixture children/handles; failures retained before cleanup.

**Planning estimate:** no download/install needed unless ABI preflight fails. Execution harness preparation needs explicit narrow approval; current source remains unmodified.

## Lane B — Bun on Linux, setup not yet approved
No verified Bun version/artifact/checksum is available from local inventory. Do not invent a current version or approve `latest`, curl-pipe-shell or unpinned installer. Before any install, a read-only official release metadata/checksum lookup must establish an exact supported stable Linux x86_64 artifact, publisher URL and integrity method; present the resulting pin for approval. If operator already has Bun elsewhere, take its exact path/version/hash instead.

Proposed install boundary **if later approved**: unpack only the approved artifact into an owned temporary/private tool root, no sudo/system PATH/shell RC changes/no global npm/no changes to repo node_modules or lockfiles. Separate setup network window from fully offline fixture execution. Keep artifact checksum/version receipts. Do not use Docker pulls as an implicit alternate installer.

Execution must run actual `bun:sqlite` factory and driver Bun branch; Node-running Vitest with simulated `process.versions.bun` is not actual Bun evidence. Prefer a standalone bounded Bun harness over assuming current Node Vitest runner works unchanged under Bun. Harness must cover LaneA primitive controls and affected migration/ACL contracts; label unsupported harness mechanics as blocked, not skipped green. Node-only child fixture `fork`/proc/signal assumptions need explicit adaptation/provenance rather than copying Linux-Node counts. Runtime-specific syntax/tooling availability is a preflight, not production acceptance.

**Decision still required:** exact Bun version/artifact approval after metadata lookup, then scoped setup+harness+execution approval. This proposal itself grants none.

## Lane C — actual Windows environment, not emulation
No local Windows/Wine/PowerShell execution environment identified. Need operator-provided Windows host or authorized Windows CI. Exact Windows build, Node version, architecture, filesystem/volume type and permissions recorded; fresh disposable application directory and platform-specific dependencies. Do not copy Linux ELF addon to Windows.

**Concrete source risks, not merely coverage gaps:** `fsyncDirectory` opens a directory read-only and calls fsync; host Windows semantics may reject it before any adapter opens. `proveDead` intentionally auto-recovers only on Linux `/proc` sameboot+ESRCH; Windows stale owner must stay ambiguous/operator-recovery, not Linux auto-reclaim expectations. Existing symlink/hardlink/kill/realpath assertions are Linux-oriented. Do not suppress fsync errors or weaken ownership to make Windows pass. A failclosed startup is safety evidence, **not** proof the existing supported Windows app remains usable.

First Windows gate: actual directory open/fsync, atomic replace/rename and ownership create/release/cleanup in fixture root; capture exact errors and postfailure files. If required durability primitive unavailable, STOP for a separately designed Windows durable-publication mechanism or explicit product support decision; never retrospectively call the adapter accepted. Then actual Node SQLite and SQL.js lifecycle/publication/reopen/ACL checks; better requires correctly installed platform binding under separately approved dependency setup. No silent skip of stale-recovery/platform tests: replace Linux-only automatic-recovery expectation with documented Windows failclosed/manual-policy expectation as a distinct test identity, preserving provenance.

A handoff packet can be generated locally without pushing or starting CI. Download/setup/runner costs and access need operator approval. Docker Linux or Wine do not fulfill native Windows filesystem proof.

## Acceptance / approval separation
1. **Current approved:** inventory + this proposal, docs only. Completed; zero runtime execution/addon load/download/install.
2. **Smallest recommended next approval:** LaneA existing-Node22 execution preflight + plan-owned harness preparation + once-per-purpose offline fixture controls, no install/network or source behavior changes; stop on failed preflight. Independently approve read-only official Bun metadata lookup if desired, without install.
3. **Not approved:** Bun artifact install, binding rebuild/dependency change, Windows CI access/push/dispatch, product Windows repair or supported-lane waiver. Each needs concrete separate boundary.
4. Available lanes do not waive unresolved analytics reds or independent review. P1 gate can only be reconciled after prerequisite obligations are honestly resolved, not by relabeling Node-only success as all-adapter support.
