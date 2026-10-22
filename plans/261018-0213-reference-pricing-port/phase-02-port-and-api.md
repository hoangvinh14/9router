---
title: "Port pricing, persistence và API"
status: done
---

# Port pricing, persistence và API

## Prerequisite
<!-- Updated: Validation Session 1 - bounded seam gate, sync PUT và coverage-only revision conflict -->
Phase 1 exact file/test manifest và dependency decisions đã đóng với bounded design giữ đủ invariant; nếu chưa, không port. U1 feasibility chưa được chứng minh chỉ bằng validation docs. Nếu seam cần broad writer/restore/accounting refactor hoặc giảm adapter support thì STOP/P1 BLOCKED + named prerequisite cho user duyệt. Ownership ở minimal files manifest, không copy toàn branch; comparator fix nếu cần chỉ ở exact tests-only delta đã review từ phase 1.

## Steps
1. Port tests nhỏ trước: money decimal/BigInt/rational, explicit zero vs missing, complete-source precedence và exact provider/model mapping. Reuse old tests sau đọc fixtures; giữ red cho defect có thật, không tạo red bằng sai premise.
2. Port pricing-owned validators/parser/mapping/resolver. Metadata/snapshots riêng legacy numeric map; giữ newly added upstream provider pricing, không dùng fuzzy suffix cho enforcement. Typed media/tool rate obligations chưa hỗ trợ phải còn explicit, không biến missing thành free.
3. Port persisted catalog/manual override/schedule status và revision invalidation cần thiết theo pricing-owned persistence/ACK/reopen/failure design đã chốt, additive schema; snapshot cũ frozen và giữ original revision khi giá đổi, snapshot mới phản ánh giá mới. `canMemoizePricing` absence = không cache, không giả committed health/durable RAM. Bao gồm raw import/migrate invalidation và explicit export/import policy cho referencePricing state theo manifest; không broad restore redesign hoặc silently drop state. Pricing-only invalidation không tự cung cấp accounting durability; ledgerStartedAt không được tạo.
4. Route-level management guard trước privileged body/read/write/fetch: JWT hoặc verified direct loopback khi login disabled; CLI/gateway key không quyền admin. Giữ trusted socket provenance của custom-server; Origin/cross-site/proxy normalization phải có tests. Không broad auth rewrite.
5. `/api/pricing` GET/PATCH/DELETE giữ numeric provider/model map response, metadata riêng; không thêm PATCH expectedRevision/CAS/header bắt buộc. Proposed `/api/pricing/sync` **GET/POST/PUT** và `/api/pricing/coverage` GET chỉ thêm sau manifest:
   - GET sync: bounded/redacted status, không fetch hoặc start scheduler.
   - POST sync: không source/options payload hoặc query; fixed HTTPS models.dev URL/path, redirect reject, timeout15s/decompressed20MiB/parse bounds/prototype guards/no credentials, stage→atomic publish. Invalid/offline giữ last-good/overrides.
   - PUT sync: body đúng `{schedulerEnabled:boolean}` duy nhất, không query; auth/CSRF trước body, body bounded1KiB, invalid400/no write, storage/runtime failure503, phân biệt `configurationSaved:true` nếu durable config đã lưu nhưng runtime reconcile fail; success trả configured/running state. Cập nhật page consumer và API/restart tests, không invented endpoint.
6. Scheduler opt-in24h/default OFF, serving-only startup initialization theo manifest, không build-time/startup fetch. Enable/disable/restart serialized; disable ngăn scheduled fetch mới, in-flight sync được finish last-good publication. Không cần ledger ownership giả. Nếu cần authority seam ngoài bounded manifest, block thay vì mở driver refactor.
7. Verify indexed/current revision/reopen/dirty state invalidation, concurrent writes không mất unrelated model updates, no-op không mutate và original frozen snapshot không drift. **Stale revision conflict là coverage pagination**: GET coverage với revision cũ trả409 `pricing_coverage_revision_changed`, client restart pagination; không PATCH CAS hoặc lost-update protection cho cùng model được claim ngầm. Giữ snapshot contract tests trước consumer P2.

