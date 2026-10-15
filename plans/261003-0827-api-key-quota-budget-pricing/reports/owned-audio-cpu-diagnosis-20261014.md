# Owned inline-audio JSON: CPU sampling diagnosis, not repair

## Outcome

`b6ab3d6e6` FAILED: unchanged original JSON positive hit its5s deadline, reporter body8986.028ms,0pass1fail109filtered. Inputs1864 before/after identical. Explicit Inspector stop produced a profile; no product/test source edits, mocks, prewarm, assertion or deadline changes. External setup/config/script and raw profile remain under `/tmp/9router-gemini-function-authority/owned-audio-inspector*`.

Prior exit-time CPU attempt `bbbf9aab8` failed with JSONtimeout/body8208ms and NOprofile; it provides no inner CPU evidence. Installed Vitest fork shutdown sends SIGTERM then SIGKILL after500ms, a plausible unflushed-profile explanation, not proven attribution.

## Measurement and limitations

Inspector started in external setup before file imports and stopped in afterAll. Full profile spans18446ms/13139samples. Monotonic setup887.758ms,beforeAll10336.888ms,afterAll19334.331ms. Approximate final8997ms isolates suite/setup+body+cleanup from most collection imports; it is NOT an exact test-body window. V8/performance clocks were not explicitly correlated. Samples weighted by timeDeltas are statistical elapsed-time attribution, not exact function execution counters or syscall/CPU measurements. Idle/native gaps, scheduling and profiler overhead remain. Transformed module URLs/line numbers need source reconciliation, not verbatim production stack-line claims.

`owned-audio-inspector-aggregates.json` groups identical frame labels across call trees; inclusive time counts a frame once per sample. Do NOT sum nested inclusive values or equate them with isolated per-call timings. No secret, prompt, binding or authority values extracted. Raw profile contains local code metadata and must be reviewed before publication.

## Approximate suite-window observations

| Frame/path | Sample-weighted ms | Kind |
|---|---:|---|
| assertGeminiOwnedUploadResultSync |4113|inclusive|
| assertGeminiOwnedFileAuthoritySync |4112|inclusive|
| captureGeminiUploadedResourceSync |4042|inclusive|
| freshBinding |2453|inclusive|
| captureQueuedRequestAuthoritySync |2202|inclusive|
| accountingCoverage.current |1924|inclusive|
| SQL.js get |1640|inclusive|
| coverage.fingerprint |1613|inclusive|
| writerOwnership.assertOwned |1174|inclusive|
| readFileUtf8 |1038|self|
| accountedBaseDispatch.copy |517|self|
| writerOwnership.readOwner |318|self|
| idle |1700|self|

Fresh SQL/coverage/writer/resource paths dominate multiple nested stacks. This supports investigating amplification across mandatory checks, not blaming one syscall, CPU load or crypto primitive. Snapshot construction is a smaller contributor in this run; rejected equality candidate's micro gain was not enough to close actual pipeline. Profile is not a matched comparison establishing that candidate's causal performance effect.

## Source reconciliation

- `geminiOwnedFileAuthority.js`: every independent private grant invokes full current authority, including every resource. No grant aggregation or removed check authorized.
- `geminiOwnedUpload.js` → `geminiUploadRegistry.js`: each current result capture freshly validates record, latest lifecycle receipt, signature, full binding and time/expiry.
- `queuedRequestAuthority.js`: before/after coverage, canonical SQL view, binding fingerprint, actual prior-ID/reverse/retired helper, settings/connection/pool grammar; detached original strings remain significant.
- `accountingCoverage.js`: each current/status/fingerprint reads sidecar and lock, validates integrity history and SQL policy marker. fingerprint is not just an in-memory HMAC.
- `sqljsAdapter.js`: every get freshly asserts owner and executes; compiled-statement reuse already exists. Result caching is not an option.
- `writerOwnership.js`: current lock is freshly read and parsed on each assert; inspection independently checks before/after callbacks.

See prior [bytewise architecture review](./bytewise-authority-architecture-review.md) for source-derived14SELECT/37file-read per-resource model, which is NOT newly measured call counts in this JSON run.

## Decision / next design gate

No additional production optimization is justified yet. Equality helper/test/callsite candidate fully reverted to exact original1864 dictionary; no running gate or active diagnostic source patch. Do not rerun unchanged JSON forgreen, raise deadline, prewarm, cache read/authority results, combine freshness frames, remove grant checks, coalesce bytewise work or weaken durability/own delivered ACK.

Next work is **design-only verification-core feasibility**, starting with the expensive fresh coverage/writer/resource path. Any candidate must specify exact same read/check/boundary sequence, bounded plain-data validation, fresh mutation rejection, original signed/durable representation and all-adapter/restore implications BEFORE test-first implementation. A proposal that can only obtain speed by eliminating required freshness is rejected, not treated as delivered support. Current evidence does not promise a viable candidate, speedup or ETA.

B/F and all13AC/G→T→I→V/C–E remain OPEN. Enforcement/public/synchronous activation OFF. Existing27producer failures/whole-contract timeout/bytewise/other historical obligations retained. Dummy loopback/SQL.js profile is not live-provider, tenant/SSRF/TLS, production adapter or crash/restore certification.
