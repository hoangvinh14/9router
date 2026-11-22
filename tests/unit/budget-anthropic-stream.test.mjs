import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createAccountedAnthropicStream } from '../../open-sse/utils/accounted-anthropic-stream.js';
import { createStreamController, pipeWithDisconnect } from '../../open-sse/utils/streamHandler.js';
import { createAnthropicUsageAccumulator } from '../../src/lib/accounting/anthropic-usage.js';

assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
const encoder = new TextEncoder();
const frame = (type, fields = {}) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...fields })}\r\n\r\n`;
const start = frame('message_start', { message: { usage: { input_tokens: 10 } } });
const delta = frame('message_delta', { usage: { output_tokens: 2 } });
const stop = frame('message_stop');
const failure = frame('error', { error: { type: 'api_error' } });

function pipe(text, settle, { reset = false, chunkSize = 1, onTerminal = () => {} } = {}) {
  const bytes = encoder.encode(text);
  let offset = 0;
  const upstream = new Response(new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) {
        controller.enqueue(bytes.subarray(offset, offset + chunkSize));
        offset += chunkSize;
      } else if (reset) controller.error(new Error('upstream reset'));
      else controller.close();
    },
  }));
  const usage = createAnthropicUsageAccumulator();
  const attempt = { observe: usage.observe, settleStream: () => {
    assert.equal(usage.result().completed, true);
    return settle(usage.result().usage);
  } };
  return pipeWithDisconnect(upstream, createAccountedAnthropicStream(attempt, onTerminal),
    createStreamController({ log: { errorLine() {} } }), () => encoder.encode(failure), 5000);
}

test('split UTF-8, CRLF and multiline data preserve native frames and hold stop until acknowledgement', async () => {
  const content = frame('content_block_delta', { delta: { text: 'caf\u00e9' } });
  const multiline = 'event: ping\r\ndata: {"type":\r\ndata: "ping"}\r\n\r\n';
  const { promise, resolve } = Promise.withResolvers();
  const { promise: settling, resolve: entered } = Promise.withResolvers();
  let finished = 0;
  const body = pipe(start + content + multiline + delta + stop + stop, usage => {
    assert.deepEqual(usage.components.map(part => part.count), [10, 2]);
    entered();
    return promise;
  }, { onTerminal: () => finished++ });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  for (let i = 0; i < 4; i++) seen += decoder.decode((await reader.read()).value);
  assert.equal(seen, start + content + multiline + delta);
  const terminal = reader.read();
  await settling;
  assert.equal(finished, 0);
  resolve();
  assert.equal(decoder.decode((await terminal).value), stop);
  assert.equal((await reader.read()).done, true);
  assert.equal(finished, 1);
});

test('malformed and incomplete streams never publish success or invoke settlement', async () => {
  for (const tail of [stop.slice(0, -2), stop.replace('event: message_stop', 'event: ping'),
    'data: [DONE]\n\n', 'x'.repeat(1024 * 1024 + 1)]) {
    const result = await new Response(pipe(start + delta + tail, () => assert.fail('settled'),
      { chunkSize: 4096 })).text();
    assert.ok([start, start + delta].some(prefix => result === prefix + failure));
  }
  const reset = await new Response(pipe(start + delta, () => assert.fail('settled'), { reset: true })).text();
  assert.ok([start, start + delta].some(prefix => reset === prefix + failure));
});

test('upstream error stops the stream and an acknowledgement failure suppresses message_stop', async () => {
  const native = frame('error', { error: { type: 'overloaded_error' } });
  assert.equal(await new Response(pipe(start + native + stop, () => assert.fail('settled'))).text(), start + native);
  let calls = 0;
  const failed = await new Response(pipe(start + delta + stop, () => { calls++; throw new Error('storage'); })).text();
  assert.equal(failed, start + delta + failure);
  assert.equal(calls, 1);
});

test('client cancellation before terminal leaves the attempt unsettled', async () => {
  const reader = pipe(start + delta + stop, () => assert.fail('settled')).getReader();
  await reader.read();
  await reader.cancel();
});