## Current evidence (2026-10-19)
Persistence stage4 original3file barrier PASS31/31 under explicitly approved10second cold-start identity budget (bothNode/SQLjs, no other timeout/bootstrap/assertion changes). Broader20file DB/ACL/usage+pricing barrier `baeed4691` PASS206/206,0failed/pending/todo; frozen source hashes/file identities verified. Counts overlap and are not summed. Raw earlier reds retained; no performance/root-cause fix claim. [Receipt](./reports/pricing-persistence-stage4-r3-affected/receipt.json).
Stage5 guard+CRUD+sync routes/tests implemented; `b203701b9` PASS46/46 across2files,0failed/pending/todo and frozenhashesmatch ([receipt](./reports/pricing-api-stage5-tests/receipt.json)). Mocked session/storage boundary only, not actualJWT/TCP/server proof. `bbb21e75e` lint PASS5files/sourcehashesmatch. LSP5paths zero diagnostics but3confirmedclean/2push-onlyinconclusive. Stage6 coverage/currentregistry/committedview, auth-first route, socket provenance stamps and issuedJWT checks PASS61/61/lint6. Stage7startup9/TCP11/h2c1 separate source-bound checks passed; compiledNextserver unverified. Consolidated `b819910f1` PASS271/27126files0failed/pending/todo ([receipt](./reports/pricing-phase2-final/receipt.json)), frozenfileidentities/hashesmatch. UI review then identified exact-value roundtrip risk in numericGET. Bounded refinement within ownedrepo/index/route: opt-in GET `?view=editor` yields exact canonical string map includingcustommodels; defaultGET numericunchanged/noCAS. Reopened verification `bf78357a1` completed PASS36/36 and `bbb1bde90` completed PASS275/275; `b3ab57c58` completed lint exit0, with freshfrozeninputs and source hashes verified. ActiveLSP6paths zero diagnostics but3confirmedclean/3push-onlyinconclusive, notallclean. UI/browser/build/Docker and compiledserving/restart remain unverified; no Docker/live operations.

## Closure — 2026-10-22
The user approved closing Phase 2 after the final source-bound and affected-consumer evidence. The phase exit obligations are satisfied by the persistence/API/coverage barriers (`b819910f1`, PASS271/271) and the exact editor refinement barrier (`bbb1bde90`, PASS275/275), with lint and frozen source manifests verified. The phase preserves the numeric API contract, exact editor projection, decimal/zero/inherit behavior, durable revision and last-good semantics, auth/CSRF/fixed-source controls, coverage-only revision conflicts, and the pricing-only ACL/schema/accounting boundary.

Compiled Next serving, rendered browser flows, restart acceptance, and Docker packaging remain Phase 3 work and are not claimed by this closure.

## Verification
Sau port và sau khi kiểm tra file tồn tại, chạy từ `tests/` với HOME/DATA_DIR disposable, dummy fixed-source network only:
```bash
npx vitest run unit/api-key-money.test.js unit/pricing-validation.test.js unit/pricing-catalog-sync.test.js unit/pricing-schedule.test.js unit/pricing-snapshot-cache.test.js unit/pricing-snapshot-sqljs.test.js unit/pricing-management-route.test.js --reporter=json --outputFile=/ABSOLUTE_DISPOSABLE_DIR/pricing-core.json
```
Đây là filenames từ Git cũ, **planned port targets, chưa tồn tại master**; manifest có thể tách helper/test tên khác nhưng phải giữ obligations. Khi thêm coverage, liệt kê riêng `tests/unit/pricing-coverage-report.test.js` và `tests/unit/pricing-coverage-registry.test.js` (old-source port candidates), cùng actual GET409/PUT/auth/invalid-body/restart checks; command trên không thay thế affected barrier của manifest. Không yêu cầu port budget service để chạy money test; đổi import boundary có kiểm chứng. Tại root chạy `npx eslint <manifest-changed-js-files>`; command phải ghi file list thực tế. Node SQLite + SQL.js chỉ claim adapters thực chạy, không Bun/better proof.

## Exit
- [x] Money/precedence/snapshot/revision/last-good/override behavior verified; không inference hook hoặc ledger coverage activation.
- [x] API compatibility/auth/CSRF/fixed-fetch/prototype/decimal/no secret evidence; relevant consumers verified.
- [x] Không thay upstream ACL/schema/routing semantics; source diff giới hạn manifest. Nếu shared files mở rộng thì update impact trước gate, không sau khi failed.
