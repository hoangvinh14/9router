# Actual better adapter attempt2 — bounded lane PASS

Task `b6aa50c3f` completed exit0 on Node22.23.2/Linuxx64 ABI127 with publisher better-sqlite3 12.11.1 ABI127 binding in a private byte-identical source mirror.

## Results / evidence
**12 main scenario controls + contender child1 + fresh-process reopen child1 =14 named controls passed,0failed,0unreached,0skipped.** These are scenario counts, not Vitest assertion counts. [Receipt](./receipt.json), [main](./adapter-main-result.json), [contender](./adapter-contender-result.json), [reopen](./adapter-reopen-result.json), [runner output](./adapter-output.log), [inputs](./adapter-inputs.json), exact harness/resolver/preload bytes and3per-process ESM resolution logs are retained here.

Actual factory/driver chose better-sqlite3, no fallback accepted. Controls covered WAL/FULL, managed durable commit and memo boundary, second-factory/process exclusion, rollback/nesting/outermost restriction, active-transaction close guard, SQL transaction/read mutation guard and legitimate trigger, async refusal, thenable rollback/poison, checkpoint/closed-use, retained pre-open token refusal, migration/schema2/ACL column-helper roundtrip/failclosed corrupt allow-list, existing pricingRepo atomic model merge with explicit numeric zero, and normal-close fresh-process reopen of factory ACK plus driver/ACL/pricing.

ESM resolution logs from all3processes matched exact mirror/harness/builtin boundaries. Final CJS cache and addon hash checks passed in main and reopen; contender refuses ownership before engine-open, so is not native-query evidence. Addon hash `df9fbd0d061f360d81fb51e265c53c9605020bd68219e34f33c07c85de15719a` matches extracted pinned publisher binary. Original R3 DB/test hashes, all55mirror files, original ABI137 binding and exact runtime harness inputs matched postrun. No fixture writer lock/acquisition directory remained in bounded recursive observation; reported cleanupErrors empty. This is not an OS-wide handle/process audit.

## Changed input / historical failures
User explicitly approved adding required `createdAt` to the direct-SQL fixture: fixed ISO `2026-10-18T00:00:00.000Z`. Before launch comparison proved harness changed only that column/value/placeholder; runtime copies additionally rebase the private root literal. Source/schema/assertions/binary/timeouts unchanged. Fresh root `/tmp/9router-db-safety-abi127-TmIKGl`,60s parent/10s children, no new download/install/rebuild; previous failed root retained.

[Attempt1](../abi127-adapter-attempt1/disposition.md) remains FAILED,9mainpass1fail2unreached+contender1pass, due invalid fixture omitting required createdAt. Earlier ABI137 mismatch and preflight cache assertion reds also retained. Attempt2 stands alone; no pass totals synthesized across attempts.

## Security / acceptance limits
No production DATA_DIR, server/provider/OAuth traffic, inference/ledger/accounting or root dependency mutation. Selected JS network APIs blocked by preload; not an OS/native network sandbox. Publisher SHA pin is integrity evidence from the GitHub trust domain, not independent signature/malware proof.

This advances **only actual better-sqlite3 bounded integration evidence** for the isolated ABI127 binding. It does not make the original installed ABI137 addon compatible with Node22 or change Node24 avoidance. Source is executed as a byte-identical mirror, not original module paths. Reopen follows orderly close, not process-crash/power-loss certification. ACL test is column/helper composition, not full management/API authentication. No synthetic engine fault injection in this harness; existing fault controls stay separate.

Bun actual runtime, Windows filesystem/directory-fsync behavior, independent full-source review and two unresolved analytics failures remain open. Existing R3 combined result stays115pass2fail/117, not all-green. **DB prerequisite remains unaccepted WIP; P1 gate remains closed.** No additional execution, runtime install, CI action, support narrowing, commit/push or activation inferred from this pass.
