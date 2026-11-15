# API-key budget — product contract from the owner brainstorm

Recorded: 2026-11-13; updated after the owner selected a clean integration branch. This is the product authority for the next planning session and the [scope audit](../plan.md), not a claim of runtime delivery or a blanket cancellation of old safety requirements. **Read section 8 before planning; it supersedes the earlier candidate-only branch recommendation.**

## 1. Confirmed outcome

9Router already has inference paths used by Claude Code / Codex. The requested addition is **budget per client API key issued by 9Router**, with **the next request blocked when its budget is exhausted**. It is not a separate budget for each upstream Claude/Codex login and not monitoring/alerts only. An API key may use multiple upstream accounts; accounting must not move its spend to another client key.

The owner requested preserving this understanding first, then reviewing develop versus upstream-synced master. Existing work may be discarded **after** the comparative decision if the gap is large; no deletion/reset is authorized by accepting that option.

## 2. Scope and requirements

| ID | Required behavior | Nature / acceptance evidence |
|---|---|---|
| B01 | Budget subject is the stable 9Router API-key identity, not its display name or upstream connection. | Owner-confirmed identity. Rename/rotation/deletion semantics must be explicit; no plaintext key in new accounting records or UI. |
| B02 | Configure a budget and show recorded spend, remaining amount and period/reset. | Budget control plus usable management surface. Weekly/monthly Asia/Ho_Chi_Minh windows are the existing brainstorm proposal, not a newly selected alternative calendar. Verify actual UI/API rather than helper presence. |
| B03 | Block a new upstream dispatch when recorded spend reaches an applicable limit. | Owner-confirmed block-next, not reservation/hard cap. A request already in flight can finish and push recorded spend over the limit. Concurrent pre-admitted requests may overshoot; do not introduce reservations without a new decision. |
| B04 | Reuse working Claude/Codex routing, translation, credential refresh and execution where compatible. | No replacement inference pipeline. Guarded dispatch must remain correct through retry/account fallback; ordinary-key behavior is a compatibility requirement, not a verified fact. |
| B05 | Attribute known cost to the original client key and actual upstream attempt, at the applicable original price/period, without duplicate debit. | Recommended necessary correctness for budget enforcement. One logical request may contain several attempts; do not deduplicate real costs merely by request ID or count duplicate callbacks twice. |
| B06 | Usage and monetary provenance are explicit. | Provider-reported vs estimated usage and priced vs unpriced are independent dimensions. Missing/invalid usage or price is not automatically zero/free. Existing telemetry is not accepted as authoritative debit solely because it is available. |
| B07 | Saved spend and policy survive restart; concurrent changes do not corrupt identity, money or totals. | Necessary accounting integrity; this does not promise capture of evidence never durably received. Process-death undercount limitation previously accepted remains explicit; no new recovery product. |
| B08 | Management is authorized, secrets remain isolated, and budget refusal cannot trigger a bypass through routing/fallback. | Security acceptance for touched budget seams: auth/CSRF/ACL, no client-spoofed key authority, no credential leakage, no weakened TLS/proxy/SSRF controls. No general security certification. |

## 3. Constraints

- Extend the existing execution pipeline and reuse suitable DB/pricing/budget helpers. A separate ledger per provider or a second raw-stream reader is not a goal.
- Reference USD cost for OAuth/subscription is a local budget valuation, not the actual subscription invoice, provider quota balance or spend outside 9Router.
- Preserve precise monetary calculations where used; a simpler design must preserve the same product invariants, not merely have fewer files.
- The initial delivery was documentation + static audit. The later owner instruction additionally authorizes syncing local master from its remote and updating the brainstorm/handoff. No runtime implementation, tests/inference/real refresh, private config/credentials/DB access, production activation/deploy, reset or deletion is authorized in this handoff turn. Implementation planning starts after the owner clears context.
- Prior decisions/requirements are evidence to examine, not proof that every mechanism/proof campaign is essential. Any proposed removal needs explicit disposition rather than an implied waiver.

## 4. Non-goals

No new inference service, new provider support, ledger per model/provider, reservation/hard spending cap, automatic account switch on budget exhaustion, post-death acquisition service, universal provider contract proof, or provider-wide billing reconciliation. Do not expand the fresh feature merely to close an old plan. This is not approval to remove required Claude/Codex compatibility or security checks.

## 5. Acceptance of the future feature

A representative authenticated client can set a key budget, make a supported Claude/Codex request through the normal route, see valid cost charged to that same key once, and have a later dispatch refused when the recorded limit is reached. Tests must cover retry/refresh/fallback identity, duplicate completion, concurrent keys, missing usage/pricing, cancellation, saved-row restart and period boundaries at the actual reachable seams. Exact applicable paths and supported model/composition scope must be explicit. Reading such tests in this audit is not executing or passing them.

## 6. Trade-offs and chosen direction

