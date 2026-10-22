# Private ABI127 binding setup — proposal, not executed

Research date: 2026-10-18. Scope authorized by “hãy làm tiếp”: continue the preceding **planning-only** proposal. No binary/package download, extraction, install/rebuild, runtime/addon execution or production change in this step.

## Outcome
An exact publisher prebuild exists, so a source build is **not recommended or requested**. Propose one pinned binary download and a private fixture mirror using existing local JS dependency files. Do not overwrite the ABI137 addon that failed under Node22. P1 remains blocked; this lane does not accept Bun/Windows or waive existing analytics failures.

## Verified publisher metadata / integrity pin
Official release: [WiseLibs/better-sqlite3 v12.11.1](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.11.1), release ID339692067, published2026-06-15. Release metadata reports immutable=false: assets may change, so name/tag alone is insufficient.

| Field | Pin |
|---|---|
| Asset | `better-sqlite3-v12.11.1-node-v127-linux-x64.tar.gz` |
| Asset ID | `448381028` |
| Size | `1089479` bytes |
| Publisher API digest | `sha256:94ce113ea2d9347fcd1cf8e46445cc271d1dbd02d05a64aa460442222f023b11` |
| Runtime | existing `/home/gmo/.nvm/versions/node/v22.23.2/bin/node`, actual ABI127/Linuxx64 from failed preflight |
| Download | `https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-node-v127-linux-x64.tar.gz` |

[Asset pin](./binding-abi127-asset-pin.json) retains exact matching metadata and SHA256s of two saved API pages. Page1 contains100assets and no matching asset; page2 contains38assets and exactly one match. Both metadata pages fetched boundedly from api.github.com, no binary fetched. 9router search was unavailable (no configured route); precise official API/docs URLs used instead, no provider/config changes.

API source: `https://api.github.com/repos/WiseLibs/better-sqlite3/releases/339692067/assets?per_page=100&page=2`.

Digest is publisher metadata from the same GitHub trust domain, not independent signature/attestation or a malware guarantee. If downloaded bytes differ in size/hash, STOP; never update the pin automatically to get a match. Local package12.11.1+prebuild same version is intended compatibility, not actual tested success. No CVE audit or release-safety certification performed.

## Proposed private destination and module boundary
Create a fresh mode0700 temporary root `/tmp/9router-db-safety-abi127-<random>/` only after approval:

```text
root/
  download/     pinned .tar.gz, retained download receipt
  unpack/       validated regular .node file, no archive links/devices
  mirror/
    package.json                  local root metadata copy
    src/lib/db/**                 byte-identical frozen R3 source copies
    src/lib/dataDir.js             byte-identical local dependency copy
    node_modules/better-sqlite3/   local package.json + lib/** copies
      build/Release/better_sqlite3.node  verified ABI127 payload only
    node_modules/bindings/        local JS package copies
    node_modules/file-uri-to-path/ local JS package copies
  fixtures/     private HOME/DATA_DIR/TMPDIR/cache, app DBs
  harness/      plan-owned runtime tests + exact alias resolver if needed
  evidence/     input manifests, paths, stdout/stderr, exit/signal/results
```

No global/module PATH mutation, root node_modules write, hardlink to writable original, external symlink or CJS monkeypatch redirect. Confirm realpaths of resolved better package and loaded addon stay beneath mirror; deny out-of-mirror resolution for copied DB/dataDir modules. Copy only required local packages after enumerating their relative imports and all files/hash identities; do not assume package metadata engines prove ABI. Actual copied source test claims must identify **mirror execution**, not original-path product execution.

DB `paths.js` imports `@/lib/dataDir.js`; native Node needs an exact plan-owned alias resolver to mirror/dataDir (no general alias escape or Vitest/mock substitution). Copy complete DB subtree for driver dynamic imports; known alias/local dependencies must be statically enumerated before run. Driver fallback to node/sql.js is **not** acceptable better-lane success: assert `adapter.driver === 'better-sqlite3'`, record actual binding/engine identity and fail if fallback occurs. No production factory injection needed. `version.js` package metadata path resolved within mirror and recorded. Any missing dependency is harness-preflight failure, not permission to install/copy arbitrary app tree.

[Official API documentation](https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v12.11.1/docs/api.md) documents `nativeBinding`; installed `lib/database.js` confirms explicit path override exists. That can prove the downloaded binary can open a raw fixture DB using local JS, but the production adapter does not pass this option. Therefore **nativeBinding-only tests cannot certify actual factory/driver composition**. Prefer private ordinary package resolution above for adapter tests. Do not edit production adapter to add an option merely for this lane.

## Requested execution boundary (not yet approved)
1. **Setup network phase:** download only the pinned asset over HTTPS using the named GitHub URL; allow only expected GitHub release/CDN redirects, no credentials/tokens or private data. One attempt, fixed60s and compressed byte cap2MB, streamed to private file. No curl-pipe-shell, npm/npx/prebuild-install/install scripts, git clone, build tools, containers, Node header downloads or other artifacts. Record redirect hosts and final URL; unexpected origin/refusal/timeout→STOP, no silent retries.
2. **Integrity/extraction:** verify compressed size1089479 and exact pinned SHA before extraction; inspect archive member list and reject absolute paths, `..`, symlink/hardlink/device/FIFO, duplicate paths or unexpected files. Cap expanded content16MB. Only a regular expected binding path is allowed, with final realpath under unpack/mirror. Contents not yet downloaded, so member layout is **not yet verified**; mismatch requires decision, not permissive extraction. Record extracted binary SHA independently.
3. **Mirror preparation:** byte-copy enumerated source/JS dependency files into private root; hash-compare originals and mirror before running. Retain package/lock/binding/source/input receipts, including original ABI137 SHA unchanged. No source transformation; resolver/harness are separate declared inputs. Do not restore/stash/reset unrelated work.
4. **Offline execution:** no intended network calls; existing JS preload blocks selected network APIs, **not OS/native sandboxing**. No app server/OAuth/provider credentials. Explicit existing Node22 executable/PATH, core dumps disabled, fixture-only DB paths. New fixed30s binding availability preflight; if it fails, counsel and STOP, not fallback/rebuild.
5. **Only on preflight pass:** prepare/run bounded plan-owned actual better factory+driver harness, fixed60s per distinct process purpose, no polling, warmup, retries or budget changes. Cover WAL/FULL, ownership/second opener, durable ACK/reopen, rollback/nesting/close guard, retained-token refusal, SQL read/transaction boundaries, sync callback/thenable handling, migration/schema2/ACL/pricing contracts. Any synthetic close/commit faults separately labeled. Same2analytics baseline identities not modified or waived; broad117test rerun is not automatically needed to prove better-specific controls. Exact scenario manifest/counts and module identities required before launch.
6. **Final evidence/stop:** retain all red results and source hashes; compare originals untouched, close owned handles/children, retain fixture/evidence directory. No production activation/commit/push. Passing better checks advances only this runtime evidence lane, not prerequisite acceptance or P1 automatically.

Limits above are proposed now, before execution, not extensions of the previous preflight timeout. Any failed step uses existing counsel-before-diagnosis protocol. This is a **changed-input** ABI127 lane, not rerunning the failed ABI137 binding for green.

## Outstanding decisions
Approve the exact private download/extraction/mirror/preflight/harness scope above, or stop/provide a pre-existing ABI127-compatible environment. Source build, package manager installs and root binding replacement remain excluded. Bun/Windows actual evidence and independent full-source review remain separate obligations.
