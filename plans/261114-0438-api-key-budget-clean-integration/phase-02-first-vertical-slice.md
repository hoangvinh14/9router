# Phase 02 — First real vertical slice

Status: completed / nghiệm thu offline cho C0 Messages JSON trên Docker nội bộ.

### Resume — dashboard budget readback

The internal Docker Messages JSON path has reached offline acceptance on existing SQLite. The companion backed up an ordinary database, and the packaged app saved the first budget for the existing key, read back zero spend, recorded one exact debit over TLS loopback and refused the next request at the limit before and after restart. [Packaged acceptance and image manifest](./phase-04-integrity-and-migration.md#success-evidence). Phase 03 tracks the remaining provider and transport scope.

## Outcome / không oversell milestone

Một representative authenticated client set finite key budget bằng **shipping management route/UI**, gọi native cell C0 qua existing shipping ingress/router/core/executor/raw transport, debit durable original key một lần, rồi request kế tiếp bị từ chối **0 upstream inference POST** khi recorded spend >= limit. Test chạy dummy TLS local trong disposable instance; không thay fixture-association test thành production wiring. Đây là milestone đầu, không chứng nhận toàn bộ Codex/Claude hoặc production rollout.

## Files — selective create/adapt

Tất cả paths relative root `/home/gmo/projects/9router`; exact hunks/dependencies phải được phase01 admit.

- C/A selected `src/lib/accounting/{exact-money,budget-policy,budget-windows,budget-gate,budget-projection,budget-errors,attempt-payload,service,write-coordinator}.js` và selected pricing resolver/snapshot dependencies.
- C/A `src/lib/db/repos/api-key-accounting-repo.js`, policy/key-binding helpers, schema/migrations/driver/adapters/durable publication/writer ownership **chỉ admitted closure**. Durability/identity/idempotency thực thi ngay cho first slice, không defer foundation qua phase04.
- A `src/lib/accounting/budget-management.js`; C/A `src/app/api/keys/[id]/budget/route.js`, `src/shared/components/ApiKeyBudgetPanel.js`, `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`, management auth/trusted-peer/key CRUD/CLI compatibility hunks nếu cần. Minimal unresolved-recovery API/UI và verified same-ID rotation operation được phase01 admit với exact paths/actions (planned-new seams, không existing endpoint claim); reuse service/repo, không second ledger/recovery service.
- A `src/sse/services/{keyAccess,chat-accounting}.js`, `src/sse/handlers/chat.js`, optional new `budget-admission.js` nếu phase01 chọn; C/A selected native usage/wire/price modules của C0, transport/raw-owner and core consumers. M `proxyFetch`/Base upstream changes giữ nguyên trừ exact accounted-path adaptations.
- C tests dự kiến `tests/unit/budget-{production-admission,shipping-vertical,route-coverage}.test.js`, reuse selected donor helper/ledger/security/native loopback fixtures. Không import collectors/captures.

<!-- Updated: Validation Session 1 - minimum shipping unresolved recovery, D03 and same-ID rotation -->

## Implementation sequence (future authorized)

1. Test-first helper/core invariants: exact money + HCM windows, independent weekly/monthly limit, intent not reservation, same-key final gate, duplicate/conflict, original key/price/start. Port/adapt helpers và minimum durable ledger/identity closure đã review, không generate second ledger.
2. Thêm schema budget vào SQLite hiện có bằng thay đổi additive trên bản sao sandbox. Giữ nguyên API key, cấu hình và dữ liệu hiện có của 9Router. Khi bật budget cho key, bắt đầu sổ chi phí từ 0 và ghi các request được hỗ trợ kể từ lúc đó.
3. Wire **server-owned recognized key admission** at reachable endpoints even for unrestricted ACL, attach request lifecycle from actual auth+policy. Fixture helpers remain isolated. Persisted finite policy cannot ordinary-fallback if accounting unavailable. Unsupported endpoints/compositions refuse before initial provider/helper POST.
4. Adapt C0 existing native transport and **one raw owner** before translation. Every actual POST needs own durable intent ACK + fresh final gate; no original implicit replay/peeker may dispatch under already-consumed permission. Counter/price proof applies to actual effective wire. Refuse unproven transport/premium/request fields before transform/prefetch.
5. Settle valid exact usage using original context; retained terminal sink survives request disposal but cannot dispatch. Hold successful final protocol completion until required settlement own ACK; errors remain errors. Valid cost known from failure also counted when evidence supports; unknown classifications follow approved D policy, not default zero.
6. Management guard auth before parsing/body/privileged access; bounded JSON/no-store/same-origin/CSRF/CAS. Finite-save readiness comes from installed server coverage+health, not fixture lifetime or client flags. Save+GET+UI reload returns original ID, exact recorded/reference spend, remaining, week/month reset Asia/Ho_Chi_Minh and health/eligibility states.
7. Panel labels reference USD vs subscription invoice, not provider quota; initial ledger coverage timestamp and may-undercount truthful. Show budget exhausted/unknown/unpriced/storage-unhealthy/stale-draft states separately. No plaintext key newly exposed to accounting UI/history; keep ordinary existing key management behavior.
8. Implement minimal shipping **unresolved-only** admin recovery: authenticated actor/CSRF, bounded reason/evidence, operationId idempotency, expectedVersion CAS, original snapshot retained, truthful operator adjustment/waiver labels; retry/reload UI with conflict handling. B1/E2 unrecorded remains may-undercount outside required manual recovery; normal missing/malformed cannot become unrecorded. Startup recovery needs exclusive writer/retired-owner proof, never live-attempt timeout.
9. Implement verified same-ID secret rotation under admitted binding protocol: preserve policy/spend/history, reject stale/conflicting/unauthorized rotation, revoke old secret authority, no plaintext secret in accounting records. D03 fail-closed applies even to unlimited accounting-controlled keys; remove only dedicated degraded continuation after dependency review, not durable safety.
10. Review diff closure and security before commit; record per-slice SHA/tests and ordinary-key controls. No production enable/deploy/real upstream call.

## Acceptance / concrete oracles

- Authenticated shipping PUT budget and UI save succeed in disposable server for eligible installed C0; unauthorized/cross-origin malformed/oversized requests fail before mutation. Concurrent stale expectedVersion returns conflict, not overwrite.
- With finite limit L and known exact priced dummy usage cost L: first actual TLS POST count **1**, one original-key attempt, frozen price/start period, durable exact debit **L**; next actual request via same public URL/header has POST count delta **0**, no additional cost, stable budget error. GET/UI shows spent L, remaining 0, correct reset; no fixture association used on shipping request.
- Same loop with `0` budget → **0 POST** at first request; below L admitted; weekly OR monthly exhaustion blocks independently. Existing in-flight costs may exceed L, no reservation.
- SSE + JSON client behavior applicable to C0, not fake direct service calls only. Database inspection confined to disposable DB; reopen persisted policy/spend after process restart and reject next POST.
- Client spoofed key ID/account header/body does not debit different key; budget key over alternate route/key-extraction spelling cannot bypass. Ordinary key/no-key paths retain auth/routing; inference API key cannot administer budget.
- Missing price → **0 POST**; normal missing/malformed/conflicting usage after actual POST → unresolved/NULL, safe error and blocked key, never false free success. Valid known cost cannot be erased by conflicting callback. Authorized recovery updates exact unresolved version once with immutable audit; unauthorized/CSRF/stale/duplicate-conflict attempts do not mutate. Unrecorded B1/E2 is a separate may-undercount case, not automatically zero or manual recovery debt.
- Storage intent/terminal ACK failures → no unauthorized successor for finite **or unlimited accounting-controlled** keys. Verified same-ID rotation preserves old spend/policy, old secret cannot dispatch, concurrent failed rotation cannot half-rebind. No creds in response/errors/fixture output.

## Stop

Any selected P evidence/decision missing, unsupported route falling ordinary, hidden POST, second raw owner, global ordinary regression, undurable “ACK”, unbounded dependency closure or real filesystem/network exposure: keep production readiness OFF, stop affected slice. A safe negative fixture does not fulfill positive native target.
