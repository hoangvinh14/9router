# E1 embeddings accounting — selected fixture acceptance

Authorized child: [plan](../261031-1335-x1-e1-embeddings-accounting/plan.md), explicit `--auto`.

## Scope and security

Selected private-fixture persisted dynamic `openai-compatible-*` API-key synchronous embeddings only. Production OFF. No shipping fixture-association caller, public activation setting, schema migration, server/build, real provider, real DB, commit/push/deploy. Existing R1 dirty delta preserved; pre-E1 source hashes and full status are in [evidence](./evidence/261031-e1-embeddings/). All3child phases completed for this selected fixture scope only. Parent X1/R and other canonical owners remain OPEN/BLOCKED.

New authority/session/profile/raw-reader modules reuse the existing ledger/service/exact money and actual `proxyAwareFetch` boundary. Input-only exact usage, original `embeddings` snapshot, own intent and terminal ACK, persisted key/ACL/model/connection/node/proxy material rechecks. Terminal publication failure remains a refusal even after an own coverage-gap ACK; gap ACK is never priced-intent authority. Fresh degraded E1 dispatch refuses when original price/own intent cannot be established. No incidental Chat/R1 degraded-policy change.

Client payload/error bytes stay request-local, bounded at 8 MiB selected raw evidence; no vectors/raw bodies persisted to ledger. Only upstream Content-Type survives selected replay; local CORS/no-store/request-id ownership retained. No peak-RSS/invoice-hard-cap/provider-wide certification. Existing diagnostic logging and legacy presentation persistence remain excluded.

## Incremental evidence (not final acceptance)

| Run | Result | Raw report |
|---|---|---|
| Pre-E1 compatibility + isolation | 110/110, 5 suites | `preflight-results.json` |
| Initial E1 usage/JSON + compatibility | 148/148, 4 suites | `initial-json-results.json` |
| Cumulative focused diagnostic | 179/180, 11 suites; one 5s replay-test timeout | `diagnostic-focused-failed-results.json` |
| Replay/current admission diagnostic | 169/169, 6 suites | `replay-rerun-results.json` |
| Remaining safety diagnostic | 78/78, 5 suites | `safety-diagnostic-results.json` |

Reports above are preserved under the evidence directory. Original comparator on preflight report exit0; `/app/`/path normalization and unmatched identities must not be called historical baseline coverage. Later source edits invalidate earlier runtime evidence for final acceptance.

The lone diagnostic timeout was the 1 MiB replay case using Vitest deep Uint8Array equality. Advisor requested timing to distinguish reader vs matcher and recommended native `Buffer.equals` with an independent expected buffer plus length. No timeout raised and no payload reduction. Rerun passed; measured construction7.56ms/read23.05ms/compare0.38ms supports matcher-overhead diagnosis. Later edits still require frozen-source acceptance. Failure report retained, not overwritten.

## Current implementation inventory

- `open-sse/utils/accounting-embeddings-usage.js`: closed request/usage/price profile and decoded-key ambiguity walk.
- `src/lib/accounting/persisted-embeddings-authority.js`: endpoint-specific persisted authority, saved target/proxy and narrow fallback mutation adoption.
- `src/sse/services/embeddings-accounting.js`: single-use private association/session, original lifetime, service-backed own ACK and retained late terminal sink.
- `open-sse/handlers/embeddings-accounting.js`: actual POST raw boundary, incremental cap, abortable reader and nonawaited cleanup.
- `src/sse/handlers/embeddings.js`, `open-sse/handlers/embeddingsCore.js`: optional selected entry/core dispatch and final-error fidelity; unassociated paths preserved.
- Embeddings loopback/process fixtures and focused tests; activation lexical tripwire covers shipping src+open-sse and forbidden caller/owner alias controls. It is not a formal reachability proof.

Only four pre-existing runtime/test files changed relative to pre-E1 source snapshot at the last inspection: embeddings entry, embeddings core, embeddingsCore tests, activation tests. Existing R1 shared source hashes remained unchanged. New files tracked separately.

## Static checks and current frozen run

