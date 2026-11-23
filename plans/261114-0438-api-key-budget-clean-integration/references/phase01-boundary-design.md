# Phase01 — bounded boundary design, not runtime admission

Status: **partial / producer-gated**. Baseline M `1855aa44473e88feac9d3f131b9c0c5fc9706b68`; donor P `7a4f3a3e43dc738d0406e6ab1658db02b8df7ff2`. No eligible C0 selected; phase02 positive blocked. No repeated public audit/research or fixture-to-producer eligibility upgrade.

## Evidence reviewed and source gaps

Fresh bodies: M `src/sse/services/keyAccess.js`, `src/dashboardGuard.js`, `src/lib/db/repos/apiKeysRepo.js`, key item route, `src/lib/db/index.js` export/import, `src/lib/db/backup.js`, all 24 route modules under `src/app/api/{v1,v1beta}`, `next.config.mjs`. P bodies: `accounting/service.js`, `db/helpers/api-key-bindings.js`, `db/repos/api-key-accounting-repo.js`; management/errors extracted as candidates but not fully admitted. No entire donor core restored. These reads support the observations below, **not** transitive dispatch/body/import/startup/transport closure. Source hashes recorded in [static manifest](./phase01-static-manifest.json).

## Stable identity and shared admission — design requirement

M `getKeyAccessContext` intentionally returns null for unrestricted/unknown/no-key: ACL result cannot be accounting authority. M `getApiKeyByKey` returns row regardless active status; admission must independently require active row and valid retained binding/policy. Header precedence is Bearer → x-api-key → x-goog-api-key → query key, identical to existing guard. Never merge identities from multiple spellings; test conflicting headers and repeated query values. An invalid/inactive presented key must not become ordinary because ACL context is null, localhost or CLI-token access passes middleware, or `requireApiKey` is false.

Proposed shared server boundary: resolve identity+policy from presented secret at authoritative public ingress **before** route/helper/network work. Internal immutable admission capability carries stable ID, binding generation, policy/coverage version and allowed exact route/profile; client ID/headers/env flags cannot construct it. Reconstruction (compact/Gemini) either receives explicitly propagated server capability through a private association or refuses before reconstruction. Default unknown billable route for an accounting-controlled key refuses; ordinary/no-key path remains existing behavior only when positively classified independent. Recognized identity with missing/unreadable policy/coverage never defaults ordinary/unlimited. Do not implement a blanket global transport hook on ordinary requests.

Need before admission: choose exact shared placement respecting Next rewrite/proxy runtime and direct route/core callers; enumerate all callsites and prove alternate public/helper invocations cannot skip it. `dashboardGuard` currently allows local/CLI public access and has no accounting capability; middleware-only design is not enough. No new source module/name is admitted yet.

## Route-boundary inventory (fresh route bodies; not transitive closure)

All `/api/v1/...` entries also reachable through `/v1/...` and `/v1/v1/...`; `/api/v1` re-exports models. Rewrites additionally `/responses`, `/codex/:path*` → Responses; `/systemone` → Systemone; `/v1beta` aliases. Root `/systemone` differs from public-prefix list in dashboard guard: actual middleware+rewrite auth tests required, not presumed equivalent.

