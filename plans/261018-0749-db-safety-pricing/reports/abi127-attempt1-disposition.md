# Private ABI127 preflight attempt1 — FAILED, execution stopped

Task `b058d2be4` returned exit1. Pinned binary download/extraction had passed; this attempt records the expected private package and addon path/hash on actual Node22.23.2/ABI127/Linuxx64, then fails the assertion requiring **every** CommonJS cache file to be beneath mirror. Adapter/driver harness NOTRUN. No retry, addon reinstall, runtime switch, production edits or gate reopening.

## Evidence and limits
[Result](./abi127-attempt1-abi127-preflight-result.json), [empty output](./abi127-attempt1-abi127-preflight-output.log), [exit code](./abi127-attempt1-abi127-preflight-exit-code.txt), [executed script bytes](./abi127-attempt1-preflight.mjs.txt), [preload bytes](./abi127-attempt1-offline-preload.cjs.txt), [input manifest](./abi127-attempt1-preflight-inputs.json), [receipt](./abi127-attempt1-receipt.json), [mirror manifest](./abi127-mirror-manifest.json).

Source order places successful open/SELECT assertions before the failing cache check, and result contains the correct addon SHA. However, receipt does not track those stages individually; no offending cache entry was saved. Do not relabel the failed attempt as successful binding verification. Finally-close was attempted; absence of cleanupFailed is not independent close certification.

After failure all R3 original DB/test hashes, mirror55file hashes, original ABI137 binding and recorded harness inputs matched. Fixture/evidence root retained at `/tmp/9router-db-safety-abi127-mOsx0u`; no destructive cleanup.

## Source-only finding after counsel
The launcher uses `NODE_OPTIONS=--require=<root>/harness/offline-preload.cjs`. That declared CommonJS preload lives **outside mirror** and should be cached by Node. Its source imports only builtins. Thus the blanket assertion is incompatible with this declared preload. This source reasoning does not identify the actual failing entry or exclude other unexpected entries: none were logged.

Potential bounded correction, requiring a new execution decision: allow only the exact canonical preload file after verifying its previously recorded SHA; all dependency/addon paths must still resolve beneath mirror. No general harness-directory/root allowlist. Record every cache entry/unexpected entry, open/query/provenance/close milestones separately; failure to close cannot pass. Put initial assertions inside the reporting boundary. Use fresh fixture DB/data path without deleting the failed attempt evidence, same Node/binary/timeout and no new downloads. Preserve attempt1 red rather than overwrite it.

## Stop / decision
Existing setup proposal says failed step→counsel and STOP, no silent retry. Counsel obtained and source-only review completed; **no correction or changed-input execution yet**. Request approval for exactly the harness correction and one fresh30s preflight above; only if that passes may the already-authorized actual better factory/driver harness proceed. No P1 advance. Bun/Windows, independent review and two analytics failures remain outstanding.
