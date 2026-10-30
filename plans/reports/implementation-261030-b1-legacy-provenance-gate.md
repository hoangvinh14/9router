# B1 — Legacy provenance compatibility gate

## Outcome: blocked, not compatibility accepted

Base source: `develop` `57d82de4`; working branch `test/b1-legacy-provenance-gate`.
The B1 contract requires a separate decision when existing evidence cannot classify
legacy rows as interrupted+absent versus failed persistence of known usage.
No runtime or schema changes were made. Production activation remains OFF.
No real DB, imported user data, sidecars or existing build artifacts were modified.

## Evidence

Added:
- `tests/fixtures/accounting/b1-legacy-process.mjs`
- `tests/unit/b1-legacy-provenance.test.js`

For **each explicitly asserted actual driver** (`node:sqlite`, `sql.js`), separate
child processes construct these histories in disposable temporary databases:
1. Persist an independent settled known charge and an intent; receive no usage;
   die by SIGKILL without clean-close recovery.
2. Persist the same known charge and intent; receive exact usage; invoke the real
   `finalizeAttemptMutation` inside `db.durableTransaction`; verify the mutation
   returns settled/1200000 nanoUSD, then SIGKILL before the transaction commits.
   A test-only external `.fault-witness` proves that fault boundary was reached.
   Recovery never reads that witness. This is the same mutation-inside-outer-durable-
   transaction boundary used by the accounting service coordinator, not a simulation
   that simply inserts two identical pending rows.

Parent asserts SIGKILL, reopens through normal owner acquisition/startup recovery,
and compares the full ledger rows, audit rows, key rows, bindings and policies;
coverage generation/maintenance/gaps are compared, health is asserted healthy.
The independent known charge remains settled at 1200000 nanoUSD in both histories.
The affected row is `unresolved/network_unknown`, null usage/cost/terminal in both.

Normalization is explicit in the test: owner instance ID (including intent JSON),
recovery `finishedAt` for unresolved rows, generated installation fingerprint and
key/binding/policy creation/update times. These vary by independent installation/
execution and contain no usage-availability assertion. All other compared columns,
including snapshots, resolution versions and audit payloads, remain unnormalized.
This comparison is **after startup recovery**, not raw-file or pre-recovery byte
identity. It does not claim exhaustive equality of every filesystem artifact or
that recovery preserved every hypothetical forensic discriminator. Fixture
`pre-change` backups are overwritten by reopen and are not used as evidence.

Under the tested crash boundary, the two constructed histories produce identical
compared accounting evidence after normal startup recovery on both tested backends.
That evidence cannot distinguish absent usage from valid usage lost before commit.
This triggers the accepted B1 stop gate; it does **not** establish that historical
charges were lost or that any real installation contains these rows.

## Verification

- `cd tests && npx vitest run unit/b1-legacy-provenance.test.js`
  — **2/2 passed**, 1 file, Vitest 4.1.12, 6.36s, Node v24.21.0, Linux.
- Active LSP diagnostics for both new files — **2 clean, zero diagnostics**.
- `cd tests && npx vitest run unit/b1-legacy-provenance.test.js unit/accounting-crash.test.js unit/accounting-lifecycle.test.js`
  — **31/31 passed**, 3 files, Vitest 4.1.12, 24.94s. Includes the new
  characterization and existing crash/lifecycle controls on both backends.
- Advisor consulted before implementation and after evidence. Review is advisory,
  not independent source inspection (untracked file contents withheld).

## Stop condition and remaining scope

Phase 1 characterization is complete; Phase 1 compatibility/implementation exit
is blocked, Phase 2 is not started. No ambiguous rows were waived or labeled
corrupt; no recovery workflow, new unknown blocker, migration or activation was
introduced. Existing runtime semantics are unchanged, including existing blockers.
Only the user can authorize a revised compatibility policy or separately decide
how ambiguous historical evidence is handled. Do not silently weaken B1 rule 8.

Security: test fixtures use synthetic credentials and temporary files. Auth,
CSRF/ACL, storage health, single-writer and production readiness gates remain
unchanged. Full functional/security/build/browser acceptance was not run because
implementation stopped at the mandated gate.
