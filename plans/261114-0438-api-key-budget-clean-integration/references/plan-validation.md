# Plan validation — planning-only

Date: 2026-11-14. Deliverable: Markdown implementation plan và references trong folder này. All runtime phases **pending**, chưa cấp execution authority. Không HTML/publish/agents/live tests được yêu cầu hoặc thực hiện.

## Evidence đã dùng

- Đọc toàn contract, đặc biệt §8; branch handoff; audit §§3–8/11 và các retained historical scope decisions có liên quan. Không restart broad audit.
- Read-only Git: develop `08ee1a74954c5fe7a1659a6473e57b6b1ea9059b`; master/cached origin-master `1855aa44473e88feac9d3f131b9c0c5fc9706b68`; common ancestor `1fe586bb…`; master-only68/develop-only21; tracked modified42/staged0; một checkout. Không fetch mới; remote current freshness chưa established.
- Selected source bodies core accounting/management/gate/migration, master key ACL/repo và scoped upstream diff đã đọc. Path inventories/callsite pointers khác là candidates, không claim full code review.
- [Planning baseline](./planning-baseline.json) ghi selected public source hashes, không toàn WIP certificate. Project graph unavailable (`too_many_files`), dùng scoped Git tree/diff và direct reads thay; không dùng graph rỗng làm proof.

## Plan-direction Advisor review

Advisor được gọi trước drafting để review consequential direction bằng concise supplied facts, không independently attested source review. Những điểm được áp dụng:

1. Local ref equality không phải fetch freshness: phase00 authorized fetch+pin+delta revalidation.
2. Mọi WIP category cần disposition; retained-in-place artifacts không durable backup. Collision check cả ignored/file-directory/case trước switch.
3. Preservation commit recover content, không original dirty/index state; lưu status và external recovery locator để plan/contract không mất discoverability sau switch.
4. Identity/idempotency/durable publication/concurrency/failure design có ngay phase01, thực thi ở phase02; phase04 chỉ mở rộng fault coverage.
5. Upstream low-level replay và header mutation là accounting boundary; từng actual POST own attempt/ACK, test counts cho every layer.
6. Isolation external process/filesystem/network, gồm imports/background jobs/subprocesses/undici/native TLS, không chỉ mock fetch.

**Điểm không áp dụng:** từ gợi ý Advisor có chữ reservation không được lấy làm design change; contract explicit block-next/no reservations được giữ xuyên plan. Pending intent không debit/reserve money.

## Inline adversarial review (không phải multi-agent red-team certification)

| Lens | Failure challenged | Disposition trong plan |
|---|---|---|
| Assumptions | New branch magically clean; cached ref proves remote latest; fixture positive implies producer eligibility | Phase00 actual isolation+pin, baseline limitations, P1–P4 support cells pending |
| Failure modes | Untracked donor unavailable after switch; plan disappears; ignored file overwritten; service keeps migrated DB | All-category preservation+external locator+pre-switch collisions/services; no DB rollback assumption |
| Scope/complexity | Full develop dependency import disguised as helper port; narrow first model silently drops retained target; old E0–E6 recook | Per-hunk closure+smaller alternative gate, C1–C4 required, exact old guarantee disposition table |
| Security | Unrestricted key bypasses accounting; reconstructed Request loses authority; hidden undici replay/header mutation; private artifacts committed | Server active-row identity independent ACL, route-closure fail closed, one actual dispatch authority, secret-reviewed literal allowlist; auth/CSRF/TLS/SSRF acceptance |

## Validation questions / approvals — historical drafting state

**Superseded for D01–D04 by [Validation Session 1](../plan.md#validation-log).** Các pending statements dưới đây chỉ ghi trạng thái khi soạn plan, không authority hiện tại.

Không hỏi lại key-vs-account/block-vs-monitor/master/same checkout. Không cần quyết thay user để viết plan. A0/D01–D06/P1–P4/A1 giữ explicit pending với affected phases; approval và evidence là prerequisites tương lai, không claim passed. Toàn-plan execution **chưa ready**, dù static documentation có thể hợp lệ.

## Static verification results / whole-plan sweep

- Read-only checks: **10 Markdown files, 6 pending phases**; required index frontmatter và phase dependencies present; relative links missing **0**, invalid anchors **0**, gồm `#decision-register` đã đối chiếu heading.
- **10 example unit selectors** đã phân loại đúng provenance: 3 existing develop helper tests, 4 existing master ordinary controls, 3 explicit planned-new shipping tests. Master-only DONE/proxy tests chưa có trong current develop checkout nhưng tồn tại trong pinned master Git tree; không được gọi là new chỉ vì file local absent.
- **14 selected public hashes unchanged**, HEAD/master/cached origin-master refs unchanged, tracked modified count vẫn **42**, staged **0**. Đây là observations có phạm vi; equal counts không chứng minh toàn tracked/untracked tree nguyên trạng. Không all-worktree integrity certificate; future preservation phải inventory/hash lại.
- Toàn plan nhất quán no reservations, no host production activation, no blanket stash/add/force/reset/clean, no implicit old requirement waiver. Foundational invariants design phase01/implement phase02; phase04 mở rộng coverage. Candidate file paths/command examples không đồng nghĩa body đã review hoặc runtime tests đã chạy.
- No runtime test/build/inference/refresh/import application modules performed; không private config/credentials/DB đọc. Static Python documentation/Git/hash checks không phải runtime verification.

## Completion Advisor review / applied corrections

Review thứ hai dùng concise summary + static observations, không trực tiếp certify all plan files. Đã áp dụng:

- Không nâng selected hashes/unchanged ref/count thành whole-WIP integrity claim.
- Kiểm chứng anchor và selectors qua explicit planned-new declarations + master/develop Git trees, không auto-label absent path.
- Phase00 yêu cầu **accessible validated recovery copies cho mọi non-disposable category**, private backup owner-controlled/attested, không Git; locator không thay preservation. Retained-in-place chỉ đủ cho owner-confirmed disposable artifacts, không tự suy từ folder name.
- Phase03 explicitly **disable internal replay hoặc block affected budget route** khi không thể intercept fresh gate+durable own attempt ACK. Một test matrix không phải proof boundary khả thi.

Không correction nào cấp execution authority, thay block-next thành reservation, waive producer gates hay grant runtime/security success. Whole-plan status vẫn **pending / approval-and-evidence gated**.

## Remaining limitations

At drafting time, approval-gated preservation method/external secure location, exact positive native model/profile evidence, unknown/unpriced/storage/key-history policy, bounded sidecar/config dependencies, changed upstream retry semantics, available adapter/platform runners và old applicable timing/native-isolation obligations cần closure trước phase completion. **Session 1 update:** D01–D04 policy approved; exact recovery/binding protocol still phase01 work, legal retention remains rollout gate. A0/A1, D05/D06, P1–P4 and runtime/platform evidence remain pending. Current authority: [decision register](./scope-and-decisions.md#decision-register). Plan review không security sign-off, runtime portability proof hoặc permission to execute.
