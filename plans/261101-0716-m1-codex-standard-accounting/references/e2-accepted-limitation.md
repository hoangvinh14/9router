# Owner decision — accept the E2 process-death accounting gap

## Authorization and status

The owner explicitly agreed to the recommendation not to build extra E2 recovery infrastructure and instructed: **“đồng ý khuyến nghị, sửa yêu cầu trong plan; tiếp theo hãy show tổng quan các mục còn lại, để tôi đánh giá là cần làm ko”**.

This record changes the requirement, **not the implementation or test result**. It supersedes the mandatory future-after-process-death delivery part of **E2 / E2-01** in this child and the pending source-selection/architecture decisions in [the earlier proposal](./e2-surviving-source-proposal.md). No source/C selected, no journal/service/consumer authorized, P5 remains cancelled. Historical proposal, source audits and receipts stay unchanged as chronology.

**Disposition: E2-01 recovery obligation removed from this child's required delivery by explicit owner decision; original functionality NOT demonstrated or implemented.** Overall remains **IN PROGRESS / NOT ACCEPTED** for independent remaining gates. This is neither a broad accounting waiver nor automatic parent M1/release acceptance.

## Revised required behavior

| Situation | Required disposition |
|---|---|
| Spend/usage already durably recorded before crash, including terminal-durable/own-ACK-lost | Preserve original amount/identity/price/startedAt/window exactly once on restart; do not reset spend or make an exhausted budget available again merely because of restart. Lost old ACK never authorizes a successor. |
| Original process remains alive after client disconnect/admission disposal | Existing lawful retained raw sink must still handle received valid late usage once at original context. No second reader, inferred zero or cancelled-admission revival. Existing ownership/publication/ACK requirements retained. |
| Process dies before usable usage is durably available | **Possible undercount is accepted; no guarantee of acquiring/reconstructing missing usage after death.** No guessing, text-based estimate, zero-cost inference or automatic resubmission to discover usage. Existing evidence-free pending B1 reopen may be unrecorded/costNULL where its prerequisites hold; missing/nonexistent records are not promised to appear. |
| Malformed/contradictory received evidence, failed persistence, unhealthy storage/coverage or lost ACK | Existing failure/unresolved/coverage rules remain. This decision does not relabel these as successful B1 absence/free usage, weaken normal persistence obligations or manufacture a delivered ACK. |

The accepted risk is **unmeasured provider spend and understated budget use after a crash**. Reference accounting is not guaranteed provider billing reconciliation or a hard spending cap. `NULL` means unknown/unrecorded under existing schema semantics, not numeric zero or evidence that no provider spend happened. A process-death gap and ordinary interrupted-absent B1 are not identical evidence claims.

## Exact boundary of the requirement change

- Remove E2-01's requirement to obtain **future evidence only available after the original process is dead**, via a surviving producer/new consumer.
- Do not build/poll/spool/add an independent acquisition owner solely to close that gap. If a provider later supplies a real trustworthy retrieval feature, evaluate it as a separately scoped improvement, not this plan's mandatory blocker.
- Keep original durable-truth/restart/known-spend, live late-sink, idempotency/conflict, original pricing/calendar, key isolation and own-ACK/no-successor rules. Existing E3-08/E3-09 results remain finite source-bound evidence for those separate invariants.
- Do not waive E1 encrypted-history behavior, E5 failed-usage/retry, P1–P4 producer semantics/prices, E3-07 native sensitivity, historical timing reds, security or E6's other prerequisites. These are presented for separate owner evaluation, not automatically cut by this decision.
- Do not introduce a public/body/environment opt-in, credentials access, production admission/activation, build/deploy or Git delivery authority.

## Acceptance hierarchy / parent impact

For this child, E6 no longer requires implementing the removed future-after-death source/delivery feature; it still requires applicable retained E2 durability/live-sink/restart controls and all other unamended gates. The acceptance matrix must label the original E2-01 as **owner-accepted limitation**, not “passed” or “implemented”.

Original parent M1/release documents and historical requirements are not rewritten by this child amendment. Any parent row requiring lossless future-after-death spend must carry this explicit accepted limitation to its own acceptance owner; **no parent requirement is silently satisfied, transferred or certified here**. The child's accepted risk is disclosed, not a claim of universal ledger completeness.

## Validation boundary

Documentation-only change. No runtime test is needed merely to change product acceptance; source input comparison and local document consistency are recorded separately. No historical receipt is promoted to current whole-tree evidence. [Remaining-items overview](./remaining-items-owner-review.md) distinguishes existing obligations from recommendations awaiting owner consent.
