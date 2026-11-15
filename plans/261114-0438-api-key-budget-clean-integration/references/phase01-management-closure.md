# Phase01 — selected management/identity closure comparison

**Partial static design; not port/admission approval.** M `1855aa44473e88feac9d3f131b9c0c5fc9706b68`, P `7a4f3a3e43dc738d0406e6ab1658db02b8df7ff2`. This named increment follows initial route/retry inventory, not a repeat audit. No explicit app import/test/build/inference executed.

## Fresh body evidence and concrete mismatches

| Exact body | Observation / integration decision |
|---|---|
| M `src/lib/auth/dashboardSession.js` | JWT verification/session helper exists, but module calls loadJwtSecret at import and can read/create DATA_DIR jwt-secret. **Never import on host for tests.** `verifyDashboardAuthToken` only verifies signature; donor management guard checks `session.authenticated === true`. Reuse session primitive after sandbox/claims review, not generic ACL result |
| M `src/lib/auth/trustedPeer.js`, `custom-server.js` | Per-process token stamps socket-derived real IP; wrapper strips/replaces real-ip/peer-token/via-proxy and strips XFF; preserve this. M does **not** strip/stamp donor `x-9r-authority-forwarded` and `x-9r-socket-proto` provenance fields |
| P `src/lib/auth/managementGuard.js` | Exact Origin/Host/protocol/Next-loopback normalization checks, CSRF no-store errors; **allows direct-local requireLogin=false without authenticated JWT** and actor becomes `local-management`. Cannot import unchanged for newly proposed strict unresolved/rotation session requirement. Other actor is only `dashboard-session`, not stable per-user principal |
| P `custom-server.js` wrapped request block | Adds deletion/stamping of both provenance fields from original forwarding presence and socket encryption. This is an auth dependency of guard loopback normalization. Copying guard alone onto M would trust fields M leaves client-supplied or reject legitimate normalized requests; do not certify auth from guard unit name |
| P `src/app/api/keys/[id]/budget/route.js` | Guard + params/body bounded4KiB + fixture capture WeakMap; finite management route is not shipping readiness. Reuse bounded parser/error patterns only after production association and strict guard design, not full route restore |
| P `cli/src/cli/api/managementSession.js` | In-memory exact-origin cookie, Origin for mutations, redirects refused, generation invalidation and bounded responses. No CLI/inference-token bypass. Potential reuse for future budget CLI only; CLI budget surface not auto-added to milestone |
| M `cli/src/cli/api/client.js` selected makeRequest prefix | Ordinary client sends machine-derived CLI token and may create/read host auth files when called. It is not management-session actor; do not use it to authorize new budget recovery/rotation, and do not execute host client |
| M `src/app/api/settings/database/route.js` | Existing password reauth except presence of CLI header, relies on upstream ALWAYS_PROTECTED validation. New budget write design must not copy header-presence authority into recovery. Import applies outbound proxy env after transaction. This is a scoped dependency warning, **not a tested exploit/general audit** |
| P `db/durableFile.js` | fsync-file → rename → directory fsync; postrename failure uncertain ACK, not rollback. Managed sync SQL/read surface. Preserve uncertainty semantics; visible row cannot supply lost own ACK |
| P `db/writerOwnership.js` | Exclusive cooperative acquisition gate and incarnation/boot evidence; ambiguous owner/non-Linux/PID reuse fail closed/operator recovery; only adapter-close owns claimed lease release. Cannot remove for smaller file count; platform applicability still open |

## Bounded dependency DAG / choices

Proposed control route → strict management guard → dashboard session + trusted peer + canonical authority/Origin → bounded body → production accounting service → write coordinator/durable transaction → binding/policy/ledger/audit/coverage-sidecar + writer lifetime. Response only after own durable ACK. Each arrow still needs exact implementation/body/caller tests; this diagram does not admit entire DAG automatically.

Three guard alternatives compared:

1. Whole donor guard unchanged: smaller diff, but retains local no-login exception and coarse actor; violates proposed strict new recovery/rotation boundary. **Not selected**.
2. Reuse donor canonical authority+CSRF functions and M session primitive; explicit strict-session mode for new sensitive routes, no local/CLI bypass; targeted M wrapper provenance adaptation with spoof/normalization tests. **Preferred candidate**, contingent on full packaging/proxy/session claims closure. No second auth system.
3. New independent JWT/login/guard engine: duplicates existing signing/secret/principal semantics and expands risk. **Not admitted**.

