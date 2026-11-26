# Phase 05 — Isolated integrated acceptance, security và handoff

Status: completed (nghiệm thu offline trong phạm vi đã chốt). Priority: P1. Depends on: phase04 và mọi required unamended support/evidence gate. Không production/live/commit-push/activation authority implicit.

<!-- Updated: Validation Session 1 - SQLite storage facts; approved recovery/rotation/storage acceptance -->

## Isolation prerequisite — trước import/test/install/build

- [ ] Review selected preserved sandbox runner code/arguments/dependency fixture copy list trước run; không chạy tooling từ `scripts/accounting` chỉ vì đã preserve. Có runner mới thì authorize exact files/commands.
- [ ] External sandbox boundary (ví dụ bwrap fail-closed pattern đã có trong historical offline runner), repo input read-only ngoài approved writable output; writable test/build copy là disposable directory, **không worktree implementation mới**. All artifacts output trong approved temp location, không dùng `.next-*` cache hiện tại.
- [ ] Disposable **HOME, XDG_CONFIG_HOME, XDG_DATA_HOME, DATA_DIR, TMPDIR**, fake test-only JWT/API secrets; no host `.env`, credentials/proxy env, `~/.9router`, captures/logs/DB, `.pi/.unipi`. `src/lib/usageDb.js` là SQLite re-export; usage/history trong `usageHistory`, logs được derive trên read, DB path từ DATA_DIR. `dataDir.js` fallback HOME/APPDATA khi configured path bị EACCES/EPERM hoặc Unix path trên Windows, có import-time directory creation. Vì vậy DATA_DIR riêng **không đủ** làm isolation; Windows runner phải có disposable APPDATA nữa. Không dựa mô tả JSON legacy đã stale trong root/architecture docs.
- [ ] Network namespace/process boundary deny external network, allow only controlled loopback dummy TLS/server+browser; no host service ports/provider refresh/real accounts. Apply to undici, native TLS/sockets, proxy CONNECT, wreq/adapters và subprocesses/background Claude CLI version fetch, không chỉ mocked fetch. Missing isolation → STOP, no host fallback.
- [ ] Import-time writes, startup jobs/pricing sync/cloud/OAuth discovery và subprocess inherits đều audited/contained. Install dependencies only exact approved workflow in disposable area, preserve root/tests lockfiles; tests independent ESM package. No `npm install`/postinstall trên host checkout theo mặc định.
- [ ] Build process tách khỏi current service/cache/env; Next build có thể startup/import modules. Browser managed fresh profile tới disposable instance, không personal profile; no focus steal/private account login.

## Test-first selectors / future command contract

Đây là commands tương lai **trong sandbox cwd** có deps đã cài, không commands đã chạy. `npx --no-install` không được download executable khi thiếu local package. `budget-*.test.js` mới là planned names, chỉ chạy sau khi tồn tại; freeze exact selector manifest, no shell glob full suite.

```bash
# From isolated <repo>/tests; root dependencies and tests deps preinstalled safely.
npx --no-install vitest run unit/accounting-exact-money.test.js unit/accounting-budget-windows.test.js unit/accounting-budget-gate.test.js
npx --no-install vitest run unit/budget-production-admission.test.js unit/budget-shipping-vertical.test.js unit/budget-route-coverage.test.js
# Select affected ordinary suites that exist on pinned master (then expand by actual touched consumers).
npx --no-install vitest run unit/proxy-keepalive-dead-socket.test.js unit/passthrough-done-sentinel.test.js unit/claude-header-forwarding.test.js unit/claude-cloaking.test.js
# Root lint only exact admitted JS paths, active LSP exact changed paths; no whole unrelated dirty tree.
# npx --no-install eslint <literal-reviewed-paths>
# Root standalone build only after isolated server/import-write gates:
# npm run build
```

