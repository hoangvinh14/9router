import { describe, expect, it, vi } from 'vitest';
import { createAccountedOpenaiStream } from 'open-sse/utils/accountedOpenaiStream.js';
import { createAccountingKiroEventStreamParser } from 'open-sse/utils/accountingKiroEventStreamParser.js';
import { concatFixtureBytes, fixtureKiroEvent as frame } from '../helpers/accountingKiroFrames.js';

const text = () => frame('assistantResponseEvent', { content: 'Xin chào 🌍' });
const metrics = () => frame('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120,
  cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 });
const stop = () => frame('messageStopEvent', { stopReason: 'end_turn' });
const exact = { exact: true, input: 100, output: 20, cacheRead: 0, cacheWrite: 0,
  reasoning: 0, reasoningIncludedInOutput: true,
  provenance: { schema: 'kiro', endpoint: 'chat', inputIncludesCache: true } };
function deferred() { let resolve; const promise = new Promise(ready => { resolve = ready; }); return { promise, resolve }; }
function stream(response, accounting) {
  return createAccountedOpenaiStream(response, { accounting, attempt: { id: 'fixture-attempt' },
    provider: 'kiro', parserFactory: createAccountingKiroEventStreamParser });
}
function consume(reader, onChunk = () => {}) {
  const chunks = [];
  const work = (async () => {
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(next.value); onChunk(next.value); }
    } finally { reader.releaseLock(); }
  })();
  return { work, bytes: () => concatFixtureBytes(chunks) };
}

describe('Kiro binary shared-stream own ACK boundary (mock sink, not durable owner approval)', () => {
  it('consumer text precedes EOF, but binary metrics/stop/EOF wait own ACK AND authorization', async () => {
    const delivered = deferred(), enteredAck = deferred(), ack = deferred(), enteredAuth = deferred(), auth = deferred();
    let upstream, ended = false;
    const accounting = {
      completeAttempt: vi.fn(async (_attempt, payload) => { enteredAck.resolve(); await ack.promise; return payload; }),
      assertSuccessfulTerminal: vi.fn(async () => { enteredAuth.resolve(); await auth.promise; }),
    };
    const wire = concatFixtureBytes([text(), metrics(), stop()]);
    const response = new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(wire); } }));
    const reader = stream(response, accounting).getReader();
    const consumer = consume(reader, () => delivered.resolve());
    const work = consumer.work.then(() => { ended = true; });
    try {
      await delivered.promise;
      expect(consumer.bytes()).toEqual(text()); expect(accounting.completeAttempt).not.toHaveBeenCalled();
      upstream.close(); await enteredAck.promise;
      expect(consumer.bytes()).toEqual(text()); expect(ended).toBe(false);
      expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
      ack.resolve(); await enteredAuth.promise;
      expect(consumer.bytes()).toEqual(text()); expect(ended).toBe(false);
    } finally {
      ack.resolve(); auth.resolve(); try { upstream.close(); } catch { /* closed at observed EOF */ } await work;
    }
    expect(consumer.bytes()).toEqual(wire);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: exact, outcome: 'success' });
    expect(accounting.assertSuccessfulTerminal).toHaveBeenCalledTimes(1);
  });

  it.each(['missing-stop', 'corrupt-frame', 'synthetic-DONE'])('%s fails delivery while its independent unresolved ACK is still pending', async fault => {
    const delivered = deferred(), entered = deferred(), ack = deferred(), observedAck = deferred();
    let upstream;
    const accounting = {
      completeAttempt: vi.fn(async (_attempt, payload) => { entered.resolve(); await ack.promise; observedAck.resolve(); return payload; }),
      assertSuccessfulTerminal: vi.fn(),
    };
    const response = new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(text()); } }));
    const reader = stream(response, accounting).getReader();
    const consumer = consume(reader, () => delivered.resolve());
    // Attach rejection observation before injecting the intended failure.
    const rejection = expect(consumer.work).rejects.toThrow('Gateway accounting stream unavailable');
    try {
      await delivered.promise; expect(consumer.bytes()).toEqual(text());
      upstream.enqueue(metrics());
      if (fault === 'corrupt-frame') { const bytes = stop(); bytes[bytes.length - 1] ^= 1; upstream.enqueue(bytes); }
      if (fault === 'synthetic-DONE') upstream.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      upstream.close(); await rejection; await entered.promise;
      expect(consumer.bytes()).toEqual(text());
      expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
      expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: null, outcome: 'network_unknown' });
      expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
    } finally { ack.resolve(); await observedAck.promise; }
  });

  it('consumer cancellation during exact ACK retains the winner and suppresses binary terminals', async () => {
    const entered = deferred(), ack = deferred(), observedAck = deferred();
    const accounting = {
      completeAttempt: vi.fn(async (_attempt, payload) => { entered.resolve(); await ack.promise; observedAck.resolve(); return payload; }),
      assertSuccessfulTerminal: vi.fn(),
    };
    const reader = stream(new Response(concatFixtureBytes([text(), metrics(), stop()])), accounting).getReader();
    const consumer = consume(reader);
    try {
      await entered.promise; expect(consumer.bytes()).toEqual(text());
      await reader.cancel('fixture cancellation');
      expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
      expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: exact, outcome: 'success' });
      ack.resolve(); await observedAck.promise; await consumer.work;
      expect(consumer.bytes()).toEqual(text()); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
    } finally { ack.resolve(); await consumer.work; }
  });

  it.each(['ACK', 'authorization'])('%s rejection never releases binary terminals or rewrites the claimed exact winner', async fault => {
    const enteredAck = deferred(), ack = deferred(), enteredAuth = deferred(), auth = deferred();
    const accounting = {
      completeAttempt: vi.fn(async (_attempt, payload) => {
        enteredAck.resolve(); await ack.promise;
        if (fault === 'ACK') throw new Error('fixture lost ACK');
        return payload;
      }),
      assertSuccessfulTerminal: vi.fn(async () => { enteredAuth.resolve(); await auth.promise; throw new Error('fixture authorization refused'); }),
    };
    const reader = stream(new Response(concatFixtureBytes([text(), metrics(), stop()])), accounting).getReader();
    const consumer = consume(reader);
    const rejection = expect(consumer.work).rejects.toThrow('Gateway accounting stream unavailable');
    try {
      await enteredAck.promise; expect(consumer.bytes()).toEqual(text());
      ack.resolve();
      if (fault === 'authorization') { await enteredAuth.promise; expect(consumer.bytes()).toEqual(text()); auth.resolve(); }
      await rejection;
      expect(consumer.bytes()).toEqual(text());
      expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
      expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: exact, outcome: 'success' });
      expect(accounting.assertSuccessfulTerminal).toHaveBeenCalledTimes(fault === 'ACK' ? 0 : 1);
    } finally { ack.resolve(); auth.resolve(); await rejection; }
  });
});
