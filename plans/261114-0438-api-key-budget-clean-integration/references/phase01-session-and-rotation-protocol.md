# Phase01 — session actor and cross-artifact rotation protocol

Status: **bounded static design complete for the comparisons below; runtime admission blocked**. Does not complete phase01. M `1855aa44473e88feac9d3f131b9c0c5fc9706b68`; P `7a4f3a3e43dc738d0406e6ab1658db02b8df7ff2`. Read coverage and exact-file hashes in [static manifest](./phase01-static-manifest.json). [Dependency admission](./phase01-persistence-admission.json) is a design register, not an executable port allowlist.

## 1. Session evidence and actor decision

Fresh M bodies: `auth/login/route.js`, `auth/logout/route.js`, `auth/status/route.js`, `auth/oidc/callback/route.js`, `auth/saml/acs/route.js`, `lib/auth/dashboardSession.js`.

| Path / actual behavior | Consequence for new recovery/rotation endpoints |
|---|---|
| Password login calls setDashboardAuthCookie with no extra claims | JWT has authenticated, iat, exp; no jti, individual subject or role installed by this caller |
| OIDC callback verifies through helper and adds oidcSub/email/name | Local JWT does not carry issuer alongside sub; do not treat subject alone as globally unique principal. This is caller observation, not fresh IdP/helper security certification |
| SAML ACS adds saml/email/name | No stable subject in local claims; do not invent a person ID from email/display name |
| createDashboardAuthToken accepts claims; both verify/session helpers use jwtVerify | Neither helper itself requires authenticated===true nor explicitly pins algorithm/issuer/audience. Strict authorization claim checks are **proposed new guard behavior**, not an existing guarantee |
| Logout deletes cookie; no token blacklist/generation revoke here | A copied still-valid JWT is not revoked by cookie deletion. Do not describe a verified token as proof of current individual authorization after logout/password/SSO configuration change |
| status reports authenticated from presence of verified session | Status display is not strict management authorization or audit identity |

**Selected bounded actor design:** use server-derived literal `dashboard-session` after signature/time validation **and** required `authenticated === true` claim check in the new strict guard; audit schema explicitly labels actor as a shared administrative authentication class. Never accept `actor`, user ID, session ID or CLI/inference headers from body as audit authority. No raw JWT, cookie, email or secret in new audit fields. Existing scope requires authenticated/audited administration, not invented per-person attribution. If finer attribution is later required, treat that as a named extension with session/principal evidence, not a hidden claim.

Rejected additions: token-HMAC fingerprint as “session ID” (without jti, same claims/time can create identical tokens; at most token correlation), storing JWT or raw SSO identity, separate signing/login engine. No new persistent secret or auth subsystem needed for generic actor. Unknown extra claims do not automatically invalidate a token; required claim types/value/signature/time must validate. OIDC/SAML issuer/audience/nonce internals are not recertified here. Route-specific strict guard must reject missing/invalid authenticated claim, missing/invalid/expired session and local `requireLogin=false`/CLI-token-only bypasses; ordinary dashboard behavior unchanged.

Explicit limits retained: copied valid JWT lifetime follows existing semantics; no new immediate logout or password-change revocation promise. Proposed algorithm pin HS256 matches local signer but needs jose/version and existing-token compatibility review before code. Do not add issuer/audience requirements that invalidate existing sessions without a migration/relogin disposition. Every mutation still needs canonical authority+Origin/CSRF and fresh server authorization; session does not grant client-selected key/attempt association.

## 2. Same-ID rotation: exact missing representation

Fresh P bodies: `db/accounting-coverage.js`, binding helper (prior increment), selected binding/accounting schema, driver, lifecycle, coordinator, SQL.js and native durability/authority wrappers, migration002 and004.

- `apiKeyBindings` is one row per apiKeyId with unique current fingerprint and optional retiredAt; no bindingVersion or active-ID fingerprint history.
- Coverage v1 `retiredBindings` validates unique IDs and fingerprints. `retainRetiredBindings` allows only one fingerprint per ID. Initialization applies these tombstones to retire/deactivate that ID. It **cannot** be reused as a rotated-secret list for an active ID.
- Coverage binds `.accounting-coverage.json` to SQLite meta via coverage ID and bindingKey digest. HMAC fingerprint source is private sidecar bindingKey; do not substitute unhashed/raw secret, create another key, or discard sidecar on import.
- `current()` rejects nonmonotonic generations/history within observed owner lifetime; this is not universal detection of coordinated rollback of every on-disk artifact across restart. No external monotonic root was demonstrated. Existing restore threat model must be explicit; no anti-rollback certification from this read.
- Coverage has bounded4MiB state and512 retained reconciliation receipts; silently evicting history to permit rotation/recovery is not approved. Capacity failure must fail closed, not bypass history.

