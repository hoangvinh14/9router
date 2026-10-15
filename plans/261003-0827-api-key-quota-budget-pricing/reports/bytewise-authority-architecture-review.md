# Bytewise owned-resource authority — read-only architecture checkpoint

## Status and scope

Operator selected direct, read-only architecture review after three insufficient pipeline optimization attempts. This review used source and existing receipts only: no delegation/advisor, live DB access, network, test execution, production edit or fourth repair. Enforcement/public activation remain OFF. Package B/F, all 13 acceptance criteria and G → T → I → V remain incomplete.

Latest rejected experiment: `b0b8227bd` failed **89 pass / 1 fail**, pending 0. The existing private owned-videoMetadata bytewise case exceeded its unchanged 5-second test deadline; reporter body duration was 10773.115 ms. JSON `STACK_TRACE_ERROR` and log timeout are distinct retained evidence. Contract gate `b6e805eaa` passed 14/14, but did not establish pipeline throughput. Fresh snapshot candidate was undone; its test is preserved intact under `/tmp/9router-gemini-function-authority/accounting-prepared-data-construction-rejected.test.js`. Restoration receipt proves the 1857 source/test hashes match the post-Fusion-ordering snapshot, with no added/removed inputs. No broad impact expansion is justified for this reverted source.

## Actual call chain

1. `tests/unit/gemini-owned-upload-loopback.test.js`, existing private capability case, sends each of the 562 encoded bytes through `parser.push(encoded.subarray(offset, offset+1))`. It retains exact usage/EOF/byte-conservation checks. This is actual SQL.js with a disposable acquired writer, migrations, coverage and private upload origin.
2. `src/lib/apiKeyBudget/geminiOwnedFileUsage.js`: `run()` validates before and after every push and finish. A parsed event additionally validates before and after the callback. Failure/reentry/ended latches, undefined synchronous callback results and real-promise rejection observation remain mandatory.
3. `geminiOwnedFileAuthority.js`: private WeakMap identity, exact adapter/model and bounded full-original equality; each retained private upload result is revalidated, and exact resource equality is checked.
4. `geminiOwnedUpload.js`: exact issued result identity and binding equality, then current uploaded-resource capture; returned material must equal the original result.
5. `geminiUploadRegistry.js`: freshly reads the KV record, checks current external latest receipt, signature, complete grammar and metadata. Fresh key/connection/coverage binding digest must match; ACTIVE/time/expiry checks precede exposing a detached result.
6. `geminiResourceLifecycle.js`: private acquired ownership inspection before/after the receipt read; fresh sidecar regular-file/size/JSON/signature/coverage checks and latest-generation equality protect scoped rollback. This is not whole DB+sidecar+coverage-key rollback protection after process death.
7. `queuedRequestAuthority.js`: current coverage before/after, freshly executed canonical SQL join, exact active key and credential binding, actual `validateKeyBindings` prior-ID/reverse-fingerprint and retired-binding checks, settings/ledger/connection/pool grammar, then bounded detached equality material.
8. `accountingCoverage.js`: every status/fingerprint/retiredBindings operation calls `current()`, which rechecks the writer, reads and validates the sidecar, compares retained integrity history, and freshly checks the policy-format SQL marker. Fingerprinting is not simply an HMAC over an in-memory key.
9. `sqljsAdapter.js`: each `get()` checks acquired writer ownership and current health before freshly binding/executing/resetting a compiled statement. Compiled SELECT reuse never caches result rows or authority.
10. `writerOwnership.js`: each `assertOwned()` freshly parses the current writer-lock file and compares its instance with the acquired owner; ownership inspection adds checks on both sides of its synchronous callback.

## Source-derived work model — not a new measurement

For one successful authority check with **one resource**, no proxy pool, healthy actual SQL.js, normal coverage policy marker path, and no reentry/fault:

| Work inside one resource capture | Source-derived count |
|---|---:|
| Coverage `current()` paths | 10 |
| Fresh coverage policy-marker SELECTs | 10 |
| Other SELECTs: registry row + canonical authority view + helper prior-ID/reverse-fingerprint | 4 |
| Writer-lock reads: coverage ownership + each SELECT + lifecycle inspection before/after | 26 |
| Coverage-sidecar reads | 10 |
| Lifecycle-sidecar reads | 1 |