Run long tests/build with background runner notification; do not poll/retry blind. Test configs exclude `*.real.test.js`/live endpoint discovery; raw suite is known not all-green. Use `tests/__baseline__/verify-no-regression.mjs` per repo convention, **prevalidate path mapping**: current master implementation uses `f.name.split('/app/')[1]`; sandbox paths khác `/app/` sẽ misclassify. Mount replica predictably `/app` hoặc implement reviewed normalized exact repo-relative-file+full-test-title comparison, never edit known-fails to absorb new regressions. Collection errors/timeouts/unexecuted selector counts need separate handling, not false pass because assertionResults empty.

Provider/alias/OAuth baseline scripts if registry/alias touched:
```bash
node tests/__baseline__/verify-providers.mjs
node tests/__baseline__/verify-alias.mjs
node tests/__baseline__/verify-oauth-urls.mjs
# After reviewed Vitest JSON exists:
node tests/__baseline__/verify-no-regression.mjs /approved-output/current-results.json
```

Command paths/exact CLI args validated in sandbox before launch; no hardcoded root `npm test`. Baseline/red classification is not waiver for an affected required safety case. Exact old named failure contexts retained; after two equivalent failures/no-progress consult Advisor, stop equivalent reruns/timeout inflation.

## Acceptance matrix (beyond helper tests)

| Surface | Required evidence |
|---|---|
| Shipping vertical C0 then C1–C4 | Actual native TLS POSTs, full ingress/core/executor/translation path, original exact durable cost+threshold **0 POST**, no fixture activation; representative actual client request shapes |
| Management HTTP | Real session vs missing/invalid session/CSRF/origin/proxy IP spoof, ACL, oversized/invalid JSON, CAS/version conflict, retired key refusal, secret-safe errors/no-store; unresolved recovery auth/bounds/audit/operation replay/CAS and verified same-ID rotation old-secret revocation, immutable original cost/history |
| UI | Actual disposable dashboard budget save/reload/spent/remaining/HCM resets, readiness/unknown/unpriced/storage errors; minimal unresolved-only recovery retry/reload/conflict and operator-adjustment provenance; B1/E2 unrecorded remains may-undercount, not false zero or required post-death recovery; reference label and overshoot/undercount disclosure, mobile/keyboard/accessibility; screenshots do not replace HTTP assertions |
| No bypass closure | Every current reachable route/alias/key header spelling, unsupported modality/composition/helpers/compact; budget refusal zero POST+debit and no provider cooldown/fallback. Newly introduced route default refusal tested |
| Retry/refresh/identity | Own ACK ordering, all-layer retry counts, no replay bypass, no-key/ordinary controls; two client keys/accounts/out-of-order/dedupe/conflict/cancel/late/restart original contexts |
| Ordinary compatibility | Claude/Codex ordinary stream/JSON/tools/thinking/history/header/cloaking, Codex compact/overlap/401 refresh, nonselected provider transport/proxy/TLS, upstream DONE and fresh-socket fixes; no global accounting hooks on ordinary path unless reviewed |
| Persistence/platform | Saved rows/policy/audited recovery/rotation, finite+unlimited accounting paths fail closed on recording failure (D03); past-owner startup recovery after exclusive ownership, final-close after write-lane stop, no live owner reclassification; budget enrollment from zero on existing 9Router SQLite, backup/restore of current budget data, storage faults, adapter chain and optional runtime install fallback; Windows/Bun/better support explicit evidence or OPEN |
| Security review | Auth/CSRF/key authority/admin separation; no raw key in ledger/UI/response; TLS/proxy/SSRF/final URL/redirect/header authority; no client-spoofed permissions; reviewed touched seams only, no broad certification |
| Build/performance | Isolated standalone packaging/traced SQL.js wasm and optional deps/host-path compatibility; bounded per-request operations/queues; ordinary startup/request comparison against exact pinned-master baseline, not invented benchmark |

## Nghiệm thu hiện có trên Linux amd64

