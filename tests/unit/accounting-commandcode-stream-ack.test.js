import { describe, expect, it, vi } from 'vitest';
import { createAccountedOpenaiStream } from 'open-sse/utils/accountedOpenaiStream.js';
import { createAccountingCommandCodeNdjsonParser } from 'open-sse/utils/accountingCommandCodeNdjsonParser.js';

const encoder = new TextEncoder();
const usage = () => ({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 });
const events = () => [
  { type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 'text_fixture' },
  { type: 'text-delta', id: 'text_fixture', text: 'héllo' }, { type: 'text-end', id: 'text_fixture' },
  { type: 'finish-step', finishReason: 'stop', usage: usage() },
  { type: 'finish', finishReason: 'stop', totalUsage: usage() },
];
const wire = values => values.map(value => JSON.stringify(value) + '\n').join('');
const exact = { exact: true, input: 100, output: 20, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true,
  provenance: { schema: 'commandcode', endpoint: 'chat', inputIncludesCache: true } };
function deferred() { let resolve; const promise = new Promise(ready => { resolve = ready; }); return { promise, resolve }; }
function stream(response, accounting, extra = {}) {
  return createAccountedOpenaiStream(response, { accounting, attempt: { id: 'fixture-attempt' }, parserFactory: createAccountingCommandCodeNdjsonParser, ...extra });
}

describe('raw CommandCode shared-stream ACK boundaries (mock sink, not executor/durable-ledger certification)', () => {
  it('consumer delta precedes EOF, but finish-step/finish wait own ACK AND authorization', async () => {
    const deliveredDelta = deferred(), enteredAck = deferred(), ack = deferred(), enteredAuth = deferred(), auth = deferred();
    let upstream, delivered = '', ended = false;
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { enteredAck.resolve(); await ack.promise; return payload; }),
      assertSuccessfulTerminal: vi.fn(async () => { enteredAuth.resolve(); await auth.promise; }) };
    const text = wire(events());
    const response = new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(encoder.encode(text)); } }));
    const reader = stream(response, accounting).getReader();
    const work = (async () => {
      const decoder = new TextDecoder();
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += decoder.decode(chunk.value, { stream: true }); if (delivered.includes('text-delta')) deliveredDelta.resolve(); } delivered += decoder.decode(); ended = true; }
      finally { reader.releaseLock(); }
    })();
    try {
      await deliveredDelta.promise;
      expect(delivered).toContain('héllo'); expect(delivered).not.toContain('finish-step'); expect(accounting.completeAttempt).not.toHaveBeenCalled();
      upstream.close(); await enteredAck.promise;
      expect(ended).toBe(false); expect(delivered).not.toContain('finish-step'); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
      ack.resolve(); await enteredAuth.promise; expect(delivered).not.toContain('finish-step'); expect(ended).toBe(false);
    } finally {
      ack.resolve(); auth.resolve(); try { upstream.close(); } catch { /* already closed at observed EOF */ } await work;
    }
    expect(delivered).toBe(text); expect(delivered).not.toContain('[DONE]');
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: exact, outcome: 'success' });
    expect(accounting.assertSuccessfulTerminal).toHaveBeenCalledTimes(1);
  });

  it.each(['missing-finish', 'conflicting-total', 'synthetic-DONE'])('%s errors delivery while independent unresolved ACK remains pending', async kind => {
    const entered = deferred(), ack = deferred(), observedAck = deferred();
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { entered.resolve(); await ack.promise; observedAck.resolve(); return payload; }), assertSuccessfulTerminal: vi.fn() };
    const values = events();
    if (kind !== 'conflicting-total') values.pop();
    else values.at(-1).totalUsage = { ...usage(), inputTokens: 101, totalTokens: 121 };
    const reader = stream(new Response(encoder.encode(wire(values) + (kind === 'synthetic-DONE' ? '[DONE]\n' : ''))), accounting).getReader();
    let delivered = '';
    const work = (async () => { try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += new TextDecoder().decode(chunk.value); } } finally { reader.releaseLock(); } })();
    try {
      await expect(work).rejects.toThrow('Gateway accounting stream unavailable'); await entered.promise;
      expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: null, outcome: 'network_unknown' });
      expect(delivered).not.toContain('finish-step'); expect(delivered).not.toContain('[DONE]'); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
    } finally { ack.resolve(); await observedAck.promise; }
  });

  it('consumer cancellation during exact ACK preserves winner, suppresses terminal, and never authorizes success', async () => {
    const entered = deferred(), ack = deferred(), observedAck = deferred();
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { entered.resolve(); await ack.promise; observedAck.resolve(); return payload; }), assertSuccessfulTerminal: vi.fn() };
    const reader = stream(new Response(encoder.encode(wire(events()))), accounting).getReader();
    let delivered = '';
    const work = (async () => { for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += new TextDecoder().decode(chunk.value); } })();
    try {
      await entered.promise; expect(delivered).toContain('text-delta'); expect(delivered).not.toContain('finish-step');
      await reader.cancel('fixture consumer cancellation');
      expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: exact, outcome: 'success' });
      ack.resolve(); await observedAck.promise; await work;
      expect(delivered).not.toContain('finish-step'); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
    } finally { ack.resolve(); await work; reader.releaseLock(); }
  });
});
