# Minimal pure budget helper admission

Parent `55fc2d00416296532eb580b1f0afa25f871aab5a`. User asked to integrate budget into existing LLM mechanisms, not redesign auth/rotation/database. This independent slice adds no LLM hooks and cannot enforce a budget yet.

## Exact implementation scope

Five **new, previously absent** destinations copied byte-for-byte from P `7a4f3a3e43dc738d0406e6ab1658db02b8df7ff2` after whole-body review:

- `src/lib/accounting/exact-money.js`: exact integer-based cost from immutable price/observed usage; final aggregate rounding, no estimated-usage permission.
- `src/lib/accounting/budget-windows.js`: HCM Monday/calendar-month boundaries, pure injected clock or Date default.
- `src/lib/accounting/attempt-payload.js`: bounded JSON copy/timestamp validation required by both helpers. No IO/storage/logging. Does not redact secrets: caller must provide only approved accounting fields, never credential/request bodies. Snapshot memory is not ledger or durable ACK.
- `src/lib/pricing/decimalMoney.js`: exact decimal-string conversion/formatting.
- `src/lib/pricing/constants.js`: category/unit definitions only; listing a category does not admit provider/tool/modality support.

Imports close among these five files and built-in Buffer/Date/BigInt. M has none of these files. No existing source/dependency/schema/LLM path changed. Smaller alternative (new duplicate arithmetic) rejected in favor of reviewed existing donor helpers. DB-coupled budget-gate is deliberately not ported. B02/B03/B05 math/window groundwork only; stable identity, original snapshot capture, threshold gate, persistence/dedup/retry/no-bypass and producer P1–P4 remain future gates. No sidecar/auth subsystem replacement. Rollback this unused additive slice by a scoped source revert, not data rollback; no data migration introduced.

## Exact test and A1 lane — reviewed before first execution

New `tests/unit/budget-pure.test.mjs`: Node built-in test/assert, literal fake price/usage, no donor DB fixture or package dependency. Eight top-level tests: exact decimals/invalid values, aggregate rounding, missing vs explicit zero/overflow, cache/reasoning subsets/tiers, component completeness/units, bounded data/accessors, HCM reset before/at/after including leap/year rollover and host-TZ independence, strict synchronous clock/timezone. Fake quantities do not prove upstream usage or tariff semantics.

New `tests/fixtures/budget/run-pure.mjs`: fixed no-argument Linux/Node24.21.0 launcher; stdlib imports only on host, never app modules. New `module-scope.json` is mounted as `/app/package.json` with type=module. Exact five sources and one test individually read-only mounted; parent root remounted read-only. Runtime `/usr`, `/lib`, optional `/lib64` and Node binary read-only are acknowledged broader system exposure. No checkout root, .git/.env, dependencies, historical artifacts, home, private sockets or DB mounted. Namespace isolated network/process/user via bwrap --unshare-all. `/sandbox` and `/tmp` are disposable tmpfs; HOME/XDG_CONFIG_HOME/XDG_DATA_HOME/XDG_CACHE_HOME/DATA_DIR/TMPDIR point to newly created empty directories. No host filesystem output mount for child writes; stdout/stderr remain inherited host output channels captured by the harness background log, not app logging.

Test checks network namespace differs from nonsecret host namespace literal, read-only covering mounts, isolated empty dirs and named private/project paths absent **before dynamic helper imports**. Absence checks aren't universal private-exposure certification. No destructive host write probes. Clean host launcher env prevents NODE_OPTIONS/NODE_PATH preload before script can check. Fixed `/usr/bin/bwrap`, no shell/fallback/download/install.

Only admitted candidate command, after exact source/test/launcher review:

```bash
/usr/bin/env -i PATH=/usr/bin:/bin /home/gmo/.nvm/versions/node/v24.21.0/bin/node tests/fixtures/budget/run-pure.mjs
```

Child fixed command: `/runtime/node --test --test-isolation=none /app/tests/unit/budget-pure.test.mjs`. Missing namespace permission, attestation, import error or test failure is failure; **no host fallback**. No ordinary Vitest/build/global scripts admitted. Exact file hashes and command captured outside repo in `pure-budget-preexecution.json`; changing source/runner invalidates affected review. Hashes are a reviewed audit snapshot, not integrity enforced by the launcher.

## Actual bounded result

Exact command ran as task `b9ccff45c`, exit0,8/8 tests passed. Review then corrected only a misleading snapshot test title (no redaction claim); same fixed lane reran as task **`b050044b4`**, exit **0**, **8 tests,8 pass,0 fail/cancel/skip**, duration189.02ms (test-run duration, not performance acceptance). Pre-import namespace/mount/disposable-directory assertions completed before helper imports. Full outputs are retained externally in `.pi/tasks/01a1dd0d-94b3-712c-8d9f-b8450599ae52-3705405/{b9ccff45c,b050044b4}.output`; receipt locators only, not tracking candidates. No fallback, broad Vitest suite, dependency install or build. Five source files and launcher/module fixture unchanged; corrected test hash recorded before rerun in `pure-budget-preexecution-title-correction.json` and verified afterward.

**Pure helper slice validated for these cases only.** No budget threshold enforcement, durable accounting, producer semantics, platform matrix or integrated acceptance from this result.

## Limits

No shipping route activated; no real inference, refresh, credential/config/DB payload read, real-service action, deployment or push. New helpers unused by existing callers. Automatic harness language diagnostics may run and maintain caches; not a claim of zero incidental tooling effects. Phase01 full exit remains partial, positive slice blocked; this is a separately bounded pure-helper implementation, not phase02 positive acceptance.
