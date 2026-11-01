# E1 acceptance evidence map — selected fixture scope

Frozen final `b22e7657f` passed: **1162 reported test cases across65distinct suites,0failed/skipped**,5isolated batches on1693unchanged source/input hashes. Both Node SQLite and SQL.js cases collected; all5original comparator runs passed. Receipt: `plans/reports/implementation-261031-e1-embeddings.md`. This closes only selected fixture acceptance; production OFF and broader X1/release gates remain open. Per-test identities and raw reports are preserved, not inferred from test existence or historical totals.

## Exact owners and cases

| Contract | E1 evidence owner |
|---|---|
| Four nonempty homogeneous input shapes, token IDs, encoding/dimensions, ignored user compatibility | `embeddings-accounting-usage.test.js`, `embeddings-accounting-json.test.js`: original admission plus actual one POST/one aggregate ledger row; unassociated control |
| Exact explicit prompt/total equality, zero, unsupported dimensions, decoded-equivalent duplicate keys, UTF8/JSON | usage suite and JSON/transport malformed controls; structural parser operates after JSON syntax validation, root usage/counter scope |
| Original input-only embeddings pricing | `embeddings-accounting-pricing.test.js`: resolver input1/output0 → 1000 tokens →1000000nanoUSD, batch2000→2000000, ledger/reopen/original week/month; JSON suite rate change during actual POST |
| Actual raw boundary and byte fidelity | JSON/transport suites: float/base64/metadata, valid failed errors, Content-Type-only upstream replay, chunked/incremental cap/truncation/UTF8, reader cleanup reject/nonsettling and original cancellation |
| Persisted key/ACL/alias/node/connection/target/API-key/proxy authority | JSON/authority suites: prewire refusal and held intent mutation; canonical trailing slash/one suffix; no default missing target, OAuth tokens refused; final serialized body/header/route drift |
| Own intent/terminal/gap ACK | JSON/authority/final-controls: held/lost intent and terminal delivery, copied receipt, consumed dispatch, actual intent/terminal publication failures, coverage gap delivery/reopen and peer-key binding isolation |
| Account fallback and final response | `embeddings-accounting-loopback.test.js`: actual two accounts, predecessor own terminal ACK before successor, original priced attempts, later success/final exhausted bytes, successor budget/authority refusal and recording failure precedence |
| Unsupported refresh and compatibility | `embeddingsCore.test.js`: controlled selected refresh mutation refuses before successor/callback; unassociated refresh actually dispatches second call with new credentials. Actual dynamic API-key401/403 one-account route remains E1, not OAuth-positive support |
| Lifetime/resource controls | transport/authority/final-controls: preabort, held/queued intent, deadline, network/body cancellation, partial vs zero-byte absence, valid full JSON before interruption, byte cap, nonsettling cancel, terminal abort charge preservation; no peak RSS claim |
| Late/idempotency/conflict | late-sink suite: private retained sink after dispose/revoke/rate change, original week/month projection, duplicate one debit, conflict retains known charge/safety, no authority resurrection |
| Actual crash/reopen | restart suite + `embeddings-process.mjs`: both adapters, private actual upstream, IPC barriers, SIGKILL after durable intent / committed terminal before ACK / volatile observed usage before publication; original snapshot/time and recovered B1 disposition |
| Budget threshold/rollover/isolation | budget suite: weekly/monthly/both, raise/no reset, only one raised while other exhausted, null/zero, batch debit, two keys, HCM calendar rollover, in-flight overshoot/next request denial, held-intent peer settlement |
| Management/security/activation | budget suite actual spend via authenticated GET/no-store and unauthenticated refusal; affected management security suite retained. Activation test scans src+open-sse and rejects synthetic forbidden caller plus owner alias; lexical tripwire, not formal reachability proof |
| No inference | actual OPTIONS no attempt/debit; unassociated paths do not acquire accounting from client fields. No selected inference response cache exists in inspected entry/core |

## Isolation and exclusions

Only `node tests/fixtures/accounting/run-isolated.mjs <unit paths>` launches application runtime. Read-only allowlisted code/dependencies, private mount/PID/network namespaces/loopback, disposable pre-import HOME/DATA_DIR/TMPDIR and isolation-attestation tests reused. No weakening of runner/setup. Legacy presentation persistence is disabled by the existing sandbox loader/setup and remains uncertified. Historical real-DB uncertainty is not investigated or remediated.

No production activation/server/build, real provider invoices, UI/CLI/release/platform performance acceptance. Node SQLite and SQL.js/Linux fixtures only. In-flight overshoot and crash undercount are accepted B1 behavior. E2–E4, R2–R4/C1 and parent X1/R remain OPEN/BLOCKED. Missing cloud worker suite is explicitly excluded, not passed.

## Current evidence locations

`plans/reports/evidence/261031-e1-embeddings/` contains pre-E1 hashes/status, diagnostic raw reports (including the one failed timeout), expected final65suite inventory, exact final commands, source/runtime manifests and per-batch raw reports as they complete. See `plans/reports/implementation-261031-e1-embeddings.md` for execution history. Final exact suite collection, per-suite reported-case counts, all reported passed statuses, adapter prefixes and unchanged-source integrity passed. Eight inherited collision groups are audited exact-multiplicity exceptions bound to unchanged source hashes; report occurrence ordinals are not proof of distinct parameter inputs. New E1 case identities are unique. Counts from attempt1 guard later collection drift, not independent requirement completeness. Original comparator unmatched IDs are not historical baseline passes; `/app/` identity caveat retained. Scoped ESLint passed; active LSP0diagnostics/20inconclusive (4timeout,16push-only), later2path recheck inconclusive. Advisor reviewed summaries/invariants, not full code; no independent subagent approval. All3child phases completed only selected Linux fixture scope. Failed diagnostic and first collection-rejected attempts are preserved.
