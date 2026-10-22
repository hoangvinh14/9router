---
title: "Schema, identity và coverage"
---

# Phase 1 — Schema, identity và coverage

## Outcome và context

P1 baseline là `2ca88257`. User đã authorize execution đến khi xong; [design preparation](./design-preparation.md) ghi quyết định và manifest trước source edits. Phase này cung cấp complete identity/coverage/import/delete boundary trước khi ledger được dùng. Không apply saved WIP `d515fb49` hoặc checkout driver cũ.

## Implementation và files

- Schema version 3, migration 2 thêm bindings/ledger/audit; kiểm tra exact table/index/append-only trigger definitions, không lấy additive-sync success làm readiness.
- `src/lib/db/helpers/api-key-bindings.js` và `accounting-coverage.js` giữ one-to-one HMAC binding, independent tombstones, gap/maintenance/CAS/audit receipts. `writerOwnership.js` expose immutable directory/lifetime qua private lease.
- `driver.js`, native/SQL.js wrappers validate artifacts trước PRAGMA và initialize dưới exclusive writer. Missing required material fail closed; pristine interrupted sidecar initialization reuse cùng identity.
- `repos/apiKeysRepo.js` dùng durable CRUD, cấm rebind/retired reuse. `db/index.js` prevalidate import, preserve ledger/audit/bindings/meta và thêm configuration-only export metadata; existing import route map identity conflict 409. ACL/pricing/valid legacy imports giữ semantics.
- `backup.js` tạo unique verified backup, copy indexes/triggers/coverage; `migrate.js` bắt buộc backup trước schema mutation của existing DB, kể cả metadata thiếu. Không mở live DB.

## Acceptance và evidence

[Execution receipt](../reports/implementation-261022-accounting-foundation.md) ghi commands, source hashes, failed histories và limits. Các controls chạy actual Node SQLite/SQL.js trong disposable fixtures:

- [x] Chốt full boundary/API/lifecycle/P2–P5 ownership trước implementation và giữ default OFF.
- [x] ID/secret/duplicate/retired collisions refuse; missing binding/marker không regenerate retained history.
- [x] Config/ACL/pricing round trips pass; backup failure refuse trước DELETE/schema mutation và giữ rows.
- [x] Missing/malformed/mismatched/insecure sidecar refuse trước application mutation.
- [x] Actual child crash sidecar-before-reference reuse pristine identity; tombstone-before-delete-commit disables stale key on restart.
- [x] Gap/global maintenance scope, generation CAS, idempotent audit và before/after-sidecar-publication ACK replay pass.
- [x] Source review fixes missing-binding bypass và native backup trigger/index omission; final focused/regression tests and lint pass.
- [x] Phase 2 nhận stable identity/coverage contract; no ledgerStartedAt, no historical debit.

## Risk và rollback

Independent retirement có thể đã durable dù DB delete/import fail; giữ block để operator reconcile, không rollback sidecar riêng. Backups omit requestDetails; physical restore automation/UI thuộc P5. Bun/better/Windows accounting parity vẫn là P5/R release blockers. Trước activation, stop writer và restore compatible DB + coverage bundle đã verify; không xóa lock khi writer sống, không reset tombstone/history hoặc downgrade unsafe schema.
