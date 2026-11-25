---
title: Codex compact routing across retries
date: 2026-11-24
summary: Isolated compact routing and session identity per Codex invocation.
---

# Codex compact routing across retries

An overlapping ordinary compact and standard request reached each other's endpoints on 04978f00. Codex now captures route and session before the first dispatch and preserves the original compact marker for credential-refresh re-entry. The HTTP regression checks four requests including a 503 retry. Five Codex suites passed 51 tests and budget HTTPS composition passed 76. Phase 03 remains open for producer finality, applicable tariffs and strict proxy qualification.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
