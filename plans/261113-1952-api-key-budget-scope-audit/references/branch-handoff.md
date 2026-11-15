# Context-reset handoff — clean integration branch, selective port

## Read first

1. [Brainstorm contract](./brainstorm-contract.md), especially section 8: current owner decisions, B01–B08, next-session instructions.
2. [Audit report](./audit-report.md): source findings plus section 11's later owner strategy.
3. This handoff: actual baseline sync and same-checkout safety state. The [completed audit plan](../plan.md) is not the implementation plan to execute.

## Accepted direction

New implementation branch from **remote-synced master**, **same existing checkout**, **no separate worktree**. Keep develop as a preserved donor; port/adapt only requirement-driven pieces as each vertical slice is designed. Do not implement a duplicate system first or import entire coupled commits afterward. Do not re-ask API-key vs upstream-account or blocking vs monitoring.

The owner will clear context and start a new session to **create the implementation plan first**. No runtime implementation starts in this handoff turn. Branch name is not selected and no implementation branch is created/switched here.

## Sync operation — completed successfully

To avoid merging master into dirty develop, operation is `git fetch --no-tags origin refs/heads/master:refs/remotes/origin/master`, followed only on success by ancestor verification and compare-and-swap `git update-ref` of inactive local master. This is not `git pull` into the current branch.

- Before: local master `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d`; HEAD/develop `08ee1a74954c5fe7a1659a6473e57b6b1ea9059b`.
- Remote tracking for master: `origin`, `refs/heads/master`.
- Background task `b05856b36` completed, exit code **0**. Fetch succeeded and the ancestry-checked compare-and-swap update fast-forwarded local master.
- After: local master and fetched `origin/master` both **`1855aa44473e88feac9d3f131b9c0c5fc9706b68`**. This is the next plan's candidate baseline; upstream changes since the audit have not been reviewed.
- Current checkout remains **develop**; no implementation branch creation/switch, merge into develop, stash, reset, commit or push was performed.
- `git worktree list --porcelain` observed one checkout only, on develop; no existing master worktree found.
- Source stability check: 333 explicitly listed source paths still match the audit manifest. This is not an all-files/generated/private-state preservation certificate. Post-sync verification is recorded separately in [handoff-validation.json](./handoff-validation.json).

## Critical preflight before a same-checkout branch switch

Current checkout contains tracked pending changes and relevant untracked native modules plus many generated/session artifacts. Switching branches may refuse or carry pending edits onto the new branch. **Do not call a new branch clean until the working source tree is actually isolated from WIP.**

Next planning session must explicitly plan preservation before switching:

- Inventory only public source/docs needed as donors; distinguish tracked vs untracked. An untracked module is not in develop's Git tree and cannot be retrieved with `git show develop:path`.
- Select a scoped preservation method with necessary approval (reviewed WIP preservation commit or scoped stash including required untracked source). No blanket stash/add/reset/clean/force checkout. Do not sweep `.pi`, `.next-*`, private config/DB/captures or credentials into a commit/stash.
- Preserve these untracked planning/handoff documents themselves, so context reset and checkout do not strand the product contract.
- Do not alter running services or use production DATA_DIR for experiments. Branch checkout does not undo schema/data migrations.

## What the next plan must contain

- Explicit master baseline SHA and deltas since the old audit; do not treat the old source findings as certification of newly fetched upstream.
- Small supported Claude/Codex ingress/model/composition matrix and unknown/pricing/storage failure policy; exact old requirement dispositions rather than blanket waivers.
- Per-slice admission rule: requirement Bxx, file/dependency list, port/adapt vs smaller alternative, migration/data risks and isolated checks.
- First real vertical acceptance: save key budget → ordinary pipeline supported native request → exact original-key recorded cost → subsequent pre-POST refusal; then relevant retry/refresh, duplicate/conflict, concurrency/restart/period and ordinary compatibility controls.
- Unaccounted reachable routes must refuse budget keys, never bypass to ordinary inference. No telemetry-only substitution or missing-data-as-zero.
- Optional catalog automation, standalone embeddings coverage, degraded-storage continuation and full control-plane machinery are **not imported automatically**; preserve required invariants if replacing them.
- Stop conditions for unresolved producer evidence; a new branch cannot supply missing monetary semantics. No runtime/live/activation authority inferred from this handoff.

## Historical evidence

`source-baseline.json`, `inspected-evidence-index.json`, `validation.json` and the audit report describe the earlier static audit. Keep their baseline hashes/results unchanged. The old `validate-documents.py` intentionally expects the earlier refs and must not be used to claim ref stability after an authorized master update. Later handoff validation is a separate record.
