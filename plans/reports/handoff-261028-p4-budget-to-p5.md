# P4 → P5 constraints and operational handoff

This handoff is not production activation authority. P4 final acceptance is recorded separately; P5 must not infer broader coverage from fixture successes.

## Public management contract

- Key CRUD and `/api/keys/:id/budget` use the shared dashboard management guard: verified dashboard session, or existing verified direct-loopback/login-disabled conditions. Mutations retain Origin/CSRF/authority checks. Inference API keys and CLI tokens do not authorize management.
- GET returns exact decimal-string current/previous window projection, identity/status/version, health/coverage, and explicit enforcement readiness. No key/provider credential or internal fingerprint is part of the budget response.
- PUT fully replaces `{weeklyLimitUsd,monthlyLimitUsd,expectedVersion}`. Each amount is a plain decimal string or null; null unlimited, zero blocking. Limits obey the existing safe nanoUSD policy bound. No extra fields, floats, implicit defaults, upsert or spend reset. Atomic durable CAS; unchanged policy preserves version.
- Production finite PUT409 `accounting_not_ready`. Healthy active retained identity/current version can save null/null. Maintenance prevents all writes; inactive/retired identity is read-only. Historical tombstone reads do not resurrect keys.
- CLI management sessions are memory-only and exact-origin, no redirects or token exemption; background reads never prompt. Explicit `connect --password` retains argv/history exposure; prefer interactive password prompt.

## Accounting and recovery invariants

- One SQLite writer per DATA_DIR and coverage sidecar identity are mandatory. Never force-orphan a live owner. Restore/copy rules remain in `docs/DB-SAFETY.md`.
- Per-attempt immutable `startedAt` attributes money to fixed Asia/Ho_Chi_Minh Monday/month windows. Original price snapshot and terminal receipt survive policy changes/reset. No cron/counter reset.
- Finite budgets are soft recorded-spend thresholds, not reservations/hard invoice caps. Multiple admitted in-flight attempts can overshoot without a one-request bound. Both windows apply; zero does not automatically reopen on reset.
- Every unresolved attempt in the recording lifetime blocks finite admission, including old windows and restart. Pending from a verified dead owner recovers to unresolved before service. Unknown cost remains null, never zero.
- Null/null continuation does not clear unknown/history. Existing recording-failure continuation requires private persisted identity plus the independent own coverage-gap ACK; ordinary poisoned reads stay blocked.
- Internal audited CAS resolver supports waiver/exact/correction primitives. P4 tests use these only inside disposable fixtures; P5 still owns public recovery UX, authorization/audit policy and physical restore workflows. No fake clear-unknown/reset-spend button exists.
- Local budget error identity is private provenance, not upstream codes/headers. Native429/503 metadata/no-store/requestId/CORS is preserved; selected own-terminal ACK failure cannot emit false SSE finish/DONE.

## UI freshness and conflicts

Budget state is per-key and separate from ACL/toggle updates. Dirty refresh never silently rebases its original CAS version. Conflicts and ambiguous committed-write/lost-reply outcomes require explicit review/reconciliation. A failed read or pending refresh makes allowance/current health unknown; editing or locally reloading a draft is not a freshness event. Only owned successful coherent API projections restore freshness. Late responses from removed keys must not mutate another editor.

## Coverage and release blockers

- Accepted execution scope is only selected `openai-chat-explicit-details`, Node SQLite/SQL.js on Linux. Broader compatible providers/protocols/fusion and Bun/better/Windows parity remain unvalidated owners.
- Private fixture associations are exact-Request WeakMaps with no shipping caller; no request/header/body/environment/setting activates production. No `ledgerStartedAt` activation stamp is manufactured.
- Hybrid compiled UI + actual Next source-route lifecycle is distinct from detached production standalone testing. Preserve this separation in future evidence.
- Performance initial1920 requests showed material signal; ABBA480-request review documents +6.26% diagnostic summed elapsed and roughly+7–11% finite cells, with variability. No capacity/SLO/upper-bound claim. See `verification-261028-p4-performance-review.md`; do not activate or introduce caches from this result.
- Full-suite baseline remains red (51 failures in each final paired CI run, including missing suite dependencies). No newly unexplained failure observed after ordered exact-base controls; this is not an all-green certification.
- Endpoint retains5 exact-base hook lint errors/2 warnings, explicitly documented and session-deferred, not suppressed in source. Some active LSP probes timed out; timeouts are inconclusive.
- Advisor disclosure provided filename summaries rather than source bodies in final review requests. Do not represent this as an independent full-source audit.

## Next authorized owner

P5 needs a separately executable plan and authorization for recovery/restore UX and release prerequisites. X1–X6/R remain open. P4 execution does not authorize commit, push, merge, deployment or production activation.
