---
title: "Per-POST transport boundary"
status: todo
---

# Per-POST transport boundary

Depends on accepted phase 1; its October 27 gates are green.
This named X5 prerequisite is independent of P3 and does not open X5 inventory.

Files: `open-sse/executors/base.js`, `open-sse/utils/proxyFetch.js` and
new `open-sse/utils/accounting-transport.js` and
`tests/unit/accounting-transport-boundary.test.js`, with disposable actual
fixtures under `tests/fixtures/accounting/`. One serial owner; no shared state
on executors. Reuse P2 receipts and the phase-1 private proof capability.

The transport ticket has async `prepare(wire)`, synchronous final
`assertDispatch(wire)`, and separate `response`/`failed` observation stages.
Every lower resend obtains a new ticket after the predecessor's observation.
The actual headers notification stops Base's original connect timer before
body/terminal observation. Immutable request/environment material is checked
again after dispatcher/DNS/socket/admission awaits; redirects are manual only
with a ticket. A consumed receipt is exposed/uncertain even on synchronous
native invocation failure; only pre-consumption refusal is not-dispatched.

1. Inventory every exposure: native fetch/direct/relay, lazy proxy dispatcher,
   TLS resend, proxy/direct fallback and MITM DNS/socket/module awaits. Bind
   actual URL/headers/body/credentials/environment/proxy selection before
   admission; validate current authority synchronously at actual exposure.
2. Every actual generation POST consumes its own receipt; no await between
   final check and exposure. Redirect auto-replay is refused only on the
   instrumented path; explicit TLS/proxy resends retain their own attempt and
   predecessor terminal ownership. No-hook behavior remains unchanged.
3. Keep local accounting refusal out of transport retry/fallback catches.
   Distinguish proven no exposure from uncertain network dispatch. Preserve
   strictProxy/TLS policy, AbortSignal and original connect timer start;
   no prewarm or new deadline budget.

- [x] Actual native loopback and saved HTTP proxy controls send intended POSTs with own ACKs; denial-only tests cannot establish support.
- [x] Hold/release/lost intent and dispatcher await; change credential/key/node/pool/settings/environment; count zero invalid POSTs and correct no-dispatch versus unresolved terminals.
- [x] Redirect and explicit transport resends cannot reuse receipts; two keys on shared executor retain independent ownership and bounded cleanup.
- [x] Run `base-executor-retry`, `antigravity-retry-hook`, `strict-proxy-enforcement` and `qoder-proxy-replay` affected suites with no-hook/default controls.

Run each named new suite with `npm --prefix tests test -- unit/<file>`,
120-second process bound, unchanged per-test/deadline/guard limits. Record
hypothesis and observations; invoke cook counsel before failed-verification
repair. Stop if a lower resend cannot have a proven owner; leave it assigned
and activation OFF rather than silently removing fallback support.
