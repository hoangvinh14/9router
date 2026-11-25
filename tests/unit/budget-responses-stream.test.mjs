import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createAccountedResponsesStream } from '../../open-sse/utils/accounted-responses-stream.js';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { createNodeAttemptLedger, initializeNodeAttemptLedger } from '../../src/lib/accounting/node-attempt-ledger.js';
import { createNodeKeyPolicy, initializeNodeKeyPolicy } from '../../src/lib/accounting/node-key-policy.js';

assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);

const encoder = new TextEncoder();
const frame = (type, fields) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...fields })}\r\n\r\n`;
const created = frame('response.created', { response: { id: 'fixture-response' } });
const delta = frame('response.output_text.delta', { delta: 'caf\u00e9' });
const completed = frame('response.completed', { response: { id: 'fixture-response', status: 'completed',
  usage: { input_tokens: 130466, output_tokens: 25, input_tokens_details: { cached_tokens: 127744 } } } });
const failed = frame('response.failed', { response: { id: 'fixture-response', status: 'failed' } });

function pipe(chunks, settle, onTerminal = () => {}) {
  const upstream = new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
    controller.close();
  } });
  return upstream.pipeThrough(createAccountedResponsesStream(settle, onTerminal));
}

test('Responses completion waits for durable SQLite spend and the next dispatch is blocked at equality', async () => {
  const path = '/tmp/responses-stream.sqlite';
  const db = await createNodeSqliteAdapter(path);
  try {
    db.exec('CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, isActive INTEGER NOT NULL)');
    db.run("INSERT INTO apiKeys VALUES ('fixture-key','fixture-secret',1)");
    initializeNodeKeyPolicy(db);
    initializeNodeAttemptLedger(db);
    createNodeKeyPolicy(db).save('fixture-key', 0, { weekly: null, monthly: '37630000' });
    const ledger = createNodeAttemptLedger(db);
    const now = '2026-11-16T10:00:00.000Z';
    const command = { attemptId: 'first', keyId: 'fixture-key', bindingGeneration: '1',
      provider: 'codex', model: 'fixture-model', startedAt: now,
      price: { currency: 'USD', unit: 'USD/1M tokens', revision: 'fixture',
        rates: { input: '2', cached: '0.25', output: '10' } } };
    const credentials = { presentedSecret: 'fixture-secret', now };
    let posts = 0;
    const attempt = ledger.prepare(command);
    const stream = ledger.dispatch(attempt.ack, credentials, () => {
      posts++;
      return pipe([...encoder.encode(created + delta + completed)].map(byte => Uint8Array.of(byte)), attempt.settle);
    });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    assert.equal(decoder.decode((await reader.read()).value), created);
    assert.equal(decoder.decode((await reader.read()).value), delta);
    assert.equal(decoder.decode((await reader.read()).value), completed);
    const peer = new DatabaseSync(path, { readOnly: true });
    try {
      const terminals = peer.prepare('SELECT amount FROM accounting_terminals_v1').all();
      assert.deepEqual(terminals.map(row => row.amount), ['37630000']);
    } finally { peer.close(); }
    assert.equal((await reader.read()).done, true);
    const next = ledger.prepare({ ...command, attemptId: 'next' });
    assert.throws(() => ledger.dispatch(next.ack, credentials, () => posts++), { status: 503 });
    assert.equal(posts, 1);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_terminals_v1').n, 1);
  } finally { db.close(); }
});

test('Responses holds completion while an asynchronous settlement acknowledgement is pending', async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let published = false;
  const output = new Response(pipe([completed + 'data: [DONE]\r\n\r\n'], () => {
    entered.resolve();
    return release.promise;
  })).text().then(body => { published = true; return body; });
  await entered.promise;
  assert.equal(published, false);
  release.resolve();
  assert.equal(await output, completed + 'data: [DONE]\r\n\r\n');
  const splitDone = await new Response(pipe([completed + 'data: [DO', 'NE]\r\n\r\n'], () => {})).text();
  assert.equal(splitDone, completed);
});

test('downstream cancellation during terminal settlement preserves the received usage', async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const finalized = Promise.withResolvers();
  const recorded = [];
  const reader = pipe([completed], async evidence => {
    entered.resolve();
    await release.promise;
    recorded.push(evidence.components.map(({category, count}) => [category, count]));
  }, () => finalized.resolve()).getReader();
  try {
    const publication = reader.read();
    await entered.promise;
    const cancelled = reader.cancel();
    release.resolve();
    await Promise.all([cancelled, finalized.promise]);
    assert.equal((await publication).done, true);
    assert.deepEqual(recorded, [[['cached', 127744], ['input', 2722], ['output', 25]]]);
  } finally {
    release.resolve();
    reader.releaseLock();
  }
});

test('Responses preserves a native failure and refuses invalid or interrupted terminal evidence', async () => {
  const unexpected = () => assert.fail('unexpected settlement');
  assert.equal(await new Response(pipe([created, failed], unexpected)).text(), created + failed);
  for (const tail of ['', 'data: [DONE]\n\n', completed.slice(0, -2), completed + failed,
    completed.replace('fixture-response', 'different-id'), completed.replace('"completed"', '"failed"')]) {
    await assert.rejects(new Response(pipe([created, tail], unexpected)).text(),
      /Responses SSE|Responses terminal|Unexpected token/);
  }
  await assert.rejects(new Response(pipe([completed], () => Promise.reject(new Error('failed ACK')))).text(), /failed ACK/);
});


test('Codex preserves an incomplete terminal and awaits the acknowledgement for its reported usage', async () => {
  const incomplete = (reason, usage) => frame('response.incomplete', {
    response: { id: 'fixture-response', status: 'incomplete', incomplete_details: { reason }, usage },
  });
  for (const reason of ['max_output_tokens', 'interrupted']) {
    const terminal = incomplete(reason, { output_tokens: 25 });
    const output = await new Response(pipe([created, terminal], evidence => {
      assert.deepEqual(evidence.components.map(({ category, count }) => [category, count]), [['output', 25]]);
    })).text();
    assert.equal(output, created + terminal);
    await assert.rejects(new Response(pipe([terminal], () => {
      throw new Error('failed ACK');
    })).text(), /failed ACK/);
  }
  for (const terminal of [incomplete('max_output_tokens', null), incomplete('content_filter', { output_tokens: 25 })]) {
    assert.equal(await new Response(pipe([terminal], () => assert.fail('unexpected settlement'))).text(), terminal);
  }
});

test('Codex meters only usable nested response.failed usage and preserves the error frame', async () => {
  const failure = usage => frame('response.failed', {
    response: { id: 'fixture-response', status: 'failed', usage },
  });
  const metered = failure({ output_tokens: 25 });
  let settled = 0;
  assert.equal(await new Response(pipe([created, metered], evidence => {
    settled++;
    assert.deepEqual(evidence.components.map(({ category, count }) => [category, count]), [['output', 25]]);
  })).text(), created + metered);
  assert.equal(settled, 1);
  const topLevelError = frame('error', { usage: { output_tokens: 25 }, message: 'fixture failure' });
  for (const terminal of [failure(null), failure({ output_tokens: -1 }), topLevelError]) {
    assert.equal(await new Response(pipe([terminal], () => assert.fail('unexpected settlement'))).text(), terminal);
  }
});
