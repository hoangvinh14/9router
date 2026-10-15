# API-key budget WIP checkpoint — 2026-10-15

## Purpose and status

Operator explicitly authorized classification, secret review, checkpoint commits and a normal push to `feat/api-key-quota-budget-pricing`. This is a recoverable **WIP backup**, not a release, merge approval or certificate that the feature is ready. Enforcement/public/synchronous activation remains **OFF**. No PR, merge, force push, deployment or live billable call is authorized by this checkpoint.

## Included scope

Preserve the accumulated API-key accounting continuation since `0a785e59`: Claude original histories/citations/server-tool accounting, exact embedded tool and Gemini media reference rates, Gemini owned upload/lifecycle/capabilities, original wire/usage/price/own-ACK integration, related pricing UI/recovery plumbing, scoped fixtures and tests, and the canonical plan/handoff/reports.

Implementation/test changes and documentation are separate checkpoint commits. The scope is deliberately larger than the most recent video slice because modified shared modules depend on earlier untracked accounting modules; a selected local-import audit found no missing local source dependencies in the checkpoint.

Exclude `.pi/` diagnostics/profiles/runtime receipts, databases, credentials, raw logs, the unrelated Kimchi test-runner edit, generated translator URL/header snapshot, and two unrelated cache/session-affinity research reports. Exclusions stay in the local workspace; nothing is discarded. Historical local artifact paths in reports are provenance references, not files present in this push.

## Evidence and known failures

- Current owned-inline-video mode: 49 focused cases and 12 actual SQL.js/dummy-loopback producer cases passed in their finite gates. Original POST, durable pending, observed309000nanoUSD/original rates and own ACK controls are scoped evidence only.
- Finite direct-consumer barrier: **2394 pass / 10 fail / 0 pending**, 99 distinct files/18 batches; all before/after source dictionaries matched. Eight existing producer timeouts, one bytewise upload timeout, and one negative-fixture premise regression were retained, not filtered away.
- The missing-DOCUMENT negative fixture now explicitly removes both rates. Its targeted verification still timed out at5s; diagnostic reached missing-rate refusal/noPOST/noACK/norow at~3.79s, while the positive POST/own-ACK branch remained unobserved. That entire case is **not passed**.
- Conditional one-resource coverage-view experiment: prerequisite13pass/focused45pass/lint13 did not override original bytewise5s timeout/body19769.57ms. Candidate **rejected and reverted**, exact1865preflight source/test dictionary restored. No coverage frame, provenance adapter change or lazy-native-import experiment is retained. Reports preserve its outcome.
- No new full suite/build or performance rerun is claimed for making this backup. Existing historical failures, performance/cold checks, all-adapter/recovery/managed-restore evidence, routing/fusion integration, management end-to-end journey and all13acceptance criteria remain open. See the canonical plan and continuation reports; do not infer progress percentages from test totals.

## Security and publication boundary

Publication checks: Gitleaks8.30.1 scanned the209initially selected files (~2.90MB), the new checkpoint report separately, and the exact168staged code/test additions; all completed exit0with empty findings. Heuristic URI-userinfo matches were three explicit dummy negative-security fixtures, not live credentials. Staged168file hashes matched the reviewed working files; `git diff --cached --check` passed. Code/test checkpoint commit: `84125068` (`feat(api-key-budget): checkpoint media and embedded-tool accounting WIP`). Documentation receives its own staged scan before commit. A clean secret scan is not a full security audit. Authentication/credential binding, upload destination and redirect restrictions, ownership/lifecycle checks, signed receipts and delivered-ACK identity remain sensitive areas with incomplete whole-feature acceptance. Dummy fixture keys are not live provider credentials.

The archived rejected candidate and raw runtime evidence remain local, not published. Do not activate or treat configured rates as certified provider/protocol support. Future implementation must preserve existing safety contracts or obtain explicit approval for a changed contract.