**Required capability:** a durable rotation fence enforced by every relevant identity reader/writer, not intrinsically a per-key fence. Per-key versus global scope remains unresolved. Existing global maintenance alone may also block settlement/recovery and ordinary shared-DB work; do not select it without showing those effects. A scoped fence adds representation/migration; neither alternative is approved merely to reduce files. D05 sidecar integrity mechanism remains retained.

## 3. Publication state machine (design obligations, no claimed atomic implementation)

There is **no demonstrated atomic transaction across SQLite and sidecar artifacts**. `durableTransaction` proves its own ACK contract only. File rename followed by failed directory fsync can leave durable outcome uncertain. The state machine below specifies what a proposed implementation must prove, not a runnable algorithm.

Operation identity: server-validated opID, stable keyID, expected current bindingVersion, target next version, old/new fingerprints, canonical bounded request hash, server actor, reason and durable stage/result. No raw new secret in journal/audit/status. New secret remains only in existing credential storage and one successful authenticated no-store mutation response; precise adapter secret handling/migration still requires review. Operation result replay must be immutable, not a projection of latest unrelated version.

| Stage / cut | Required durable fact and authority | Allowed outcome / recovery |
|---|---|---|
| R0 preflight | Active original ID/current version, unretired secret, healthy owner, exact request/actor, opID replay checked, policy/history captured | Conflict/unknown/unhealthy refuses without mutation; exact prior op replay is status only, no new secret or mutation |
| R1 fence acquired/ACK | Durable opID+expected version fence visible to every dispatch/CRUD/import/restore reader before binding can change | No stale final dispatch or competing rotation; failed/ambiguous fence publication yields no success/no secret; cannot assume rollback |
| R2 SQLite publication/ACK | One durable CAS changes active secret/current binding/version and appends immutable rotation operation/audit; policy/ledger/history unchanged | Lost DB ACK cannot be reconstructed from row existence. Keep fence and health exclusion; no client success or successor authority |
| R3 sidecar publication/ACK | Monotonic revoked-fingerprint record scoped separately from ID retirement, operation/version linkage matches DB | Mismatch/missing/uncertain publication remains fenced; previous key cannot regain authority via stale process/import/old backup |
| R4 coherent release/ACK | Required DB+sidecar+owner proofs fresh, operation immutable completed result, fence release durable and enforced | Only after this own acknowledgment may response expose generated secret and new dispatch authority be issued. Terminal settlement of already exposed attempts has separate retained sink |
| Response lost after R4 | Rotation remains committed, previous secret revoked, new secret current though caller may not possess it | Retry same opID returns nonsecret completed/version status. Admin may explicitly issue another fresh authorized CAS rotation without possessing undelivered secret; never automatically rotate on retry/roll back |
| Process death at R1–R3 | Exclusive new owner + complete operation stage/artifact facts required | No live-owner timeout, no adopting stored row as original ACK; deterministic recovery must finish/retain fence or refuse. Ambiguous state requires bounded management error, no raw DB-console fix assumed |
| Delete/retire/restore overlap | Same writer/version/fence serialization and ID retirement history | Never resurrect ID or alias cost/history to another key. Restore/import cannot skip rotation fence/generation consistency |

**Required enforcement sites:** server identity extraction, new admission capability creation and actual final pre-POST gate; refresh/retry/account successor gate; API-key create/update/delete/rotation; JSON import and legacy migration; backup creation/file restore startup validation; binding initialization and persisted authority reader; owner acquisition/close; sidecar maintenance/reconcile; unresolved recovery authorization where it can clear an affected block. A stale process with cached credentials must fail fresh owner/generation/fence validation. Already exposed attempts may settle original key/price/window after rotation without fresh dispatch permission. Whether and how settlement can proceed while fence is held must be proven, not silently globally blocked.

### Crash/restore boundary that remains a hard blocker

If fencing is only RAM or only a mutable current DB row, an old restored DB may authorize old secret. If fencing is only sidecar with no validated DB linkage, DB+sidecar can diverge. Neither “write sidecar first” nor “put it in a SQLite transaction” alone proves multi-artifact safety. Need explicit schema+operation journal, immutable rollback-detection inputs and recovery rules within retained restore guarantee. If scope requires detecting coordinated rollback of all artifacts, identify an external trusted monotonic source or seek an explicit disposition; none is authorized or introduced here. Do not sell branch rollback as state rollback.