| Route module suffix | Observed dispatch/side effect | Budget design disposition; status |
|---|---|---|
| `chat/completions`, `messages`, `responses` POST | init translators → handleChat | Candidate C1–C3 only with exact accepted cell, otherwise early refusal. HandleChat/helper/transitive closure pending |
| `api/chat` POST | clone+parse → handleChat → Ollama output transform | Refuse initially before dispatch; not silently an accepted client output |
| `responses/compact` POST | parse, `_compact`, **new Request**, handleChat | Refuse before reconstruction; ordinary compact retained |
| `embeddings`, `images/generations`, `audio/speech`, `audio/transcriptions`, `search`, `web/fetch`, `systemone` POST | Separate modality handlers | C5/C6 early refusal before handler side effects; handler/core/adapter callers pending body review |
| `videos/{generations,edits,extensions}` POST; `videos/[id]` GET | handleVideoCreate / handleVideoGet | Refuse pending accounting/job ownership/network proof; polling is not assumed free/local |
| `audio/voices` GET | listTtsVoices or **server self-fetch** to media-provider routes | Not a safe static-control exemption. Refuse until branch-specific no-billable/no-refresh proof |
| `models`, `models/[...model]`, base v1 GET | buildModelsList, dynamic compatible GETs/live resolvers, possible credential refresh/update | Not local-only metadata: early budget refusal until a reviewed no-network projection is admitted; client internal-models-fetch header skips only some fetches, not authority |
| `models/info` GET | local registry lookup/body, no fetch in route | Candidate local-control allow after import/startup/auth/ACL review, not currently certified |
| `messages/count_tokens` POST | recursive local char estimate/4, no imports/network in module | Candidate local-control allow (estimate only, **not accounting usage**); body/size/depth/auth tests needed |
| v1beta `models` GET | local model registry enumeration | Candidate local-control allow after import/ACL proof |
| v1beta `models/[...path]` POST | Gemini conversion → **new Request** → handleChat **or native TTS direct fetch/retry/account loop** | Refuse entire path before parse/convert/native credential work; required future cells need independent evidence |
| OPTIONS | local CORS response in bodies | Nonbillable candidate; auth/method/alias cases retained in matrix |

No handler/core/executor/transport closure or zero-POST oracle has executed. This table intentionally refuses to label models/voices/video GET as free by name. A newly added route must default fail-closed under accounting admission; exact interception architecture remains OPEN.

## ACK and money state contract (retained design, not new engine)

P service already binds internal context/receipt in WeakMaps, durable intent, consume-once dispatch receipt, fresh `authorize` and per-attempt terminal. Retain one ledger and actual raw owner; no second reader/tee. App integrations must preserve these invariants through transport/header mutation and every actual POST/replay.

| State/event | Required transition |
|---|---|
| Before exposure; identity/price/storage/coverage unknown | refuse, 0 POST; if durable intent exists, not_dispatched only with evidence |
| Intent durable transaction committed, own ACK lost | no permission from row visibility; no POST/successor; reconcile authoritative health, do not invent ACK |
| Own intent ACK → final fresh gate | active binding generation/policy/ACL/credential/URL/proxy/price/calendar+current recorded spend checked at actual dispatch; consume once |
| Same-key concurrent preadmitted requests | no reservation; may overshoot; peer settled before final successor gate must be included |
| Valid exact usage (including applicable failed/late evidence) | original attempt/key/reference snapshot/HCM startedAt period debit once, own terminal ACK before successor |
| Same valid terminal replay | idempotent; conflicting evidence audit, preserve known spend, never NULL/zero replace |
| Normal/error missing/malformed/contradictory evidence | unresolved NULL, block key, minimum admin resolution; not B1/E2 unrecorded |
| Interrupted exposed with absent evidence | unrecorded NULL / may-undercount under accepted B1/E2, not free/zero; known health fault still blocks |
| Storage unhealthy, finite **or unlimited accounting-controlled** | D03 fail closed; ordinary only if truly independent |
| Past-owner startup / final-close recovery | exclusive ownership / stopped write lane before reclassification; never timeout live peer |

P `resolveAttemptSync` exists but does not supply a shipping route, server actor, durable publication UI or safety around binding generations. P dependencies still include coordinator/durableFile/coverage/sidecar/lifecycle; D05 replacement not approved. No DB-centric rewrite or stripped safety layer is admitted by this record.

## Bounded recovery protocol candidate (D01/D02 approved, detailed protocol pending implementation admission)

Proposed endpoint: `POST /api/keys/:id/budget/attempts/:attemptId/resolve`; corresponding no-store management GET returns redacted unresolved attempts/version only. Not an existing M endpoint. Strong management session required regardless `requireLogin=false`; existing generic dashboard guard/local inference key/CLI token alone is not admin authority. Reuse reviewed management auth+CSRF/trusted-peer guard only after closure review. Actor is server-derived authenticated principal, never request actor.

