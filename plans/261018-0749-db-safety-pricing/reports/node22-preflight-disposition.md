# Node22 installed-binding preflight — FAILED / BLOCKED

## Authorization and actual attempt
User approved existing Node22 offline fixture preflight + plan-owned harness controls, explicitly no installation/rebuild/network and stop on ABI failure. Task `b2e2993dc` returned exit1 within fixed30s. Exact runtime Nodev22.23.2/Linuxx64, executable `/home/gmo/.nvm/versions/node/v22.23.2/bin/node`, runtime ABI127; installed better-sqlite3 version12.11.1.

At `new Database(fixtureFile)`, loader returned `ERR_DLOPEN_FAILED`: installed native binding reports compilation against **NODE_MODULE_VERSION137**, but this runtime requires **127**. This is an actual binding compatibility failure, not successful DB open, adapter coverage or a fallback pass. No crash reported. Adapter/driver harness **NOT RUN** under the agreed stop boundary. No rebuild/reinstall/runtime switch or timeout increase; error's npm suggestion is not authorization.

## Evidence
- [Actual result](./node22-preflight-result.json), [empty stdout/stderr log](./node22-preflight-output.log), [exit code](./node22-preflight-exit-code.txt).
- [Preflight inputs](./node22-preflight-inputs.json), [pre-run source check](./node22-source-check.json), [terminal receipt / artifact hashes](./node22-preflight-receipt.json).
- Postrun checks matched all R3 source/test hashes and recorded preflight script/preload/binding/lockfile inputs; no source/test behavior change. Node executable SHA captured before run; not rehashed in final small-input check.
- Fixture root `/tmp/9router-db-safety-node22-qc25Rh` retained. Bounded file listing found only preflight-result.json740bytes, empty output.log and exit-code.txt2bytes; no DB file observed in the listed root or immediate subdirectories. Not an exhaustive machine/process sandbox claim.
- Initial combined preparation hash command timed out at10s before runtime launch; preserved in input receipt, counseled and completed split bounded integrity operations without extending the limit. No diagnosis of that timing cause claimed.
- Offline preload blocks selected JS network APIs; no OS/native network isolation certificate. Script made no network actions.

## Stop / next decision
Failed-verification counsel obtained before diagnosis/repair. This bounded attempt is concluded as **blocked**, not completed verification success. Existing R3 result remains117assertions115pass2fail; Bun/Windows evidence and independent full-source review still missing. Prerequisite unaccepted WIP, P1 gate closed.

To continue better lane requires separately scoped **planning** for a private ABI127-compatible binding setup: exact12.11.1 artifact/build inputs, integrity, isolated destination, required network/build tools and module-resolution boundary. Do not overwrite root node_modules, run npm rebuild/install, select another runtime or silently fall back. No such setup or setup-planning approval inferred here; await user decision. Source/docs/receipts local only; no commit/push/activation.
