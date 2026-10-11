# API-key budget/pricing — fresh context-reset handoff

> Current next-action/gate pointers superseded by [0832 tool-history continuation](./api-key-budget-tool-history-20261011-0832.md). This0801 capture remains history and scope authority; queued native text tool history is now finite-slice closed, F/B stillopen. No gate pending after consumed `b54a41ea4`.

## Mission and current status

Resume original `plans/261003-0827-api-key-quota-budget-pricing/plan.md` to all13AC: per-gateway-key durable chat/embedding attempt accounting, simultaneous calendar weekly/monthly budgets, reference pricing, recovery/UI/acceptance. A historically closed; B alone active (execution paused for user-requested context clear); C–E pending. Packet order Q→F→G→T→I→V then C→D→E. Q finite slice, Messages exact failed-HTTP seam, and internal queued live declared-client-tool slice closed; **F/fulltools/B not closed**. No active feature gate remains: latest `b6974831c` completedPASS258/258 and consumed. Do not wait/relaunch it.

This fresh handoff supersedes earlier live/pending/next-action pointers in `api-key-budget-context-reset-20261011.md`, retaining that file as history. User requested documentation update and will restart after clearing context; no execution/dispatch launch in this handoff.

## Scope and guardrails

- Repo `/home/gmo/projects/9router`; direct execution/self-review only, one source/test writer. No delegation/advisors/provider swaps, new commit/push/merge/publish/release or production activation. Preserve intentional dirty WIP; no reset/revert/checkout cleanup.
- Default enforcement OFF. No live billable provider/OAuth/catalog/discovery/token-count probes. Owned disposable loopback+HOME/DATA_DIR/dummy credentials permitted for verification.
- Read root CLAUDE.md, docs/ARCHITECTURE.md and open-sse/AGENTS.md before engine changes. No engine→app import. Config/schema/bounds in config.
- Freeze source/tests/harness while gates run; only docs/read-only inspection meanwhile. Await native notifications, consume bg_logs/actualJSON/hash/inventory/lint even red. No polling/sleep; no full77gate relaunch or successful lane repetition for counts.
- Keep all13AC, ACK/deadlines/quorum/grace/TLS/redirect/proxy/schema/money contracts. No reservations/DB/Redis/RAMspendbuffer/multiwriter/scheduler/pruning.
- Own intent ACK before POST, own terminal ACK before eligible terminal, distinct authorization. Original price/wire/handle survives dispatch; legitimate debit may cross budget, successor admission alone checks spend. Unknown usage unresolved, notzero. Completion errors never cause second settlement/retry.
- Group32commands/256KiB/10000nodes/depth16; queue128entries/1MiB; routing64occurrences/depth16. No raw sensitive content/errors/headers/credentials in reports/ledger. Local cancellation does not prove foreign work stopped; observe/drain late work before teardown.
- Visible Vietnamese status: running taskID only when actually running; completed means stopped. Todo in_progress is not a process signal. No ETA/percent from counts.

## Current state

Observed2026-10-11T08:01:18Z before documentation edits: Git repository `/home/gmo/projects/9router`; branch `feat/api-key-quota-budget-pricing`; HEAD `0d94c72826e51cad1b2e773c133202be49f00e97`; master `a99cf57239ff778b61e434c2786009d5ed1c412c`. Worktree272entries=53modifiedtracked+219untracked, intentional WIP. Docs added/updated during this handoff can increase counts; reconcile actual state before mutation, not assume272 remains exact. No raw diff/statusdump included.

Session `01a129a0-f8b7-70c5-a34b-ad44f78dfb02` was direct source writer; previously recorded PID728357. On restart reconcile live writer/process/cwd before changing source; previous PID is historical not proof of current ownership. Latestgate PID778725 completed, not running. Temporary artifacts `/tmp/...` and `.pi/tasks/...` are local/ephemeral; if absent report missing evidence, do not fabricate or rerun indiscriminately.

## Decisions and rationale

