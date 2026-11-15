# Existing Node SQLite fixture check — bounded admission

Parent1355abb94273d6978cb642b587da9adecc2bf5ee. Existing LLM/auth/database code **unchanged**. This is a capability check using the current database adapter, not another production ledger or budget activation.

## Why not connect the existing stats callback directly?

Pinned M `open-sse/handlers/chatCore/requestDetail.js` extraction defaults some missing usage to0; saveUsageStats skips all-zero counts, canonicalizes, uses completion timestamp and calls saveRequestUsage without awaiting. `src/lib/db/repos/usageRepo.js` saves current-price floating cost, tuple-based dedup and catches storage errors. Useful analytics, not authoritative original-key/attempt/price/window settlement. No change to these existing mechanisms. Exact usage/producer evidence and safe original-attempt persistence remain blockers; no estimate substituted for missing usage.

## Reviewed inputs / no production changes

- Current `src/lib/db/adapters/nodeSqliteAdapter.js` and `src/lib/db/schema.js` whole bodies read, equal M1855aa44473e88feac9d3f131b9c0c5fc9706b68. Import closure is schema + builtin node:sqlite only. No driver/paths/real-data/startup import. Effective WAL/NORMAL is observed, not FULL crash durability.
- New `tests/unit/budget-storage.test.mjs` uses builtin node:test/assert/fs, attests namespace/read-only mounts/disposable DATA_DIR before dynamic adapter import. Only /sandbox/data fixture files. Test-only table unique **attemptId alone**, literal stable key/time/price/cost strings. Tests real adapter.transaction for multirow rollback/error propagation and commit; rejects identical+conflicting duplicate insertion (not successful idempotent ACK); close/reopen equality and each connection's PRAGMAs. No production schema or concurrent/power-loss claim.
- Existing `tests/fixtures/budget/run-pure.mjs` retained filename but comment/output identify expanded helper+SQLite fixture lane. Fixed mounts add exactly adapter/schema/storage-test to prior pure lane. Child fixed command runs only budget-pure.test.mjs and budget-storage.test.mjs. No args, dependency install/Vitest/driver/build. Pure test remains8cases unchanged; storage3newcases.

## Exact A1 extension before execution

Same clean host command, **new reviewed bytes/mount list**, not blanket runner authority:

```bash
/usr/bin/env -i PATH=/usr/bin:/bin /home/gmo/.nvm/versions/node/v24.21.0/bin/node tests/fixtures/budget/run-pure.mjs
```

Fixed child `/runtime/node --test --test-isolation=none /app/tests/unit/budget-pure.test.mjs /app/tests/unit/budget-storage.test.mjs`. LinuxNode24.21.0, bwrap unshare-all/read-only root+exact app files+system runtime mounts. No host HOME/env/private DB/service sockets. HOME/XDG/DATA/TMP isolated tmpfs; inherited stdout/stderr are host log channels; /usr/libs broad readonly runtime exposure acknowledged. No namespace/attestation/test failure fallback. No destructive host probes. Review+hashes recorded externally in sqlite-fixture-preexecution.json before run; hashes are an audit snapshot, not runner-enforced pinning.

Actual task `bdcdb040e`, exit **0**: **11 tests,11 pass,0 fail/cancel/skip** (8pure+3SQLite), duration364.09ms, not performance acceptance. Raw log retained externally at `.pi/tasks/01a1dd0d-94b3-712c-8d9f-b8450599ae52-3705405/bdcdb040e.output` (receipt only). Pre-import assertions passed; input hashes rechecked unchanged after execution. No host fallback. This establishes **tested rollback, unique-constraint rejection and close/reopen visibility in an isolated Node fixture only**. tmpfs close/reopen is not crash durability; test table isn't production ledger; uniqueness isn't successful replay acknowledgment. Other adapters, original terminal provenance, own durable ACK, actual before/after-call budget enforcement, no-bypass routes and producer eligibility remain unresolved. No live inference, real credentials/config/DB payloads, service operations, push/deploy.
