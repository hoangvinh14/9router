# Saved-proxy native failure — packet Q investigation

## Authority and preserved failure

Direct continuation of [plan.md](../plan.md), original scope/all13AC unchanged. B alone active; default enforcement OFF. No full gate relaunch, delegation, live provider call, activation, commit or push. Original `b4b3130c0` remains **FAILED**,1607pass/1fail,77files/22complete partitions. Original1349 source/test/harness hashes independently matched before diagnosis. The failed assertion was `accounting-queued-saved-proxy-loopback.test.js:201:84`: responseOK/posts1 reached, trapHits1expected0; later tunnel/ledger/gap assertions unreached.

## Observations and causal experiment

1. `b1a0c08cc`, unchanged failed file alone:19/19, input hashes unchanged. `/tmp/9router-saved-proxy-diagnosis-FLT2Tt/{results,scope,inputs}.json`. Redacted Undici diagnostics, no external requests observed. This green alone did not classify or repair the original failure.
2. `b223c6d51`, unchanged original four-file native_proxy_1 partition:26/26, input hashes unchanged. `/tmp/9router-saved-proxy-partition-diag-G98yqd/{results,scope,inputs}.json`, `diagnostics.jsonl`. Trace shows the after-upstream-POST abort case's proxy server closed, then a late Undici CONNECT to that **old proxy/old upstream** during the immediately following saved-global-proxy case. It failed ECONNREFUSED in this run; the current case used its correct new saved proxy and upstream.
3. `bb63edf4b`, **FAILED18/1**, same exact original assertion and unchanged1349 inputs. `/tmp/9router-saved-proxy-port-reuse-Lwmeq3/{results,scope,inputs}.json`, `diagnostics.jsonl`. Diagnostic-only preload forced legal reuse of the closed owned abort proxy's port by the next case's trap. No production or foreign endpoint was redirected. Trace:
   - Old abort target40981/proxy32771 POST happened once; old proxy closed.
   - New current target46435/proxy46555; trap reused32771.
   - Current CONNECT46555→46435 and POST46435 succeeded.
   - Separately late CONNECT32771→**old40981** reached the trap, incrementing trapHits1.
   - No second upstream POST appeared. The exact trap assertion failed; later assertions remained unreached.

**Proven causal mechanism:** fixture teardown destroys accepted server sockets/listeners but leaves real ProxyAgent dispatchers alive across vi.resetModules. The aborted native transport can perform late connection work after its owner rejects/ACKs unknown. OS port reuse makes this work observable as a hit in a later test's trap, even though that later request uses correct saved precedence. This is not evidence of a current-request precedence escape or extra billable POST. Original failed run did not record port/target identity, so exact historical event attribution cannot be proven retrospectively; retain that limitation rather than calling it merely flaky or silently replacing the failed receipt.

## Bounded repair and verification

- First add deterministic owned closed-port reuse to the existing fixture without changing any existing assertions/deadlines/money/ACK semantics; observe the native regression before cleanup repair.
- Then capture real test-owned ProxyAgents through an actual-subclass constructor (no mocked dispatch/response) and await destroy during teardown **before** server/DB closure. No production routing/replay policy changes from this evidence.
- Run failed native file, then the affected original four-file partition, with exact JSON inventories/statuses, current hashes, focused lint and whitespace. Reuse unchanged other gate lanes; no fullgate repetition.
- `b84d5211b` deterministic native regression **FAILED18/1**, same trap assertion (now line209 after fixture insertion), exact one-file JSON/no pending/todo,1349 hashes unchanged during run, lint/whitespace0. `/tmp/9router-saved-proxy-lifecycle-before-aqgkxsi_/{results,scope,inputs}.json`. This reproduces without the diagnostic preload and remains a retained red.
- After receipt, added test-only real ProxyAgent subclass lifetime capture and awaited `dispatcher.destroy()` before accepted sockets/listeners/DB close. Deliberately hung abort responses make drain-by-close inappropriate; destroy is an explicit fixture-owned transport shutdown, not a claim that request cancellation stopped foreign work. Existing19 tests/assertions/deadlines unchanged.
- `b220e78fa` **PASS19/19**, exact one-file JSON/no pending/todo,1349 hashes unchanged during run, lint/whitespace0. `/tmp/9router-saved-proxy-lifecycle-repair-xype7q9k/{results,scope,inputs}.json`. Deterministic owned-port reuse retained; all original assertions reached including tunnel/ledger/gap. No production changes.
- `b1751b3c5` **PASS26/26**, original native_proxy_1 affected four-file partition/exact inventory/no pending/todo,1349 hashes unchanged during run, lint/whitespace0. `/tmp/9router-saved-proxy-lifecycle-impact-4exd4xpr/{results,scope,inputs}.json`. No fullgate relaunch; only failed fixture file changed relative to original gate. Other unchanged completed lanes reused, not a new all77file green claim. Packet Q finite slice closed; B remains active and F next.

## One bounded queued-slice self-review and next seam

Read queuedGeminiEmbeddingAccounting, queuedGeminiEmbeddingWire, accountedGeminiRequest again: queued provenance remains separate/exact issued identity; binder retains original complete wire/selection and original service completion sink; admission returns own handle intact; owner checks afterawait and completes sole refusal; terminal authority is not second budget admission. No new fault established in this reviewed narrow path. Existing Node/SQL.js native39 controls retain limits from remaining-work. This review is not proof of general OAuth/pools/aliases/public queued support; these stay in later packets.

After affected receipt, stop extending Q for more green counts. Next bounded F seam from source inspection: `executeAccountedAnthropicCandidate` only parses Claude SSE usage when `response.ok`; failed HTTP always reads text and leaves usage null even if the fully observed raw body has genuine message_start/delta/stop/EOF and exact counters. Thus exact failed-HTTP billable usage is silently dropped. Reuse the existing strict raw schema/sole reader and original-price/own-ACK service, implement and verify this seam without inventing JSON error token fields or granting production beta/OAuth/general Messages support. Unknown/malformed/error/truncated streams remain unresolved. Broader family obligations remain F, not removed by this seam.

## Security and limits

Only disposable loopback HTTP fixtures/dummy credentials; diagnostics omit headers, query URLs, bodies, authority and environment values. All recorded concrete ports belong to owned local servers. Trap remains non-forwarding. No TLS weakening, proxy fallback/replay permission or production queue adoption. No all-provider, all-adapter, power-loss, foreign-stop or Bclosure certification.
