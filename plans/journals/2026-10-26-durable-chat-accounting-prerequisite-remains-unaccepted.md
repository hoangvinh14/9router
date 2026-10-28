---
title: Durable chat accounting prerequisite remains unaccepted
date: 2026-10-26
summary: Fixed adapter close-failure proof invalidation; combined prerequisite gate still has one timeout.
---

# Durable chat accounting prerequisite remains unaccepted

## Work completed

Resumed P3 on feat/durable-chat-accounting. Scoped review found that an adapter engine-close failure could retain a recording-failure proof. Native SQLite and SQL.js now invalidate it. New real-adapter controls prove the existing lifecycle close refusal, then exercise the adapter-only close failure, denied proof and retained ownership. The migration export is named to remove its lint warning.

Two new controls passed; 39 affected authority/publication tests passed. The resumed combined policy/proof gate returned 18 passes and one Node pre-RELEASE timeout against its unchanged five-second limit. Lint, syntax and relative document link checks passed. Historical failed verification remains recorded.

## Disposition

Required failed-verification counsel found no proven cause-aligned timing repair. Ended this finite cycle without changing deadlines, concurrency, prewarm, durability or freshness guards. P3 and its prerequisite are in progress with all acceptance checkboxes open. The plan index was backed up before reindex/status changes.

## Remaining work

Identify the timing cause or explicitly revise the verification contract before another acceptance cycle. Complete request/key/route proof, fresh degraded-request capability, gap ACK and one-use permit, performance evidence, transport and JSON/SSE lifecycle work. Production activation, live data/inference and Git publication remain outside authorization.

Evidence: plans/reports/implementation-261026-1757-durable-chat-accounting.md. No server or watcher was started. This local journal is work history, not product acceptance. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
