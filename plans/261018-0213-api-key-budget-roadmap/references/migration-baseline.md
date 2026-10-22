# Migration baseline — 2026-10-18

## Source authority

| Nguồn | Identity / trạng thái |
|---|---|
| Current master / origin/master | `87a74e1bda3677193c6f71a7e2100c90311f0689`, package0.5.104, fast-forward từ a99cf572 |
| Old committed feature | `3a4955a0336f970505c325b0faf892f5397c93bb`; giữ nguyên branch feat/api-key-quota-budget-pricing |
| Saved WIP | `d515fb4927ed45a5853104406cd0fecca549c04c`, stash commit, chưa apply/pop |
| Original baseline | `a99cf57239ff778b61e434c2786009d5ed1c412c` |

Trước tạo plan: tracked/index clean0untracked. Sau lập plan dự kiến chỉ docs mới. Ignored files/dependencies không được stash và không được chứng nhận khớp package mới; production DB không mở. Không baseline/build/test/matrix/inference trong planning.

## Evidence kiểm tra
- Remote master thay đổi67commits/264paths từ original baseline; feature committed diff760files/+67342/-723;23paths overlap. Đây không phải số textual conflicts; chưa merge rehearsal.
- Ba code checkpoint cũ lần lượt345/306/168files; không suitable whole cherry-pick cho slice nhỏ. Git preserves old sources/tests/evidence; hiện master không có folder plan cũ.
- Upstream schema version2 có `accessRestricted/accessAllow`; keyAccess context/gates/adapter filtering trước selected targets là boundary phải giữ. Có provider mới, GitHub embedding route, empty-content combo fallback và strictProxy changes. Diff/path presence không chứng minh feature correctness.
- Current pricing API numeric-only, repo legacy TTL5s/manual+bundled; chưa có `src/lib/pricing/`. Old resolver imports accounting config/rates; old cache expects optional adapter eligibility, scheduler attached ownership. Vì vậy P1 có dependency gate, không assume old A là drop-in.
- `docs/ARCHITECTURE.md` đã đọc nhưng DB JSON/executor inventory cũ; source `src/lib/db/driver.js` và CLAUDE.md mới hơn là authoritative cho SQLite. Đã đọc `open-sse/AGENTS.md`.
- Current comparator dùng `f.name.split('/app/')[1]`; local JSON paths không mặc định `/app/`. P1 phải prove comparator input coverage/normalization bằng synthetic controls trước no-regression claim.

## Preserve / không tự khôi phục
Stash giữ production2/test4 unaccepted candidate (requestAccounting/accountedBase và queued tests), plan checkpoint/local reports, .pi diagnostics, fusion deterministic test và unrelated Kimchi/snapshot/research WIP. Saved untracked tree có matrix r2/report/fusion test được xác minh. Không whole-apply, không restore .pi/tasks lên active workspace chỉ để tiếp tục job cũ. Không delete stash, clean ignored hoặc modify production data.

## Cách đọc lại artifact
```bash
git show 3a4955a0336f970505c325b0faf892f5397c93bb:plans/261003-0827-api-key-quota-budget-pricing/reports/package-a-closure.md
git show d515fb4927ed45a5853104406cd0fecca549c04c:src/lib/apiKeyBudget/requestAccounting.js
git ls-tree -r --name-only d515fb4927ed45a5853104406cd0fecca549c04c^3
```
`^3` là untracked snapshot, không tree của tracked modifications. Dùng immutable hashes; ordinal stash@{0} có thể đổi. Không đưa secrets từ diagnostics ra report hoặc network.

## Evidence reuse
A historical closure có value làm checklist/implementation reference, không reset thành chưa từng done, cũng không current certification sau port. Old native/SQL.js scoped positives, failures và rejected optimizations giữ provenance. Không rerun old greens nếu input tương ứng không liên quan; shared-code changes invalidates đúng affected evidence. Mọi all13AC remain OPEN cho integrated product; no performance/security shortcut hoặc activation authority.
