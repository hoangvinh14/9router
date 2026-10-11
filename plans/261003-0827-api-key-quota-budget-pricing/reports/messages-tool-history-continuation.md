# Packet F — queued native Messages text tool history

2026-10-11 continuation from the 0801 handoff. User confirmed previous session stopped and authorized direct execution. One writer; no delegation/advisor/provider swap, live provider probes, commit/push/activation. B alone active, F still open; all13AC/default enforcement OFF unchanged.

## Accepted finite seam and implementation

Internal queued standard API-key **live** native Messages now accepts assistant `tool_use` followed immediately by user `tool_result` with string/text-block output. `supportsAnthropicLiveRequest` defaults false for client tools/history; explicit queued owner and live dispatch opt in. App/synchronous/GitHub remain text-only; buffered queued tools/history remain denied. This is candidate admission, never caller authority.

- Config validator uses existing bounded plain-data snapshot (256KiB/10000 nodes/depth16) before opt-in history traversal. Rejects programmable/non-JSON/nonfinite/oversize material rather than sanitizing it. Full prepared original+actual aggregate still independently bounded.
- Preserve IDs/names/input/tool_use_id/is_error/content/order and optional supported5m cache controls. No normalization, tool-name rewriting, guessed token counters or result-derived usage. Historical names need not occur in the current tool declarations.
- Each assistant use has a nonempty unique ID/object input; each result consumes exactly one pending ID in the immediately following user turn. Results precede subsequent text; every use must be resolved before next assistant work/admission. Parallel results may follow their own user order. Server tools, media, beta fields and1h cache TTL still rejected at this seam.
- Existing strict dispatch compares **entire** original and actual wire; transforms cannot erase unsupported work or change is_error/output. Issued provenance, SQL selection/credential freshness, original-price handle and separate own ACK/authorization remain mandatory.
- Raw observer/parser/shared stream/service unchanged. Unknown remains unresolved, terminal errors never trigger another settlement or POST.

Changed source: `open-sse/config/accountedAnthropicCandidate.js`; comment-only `accountedAnthropicDispatch.js`. Tests: new `tests/unit/accounting-claude-tool-history.test.js`25 controls; native loopback28→35. Test actually reads first tool stream, reconstructs its completed tool input, submits second-turn result and verifies two distinct request/attempt IDs, pending at each POST and original106500 debit after pricing edit. Further native missingstop/lostACK/dequeuecredential/wiredrift/erasedmedia/malformedhistory controls retain sole sink and no replay.

## Consumed receipts and retained reds

All terminal tasks stopped; no wait/relaunch pointer below. `/tmp` artifacts are local/ephemeral, absence is missing evidence rather than permission to invent it.

| Task | Outcome | Artifact / interpretation |
|---|---|---|
| `bfd67363c` | FAILED49pass/11fail, exact2files60actual | `/tmp/9router-messages-live-tools-history-before-a6340es4`: test-first validator positives/native history denied before implementation; EOF/ACK/drift not yet reached.1351stablehashes/lint9+white0. |
| `b3b533318` | SETUP FAILED, no Vitest execution | `/tmp/9router-messages-live-tools-history-native-stu9b2tq/scope.json`: nonexistent requested `chat-accounting-core.test.js`; harness assertion before hashes/tests/lint. Not a functional failure/coverage claim. Correct inventory uses `anthropic-accounting-owner.test.js`. |
| `bf9b424e5` | FAILED204pass/1fail, exact6files205actual, no pending/todo | `/tmp/9router-messages-live-tools-history-native-corrected-804pq2yt`: history25/rawtools14/dispatch13/queued15/appowner103 allpass; native34/35. Sole first native beforeEach cold-load timeout10s; POST/assertions unreached.1351stablehashes/lint9+white0. |
| `bb19de3d5` | FAILED34pass/1fail, exactnativefile | `/tmp/9router-messages-live-tools-history-native-cold-retry-kbgbd21w`: bounded unchanged retry reproduced same first-hook timeout; no deadline increase/prewarm. |
| `b168a68b6` | FAILED34pass/1fail, exactnativefile | `/tmp/9router-messages-live-tools-history-setup-diagnostic-qvcj873n`: sanitized stage timing adapter1229ms/importDb8387/listener8428/executor10593; hook10s expired and await continued into next fixture. No POST/assertion proof for first test. |
| `b67ecfaf1` | PASS35/35, exactnativefile, completeJSON/no pending/todo | `/tmp/9router-messages-live-tools-history-native-fixture-repair-lh6qdhuu`: fixture-only executor static module collection before hook-owned DB/listener; no ledger/network prewarm or deadline change.1351stablehashes/lint9+white0. |
| `b54a41ea4` | PASS243/243, exact11files/4completeJSON lanes | `/tmp/9router-messages-tool-history-impact-eqobldax/{scope,inventory,inputs}.json`: raw/text90/GitHubnative47/GitHubconversion50/gatewaycontext56.1351stablehashes/lint9+white0; independently verified actual JSON inventory/no pending/todo/current hashes. |

Only native fixture changed after204/1 receipt; independent hash comparison confirms other five files/current source unchanged. Reuse their170 positive assertions plus current native35; do **not** relabel204/1 as an allgreen rerun. Impact omits queued15 already verified/current and does not repeat native lanes/full77gate for counts. Historical failed receipts remain FAILED.

Harnesses: `/tmp/9router-messages-tool-history-gate.py`, `/tmp/9router-messages-tool-history-impact.py`, bounded disposable HOME/DATA_DIR/dummy secrets, maxWorkers1/no file parallelism,300s per test command. Dynamic imports accounted in module collection normally, not waived operational deadlines. Diagnostic instrumentation removed after receipt. Source/test/harness inputs frozen throughout every run.

LSP4changedpaths:3clean/1hint (inferred heterogeneous fixture content union at splice; runtime array positively known). No error/unavailable/inconclusive; not security certification. Lint logs and whitespace logs empty.

## Direct review/security and closure limits

Direct review: explicit boolean defaultfalse, plain bounded snapshot, ROLE/CLAUDE_BLOCK constants, strict allowlisted fields and complete original/wire equality; no engine→app import, credentials/headers/raw sensitive report content, route downgrade, TLS/proxy changes, retry/terminal/service changes. No new permissions from flags/provenance copies. Own intent before POST, sole sink and ACK-before-eligible-terminal remain unchanged. Native fixture verifies durable rows, not production TLS/liveprovider/powerloss/alladapter proof.

**Close only queued native text client-tool history seam.** Full F/tools/B not closed: public app/sync integration, original client conversions, beta/OAuth/1hTTL and other accepted families remain. Temporary unsupported refusals are not completion. Build/browser/fullsecurity/alladapter/performance/fullsuite remain later B/D/E obligations; cache investigation separate.

Next distinct Messages work: inspect production beta transport/request semantics, OAuth capture and5m/1h cache creation/rate authority **before** adopting any support. Finish named protocol facts/test-first actual boundaries; do not strip beta headers/OAuth semantics merely to fit standard fixtures. No live billable probes. Missing authoritative protocol/raw pricing/usage fact must be an explicit evidenced blocker/support decision, never invented counters or scope reduction. Then continue F→G→T→I→V and only Bclosed permits C→D→E.
