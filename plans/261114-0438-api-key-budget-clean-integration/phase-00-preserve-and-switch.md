# Phase 00 — Bảo toàn WIP, pin baseline, clean switch cùng checkout

Status: **transition verified; documentation/tooling baseline commit finalization pending**. Priority: P1. Owner continuation authority supersedes original planning-only status. [Execution record](./references/phase00-execution.md) is current evidence; checklists below remain original runbook, not independent proof. No runtime file edits. Excluded material now has owner no-backup/retain-in-place disposition, not deletion authority or a secure-backup claim.

## Outcome

Có preservation point truy hồi được cho WIP công khai, approved secure disposition cho WIP nhạy cảm, artifacts không bị ghi đè, develop ref nguyên vẹn, integration source clean trên master được pin. Không worktree mới.

## 00.1 Inventory trước khi thay đổi bất cứ ref/index nào

- [ ] Xác nhận checkout/path, HEAD, branch, `git worktree list --porcelain`, local/cached remote refs. Refuse nếu có merge/rebase/cherry-pick/staged state mới chưa phân loại. Không tiếp tục từ inventory 42 paths nếu status đã drift.
- [ ] Ghi porcelain **NUL-delimited**, staged/unstaged diff metadata, tracked path+mode/blob/content hashes (chỉ public source được duyệt). Giữ original index metadata; không đọc/dump binary index vô tình chứa private payload.
- [ ] Enumerate untracked **và ignored paths/loại file**, không đọc private/session/generated contents. Không recursive hash/scan `.pi`, `.unipi`, `.next-*`, `.env*`, credentials, DB/captures. Dùng path-safe/literal handling cho spaces/newlines/symlinks, không glob/word-splitting hoặc follow symlink ra ngoài.
- [ ] Refresh manifest sau khi plan được tạo; plan/contract/handoff đều đang untracked. Mọi path mới trong lúc preservation là drift cần review, không add tự động.

### Required classification — mọi category phải có disposition

| Category | Đang thấy | Preservation disposition đề xuất |
|---|---|---|
| Tracked public source/tests/docs | 42 modified, staged0 ở planning baseline | Reviewed literal allowlist → preservation commit; giữ cả unrelated tracked WIP, không chỉ budget |
| Untracked native source | `open-sse/utils/accounting-{codex,claude}-*.js`, `src/lib/accounting/{codex,claude}-price-authority.js` | Secret-review nội dung → commit; **không thể `git show develop:path` trước bước này** |
| Untracked public tests/tooling | native accounting unit suites, `tests/offline/`, `scripts/accounting/` | Review từng file, include code/test fixtures public; captures/outputs không được tự suy public chỉ vì nằm trong scripts/tests |
| Untracked planning/history và unrelated WIP | audit folder, M1 folder, handoffs/journals/reports, cache-affinity reports/evidence | Review exact paths/content; include public WIP cả unrelated feature. Không sweep toàn bộ `plans/` vì có logs/evidence có thể nhạy cảm |
| Generated/session artifacts | `.next-*`, `.pi/`, `.unipi/` | Giữ nguyên tại chỗ, không stage/stash/cleanup. **Không phải durable backup**; owner xác nhận retained-in-place hay chỉ định secure backup riêng |
| Private config/DB/credentials/captures/unknown | Không đọc/không chứng nhận inventory đầy đủ trong planning | Never Git. Nếu cần di chuyển/backup hoặc có target collision: **STOP**, xin scoped secure handling do owner chỉ định; không tự mở contents/di chuyển |
| Ignored dependencies/builds và file-directory/case collisions | Phải inventory khi execution | Không coi ignored là disposable; target collision phải giải quyết trước switch theo approval riêng |

**Preserve all WIP không có nghĩa commit tất cả.** Mọi genuine WIP phải recoverable qua method được owner duyệt; retained artifacts không bị đụng tới và không bị gọi là backup. Mỗi category **non-disposable** phải có recovery copy truy cập/đối chiếu được trước switch: public Git blobs so hash/mode; private/ignored non-disposable dùng owner-controlled secure backup + recovery verification/attestation, không cho agent đọc payload. External locator chỉ là chỉ dẫn, không thay backup. Retained-in-place chỉ đủ cho artifacts owner xác nhận disposable hoặc không chứa WIP cần backup; không được gán nhãn disposable chỉ theo tên thư mục. Thiếu approval/copy/verification cho non-disposable category → **STOP trước switch**.

## 00.2 Chọn và xin approval preservation method

**Recommended proposal: preservation branch + scoped reviewed commit.** Tên đề xuất `preserve/develop-budget-wip-261114`; kiểm tra chưa tồn tại, không reuse/overwrite ref. Branch integration đề xuất `feat/api-key-budget-integration`, chưa tạo.

Lý do: donor untracked trở thành immutable Git blobs có SHA/path, content dễ đối chiếu; develop branch vẫn trỏ `08ee1a7…`. Commit preservation không được cherry-pick toàn bộ sang integration.

Approval phải nêu: branch names, exact allowlist/reviewed hashes, allowed Git-only operations, approved backup location ngoài checkout, hook handling, có cho fetch/quiesce services không. Không coi yêu cầu “lập plan” là approve commit/stash. **Không chạy hook/build/runtime ngoài scope**: review configured hook path mà không chạy; nếu hook có side effects cần duyệt disable đúng invocation hoặc stop, không chỉnh global config. Git filters/external diff helpers cũng phải được xét trước staging.

### Execution skeleton sau approval (không copy-paste như script hoàn chỉnh)

