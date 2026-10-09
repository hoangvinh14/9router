import { describe, it, expect, vi } from 'vitest';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { createAccountedOpenaiStream } from 'open-sse/utils/accountedOpenaiStream.js';
const delta = () => ({ modelVersion: 'fixture-gemini', responseId: 'fixture', candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'Xin chào 🌏' }] } }] });
const terminal = () => ({ ...delta(), candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: '' }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 130, cachedContentTokenCount: 40, thoughtsTokenCount: 10, serviceTier: 'standard' } });
const event = (frame, nl = '\n') => 'data: ' + JSON.stringify(frame) + nl + nl;
const encoder = new TextEncoder();
const wire = nl => event(delta(), nl) + event(terminal(), nl);
const parsed = (chunks, limits = {}) => { const events = []; const parser = createAccountingGeminiSseParser(e => events.push(e), { expectedModel: 'fixture-gemini', ...limits }); for (const chunk of chunks) parser.push(chunk); return { events, usage: parser.finish() }; };
describe('genuine native Gemini SSE monetary terminal (not route approval)', () => {
  for (const nl of ['\n', '\r\n', '\r']) {
    const bytes = encoder.encode(wire(nl));
    for (let start = 0; start <= bytes.length; start += 128) it(`all UTF8/framing splits ${JSON.stringify(nl)} ${start}..${Math.min(start + 127, bytes.length)}`, () => {
      for (let split = start; split <= Math.min(start + 127, bytes.length); split++) {
        const result = parsed([bytes.slice(0, split), bytes.slice(split)]);
        expect(result.usage).toMatchObject({ exact: true, input: 100, output: 20, cacheRead: 40, reasoning: 10, reasoningIncludedInOutput: false });
        expect(result.events.filter(e => e.terminal)).toHaveLength(1); expect(new TextDecoder().decode(Buffer.concat(result.events.map(e => e.bytes)))).toBe(wire(nl));
      }
    });
  }
  it('one-byte Unicode chunks; no invented DONE and exact native byte replay', () => {
    const bytes = encoder.encode(wire('\r\n')); const result = parsed([...bytes].map(b => Uint8Array.of(b)));
    expect(result.usage.exact).toBe(true); expect(Buffer.concat(result.events.map(e => e.bytes)).equals(Buffer.from(bytes))).toBe(true);
  });
  it('nonterminal complete-looking usage cannot supply finish', () => {
    const early = delta(); early.usageMetadata = { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 130, thoughtsTokenCount: 10 };
    expect(parsed([encoder.encode(event(early))]).usage).toBeNull();
  });
  const mutations = {
    'wrong model': m => { m.modelVersion = 'fixture-gemini-001'; },
    'missing final model': m => { delete m.modelVersion; },
    'wrong response': m => { m.responseId = 'foreign'; },
    'invalid total': m => { m.usageMetadata.totalTokenCount = 129; },
    'missing usage': m => { delete m.usageMetadata; },
    'tier': m => { m.usageMetadata.serviceTier = 'priority'; },
    'nontext': m => { m.candidates[0].content.parts = [{ inlineData: {} }]; },
    'hosted work': m => { m.candidates[0].groundingMetadata = {}; },
    'tool charge': m => { m.usageMetadata.toolUsePromptTokenCount = 1; },
    'null counters': m => { m.usageMetadata.thoughtsTokenCount = null; },
    'error finish': m => { m.candidates[0].finishReason = 'SAFETY'; },
    'duplicate candidate': m => { m.candidates.push(m.candidates[0]); },
  };
  it.each(Object.entries(mutations))('%s rejects terminal', (_name, mutate) => { const last = terminal(); mutate(last); expect(() => parsed([encoder.encode(event(delta()) + event(last))])).toThrow(); });
  it.each(['data: [DONE]\n\n', 'data: {"error":{"code":429}}\n\n', event(delta()), event(terminal()), 'event: error\n\n'])('post terminal material %s fails, cannot lend earlier exact usage', suffix => {
    expect(() => parsed([encoder.encode(wire('\n') + suffix)])).toThrow();
  });
  it('early paid-work metadata cannot be overwritten by good final usage', () => {
    const early = delta(); early.usageMetadata = { toolUsePromptTokenCount: 1 };
    expect(() => parsed([encoder.encode(event(early) + event(terminal()))])).toThrow();
  });
  it('fatal UTF8, event/chunk byte bounds, sticky parser invalidation', () => {
    expect(() => parsed([Uint8Array.of(0xff)])).toThrow();
    expect(() => parsed([encoder.encode(wire('\n'))], { maxChunkBytes: 2 })).toThrow();
    expect(() => parsed([encoder.encode(wire('\n'))], { maxEventBytes: 10 })).toThrow();
    const parser = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini' }); expect(() => parser.push(Uint8Array.of(0xff))).toThrow(); expect(() => parser.finish()).toThrow();
  });
  it('no new output/event count restriction on streaming deltas', () => {
    const parser = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini' }); const bytes = encoder.encode(event(delta()));
    for (let i = 0; i < 17000; i++) parser.push(bytes);
    parser.push(encoder.encode(event(terminal()))); expect(parser.finish().exact).toBe(true);
  });
});
describe('native Gemini parser uses existing sole stream terminal owner', () => {
  it('delta flows while EOF held; finish withheld until EOF/ACK/auth, one exact settlement', async () => {
    let upstream, releaseAck, entered;
    const response = new Response(new ReadableStream({ start(c) { upstream = c; c.enqueue(encoder.encode(wire('\n'))); } }), { headers: { 'content-type': 'text/event-stream' } });
    const ack = new Promise(resolve => { releaseAck = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { expect(payload.usage.exact).toBe(true); entered(); return ack; }), assertSuccessfulTerminal: vi.fn() };
    const stream = createAccountedOpenaiStream(response, { accounting, attempt: {}, parserFactory: createAccountingGeminiSseParser, expectedModel: 'fixture-gemini' }); const reader = stream.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(event(delta())); expect(accounting.completeAttempt).not.toHaveBeenCalled();
    let delivered = false; const terminalRead = reader.read().then(value => { delivered = true; return value; }); upstream.close(); await started; expect(delivered).toBe(false); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
    releaseAck({ state: 'settled', costNanoUsd: 124000 }); expect(new TextDecoder().decode((await terminalRead).value)).toBe(event(terminal())); expect((await reader.read()).done).toBe(true);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.assertSuccessfulTerminal).toHaveBeenCalledTimes(1);
  });
  it.each(['missing-finish', 'trailing-invalid', 'read-error', 'ACK-failure', 'auth-failure'])('%s never releases successful native finish or re-settles', async mode => {
    const content = mode === 'missing-finish' ? event(delta()) : wire('\n') + (mode === 'trailing-invalid' ? 'data: {}\n\n' : '');
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(encoder.encode(content)); if (mode === 'read-error') c.error(new Error('foreign read')); else c.close(); } }));
    const accounting = { completeAttempt: vi.fn(async () => { if (mode === 'ACK-failure') throw new Error('ACK'); return { state: 'settled', costNanoUsd: 124000 }; }), assertSuccessfulTerminal: vi.fn(async () => { if (mode === 'auth-failure') throw new Error('auth'); }) };
    const stream = createAccountedOpenaiStream(response, { accounting, attempt: {}, parserFactory: createAccountingGeminiSseParser, expectedModel: 'fixture-gemini' }); const reader = stream.getReader(); let text = '';
    await expect((async () => { while (true) { const value = await reader.read(); if (value.done) return; text += new TextDecoder().decode(value.value); } })()).rejects.toThrow();
    await new Promise(resolve => setImmediate(resolve)); expect(text).not.toContain('finishReason'); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    if (['missing-finish', 'trailing-invalid', 'read-error'].includes(mode)) expect(accounting.completeAttempt.mock.calls[0][1].usage).toBeNull();
  });
});