- Original failed77gate `b4b3130c0` remains FAILED1607/1. Savedproxy port-reuse mechanism reproduced; testfixture realProxyAgent destroy-before-listener/DB-close repaired, not proven exact historical port attribution. Focused evidence closes finite Q slice, not a new77file allgreen claim.
- Failed HTTP status and billable raw usage independent. Explicitfailedreader defaultfalse; complete strictblocks/toolJSON/stop+EOF may settlefailed/originalprice. Fixed error/no rawfailedSSE to core/client. Separate issued failedterminal authority checks fresh original queuedauthority/wire/routing without second spend gate; unknown gate/success hook retained.
- Live raw clienttools use explicitdefaultfalse optin/fullblock fields/emptyinitialinput/boundedUTF8 JSON peropenblock20MiB/objectparse atstop, no wholemessage retention. SharedEOF/ACK/auth owner unchanged.
- Request eligibility defaults text-only for app/sync/GitHub. Only internal queued prepared-wire Anthropic live owner/candidate/dispatch opts into declared customtools from texthistory. Four app/sync guard regressions repaired without changing assertions. Buffered queued stilltoolsdenied. This is not a reason to leave original tools/app obligations undone.
- Cache incident is **separate investigation**, no feature scope change. Pi reports intermittent zero/partial cacheRead then recovery at same model; not idle/model-switch evidence. 9router key/connection/prefix/reporting and client/upstream hypotheses unproven. No config change. Report can be investigated separately; do not silently turn feature work into routing/cache repair.

## Work performed

- Test-only savedproxy lifecycle repair in `tests/unit/accounting-queued-saved-proxy-loopback.test.js`.
- FailedHTTP reader/owner: `open-sse/utils/accountingClaudeUsage.js`, `open-sse/executors/accountedAnthropic.js`; distinct terminal authority/provenance in `src/lib/apiKeyBudget/requestAccounting.js`; native/raw/core controls updated.
- Live declaredtools: `open-sse/config/accountedAnthropicCandidate.js`, `accountedAnthropicDispatch.js`, `accountingClaudeSchema.js`; observer+parser above and `accountingClaudeSseParser.js`; owner optin. Nativefile22→28; new `tests/unit/accounting-claude-live-tools.test.js`14.
- No synchronous/app/GitHubtools adoption, no toolhistory/beta/OAuth/1hTTL implementation yet. Existing sharedhelpers default denial preserved.
- Updated roadmap/remaining packets and seam reports; freshhandoff linked as currentauthority. Added sanitized `plans/reports/cache-miss-investigation-20261011-pi-9router.md` covering106k/108k and new172k/132k recurrence plus adjacent169780fullmiss; no livecache fix.

## Verification

Consumed exact gates (no pending/todo on completeJSON passes; hashsets stable during runs, not equal to originalgate after intentional edits):

- Q affected `b1751b3c5`26/26/exact4files/1349hashes/lintwhite0; `/tmp/9router-saved-proxy-lifecycle-impact-4exd4xpr`.
- FailedHTTP `b5ad9d4fa`198/198/native22/core103/raw58/queued15/exact4files/1349hashes/lint6/white0; `/tmp/9router-messages-failure-threshold-repair-ufrtu27k`.
- FailedHTTP sharedcontext `bf705853d`538/538/exact19files/5partitions/1349hashes/lint6/white0; `/tmp/9router-messages-failed-context-impact-19vyp3j7`. LSP6clean0diagnostics.
- Live candidate `b9ca7a2d7`117/117/exact4files/rawtools12/livetext32/raw58/queued15/1350hashes/lint6/white0; `/tmp/9router-messages-live-tools-candidate-fltc_4hh`.
- **Current live native/scope repair `ba00f1f7c`158/158**, exact4files/native28/rawtools14/dispatch13/core103/1350hashes/lint8/white0; `/tmp/9router-messages-live-tools-scope-repair-0gouur44`. ActualHTTP pending/originaltools/original106500 afterpriceedit/helddeliveredACKauth, malformed/missingstop/trailingerror soleunresolvedACK, lostdelivery retaininginstalleddebit/no terminal, credentialdequeue0POSTintent allreached. App/sync/core refusals unchanged/pass. LSP8clean0diagnostics, notsecuritycertificate.
- **Latest sharedimpact `b6974831c`258/258**, exact12files/4completeJSON lanes rawqueued105/GitHubnativeMessages47/GitHubconversion50/gatewaycontext56/1350hashes/lint8/white0; `/tmp/9router-messages-live-tools-impact-j9u8pmk0/{scope,inputs,inventory}.json` and perlane results. Native158reused not rerun. Not full77/exhaustive transitive scope.

