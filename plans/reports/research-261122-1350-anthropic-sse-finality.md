# Anthropic Messages SSE completion

Reviewed 2026-11-22, Asia/Ho_Chi_Minh.

Anthropic documents a successful first-party Messages stream as one message start, content blocks, one or more message deltas and a final message stop. Usage in deltas is cumulative. Pinned Python SDK v0.84.0 replaces counters with the received values and retains earlier optional input/cache counters when a delta does not supply a non-null value. 9Router keeps the approved D01 handling of explicit invalid or null counters as unknown. An SSE error can arrive after HTTP 200. There is no published guarantee here that the last counters seen on a failed or interrupted stream include all billable usage. [Event contract](https://platform.claude.com/docs/en/build-with-claude/streaming#event-types) · [Pinned SDK accumulator](https://github.com/anthropics/anthropic-sdk-python/blob/v0.84.0/src/anthropic/lib/streaming/_messages.py)

The accounting accumulator now exposes whether it observed the ordered terminal sequence without an error. The existing stream settlement method refuses incomplete sequences. If an otherwise complete stream has missing counters, D01 preserves known cost and labels the rest unknown/defaulted. This was verified in the isolated primitive suite. Executor and composed C0 regressions passed. The public runtime still accepts only the existing internal C0 JSON profile.

## Remaining Phase 03 evidence

The current passthrough transform parses individual data lines and may synthesize an OpenAI sentinel. The raw owner needs to recognize a complete native SSE frame and its matching event type before accepting a terminal, and await the ledger acknowledgement before publishing the terminal event. Tests must cover chunk boundaries, cancellation, errors, known partial usage, tool/thinking continuity and no replay. Provider evidence for failure cutoff and the retained C1-C3 model/auth compositions is still open.

## Follow-up on mid-stream errors

The first-party errors reference confirms an SSE error can arrive after HTTP 200. The stream error example contains only the error type and message. The recovery guide describes saving received content and sending a new request. It gives a separate continuation shape for Claude 4.6 and later. The cumulative-usage rule describes counters in `message_delta`. These sections give no billing cutoff for a stream that ends with an error or disconnects. Keep positive failure settlement and replay eligibility open for P2. [API errors](https://platform.claude.com/docs/en/api/errors) · [Streaming events and recovery](https://platform.claude.com/docs/en/build-with-claude/streaming#error-recovery).

The internal loopback fixture now verifies the native error with one POST and zero successor or terminal rows. The successful tool/thinking response fixture verifies byte-for-byte forwarding and counts provider tokens once. [Phase 03 composition results](../261114-0438-api-key-budget-clean-integration/phase-03-native-retry-and-compatibility.md#offline-sse-tool-and-thinking-response-fidelity).