Do not modify ordinary dashboard-wide `requireLogin=false` behavior merely to secure new endpoints; strict gate is route-specific. Actor binding must be server-authenticated. Existing local password sessions may have no user ID: design a stable audit actor schema from verified session claims/session identifier, avoid token/raw email/secret logging. Exact actor/revocation/session-rotation behavior remains OPEN, not invent an unverified user ID.

`custom-server` adaptation must retain current upstream h2c handling/background-refresh behavior and XFF security. Only named header provenance hunks are candidates; `next dev` lacks trustworthy socket proof and cannot be used as shipping security parity. No global config change or host restart.

## Rotation publication/lost-ACK alternatives

Need atomic same-ID secret/bindingVersion change, revoked-fingerprint history and preserved ledger/policy. P validator rejects mismatched fingerprints by design; new dedicated rotation operation must update invariant representations, not skip validation. Existing one-current-binding schema/retired-ID sidecar does not automatically support a history of old secrets for an otherwise-active ID. Schema/sidecar/backup/restore migration must distinguish revoked **fingerprint** from retired **ID**, or same-ID rotation could retire the live key inadvertently.

- Persist plaintext replay response: easy retry but adds new secret copies/audit exposure. **Not admitted**.
- Return new secret once after durable ACK; on lost response, opID status exposes only completion/version, never secret; authenticated admin can CAS another rotation of the current stable ID to obtain a fresh secret. Each operation durable+audited; previous secret revoked when first rotation commits, but the undelivered new secret remains current until a subsequent rotation commits (server cannot infer receipt from response loss). The subsequent explicit rotation revokes that lost secret; policy/history untouched. **Preferred bounded candidate, still provisional**: no guarantee of recovering the same secret or uninterrupted client access; check earlier delivery guarantees before treating this as pure implementation choice. No lost-ACK rollback or silent second mutation on retry. UI must explain retry status vs explicit new rotation. Needs explicit exact idempotent response contract/tests and operator UX; no functionality claim.
- Encrypted short-lived replay envelope: solves redelivery but introduces key management/expiry/security/backup scope. **Not selected absent need/equivalence review**.

An already-presented old secret may be admitted before rotation; final dispatch rechecks generation and rejects stale authority. Requests already exposed can settle original spend after rotation/deletion without new dispatch authority. Audit operation replay must return stable operation result (not latest unrelated key state) and must never leak current/new secret on GET/status. Minimum UI permits status reload/new operation under explicit confirmation. The candidate does not change D04 or authorize deleting retained history.

## Key lifecycle/import/backup closure still required

Fresh caller search in current source finds key routes+repository, DB export/import/settings database route and CLI list/create/delete wrappers. Do not invent historical cloud/sync paths: `src/app/api/sync` absent on M; architecture docs are stale. Still review initialization/legacy migration and any generic raw SQL consumers before declaring complete caller inventory.

M `importDb` deletes/replaces keys in one DB transaction; preserving accounting requires prevalidation against retained bindings/tombstones/current money **before destructive import**, then one durable audited publication with coverage/owner semantics. Original data cannot be reset by omitted accounting fields or old backup key secrets. User did not authorize any real import/migration/backup operation. SQLite safety backup excludes only requestDetails but sidecar/owner generation coherence and legal retention are not proved by table-copy enumeration. Retain D05 mechanism until equivalent approved. No file restore/downrev binary against new DB presumed safe.

## Named next checks (no implicit execution)

- Exact session-claim/login/logout/OIDC/SAML caller read; cookie auth audience/actor and proxy normalization spec; bounded strict-session guard and wrapper test-selector design.
- Binding/history schema+coverage-sidecar retire/restore/export semantics vs rotate-activeID; migration dependency DAG and safe ACK-lost status contract.
- Write coordinator/adapter/canonical price and health-latch dependency comparison before first pure/helper or persistence hunk port.
- Server admission placement and direct helper dispatch callers remain open; selected route table is not an enforcement implementation.

Producer P gates still independently block positive C0. Static closure can continue without re-interview or live calls; runtime tests need exact reviewed sandbox/commands and no host fallback. Security findings above are bounded static integration risks, not vulnerability certification.
