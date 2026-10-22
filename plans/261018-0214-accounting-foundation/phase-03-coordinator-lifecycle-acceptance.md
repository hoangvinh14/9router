---
title: "Coordinator và lifecycle acceptance"
---

# Phase 3 — Coordinator và lifecycle acceptance

## Outcome và dependency

Sau [phase 2](./phase-02-ledger-exact-monetary-service.md), khép bounded group/own-ACK/fresh-apply và exclusive lifetime recovery trên actual Node SQLite/SQL.js. [Adopted design](./design-preparation.md) chốt shutdown delta trước edits; không kế thừa full graceful-stop certificate từ prerequisite.

## Implementation và files

- `src/lib/accounting/write-coordinator.js`: một lane/adapter, operation ≤32 KiB, group ≤32/256 KiB, queue ≤256/2 MiB; snapshot/double retained-byte accounting, microtask coalescing và yield giữa groups. Service private registry cũng bounded.
- Application fresh-gates trong member savepoint; local refusal không block healthy peers. Throw/malformed/uncertain RELEASE/rollback/publication không fan out success, poison lane và refuse future work.
- Pre-application abort giữ original reason; abort trong application không erase recorded outcome. Stop cancels queued work, không chờ network. Synchronous filesystem call không có hard wall-clock guarantee.
- `src/lib/db/accounting-lifecycle.js`, `driver.js` và native/SQL.js adapters: exclusive startup recover all prior pending → unresolved; close stop queue → durable current pending recovery → engine close → lease release. Failed recovery/uncertain storage giữ exclusion. Signal control cho phép synchronous listener khác chạy và exit nonzero khi close fail.
- New real child harness: `tests/fixtures/accounting/accounting-process.mjs`; actual runtime assertions, IPC checkpoint/exit races, owned-child cleanup. Fixture helper backs up before deliberate transitions.

## Acceptance và evidence

[Execution receipt](../reports/implementation-261022-accounting-foundation.md) ghi exact final-source commands/hashes/results. Không suy power-loss certification từ SIGKILL tests.

- [x] Queue/registry/group count+bytes, detached payload, bounded yielding, malformed ACK và stop controls pass.
- [x] Cancellation trước/trong application giữ đúng reason/recorded outcome; không network serialization.
- [x] Queued identity/ACL/config/price/coverage changes refuse tại actual mutation; interleaved keys giữ independent authority, post-ACK stale authority refuse.
- [x] Actual engine inner RELEASE uncertainty poison cả accounting group/lane, không partial ACK hoặc RAM truth.
- [x] Actual Node/SQL.js before/inside/after intent/terminal commit, lost ACK, duplicate, reopen và contender no-mutation controls pass.
- [x] Pending close/restart, failed recovery/release retry và scoped SIGTERM + synchronous signal owner controls pass.
- [x] Shared DB/pricing/ACL regressions, touched-file lint và isolated production build/postbuild được verify; detached standalone SQL.js initialize/query/export/reopen và localhost smoke pass; source review findings repaired.
- [x] P3 nhận core API/actual POST successor obligation; P5/R nhận Bun/better/Windows parity/full-management blockers. Accounting/enforcement/public activation OFF, no ledgerStartedAt.

## Risk, compatibility và rollback

Scoped signals không certify Next server/network graceful shutdown. Independent full-source review, Bun/better/Windows accounting parity và managed physical restore vẫn cần release evidence; không support cut. Ngừng owned fixture writers/queues trước cleanup; giữ uncertain outcomes, không ACK retry bằng row visibility. Restore full compatible preactivation DB/coverage bundle hoặc dùng audited recovery, không xóa pending/history/lock để restart. Không thao tác live data.