## 4. Durability/driver comparison and smaller alternatives

P driver acquires owner before migration, limits fallback to positively unavailable engines, validates artifacts before writable PRAGMAs in factories, uses exact adapter object, binds coverage+identity, installs lifecycle and health gates. M driver catches broad engine/factory errors and may try another adapter after errors; it also returns a copied wrapper object. Whole P driver import pulls global persistence behavior; whole M retention misses these safety invariants for accounting.

P coordinator is one lane per adapter, bounded commands/results and group ACK, health poison and stop. It captures first apply callback per adapter; do not attach a second recovery/rotation service with a conflicting callback to reuse same WeakMap lane. Need admitted command ownership/serialization and synchronous publication boundaries. No “stop writes then recover peer” on a live lane.

P native WAL/FULL outermost durable publication and SQL.js atomic-fsync export have distinct uncertain-ACK paths. P persisted authority can expose a read-only persisted snapshot under selected recording failures; D03 removes permission for accounting-controlled continuation, not authority safety used for other validation/backup. Do not delete this dependency merely because unlimited degraded dispatch is no longer allowed; compare every caller first.

Alternatives:

1. Port one ledger repository + master adapter unchanged: **not admitted**; no own durable ACK/factory ownership/sidecar safety.
2. Whole donor DB/driver/service restore: **not admitted**; broad global closure, ordinary/platform/migration behavior and retirement model not rotation-ready.
3. Selective foundation DAG with existing adapter families and retained sidecar, targeted master lifecycle/adapters/schema integration, then missing production admission+rotation protocol: **candidate**, still dependent on every node's body/caller/migration/test record. JSON register enumerates nodes and review gaps. Do not rewrite a parallel persistence engine.
4. Pure money/window helpers independently: potentially bounded but not a delivered vertical slice or permission to enable finite management; needs exact donor tests, imports and reviewed sandbox command first. No helper runtime port admitted by this increment.

## 5. Proposed verification contract (not executed)

Selector labels below are design identifiers, **not existing test names or a launch manifest**. Map each to exact existing/new test body after per-file admission; no broad suite or fixture-as-producer proof.

- S-AUTH-01: missing/expired/invalid-signature/session authenticated absent/false/wrong-type → no mutation; extra irrelevant claims do not forge authority.
- S-AUTH-02: password/OIDC/SAML verified sessions share generic actor label; body actor/key association spoof rejected; no raw JWT/email in audit/error/status.
- S-CSRF-01: Host/Origin mismatch, cross-site, invalid forwarding/provenance, direct Next normalization and configured proxy origin; existing ordinary routes preserved.
- R-CAS-01: concurrent same-ID rotations, stale generation, opID replay/conflict and stable immutable nonsecret result; no second rotation on retry.
- R-CUT-01..05: process cut/fault before/after each fence/DB/sidecar/release/response boundary, including failed directory fsync and lost ACK after a visible row.
- R-OWNER-01: competing owner/PID reuse/close failure, stale cached process/final gate, no live peer reclassification.
- R-LATE-01: already exposed attempt valid late evidence debits original key/window/tariff after rotate/delete; fence cannot turn unknown into zero.
- R-RESTORE-01: old DB/current sidecar and current DB/old sidecar, missing journal/fence/binding, import omitted accounting, old-secret resurrection, new active-ID revocation vs ID retirement; coordinated rollback limitation stated, not tested as supported without source of truth.
- R-CAP-01: sidecar/receipt capacity exhaustion fail closed before unsafe mutation, no eviction or lost history; restart/backup/protected policy-spend parity.
- R-DELIVERY-01: response lost after durable completion; status never exposes secret; second explicit CAS rotates/revokes lost current secret while preserving stable ID/policy/history, no required possession of old secret.
- D-ACK-01: adapter-specific before/after durable publication faults, no native factory fallback after opening data, no poisoned RAM export; no accounting unlimited continuation under D03.

## 6. Readiness verdict / next finite input

**Runtime rotation blocked pending demonstrated fencing, recovery and restore/rollback protection.** Generic actor design no longer waits for invented per-user identity; its authorization and CSRF implementation/tests still require admission. Exact claims/sidecar facts above are bounded static reads, not general security certification.

Phase01 can advance by comparing remaining DAG nodes (native factories, persisted request authority callers, import/backup/migration orchestration, pricing and service command ownership) and mapping exact safe test bodies. Positive C0 remains blocked under previously recorded P1–P4; those gates were not re-proven or researched here. D05/D06 and A1 exact sandbox requirements unchanged. No call to production services, real data, provider endpoints, build/test or activation is implied.
