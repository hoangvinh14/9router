# Persisted authority prerequisite — 2026-10-27

Source: `feat/durable-chat-accounting`, base `4cb4f80ecc5f629cd7d08c2167a443892ad38f2f`, uncommitted worktree. No live database, inference, activation or Git publication.

The historical timeout is resolved by a measured cause-aligned test repair: exact SQLite Buffer equality now uses `Buffer.equals()` instead of Vitest's costly recursive matcher. [Diagnosis](./debugger-261027-0836-prerequisite-timeout.md) preserves timing evidence and earlier failures. Deadlines, concurrency, backups, bytes compared and durability/freshness guards remain unchanged.

Implemented a restricted request-local identity/selection capability on the already initialized adapter. It validates presented secret, binding, retirement, explicit policy, current sidecar/maintenance, selected active connection, required node/pool and configuration. Private material and credentials never appear in the frozen proof. Fresh assertions detect changes across awaits. Ordinary poisoned getters remain strict; driver capability acquisition never initializes a writer. This proof is **not** full app ACL/route resolution, own gap ACK or POST permission; those remain transport/P3 responsibilities.

## Verification

All npm commands use `npm --prefix tests test --` followed by the exact unit files. Each new focused run has a 120-second process bound; affected run has 300 seconds; existing five-second test limits remain.

| Evidence | Result | Log |
|---|---|---|
| Policy + raw persisted authority after Buffer repair | 19 passed, 6.95s | `/tmp/9router-p3-focused-repaired-261027.log` |
| Seven affected accounting migration/identity/import/coverage/ledger/coordinator/lifecycle suites | 75 passed, 21.49s | `/tmp/9router-p3-policy-affected-261027.log` |
| Policy + raw persisted authority + request authority combined | 54 passed, 9.20s | `/tmp/9router-p3-proof-combined-261027.log` |
| Extended request authority + db-driver-chain/durable-publication/sqljs-publication/migration-chain/release-sync | 86 passed, 10.68s | `/tmp/9router-p3-prerequisite-affected-261027.log` |
| Raw authority with escaped-thenable, open uncertain native transaction and actual WAL controls | 15 passed, 6.08s | `/tmp/9router-p3-proof-uncertainty-261027.log` |
| ESLint changed prerequisite modules/new suites/measurement | exit 0 | `/tmp/9router-p3-proof-lint-261027.log` |

Actual Node SQLite and SQL.js controls cover before/after publication loss without resurrecting the failed ACK, dirty configuration, schema/binding/owner/sidecar/maintenance refusal, policy backfill/retirement, interrupted policy-marker upgrade before/after rename, driver no-replacement and selected route/credential/config drift. Node WAL proof sees committed policy changes absent from the main file. Open transaction uncertainty denies; quiescence after a real post-release outcome is narrowly exercised, not a general uncertain-engine claim. Bun/better/other platforms remain outside acceptance.

## Finite overhead

The first measurement invocation exited 9 before executing: Node v24.21.0 rejects `--experimental-default-type=module`. Required counsel verified native module syntax detection; removing only that unsupported flag repaired invocation. Exact successful command:

```sh
timeout --kill-after=5s 120s env DATA_DIR=/tmp/9router-p3-proof-measured-261027 /home/gmo/.nvm/versions/node/v24.21.0/bin/node tests/fixtures/accounting/measure-persisted-authority.mjs > /tmp/9router-p3-proof-measured-261027.log 2>&1
```

400 fresh sequential proofs, 100 per adapter/state, fixed 10,652-byte authority projection; setup measured separately. No prewarm. Exit 0 with fixture cleanup. Figures in milliseconds:

| Adapter/state | setup | p50 | p95 | max |
|---|---:|---:|---:|---:|
| Node healthy | 289.45 | 16.93 | 20.72 | 22.82 |
| Node recording-failed | same fixture | 11.79 | 14.17 | 16.03 |
| SQL.js healthy | 652.43 | 26.89 | 37.92 | 52.02 |
| SQL.js recording-failed | same fixture | 20.34 | 32.79 | 41.24 |

This accepts the classification/persisted-proof boundary only. Per-POST transport, independent gap ACK composition, app JSON/SSE, cache mapping/reopened cost and combined workload remain required. No server/watchers started; finite test/measurement processes exited.
