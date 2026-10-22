# Staged Linux-first acceptance contract — boundary approved, gate not yet passed

## Authorization and current status
On 2026-10-19 the user requested completion of the existing plan and selected: propose Linux-first acceptance, permit one independent read-only DB patch review, and diagnose the two usage-count failures before any analytics repair. Those initial choices did not themselves accept the prerequisite or waive Windows. In a later structured decision the user explicitly approved this staged Linux-development/testing boundary, a narrow dedup repair after caller/identity inspection, bounded shutdown design+repair, and one further independent read-only review. Acceptance conditions below still need to pass. No production activation, runtime install or Windows waiver follows.

## Approved conditional boundary
Accept the DB prerequisite **for continued Linux development/testing of P1 only**, after the conditions below pass or receive an explicit, evidence-backed decision. This is not all-platform release acceptance, permission to activate the product against a real DATA_DIR, or pricing completion.

- Retain all four adapter implementations and the original driver selection policy. No Windows support declaration is removed or changed to supported-by-inference.
- Label runtime evidence precisely: current Linux host, Node builtin SQLite/SQL.js affected suite, Node22.23.2 + private better-sqlite3 12.11.1 ABI127 mirror, and private Bun1.4.3 builtin SQLite mirror. Mirror/resolver/fault-injection evidence remains identified as such.
- Windows remains **unverified and a release gate** for the DB/pricing change. Do not deploy this change on Windows until actual ownership, directory-open/fsync, rename, cleanup, failed publication, close/reopen and consumer behavior are tested there. Linux startup/recovery evidence cannot substitute.
- No multi-process writer support, network-filesystem certification, power-loss certification, public native-engine escape, ledger/accounting, inference hooks, commit/push, runtime installation or production activation is authorized.

## Conditions before opening Linux P1 gate
1. Independent full-source review is delivered and material findings are dispositioned. Any relevant repair requires affected verification with new input hashes; R4 evidence cannot be inherited over changed files without justification.
2. Diagnosis of the two original usage-count failures establishes a bounded causal explanation and checks alternatives. The original 118/120 affected result remains FAILED. A diagnostic pass is not a replacement regression pass.
3. User explicitly chooses either a bounded analytics repair (with regression verification) or an evidence-backed exception allowing Linux development despite the named baseline failures. No exception is inferred from baseline identity alone.
4. Frozen source and receipts remain valid; accepted limitations, API/auth/CSRF/SSRF boundaries and remaining diagnostics are documented. Zero diagnostics with an inconclusive probe is not clean LSP evidence.
5. User accepts this staged boundary explicitly. DB acceptance is then recorded as Linux-development-only, not all-platform DONE. Windows obligation stays visible in both plans and release handoff.

## After a Linux development gate opens
Recheck the original P1 dependency manifest on the actual current source; only then implement pricing persistence/revision/snapshot/API and UI in the existing authorized order. Pricing tests must cover exact decimal lexemes and zero, numeric legacy responses, immutable snapshots, auth/CSRF/SSRF, bounded source handling, scheduler lifecycle, offline/restart and real page/modal behavior. No historical port evidence substitutes for current tests.

## If this boundary is declined
Keep P1 blocked until an actual Windows environment/handoff supplies the original all-platform evidence. Do not repeat successful Linux suites merely to conceal that missing condition.

## Decision record
2026-10-19: user selected “Duyệt Linux theo giai đoạn”, “Cho phép sửa hẹp dedup”, “Duyệt thiết kế + sửa giới hạn” shutdown, and “Cho phép review tiếp”. Condition5 (scope decision) is satisfied; bounded diagnosis is archived. Review, coherent final repairs and fresh regression/runtime verification remain open. This is not an acceptance receipt: prerequisite/P1 gate remains closed until those conditions are reconciled. Windows remains a release obligation, not removed support.