The ten coverage paths are: lifecycle signature and status (2), registry signature (1), queued capture status/fingerprint/helper retiredBindings/helper fingerprint/post-status (5), freshBinding status and binding digest fingerprint (2).

Thus the source model predicts **14 freshly executed SELECTs and 37 fresh file reads per successful resource check** in this narrow current path. More resources/pool/history/fault paths differ. These counts are structural, not observed current timing or proof of every adapter lane. They must not be substituted for runtime evidence.

The historical instrumented 562-byte profile observed 1128 authority/resource checks, 20304 `get()` calls, 4512 status calls, 5640 fingerprint calls, 33840 writer reads, 11280 coverage reads and 1128 lifecycle reads. Its old pre-batch SQL count was 18 SELECTs/check. The model explains why reducing that old authority view by four SELECTs cannot remove the dominant multiplicative checks. Historical timings are overlapping/instrumented and cannot be summed or used to assert an exact cause of a later failure.

## What is mandatory versus incidental

**Mandatory under current constraints:** each before/after push/callback/finish boundary independently rechecks current private identity, complete original, current resource/expiry/revocation/binding, coverage and writer. Own durable completion delivery remains separate. Neither protected files nor SQL rows can be retained as substitute current authority across these boundaries. Adversarial callback/getter/reentry protections remain.

**Incidental mechanics already evaluated:** compiled-statement prepare work, separate canonical authority SELECTs, generic snapshot property construction, and filesystem read implementations. Scoped semantic contracts passed for retained SELECT reuse and SQL batching, but unchanged bytewise pipelines still failed. Snapshot construction and both filesystem candidates were rejected; micro gain is not a pipeline certificate.

**Constructor duplication is not the bytewise root lever:** initial parser construction invokes authority directly and again through the private grant verifier, but that is a fixed setup cost, not the repeated 1128-check loop. Removing it does not justify claiming the bytewise objective repaired, and may erase an independently tested guard.

## Decision and rejected shortcuts

There is **no demonstrated safe fourth implementation candidate** from this review. In particular:

- Do not share a captured coverage frame, binding rows, lifecycle receipt, writer proof or full original validation between boundaries, even within one `push()`.
- Do not reduce check frequency to event/terminal-only, coalesce byte chunks, increase timeouts or prewarm.
- Do not replace actual `validateKeyBindings` with a joined-row approximation or discard prior-ID/reverse/retired checks.
- Do not equate completed debit with delivered own ACK, classify provider resource visibility as tenant ownership, or weaken resource lifecycle to a signature-only check.
- Do not treat current uninstrumented duration versus historical duration as a controlled benchmark or causal regression diagnosis.

A verification-core redesign might reduce fresh parsing/serialization or generic data construction while still executing every check, but it would require a separately reviewed design showing exact identity, bounded grammar, post-check mutation behavior and fresh HMAC/coverage/SQL/ownership semantics. Its gain is unknown; changing signed representation/sidecar/schema or adapters would enlarge security and restore risk. This review does not authorize such changes, nor support an ETA.

**Recommendation:** keep throughput explicitly OPEN; do not launch another optimization or identical pipeline run. Continue an independent remaining resource-composition obligation, or request a design-only verification-core proposal with explicit constraints before any implementation. Both preserve the complete accepted B scope.

## Other retained blockers and security notes

- Fusion batch `b04034fb0` remains FAILED409/1: post-release request count expected 4, got 5. Focused diagnostic did not reproduce it; deterministic injected ordering proves a possible collector-before-future-ACK-error ordering, not that historical HTTP failure's cause, repair or baseline.
- Historical producer batch14 acquired the real `~/.9router/db/data.sqlite`; side effects remain unknown. No contents inspection/remediation or retroactive isolation certification occurred.
- Actual disposable SQL.js/protocol/money evidence is not live-provider, public-app, codec, SSRF/tenancy, production TLS/OAuth, crash/power-loss, managed restore or integrated B certification.
- Silent/unavailable opengrep/LSP, deferred ESLint timeout and graph/cascade limits are not clean certification. The candidate gate's scoped lint success does not erase tooling limitations.

Read-only review is complete. Implementation remains paused pending the next operator decision.