Final scoped ESLint exited0 for20changed/new JS paths, empty `final-eslint.txt`. Active LSP all20paths returned0diagnostics but20inconclusive (4timeout,16push-only silent-on-clean); not a confirmed-clean LSP result. `git diff --check` exited0. Rechecked pre-E1 hashes: only four named existing paths changed, all other existing source/tests (including R1) unchanged.

Final acceptance uses `run-final.py`:65expected suites in5isolated batches, source+runtime dependency hashes captured before launch, source comparison before/after each batch, original comparator per exact raw report, independent exact collection/duplicate/no-skip/adapter identity checks. Attempt1: all5batches exited0 (261+408+205+255+33=1162assertions;65suites), all original comparators passed and source hashes unchanged. Independent verifier correctly rejected duplicate fullName identities, so wrapper exited1 and acceptance was NOT claimed. Full prior reports/logs/manifests and original verifier are preserved at `attempt-1-collection-rejected/`.

Collection correction: new E1 parameter cases now use explicit case labels/indexes and object rows (also avoids Vitest array-row argument spreading). Audited8inherited collision groups from unchanged definitions in7suite paths; `inherited-title-collisions.json` binds exact suite+fullName+multiplicity to pre-E1 source hashes and rationale. New/unexpected collisions fail. Occurrence ordinal identifies report entries only, not independently proven parameter identity; this limitation is explicit. Exact expected per-suite assertion counts are frozen from inspected attempt1collection (1162total), not historical baseline assertions. Verification scripts and exception/count inventories are hashed before fresh rerun and checked for drift. All5batches rerun from scratch, not selectively accepted. No runtime semantics changed in this correction. Fresh frozen rerun `b22e7657f` completed exit0: **1162/1162 reported test cases,65/65suites,0failed/skipped**,5batches, all5original comparators passed and source/input integrity verified unchanged. New E1 titles unique;8audited inherited title collisions retained as explicit exceptions, not unique parameter-identity certification.

## Final acceptance result

| Batch | Distinct suites | Reported test cases | Result |
|---|---:|---:|---|
| E1 focused + containment |11|261|Passed, both adapters |
| Embeddings/pricing/service/security affected |26|408|Passed |
| Chat cumulative affected |8|205|Passed |
| Native Responses cumulative affected |13|255|Passed |
| Responses compatibility affected |7|33|Passed |
| **Total** |**65**|**1162**|**0failed/skipped** |

Actual commands are in `final-commands.json` and `invocation.json`; exact raw JSON/logs/comparators and report checksums are preserved. `integrity-review.json`:1693source/input files, source-manifest SHA256 `1a16b0e91be213d138a6b6575cb40cc42be22ae242207e6529cfc49c07d00ce1`; verifier scripts/count/collision inventories hashed separately in `verification-inputs.json`. Source manifests include tracked+untracked source/tests/config and selected dependency/runtime inputs. No source edits between batches. Expected suite set compared exactly; reported case statuses/counts and adapter prefixes inspected by offline verifier. Baseline unmatched identities are not historical passes; original comparator `/app/` path caveat retained. Reported test cases are not a count of individual assertions.

Final source ESLint passed20paths; the only later2test identity edits also passed scoped lint (`identity-eslint.txt`). Active LSP remains0diagnostics but20inconclusive, later2inconclusive; no confirmed-clean claim. `git diff --check` passed. Pre-E1 existing source preservation rechecked: only four explicitly owned existing paths changed;16new source/fixture/test paths. No source shared with R1/Chat was edited by E1. Direct inline simplification/review retained four separated policy/parser/session/boundary owners rather than broad shared refactor. No independent subagent review or simplifier run claimed. Advisor received summaries/invariants only (full code was withheld by configuration); final review found no run-reporting blocker but is not independent implementation approval.

[Case/contract map](../../plans/261031-1335-x1-e1-embeddings-accounting/references/e1-acceptance-evidence.md) binds required areas to current named tests. Each phase is complete only under the child's explicit Linux fixture contract. No parent X1/R or broader release/activation completion. Production remains OFF, legacy presentation persistence excluded, historical real-DB uncertainty unresolved, no actual provider invoices/performance/hard-cap guarantee, no Bun/better-sqlite3/Windows/build/server/UI/CLI acceptance. No real DB/commit/push/deploy; no automatic next-owner execution.
