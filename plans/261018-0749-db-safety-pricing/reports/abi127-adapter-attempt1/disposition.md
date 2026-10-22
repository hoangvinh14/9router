# Actual better adapter attempt1 — FAILED / blocked

Task `bcaf237d9` exited1. Main planned12cases: **9passed,1failed,2unreached**. Actual contender child receipt1passed; fresh-process reopen child NOTRUN. Do not combine earlier preflight passes into an overall adapter pass. [Raw receipt](./receipt.json), [main result](./adapter-main-result.json), [child result](./adapter-contender-result.json), [output](./adapter-output.log), [executed harness](./abi127-adapter-harness.mjs.txt) and resolver logs retained here. Setup and ABI127preflight successes remain separate.

Failure in combined driver/migrations/ACL case: `SQLITE_CONSTRAINT_NOTNULL`, `NOT NULL constraint failed: apiKeys.createdAt`. Output records actual driver `better-sqlite3` and initial migration, but combined case **did not pass**. Pricing and fresh-process reopen remain unverified. No synthetic fault engine used. Empty cleanupErrors is reported, not independent handle-closure proof.

## Source-only review after failed-verification counsel
- Frozen `schema.js` declares apiKeys.key TEXT UNIQUE NOT NULL and createdAt TEXT NOT NULL; id primarykey, other omitted machineId/isActive fields nullable/defaulted. No timestamp default supplied by migration/schema generation.
- Executed harness direct INSERT includes id,key,name,accessRestricted,accessAllow and **omits createdAt**. Its unique key/id are fixture-only. Therefore this particular fixture violates required schema input.
- Production `createApiKey` in apiKeysRepo supplies `new Date().toISOString()` and includes createdAt in its INSERT. Harness is a direct column/helper composition control, not the actual createApiKey/auth API flow.
- Proposed fixture-only correction: add `createdAt` column, sixth placeholder and fixed ISO string `2026-10-18T00:00:00.000Z` to the harness INSERT. Preserve schema/defaults/production source and all assertions. Inspect required columns as a group, not one error at a time.

Original R3source/test hashes, private55filemirror, original ABI137binding and exact executed harness/resolver/preload hashes matched after run. All saved ESM resolution rows use file/node schemes; exact allow-boundary enforced by executed resolver. This failed attempt did not reach final CJS provenance check; do not claim full final provenance validation. Fixture root `/tmp/9router-db-safety-abi127-mOsx0u` retained without deleting failed data.

## Stop / next decision
No repair or rerun performed. Request approval for exactly the fixture correction above and **one changed-input full-lifecycle invocation** with fresh private fixture/evidence paths, same mirror/binary/Node22, same60s parent/10s children. Existing successful checks would be traversed only because the subsequent driver/pricing/reopen lifecycle requires a fresh owned setup, not an unchanged repeat for green counts. Preserve prior reds and do not synthesize pass totals across attempts.

No downloads/install/rebuild, timeout expansion, production schema/default changes or analytics repair. Missing Bun/Windows evidence and independent full-source review remain; prerequisite unaccepted and P1 gate closed.