Retained redreceipts: original77gate1607/1; failedHTTP10/4,113/5,15/1; live testfirst `be4a4913b`3/9 (early block refusal, later JSON/EOF/ACK unexecuted), native `b5a493651`154/4 (shared helper unapproved app/sync support regression) then repaired158/158. Original failures remainfailed; no relabel.

Build/browser/fullsecurity/alladapter/performance/fullsuite current B acceptance NOT completed. OwnedHTTP notproductionTLS/liveprovider/powerloss proof. Previous broader941/47,1251/56 and other baseline regressions remain historical/unwaived as mapped E. Reviewgraph/cascade unavailable is not clean proof; manualinspection+boundedtests carry finite scope.

## Open risks and blockers

- No decision blocker identified for next native client-tool text-result history seam; must inspect exact schema/transform/config before implementing. Current candidate refuses histories/app/sync; temporary safety is not fulltools completion.
- Remaining F: beta/OAuth/tools history/cache1h, GeminiOAuth/Vertex/nontext/options, other provider/compatible/web/binary/CLI accepted families per finitepreflight. G/T/I/V plus C/D/E stillpending; no silent scope cuts. Missing authoritative protocol/usage observability requires explicit evidence/supportdecision, not guessed counters.
- Defaultflags/provenance copies cannot grant caller authority. Queued/service fullwire equality/selection required; no public queued adoption inferred.
- Original13AC still allrequired. Bun/better-sqlite3 durability/managedrestore/fullsecurity/performance belong D/E and cannot be skipped via Node/SQL.js greens.
- Cachecause/billingunknown; separate report for user investigation, not a feature blocker or proven9router defect.

## Exact next actions

1. **First safe step**: read this handoff, plan.md and reports/package-b-remaining-work.md; reconcile live Git/writer and latest artifacts. No gate pending from this session, no wait/bg_status-reconfirm/relaunch of consumed tasks. Read seamreports selectively, not historical monoliths wholesale.
2. Continue F at **original+wire native client-tool history**, text-only tool_result: inspect current request validator, ROLE/CLAUDE_BLOCK constants, transform semantics, strict queued dispatch and rawowner. Preserve id/name/input/tool_use_id/is_error/content/order; reject unsupported servertools/media/beta/TTL rather than erase work. No invented usage from results.
3. Test-first one genuine two-turn tool_use→tool_result history with valid tooloutput/rawusage and durable pending/originalprice; malformed/authoritydrift/EOF/ownACK boundaries meaningful. Implement bounded explicitqueued optin, retaining defaultapp/sync/GitHub guards until separate supported integration. Finish native outcome then one relevantimpact, reuse current unmodified evidence. Do not keep extending closed declaredtools slice for counts.
4. Close only accepted namedseam; continue remaining F then G/T/I/V, closeB against original fullcriteria, only then C→D→E. Keep docs/todo truthful; no percent/ETA or wholefamily approval from narrowpasses.
5. When real product/support fact absent, state exactblocker and ask user only materialdecision. No new liveprobes/delegates/config/provider swaps or commitactivation authority.

## Source pointers

- `plans/261003-0827-api-key-quota-budget-pricing/plan.md` — sole roadmap/all13AC mapping.
- `reports/package-b-remaining-work.md`, `reports/execution-preflight.md`, `dispatch-inventory.md`, `acceptance-closure-matrix.md` beneath that plan.
- `reports/messages-live-tools-continuation.md`, `messages-failed-http-continuation.md`, `saved-proxy-lifecycle-investigation.md` — current finite evidence/retainedreds.
- `design-contract.md`, `reports/io-group-commit-cache-design.md`, original brainstorm13AC linkedfromplan.
- Source/tests listed above; schema roles/blocks and `open-sse/AGENTS.md`.
- `/tmp/9router-messages-live-tools-gate.py`, `/tmp/9router-messages-live-tools-impact.py`, exact artifact dirs under Verification; `.pi/tasks/01a129a0-f8b7-70c5-a34b-ad44f78dfb02-728357/b6974831c.output`.
- `plans/reports/cache-miss-investigation-20261011-pi-9router.md` — user cache incident report, separate from feature acceptance.
- `plans/handoffs/api-key-budget-context-reset-20261011.md` — prior historical capture only, current livepointers superseded here.