Request is exact bounded JSON: operationId, expectedVersion, action, reason, evidence and action-specific payload. Proposed bounds reuse P: operation/reason <=512 chars, evidence <=4000, overall body <=16KiB UTF-8; reject unknown fields, oversized/negative/noninteger versions, malformed money/usage. Recovery actions are `waive` and `cost_correction`. The UI labels both as operator resolutions. The upstream supplies token counts. `cost_correction` accepts a canonical nonnegative nanoUSD string. `waive` records an audited zero adjustment and preserves the original evidence. Preserve original known spend when conflict exists; such correction path needs separate comparison before admission.

Single durable audited CAS transaction; only unresolved state of that stable key, never pending/live, settled, retired-ID reassignment or B1/E2 unrecorded. Exact replay with same operation/key/attempt/canonical payload returns original operation result, not a new resolution; changed payload or foreign attempt operationID collision →409. Lost response reloads by opID/version, never optimistic clearing. Proposed HTTP:401 session,403 CSRF,404 inaccessible key/attempt,409 version/state/replay conflict,413 body bound,400 schema,503 unhealthy durability. All no-store, secret-safe error messages; durable ACK must precede success. Minimal UI reason/evidence/action confirmation/reload conflict required phase02; no DB-console recovery.

Freeze final path/body/status selectors only with auth/DB/management body/dependency review. These candidates are implementation design, not additional product waiver or functioning endpoint.

## Same-ID rotation candidate (D04)

M item PUT does not accept `key`; repository update can change it. P binding validator deliberately rejects changed fingerprint, secret reuse and retired IDs. Do **not** bypass it or claim current update implements rotation.

Proposed dedicated `POST /api/keys/:id/rotate` management-auth+CSRF; server generates new secret, stable key ID retained. Request opID, expected bindingVersion, bounded reason; active original ID/version required. A serialized durable operation atomically updates active secret/fingerprint+generation, retains revoked fingerprint tombstone/history and immutable spend/policy. No partial publication before durable ACK; stale capability/final dispatch must fail generation check. Already exposed attempts can settle under original context, not regain dispatch. Concurrent rotation wins once/CAS conflict; old secret permanently unauthorized; no alias transfer. Delete retires ID/binding/history, rename preserves all money. No reuse/purge deadline invented.

Exact secret-delivery/lost-ACK protocol remains OPEN: encrypted short-lived single-fetch response vs redelivery without persisted plaintext needs comparison, audit/privacy and storage/migration design. Do not claim idempotent secret retrieval is solved by operation ID alone. This gap blocks shipping rotation admission, not a reason to relax same-ID requirement.

### Concrete persistence consumers requiring closure

M `apiKeysRepo`: create/update/delete/validate and key lookup; item route PUT/DELETE, list/create route; `db/index.js` export serializes secrets and import **deletes/replaces apiKeys**; migrate legacy import; SQLite backupLite copies all tables except requestDetails but no sidecar proof; manual file restore and pruning semantics. Also cloud/sync/CLI consumers need full caller inventory before admission. Existing API export fields are not permission to expose secrets in new budget ledger/UI. Plain master import cannot reset/rebind known accounting identity/spend; reject incompatible import before transaction until explicit verified atomic protocol exists. D05 sidecar retain/tombstone/generation backup/restore remains retained, migration rollback is not branch rollback.

## Independent next work / blockers

- [Support manifest](./phase01-support-manifest.json): no eligible cell; exact six Codex IDs individually blocked, C2/C3 exact model/auth list incomplete. P1–P4 named new evidence required, no repeated public campaign/live calls.
- Full handler/helper/core/executor/transport/retry/import/management dependency closure and per-file admission remain OPEN. Selected route modules alone do not finish phase01.
- D05 retained mechanism until approved equivalent; D06 transport exclusions not approved as permanent scope cut. No positive direct/CONNECT/proxy class certified.
- Sandbox A1 exact reviewed runner+commands/isolation before any explicit app import/test/build. No explicit runtime test/build/inference invoked; automatic pi-lens TypeScript LSP/typingsInstaller helpers appeared while reading source and may maintain global cache metadata. This is not an assurance of zero incidental cache effects. No application/private DB imported by the explicit commands.
- Stop positive phase02; next finite static task is selected-path closure for server admission placement + management auth/CSRF guard + key CRUD/import/backup/rotation binding lifecycle, comparing exact M and P symbols/imports before any port. Then actual dispatch/replay boundary closure. Do not recook historical evidence or duplicate donor engine.
