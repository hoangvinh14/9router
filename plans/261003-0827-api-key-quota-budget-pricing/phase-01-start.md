---
title: "Phase 1: Identity, schema và durable ledger"
status: in-progress
priority: P1
effort: 16h
depends_on: []
---

# Phase 1: Identity, schema và durable ledger

> **Technical reference, không phải backlog song song.** Theo [roadmap Gói A–E](./plan.md#current-delivery-roadmap): identity/ledger consumer requirements thuộc B; adapters/restore/recovery thuộc D; release acceptance thuộc E. Checklists/checkpoints bên dưới giữ requirements và historical evidence, không chứng minh current task state. Không restart foundation hoặc lặp valid gates; reconcile stale implementation descriptions trước khi hydrate tasks.

<!-- Updated: Validation Session 1 - pre-open writer exclusion, durable gap latch, config import và managed restore -->

## Outcome

Có stable attribution và ledger SQLite độc lập log retention; ghi intent/settlement được acknowledge durable trên adapter hỗ trợ. Chưa bật enforcement. Đọc [design contract](./design-contract.md) trước coding.

## Current delivery state — implementation khác acceptance

Storage/identity/owned ledger và Node24/SQL.js durability foundation đã có code/focused evidence; không bắt đầu lại phase. Latest selected53-file sweep505/0 chỉ là scoped checkpoint, không complete adapter/restore acceptance. Ưu tiên remaining initialization/recovery prerequisite ở Phase03; broader Bun/better-sqlite3/restore gates vẫn release-blocking, không waived. Theo [current roadmap](./plan.md#current-delivery-roadmap); checklists bên dưới gồm bundled acceptance nên chưa đánh dấu done chỉ vì foundation đã có.

## Context và requirements — historical pre-implementation observations

- Repo root `R=/home/gmo/projects/9router`; mọi path dưới đây expand từ R. File mới đánh dấu create.
- `apiKeysRepo.validateApiKey` hiện chỉ trả boolean. `usageHistory` giữ raw key; `sqljsAdapter` debounce persistence 100ms và swallow lỗi timer.
- Schema hiện version 1; `migrate.js` chạy versioned migrations trước additive sync và legacy JSON import sau sync. Backfill sau import, không trước khi tables/columns mới tồn tại.
- Chi phí là nanoUSD INTEGER có safe bounds; không bổ sung usageDaily monetary counter làm source enforcement.

## File ownership

| Action | Absolute path | Thay đổi |
|---|---|---|
| Modify | `/home/gmo/projects/9router/src/lib/db/schema.js` | Bump SCHEMA_VERSION; 3 bảng ledger/policy/audit; usage ID/attempt columns + indexes. |
| Create | `/home/gmo/projects/9router/src/lib/db/migrations/002-api-key-accounting.js` | Additive SQL và versioned migration idempotent; không drop legacy data. |
| Modify | `/home/gmo/projects/9router/src/lib/db/migrations/index.js` | Register migration mới. |
| Modify | `/home/gmo/projects/9router/src/lib/db/migrate.js` | Post-import attribution backfill và activation metadata scaffolding; stamp ledgerStartedAt chỉ khi đầy đủ recording hooks được activate ở rollout, không khi schema-only migration. |
| Modify | `/home/gmo/projects/9router/src/lib/db/repos/apiKeysRepo.js` | Resolve active key row by secret, giữ boolean API; tombstone behavior/no cascade. |
| Create | `/home/gmo/projects/9router/src/lib/db/repos/apiKeyAccountingRepo.js` | Policy CRUD, attempt state CAS, indexed spend, unresolved queries, append-only audit. |
| Modify | `/home/gmo/projects/9router/src/lib/db/index.js` | Export repo API mới; versioned config export/import giữ accounting và reject identity rebinding trước DELETE. |
| Create | `/home/gmo/projects/9router/src/lib/db/accountingCoverage.js` | Durable key/global coverage-gap + maintenance sidecar, atomic fsync ack, reconciliation/restore lifecycle. |
| Modify | `/home/gmo/projects/9router/src/app/api/settings/database/route.js` | Surface config-import 409 conflicts/coverage metadata; không expose accounting restore qua legacy config upload. |
| Modify | `/home/gmo/projects/9router/src/lib/db/adapters/{sqljsAdapter,nodeSqliteAdapter,bunSqliteAdapter,betterSqliteAdapter}.js` | Durable transaction acknowledgement; SQL.js flush/health contract; không async callback trong sync transaction. |
| Create | `/home/gmo/projects/9router/src/lib/db/writerOwnership.js` | Atomic DATA_DIR writer lock **trước writable adapter load/migration**, liveness ownership và safe orphan recovery guard. |
| Modify | `/home/gmo/projects/9router/src/lib/db/driver.js` | Ownership/init/health integration, reject unsafe budget topology. |
| Modify | `/home/gmo/projects/9router/src/lib/db/backup.js` | Include ledger/policy/audit in lightweight backups; test restore warning/recovery. |
| Create | `/home/gmo/projects/9router/tests/unit/api-key-ledger.test.js` | Schema/state/ID/retention unit tests. |
| Create | `/home/gmo/projects/9router/tests/unit/api-key-ledger-durability.test.js` | Temp DATA_DIR subprocess crash/write failure/ownership tests. |

## Implementation checklist

- [x] Inspect all adapters, backup/import/export/reset paths; inventory destructive operations. Keep tests isolated from `~/.9router`. Evidence: [implementation report](./reports/implementation-evidence.md), pre-edit isolated suite and scoped tests.
- [ ] Write red tests: stable key ID across name change, same masked prefix, unknown legacy attribution; old history not debited, deleted key history survives. Retain non-secret keyed fingerprint/tombstone binding metadata (no raw key in ledger) để validate deleted-key ID/secret rebinding across config import; fingerprint material lifecycle/backup explicitly owned by accountingCoverage/apiKeysRepo, add migration metadata as needed. Protected fingerprint key stable across restore; missing/rotated key không regenerate silently, block identity reconciliation/activation tới audited recovery.
- [ ] Define tables theo design contract; audit target accepts attempt hoặc key/global gap (nullable attemptId + validated target), no invented attempt row for gap-only recovery. Migration applies fresh/v1/skipped-version/repeated boot. Post-import backfill exact key match only; migration timestamp tách ledgerStartedAt. Ledger coverage start chỉ stamp một lần khi rollout activate đầy đủ hooks; không stamp ở schema-only phase hoặc update mỗi boot.
- [x] Implement atomic attemptId insert/state CAS and policy version update; transaction audit + recovery is one commit. No raw secrets in new tables/results/errors. Evidence: `api-key-ledger.test.js` idempotency/conflict/recovery/import tests; `/tmp/9router-sqljs-gates.json` (22 ledger tests passing).
- [ ] Add durable adapter operation; ensure SQL.js pending debounce không re-export stale state after durable flush. Write/rename/fsync errors latch unhealthy and propagate; never claim durable on failed ack.
- [ ] Enforce one writer owner per DATA_DIR **trước adapter open/load và migration**, không chỉ budget gates. Non-owner không mutate settings/analytics/schema hoặc debounce/close flush, kể cả no-key/unlimited; diagnostic-only không writable DB. Lock/health lifetime process-global cùng driver, HMR không reset. Only dead-owner recovery changes pending -> unresolved; preserve live owner attempts.
- [ ] Implement independent durable coverage-gap/maintenance sidecar + audited reconciliation. Unlimited identified inference chỉ continue sau gap latch fsync ack; latch không persist được => reject identified dispatch. Không cho SQL.js unhealthy RAM/timer ghi lại file như durable truth. Restart/policy enable đọc sidecar trước admission; ownership/schema/restore-maintenance/missing-required/corrupt sidecar precedence deny, không unlimited exception. Fresh sidecar init trước ledger activation only. Recovery sequence freeze admission/read G -> durable audit operation(G) -> sidecar fsync CAS ack G; audit error leaves gap, crash after audit before ack remains blocked/replayable, generation conflict preserves newer gap.
- [ ] Config `exportDb/importDb` không complete physical accounting backup: export version/coverage metadata, import preserve ledger/policies/audit/meta/gap. Validate charged ID-to-secret và secret-to-ID binding trước bất kỳ DELETE; conflict 409/no mutation. Enumerate callers `src/app/api/settings/database/route.js:19,33` và compatibility re-exports; isolated import tests giữ spend qua import old/new payload.
- [ ] Managed physical restore stop writer + maintenance latch trước replace, gồm sidecar/ledger/policy/audit/meta; budgeted blocked tới audited reconciliation. Preserve current maintenance/gap generations, retired-key tombstones và fingerprint key outside replaced snapshot hoặc merge verified pre-restore backup; old snapshot không clear gap/reactivate retired key. Missing/mismatch artifacts remain maintenance-blocked. No automatic detection promise cho out-of-band DB/sidecar replacement. Binary downgrade management/export only, không inference; giữ tables không đủ chứng minh coverage.
- [ ] Test SIGKILL after acknowledged intent/settlement, disk full/permission/rename failures, restart, lock contention, PID reuse ambiguity, close/signal hooks; native SQLite durability matches acknowledgement contract.
- [ ] Verify log clearing/history retention/backup không delete ledger; tests prove restart allowance unchanged. Native + SQL.js lightweight backup **round-trip** phải produce readable persisted artifact gồm policy/accounting/audit/meta và separately captured sidecar; generic ATTACH copy-all không là proof SQL.js filesystem persistence. Document adapter/topology limits in phase evidence.

## Implementation status — available-runtime foundation implemented, gates outstanding

Node24/SQL.js focused checks passed (75-test six-file run plus 46-test SQL.js/ledger/migration run). Bun/better-sqlite runtime evidence remains **not run and release-blocking**. End-to-end admission/latch fetch-count and policy activation gates remain owned by phases03/04; not proven by storage-only tests. Phase remains open; no ledger activation, no full regression or independent review claim. See [implementation evidence](./reports/implementation-evidence.md). Inactive Phase02 pricing may proceed using the verified available-runtime foundation, without representing release acceptance or enabling hooks.

## Verification gate

**Pre-change regression evidence prerequisite:** Trước source edits, capture suite JSON trên isolated DATA_DIR và enumerate failed suites/assertions + intended collected scope. Đừng trust comparator hiện có (known false-green); phase 06 phải repair/negative-fixture-pass trước dùng no-regression claim. Không cần full suite green để bắt đầu foundation, nhưng preserve baseline evidence.

Commands run from R after test files exist:

```bash
(cd tests && npx vitest run unit/api-key-ledger.test.js unit/api-key-ledger-durability.test.js unit/db-migration-chain.test.js unit/db-driver-chain.test.js unit/db-concurrent.test.js)
npx eslint src/lib/db/schema.js src/lib/db/migrations src/lib/db/repos/apiKeysRepo.js src/lib/db/repos/apiKeyAccountingRepo.js src/lib/db/adapters src/lib/db/driver.js src/lib/db/writerOwnership.js src/lib/db/accountingCoverage.js src/lib/db/backup.js src/lib/db/index.js src/app/api/settings/database/route.js
```

Pass conditions: new tests 0 fail; existing failures compared to pre-change baseline; each available adapter exercised explicitly, unavailable adapters documented as not-run and verified in CI before release. No test may select production DATA_DIR. No swallowed ledger persistence error. DB callback remains synchronous. Tests phải gồm non-owner settings/analytics/migration/close writes = 0 và persisted file unchanged; durable gap survives restart, latch write failure fetch-count=0 cho identified key; config import collision no mutation; managed restore blocked-until-reconcile.

## Risks, security và failure protocol

- SQL.js is not multi-process safe; lock + durability ack must be real, not just convention. Do not replace SQLite with new datastore.
- Writes serialize only small transactions; network requests remain concurrent. No reservation introduced.
- If crash tests/ownership safety fail: stop phase, retain failed evidence; do not wire enforcement on top of analytics or RAM-only accounting. Escalate missing runtime/adapter coverage rather than claiming all adapters pass.
