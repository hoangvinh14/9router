# P4 performance review — reviewed cost, scoped disposition

## Initial bounded measurement

Identical runner SHA256 `bc2c46d9291fea44f35831a0a121a2f1fdeb7da2991172d7e475f2de5abcd2c4` executed on exact P3 base `b41dca0a791bd464070e4d65c667381613ed5c8d` and current P4 source. Actual selected app/core/transport JSON/SSE localhost requests, Node SQLite/SQL.js, concurrency1/4/16, unlimited/generous finite USD1000 per window, 0/1000 synthetic current-window settled rows. Baseline finite policy is configured but **not enforced**. No warmup. Synthetic seed setup excluded; 20 requests per cell is a smoke sample, not steady-state/capacity evidence.

- 48 cells ×20 requests = **960 requests per revision**, 1920 total. Both completed, exact upstream/ledger/own-ACK/persisted-image invariants passed.
- Base total wall318982ms; current358076ms (+12.3%).
- Sum of cell elapsed times: base226870ms; current262021ms (**+15.5%**). This is **not** a mean per-request latency increase.
- Worst observed cells:
  - Node JSON finite c4/pop0:1349→4854ms (**3.60×**).
  - Node SSE unlimited c16/pop1000:1499→4897ms (**3.27×**).
  - Node SSE finite c16/pop0:1889→4671ms (**2.47×**).
  - SQL.js JSON finite c4/pop1000:4016→7743ms (**1.93×**).
- Raw samples and correctness: `verification-261028-p4-measure-initial-base.json`, `verification-261028-p4-measure-initial-current.json`; comparison `verification-261028-p4-measure-initial-comparison.json`.

## Initial disposition (superseded by repeat below)

**Performance was NOT cleared by the initial run.** The accepted plan requires review of a material regression; no fixed budget does not authorize waiving a slowdown. Advisor reviewed the signal and requested paired repeats/stage localization. No cache, rollup, counter table, deadline relaxation or concurrency serialization is introduced.

Prepared follow-up: six unique cells (the three suspicious scenarios plus matched finite/unlimited controls), identical updated runner bytes, A–B–B–A process order, fresh fixtures, 20 requests per cell/run =480 requests total. Record startup first request separately, raw samples, host load/memory/CPU, SQL category calls/time, durable group durations, intent/terminal ACK elapsed times, TTFT and completion. These overlapping measurements must not be summed. Exact service enqueue and JavaScript authority function times are unavailable, not zero. Each revision remains bounded by external timeout/kill grace. Run only after UI workload ends; no concurrent build/test/browser load. Prepared, not yet launched. Updated runner supports a strict six-cell allowlist and records SQL category calls/time, durable group timings, host load/memory/process CPU, first request and raw samples. A separate `measure-budget-paired.mjs` supervisor verifies identical runner/fixture bytes and runs A–B–B–A with external timeout/kill grace. SQL/commit instrumentation is disabled before correctness/reopen/cleanup checks, so those operations do not inflate measured stage counts. Exact JavaScript admission/queue times remain unavailable rather than zero. UI closure exposed a product display defect requiring a fresh build; repeat is postponed until that build and browser checks finish, to avoid contention.

Repeatable large slowdown requires diagnosis/repair or explicit operational acceptance; inconsistent data requires an unresolved-risk disposition. Do not claim regression-free or capacity equivalence. Production accounting/enforcement remains **OFF**.

## A–B–B–A result and scoped decision

All four runs completed120 requests each, **480 total**, with no accounting invariant failures. Runner SHA256 `2f7005e8258c0cd9004e642347214454a68ddb54731f6d9ed4462f0a2522605c` was identical; base/current backend source hashes match the initial runs. Fresh process/fixtures per run. No concurrent build/test/browser workload launched by this task. Host12 logical CPUs, load approximately2.8–4.4, free memory6.9–7.1GB. Host pressure outside the task was observed, not controlled.

| Cell | Base runs elapsed ms | Current runs elapsed ms | Current/base paired sum |
|---|---:|---:|---:|
| Node JSON unlimited c4/pop0 |3902,5417|4003,5348|1.003|
| Node JSON finite c4/pop0 |4155,4918|5070,4661|1.072|
| Node SSE unlimited c16/pop1000 |4242,5731|3295,6731|1.005|
| Node SSE finite c16/pop1000 |5001,4789|3789,7053|1.107|
| SQL.js JSON unlimited c4/pop1000 |6563,7128|8552,5912|1.056|
| SQL.js JSON finite c4/pop1000 |8542,7477|7640,10060|1.105|

Summed elapsed across these diagnostic cells: base67865ms, current72112ms, **+6.26%**. This is workload-weighted summed cell elapsed, not a per-request latency or general expected slowdown. Finite cells show approximately **+7–11%** paired sums. Wide per-run variability persists; the initial2–3.6× slowdowns were **not consistently reproduced**, not disproved. Twenty samples and two runs/revision do not establish an upper bound, statistical equivalence, steady-state throughput or production capacity.

Deterministic added reads are visible: policy reads+140 per20 requests (7/request). Finite cells add120 cost reads (6/request across three authority checks/two windows) and60 unresolved-state reads; unlimited cells perform no cost reads. In1000-row finite cells, total cost-query time was322/513ms on Node and1673/2544ms on SQL.js per20 requests. These timings overlap request/commit intervals and cannot be added as independent stages. Full JavaScript authority/queue timings remain unavailable. Baseline finite policy has no enforcement, so finite comparisons include the cost of newly required functionality.

**Decision:** retain the ledger-derived implementation for this selected fixture-only, production-OFF slice and close the mandatory material-regression *review*, with the observed cost documented. Rationale: no predefined performance budget, correctness invariants retained, no consistently reproduced multi-fold slowdown, and no evidence justifying caches/counters or weaker gates. Advisor reviewed this disposition conditionally; it received summaries, not independently verified traces. This is not performance equivalence, regression-free certification, a production SLO or activation approval.

Production requests without private association return `null` immediately in `captureChatAccounting` before session/service/gate creation. The new per-request policy/spend work is confined to associated fixtures; management GET remains an explicit admin projection, not an inference gate. Static activation tests and detached shipping inactive controls are separate supporting evidence. Broader workloads/adapters/platforms remain unvalidated.

Receipts: `verification-261028-p4-measure-abba.json`, four per-run JSON files, and `verification-261028-p4-measure-abba-analysis.json`. Preserve initial results alongside repeats. Overall P4 still requires remaining visual/trace/final-review reconciliation; this decision alone does not mark it complete.
