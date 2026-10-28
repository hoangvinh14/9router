---
title: "SSE terminal lifecycle"
status: todo
---

# SSE terminal lifecycle

Depends on accepted JSON lifecycle and uses the same request/attempt owners
and [strict profile](./design-preparation.md#selected-protocol-evidence).
The implementation has 21 parser/watchdog controls and 40 actual app-flow
controls passing on Node SQLite/SQL.js. Final shared gates and combined
acceptance are complete; the
[final reconciliation](../reports/implementation-261028-1243-chat-plan-completion.md)
also includes 26 additional actual-flow controls and the full measurement.

## Implementation and files

1. Add `open-sse/utils/accounting-openai-stream.js` with one raw reader,
   incremental UTF-8/event parsing, bounded frame/terminal state and no whole
   stream buffer. Observe usage before translation, analytics or estimates.
2. Integrate `open-sse/handlers/chatCore/streamingHandler.js`,
   `open-sse/utils/stream.js` and `streamHandler.js`: content may pass; meaningful
   finish and DONE must await complete protocol evidence and own terminal ACK.
3. Preserve existing connect/stall limits and cancellation policy. Trailer
   absence/conflict, settlement failure or EOF cannot become synthesized success
   in translator flush/watchdog. After bytes, close in native error format.
4. Retain the sole late sink through disconnect/context disposal; no second
   debit or detached timer/reader. Unlimited failure follows the same explicit
   proof/gap precedence as JSON.

## Verification

- [x] `chat-accounting-stream.test.js` and `chat-accounting-stream-loopback.test.js`: fragmentation/UTF-8/CRLF/multiline, usage trailers, identical/conflicting duplicates and bounded parser state.
- [x] Both-adapter actual-loopback SSE cache matrix; compare raw usage, normalized counts and reopened original-rate costs.
- [x] Delta before held settlement allowed; success finish/DONE blocked until own ACK; lost ACK/EOF/stall/cancel yields native failure and no fake success.
- [x] Abort during settlement, late usage, two-key isolation, cleanup and no reader/timer leaks.
- [x] Relevant existing golden translator, Responses usage, strict proxy/default/no-key gates remain valid.

Use named suites through `npm --prefix tests test --`, 120-second bounds and
unchanged per-test limits. Follow the roadmap diagnostic protocol and cook
counsel checkpoint on failure. Do not claim every translated format/provider
from this selected OpenAI profile. Rollback retains all durable attempts and
coverage; public activation remains OFF.

## Final acceptance — October 28

Shared affected-consumer, lint/build and independent standalone smoke gates
passed. The final reconciliation maps the terminal/cleanup obligations and
preserves the selected-profile boundary. Earlier boundary below is history.

## Historical verification boundary — October 27

Selected functional controls pass. The shared build did not finish within its
300-second bound. The combined measurement retained 1600/4800 completed request
evidence before its own bound. Final acceptance stays incomplete; see the
[execution receipt](../reports/implementation-261027-chat-lifecycle.md).
