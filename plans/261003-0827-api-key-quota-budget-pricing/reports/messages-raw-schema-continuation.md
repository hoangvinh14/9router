# Queued Messages documented raw usage shapes

B alone active/F. Public app/synchronous/enforcement OFF; C–E and G/T/I/V not begun. Direct self-review, owned loopback HTTP/dummy credentials/disposable databases only. No activation/commit/push/live billable/OAuth calls.

## Finite implementation

Official streaming documentation https://platform.claude.com/docs/en/build-with-claude/streaming shows nonzero `message_start.usage.output_tokens` and token-only usage without conditional `server_tool_use` metadata. Initial observed output is now retained; later monotonic cumulative output replaces it, never adds it twice. Start/stop/EOF/model/event/block/counter invariants remain mandatory.

`allowAbsentServerToolUsage` is a boolean owner opt-in (default false). Internal queued Messages original+actual authority excludes server tools before POST, then supplies the opt-in to the live reader and buffered failed-HTTP reader. Missing conditional counters are not fabricated as zero. Explicit paid/unknown metadata, decreasing output, or paid server blocks remain rejected/unknown. Default observers still require explicit tool evidence. No estimates/media/reasoning token invention, paid-tool rates, or ordinary-path activation introduced.

## Receipts (overlapping lanes, not unique aggregate coverage)

- Test-first `bc19f01e9` **FAILED70pass/6fail**, retained `/tmp/9router-messages-raw-schema/red.json`.
- `bc843a514` native **76/76**, exact two files/no pending: live SSE37, API-key beta loopback39. Includes actual POST/original106500 debit/finaloutput20, start output2 with absent conditional tools, default refusal and boolean limits, valid prefix followed by decreasing output/paid counters/paid block rejection.
- `b052c51ed` impact **FAILED**, retained `/tmp/9router-messages-raw-schema/{scope,inputs,sqljs_native,affected,translator_context}.json`: actual SQL.js83pass/2fail; affected643pass/4fail/1todo across36exact files; translator-context13pass/1fail exact1file. Exact37file union,1363unchanged before/after input hashes, lint10/whitespace exit0. Two new OAuth fixture errors were `ReferenceError: failure is not defined` at the final assertion of the success/failed-HTTP cases; retained, not relabelled pass. Three other failed consumers reproduce on exact HEAD/same dependencies per prior `b8993187f`; existing todo remains unexecuted/not coverage.
- Fixture repair supplies server error capture (`failure` reset per test and caught async handler failures). Original cumulative usage, raw/status preservation, durable110250 debit/finaloutput20, held own ACK/no refresh assertions remain. Follow-up `b9d90b5f8` exact OAuth file **Node46/46 + SQL.js46/46**, no pending, fixture lint/whitespace exit0, `/tmp/9router-messages-raw-schema/{node_repair,sqljs_repair}.json`. Same case repetition on two real drivers, not additional unique coverage. Repaired affected gate `b9091f6bd` **FAILED** on the same37file inventory with separate `/tmp/9router-messages-raw-schema-repaired/{scope,inputs,sqljs_native,affected,translator_context}.json` receipts: actualSQL.js85/85 (OAuth46/API-key39), affected645pass/2fail/1todo across36exactfiles, translator-context13pass/1fail exact1file.1363 unchanged before/after hashes/lint10white0. No new seam failures remain; three failed consumers are the same HEAD-reproduced baseline assertions above, and todo remains unexecuted. Finite raw-schema seam verified, not an all-green affected gate or integrated B closure.
- Scoped LSP4 paths clean before fixture repair, repaired OAuth fixture1clean after; not a full build/security certification.

## Remaining boundaries/security

Original+actual authority stays mandatory; no unsupported request content stripped to obtain support. Secret/body material remains bounded internal wire and is not added to ledger/logs. ACK/deadline/quorum/collector/money/durability semantics unchanged. URL/file/citations/servertools/nonzero embedded tool pricing/additional beta/public app/other provider and protocol families remain open. Scoped passes do not establish large-file/TLS/proxy/whole-family or integrated B acceptance.