- **Observational stats only:** lowest routing impact, but depends on informational intent and fails immediately on the owner's requirement to block. Rejected as the complete solution.
- **Continue directly on current develop:** reuses all existing foundations, but carries broad coupled changes and pending experiments. Not the selected integration base after the owner update.
- **Clean integration branch from synced master + selective port:** **owner-selected direction**. Use a new branch in the existing checkout, not a separate worktree. For each requirement, port/adapt a suitable reviewed piece from develop or implement the missing piece; do not first rewrite everything and then import a second core. This assumes selected dependencies can be bounded; it fails first if each imported slice pulls the entire old architecture back in. Every port needs fresh integration checks.
- **Wholesale rewrite / wholesale cherry-pick:** neither is selected. Both can recreate unnecessary scope; rewriting equivalent persistence/security also risks losing prior protections or data compatibility.

**Better approach adopted:** keep develop as a reference/donor and preserved rollback point, not the starting feature tree. Build requirement-driven vertical slices on master and admit code only with a named requirement, dependency list, smallest-alternative comparison and validation. This preserves useful core work without importing all of develop. It is not a claim that the new approach is cheaper or provider-evidence gaps have disappeared.

## 7. Still to resolve, not assistant assumptions

- The smallest supported model/path/composition matrix that still fulfills the retained Claude/Codex intent; exclusions must not silently remove accepted functionality.
- Exact operational response to unknown usage/unpriced/recording failure. The existing strict implementation may fail closed; safety requires not calling it free, but product policy and recovery UX must be stated rather than inferred from an internal helper.
- Key rotation/removal/history retention policy and any migration needed by a redesign.
- Whether simplification should amend a particular earlier requirement or only remove a redundant implementation/proof step. The audit will name each proposed disposition; this document does not grant blanket waivers.

## 8. Owner-selected branch strategy and context-reset handoff

### Decisions now settled — do not interview again

1. Budget subject is **9Router API key**, with **block-next** at exhausted recorded budget.
2. Start a **new integration branch from master after remote sync**, not from develop. Master remote is reported synced by the owner; record the fetched SHA as the future plan baseline.
3. Use the **existing checkout**. The owner explicitly does **not** want a separate worktree.
4. Preserve develop and all existing tracked/untracked work. Port/adapt only necessary slices; never cherry-pick a large coupled commit solely because one useful function is inside it.
5. Use this fresh B01–B08 contract, **not the entire historical M1 execution plan**, as the new plan's starting specification. Preserve relevant invariants; name exact changes to previously accepted guarantees instead of silently waiving them.
6. First implementation milestone is one real vertical slice: budget configuration → supported Claude/Codex call through existing pipeline → correct original-key recorded debit → subsequent zero-POST refusal at the threshold. This is an initial milestone, not permission to drop the rest of the agreed target. Then cover relevant retry/refresh, identity/concurrency/restart and ordinary compatibility.
7. Every route still usable by a budget key must be accounted or explicitly refused before POST. No telemetry-only replacement, zero-on-missing default, second raw owner or inference rewrite.

### Same-checkout safety prerequisite

**A new branch name does not clean a dirty working tree.** The inspected checkout has substantial tracked pending work and untracked native code plus generated/session artifacts. `git switch` may refuse, or may carry changes onto the new branch, defeating the clean-baseline goal.

Before creating/switching the implementation branch, the next session must name a scoped preservation method and obtain any missing authorization: e.g. a reviewed WIP commit on a preservation branch, or an explicitly authorized scoped stash including the necessary untracked source. No blanket `git stash -u/-a`, force checkout, reset/clean, deletion or broad staging. Never sweep private/session/generated artifacts into a commit/stash. Untracked donor modules are not recoverable from `git show develop:path` until explicitly preserved.

The current handoff turn does not perform that preservation or switch. The owner will clear context and start a new session to **plan first**. Branch naming can be proposed then; no implementation branch has been created by updating this report.

Use disposable DATA_DIR/DB for future tests. A branch switch does not undo schema/data migrations or isolate current services; do not point experimental code at production state.

### Next session's instructions

Read this document, then [audit report](./audit-report.md) sections 3–8 and its later owner-decision addendum, then [baseline sync/handoff](./branch-handoff.md). Do not restart the audit or re-ask key-vs-account/block-vs-monitor questions. Create an implementation plan with explicit integration slices, file/dependency admission criteria, WIP preservation and branch switch preflight, isolated validation, compatibility/security acceptance and stop conditions for unresolved provider evidence. No implementation before that plan.

## Source of decisions

Conversation: owner selected API key + blocking, approved the audit, then **accepted clean integration branch/selective port and requested remote master sync, same checkout/no separate worktree, report update before clearing context**. Earlier advice was keep valuable core rather than reset wholesale; the owner-selected branch strategy now specifies how to do that. The [old execution plan](../../261101-0716-m1-codex-standard-accounting/plan.md) and receipts are historical evidence and retained decisions to disposition, not the new implementation backlog by default.