1. Guard HEAD/develop/ref/status/hash đúng inventory và one-writer/service gate; ghi original refs và status.
2. Normal `git switch -c preserve/develop-budget-wip-261114 <original-develop-SHA>` ở cùng HEAD; không force. Không phải clean integration switch.
3. Stage **từng literal path** trong reviewed allowlist (NUL pathspec file được review, literal-pathspec mode). Không `git add .`, `git add -A`, glob hoặc directory sweep.
4. Review cached path list/modes/diff/secret findings; staged content phải bằng reviewed hashes. Không ngoài allowlist; tracked WIP cần được bảo toàn hết, không bỏ sót deletion/mode/index layer.
5. Commit với hooks đã approved, không push. Ghi preservation SHA; verify `develop` ref không đổi, mỗi public WIP file/blob/mode hash bằng inventory; tracked working tree và index clean trên preservation branch. Commit failure → giữ state, báo lỗi, không retry bằng broad add/reset.
6. Ghi handoff ngoài checkout vào owner-approved location: original refs, preservation SHA, original status, public content manifest, category dispositions, plan path, contract/handoff paths. Không chứa secrets/private payload. Bản recovery này phải đọc được sau switch. Chưa có approved location → **STOP trước switch**.

### Alternative, chỉ khi owner chọn thay

Scoped stash **có `--include-untracked` nhưng bắt buộc exact literal pathspec allowlist**, không blanket `stash -u/-a`. Đối chiếu tracked/index/untracked trees của stash với manifest, giữ stash OID+durable recovery ref được duyệt; không drop/pop/autoapply. Scoped stash có thể bỏ sót ignored source, staged layers và unreviewed WIP; phải xử lý từng category, không được dùng như shortcut. Không dùng cả hai methods xen kẽ vì một lệnh thất bại. Nếu cần secure backup private data, owner phải duyệt riêng công cụ/location/retention, không nhập Git.

## 00.3 Remote pin + services + collisions (TRƯỚC integration switch)

- [ ] Owner-authorized fetch chỉ master: `git fetch --no-tags origin refs/heads/master:refs/remotes/origin/master`. Không `pull` vào develop/preservation. Kiểm tra ancestry `local master -> fetched master`; chỉ FF inactive local master với compare-and-swap, verify không master worktree/other writer. Divergence/non-FF → STOP, không reset master.
- [ ] Pin fetched SHA. Planning candidate `1855aa44473e88feac9d3f131b9c0c5fc9706b68`; changed SHA → đọc exact seam deltas, revise baseline/admission/test manifest trước port. Không lặp full audit.
- [ ] Đối chiếu **all untracked+ignored paths** với target Git tree và tracked transition: exact collision, ancestor/descendant file-directory collision, symlink/mode/case conflict và generated paths target sẽ ghi. Không đọc private contents. Git normal switch có thể overwrite ignored files: không dựa solely vào việc Git có refuse hay không. Dùng no-overwrite-ignore nếu Git version hỗ trợ; collision remains hard stop.
- [ ] Kiểm tra target paths có xung đột với preserved plan/contract: chúng thường biến mất vì không có trên master, nên recovery record ngoài checkout là bắt buộc. Không dùng master checkout để “restore all plans”.
- [ ] Xác định service/process khác đang dùng checkout mà không mở credentials/host DB; owner phối hợp approved quiescence/maintenance. Không kill/restart service tự động; branch switch không isolate running process, schema hay `.next` cache.

## 00.4 Create clean integration và restore planning docs có chọn lọc

- [ ] Sau các gate, normal `git switch -c feat/api-key-budget-integration <pinned-master-SHA>`; không `--force`, discard/reset/clean. Dừng nếu refuse; không retry bằng overwrite option.
- [ ] Assert HEAD đúng pin, tracked/index diff **zero trước port**, không untracked donor source còn lẫn namespace `src/open-sse/cli/tests`. Artifacts excluded chỉ tồn tại theo manifest/no-collision; không gọi checkout hoàn toàn sạch nếu còn artifacts.
- [ ] Verify develop ref unchanged, preservation ref+blobs còn recoverable; private/artifact paths không bị đụng. Nếu hash/status drift ngoài intentional branch tree → stop.
- [ ] Từ preservation SHA, selective port **exact public planning allowlist** (plan folder này + audit contract/handoff/report và necessary linked decision docs) để executor còn đọc được. Ghi docs-only commit với approval có sẵn; không mang cả `plans/`/historic receipts. Giữ external recovery reference cho donor docs chưa port; revise crosslinks/disposition references nếu không port. Không dùng blanket restore `src/`/`open-sse/`.
- [ ] Sau docs-only commit, runtime source vẫn bằng pinned master, tracked-clean. Chụp integration baseline mới để phase 01 dùng.

## Recovery / không mất WIP

Content recovery: khi integration **tracked-clean** và collision preflight đạt, normal switch về preservation branch lấy content đã commit; không apply preserved WIP lên integration. Dirty integration phải được bảo toàn riêng bằng protocol được duyệt trước switch; không force/reset. Original develop vẫn tồn tại nhưng **không chứa untracked donor WIP** — dùng preservation SHA. Khôi phục đúng dirty/index layout là thao tác riêng cần approval và status metadata, không hứa commit làm được tự động. Branch rollback không đảo DB migration: không downgrade binary lên DB mới, không chạm host DB.

## Exit evidence

Inventory+category dispositions; owner approval; original/develop/master/preservation/integration SHAs; content parity hashes và validated recovery copies/owner secure-backup attestation cho mọi non-disposable category; collision check including ignored; external recovery locator; service coordination; pre-port zero tracked/index diff và source equality; docs allowlist diff. Thiếu một gate → chưa phase 00 complete, không phase 01 runtime work.