Cùng image Docker nội bộ đã qua HTTP thật, HTTPS loopback và restart cho Codex Standard Responses SSE, Anthropic API-key Sonnet 4.6 JSON, Claude OAuth Opus 5.5 SSE và Sonnet 5 JSON qua combo. Mỗi đường đã kiểm tra đúng chi phí và 0 POST sau khi chạm hạn mức. Admin route kiểm tra phiên, origin và phiên bản policy. Bản backup SQLite qua lại 16/16 ca trên Node 24. Startup, composition, native wire và dashboard đều có kết quả theo image hoặc revision ghi trong Phase 03. [Nghiệm thu Phase 03](./phase-03-native-retry-and-compatibility.md#nghiệm-thu-claude-oauth-standard-trên-docker-nội-bộ) · [Phục hồi SQLite](./phase-04-integrity-and-migration.md#phục-hồi-cho-docker-nội-bộ).

Kết quả refresh/retry được chốt ở Phase 03, và kết quả persistence theo runtime được chốt ở Phase 04. Mỗi kết quả áp dụng cho cấu hình đã kiểm thử. Việc đối chiếu credential trên bản phục hồi thuộc rollout và cần được thực hiện trước khi mở ingress thật.

## Kiểm chứng offline ngày 2026-11-26

Trên Linux x64 Node v24.21.0, dùng các runner hiện có ở `tests/fixtures/budget/`. Bubblewrap gắn source và dependency cần thiết ở chế độ chỉ đọc, dùng HOME và SQLite tạm riêng, tách network namespace và chỉ cho phép loopback trong ca transport. Các ca dưới đây dùng source ứng dụng tại `23ef4c70` và dữ liệu fixture.

| Runner | Kết quả | Phạm vi |
|---|---:|---|
| `run-management.mjs` | 5/5 | Phiên dashboard, Origin và forwarded host, payload bounds và đọc lại SQLite |
| `run-retirement-jwt.mjs`, `run-retirement.mjs` | 3/3, 26/26 | JWT thật, CAS, retirement, secret hiển thị một lần, mất ACK và biên nhận |
| `run-guard.mjs`, `run-boundary.mjs` | 4/4, 12/12 | Route allowlist, credential precedence, trạng thái DB lỗi và key đã thu hồi |
| `run-default-fidelity.mjs`, `run-transport.mjs` | 12/12, 10/10 | Ordinary executor, HTTPS loopback, xác thực TLS, ACK trước POST và 0 lượt gửi mới tại hạn mức |
| `run-status-ui.mjs`, `run-status-mounted.mjs` | 9/9, 1/1 | Save/reload/CAS, lỗi được lọc, số dư chính xác và lịch reset. Chromium mở các mục bằng Tab, Enter và Space ở viewport rộng 390px |
| `run-status-lint.mjs` | Đạt so sánh | Hai component budget có 0 lỗi. Endpoint còn 5 lỗi và 2 cảnh báo có sẵn trong baseline cùng đường dẫn |

CI cho `23ef4c70` đạt cả bốn lane persistence, gồm build standalone Windows. Docker Linux amd64 đã kiểm chứng đóng gói SQL.js, preflight và mở lại volume sau dừng. [GitHub Actions](https://github.com/hoangvinh14/9router/actions/runs/45722467735) · [Bằng chứng lưu trữ](./phase-04-integrity-and-migration.md#kiểm-chứng-budget-sqljs-trên-linux-x64).

### Dashboard và hiệu năng bản đóng gói

Ở bản `23ef4c70`, Next.js có thể dùng hostname listener để tạo URL nội bộ. Dashboard mở từ một origin khác nhận HTTP 403 khi lưu budget. Bản `01869139` dùng origin của `BASE_URL` do người vận hành cấu hình cho kiểm tra write. Hồi quy management, JWT và retirement đạt 34/34, gồm từ chối cross-site, sai origin và forwarded host giả.

Docker Linux amd64 chạy `01869139` với Node 24.21.0, node:sqlite, hostname listener mặc định và `BASE_URL=http://127.0.0.1:20128`. Chromium trong cùng network namespace cô lập tải hai stylesheet thật, đăng nhập bằng tài khoản thử, mở budget bằng bàn phím, lưu hạn mức tuần 3.000.000 nanoUSD với kỳ tháng Unlimited rồi đọc lại trong phiên mới. Ở 390px hai ô xếp dọc, ở 1280px hai ô nằm cạnh nhau. Cả hai không tràn ngang và có 0 lỗi JavaScript trang. Image candidate `sha256:0bc85ab2c852af4437b42b09586541856f590502193283a35e46b53c45a1bcbe`.

So sánh với master `1855aa44473e88feac9d3f131b9c0c5fc9706b68` (image `sha256:171740aa160e0ad3ff6b5278d1f4d78437d9d9a75a32bd914dad3a880e4a87a7`) trên cùng Linux host, Node 24 Alpine, network chỉ loopback và volume SQLite mới mỗi lượt. Chạy xen kẽ 5 lần mỗi image. Startup đo từ `docker start` đến HTTP health và auth status đầu tiên, gồm preflight của image nội bộ. Mỗi lượt bỏ 20 request khởi động rồi đo 100 GET `/api/auth/status`.

| Đo lường | Master | Nội bộ |
|---|---:|---:|
| Startup p50 | 8,80 s | 10,35 s |
| Request p50 | 21,34 ms | 21,21 ms |
| Request p95 | 36,50 ms | 35,91 ms |

Startup nội bộ thêm 1,55 s (~18%) trong phép đo này. Độ trễ route thường tương đương trong mẫu loopback. Phép đo áp dụng cho một route HTTP trên một máy, với image nội bộ có preflight SQLite.

Rà soát bàn giao đối chiếu source candidate `018691394ea21239c80b758be63c4bfca8d5401c` với master đã ghim, ghi nhận 242 tệp runtime, build và test thay đổi. Hồ sơ bảo toàn WIP và donor ở Phase 00. Rà soát độc lập xác nhận phạm vi nghiệm thu offline sau hai phép kiểm trên. Credential thật, origin qua ingress thật và kích hoạt production thuộc rollout. [Bảo toàn WIP và provenance](./references/phase00-execution.md) · [Khôi phục SQLite](./phase-04-integrity-and-migration.md#phục-hồi-cho-docker-nội-bộ).

## Completion / handoff

Theo quyết định ngày 2026-11-24, anh tự build và kiểm tra image Docker mới nhất, gồm luồng mở lại volume SQLite hiện có. Bước này được bàn giao và bỏ khỏi tiêu chí đóng plan của phiên triển khai. Kết quả nghiệm thu đã ghi áp dụng cho từng image hoặc revision tương ứng.

- [ ] Freeze reviewed source/test/config/dep hashes and exact selectors, expected cases/skips, adapter/environment/isolation proof; run affected/security matrix, preserve outputs without private payloads.
- [ ] Required cells/evidence/policies fulfilled or exact owner amendments recorded across plan/phase/UI docs. Blocked encrypted/history/failed usage/retry/models or applicable timing/platform gates mean **partial/BLOCKED**, not feature success. No blanket M1 proof campaign just to accumulate counts.
- [ ] Record candidate integration SHA, donor provenance per admitted slice, final diff against pinned master, migration/rollback limits, WIP preservation refs and no-touch evidence. Develop and preserved WIP remain recoverable; no wholesale merge/cherry-pick.
- [ ] Advisor completion review with exact checks/remaining risks; independent security/compat review only if authorized, never imply it was performed by static plan review.
- [x] Handoff separate execution/rollout decision: delivered isolated shipping coverage != host production activation. Real DB backup/migration, actual upstream credentials/inference, `ledgerStartedAt` enablement, service restart/deploy, commit/push/PR require own approval not conferred here.

**Stop/report:** unsafe sandbox, external network/private access, WIP loss/collision, hidden dispatch, unexpected regression, missing evidence, unapproved policy change → retain failing artifacts, report exact blocker+next finite input, do not silently downgrade assertions or claim security sign-off.
