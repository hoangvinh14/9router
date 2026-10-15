import { describe, it, expect, vi } from 'vitest';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { createAccountedOpenaiStream } from 'open-sse/utils/accountedOpenaiStream.js';
const original = () => ({ contents: [{ role: 'user', parts: [{ text: 'private prompt' }] }], tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Client lookup', parameters: { type: 'OBJECT' } }] }], toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } } });
const frame = (terminal = false) => ({ modelVersion: 'fixture-gemini', responseId: 'raw_owned', candidates: [{ index: 0, ...(terminal ? { finishReason: 'STOP' } : {}), content: { role: 'model', parts: terminal ? [] : [{ functionCall: { id: 'opaque_current', name: 'lookup', args: { q: 'private raw args' } }, thoughtSignature: 'b3BhcXVl' }] } }],
  ...(terminal ? { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 130, cachedContentTokenCount: 40, thoughtsTokenCount: 10, toolUsePromptTokenCount: 0 } } : {}) });
const event = value => `data: ${JSON.stringify(value)}\n\n`, encoder = new TextEncoder();
const parse = (values, config = {}) => { const events = [], parser = createAccountingGeminiSseParser(value => events.push(value), { expectedModel: 'fixture-gemini', clientToolsOriginal: original(), ...config }); for (const value of values) parser.push(encoder.encode(event(value))); return { events, usage: parser.finish() }; };
describe('isolated raw Gemini original-bound client functions, no provider dispatch grant', () => {
  it('JSON original bound whole call/signature conserves opaque raw material with exact tokens at EOF; default stays text-only', async () => {
    const raw = frame(true); raw.candidates[0].content.parts = frame().candidates[0].content.parts; const before = structuredClone(raw);
    const value = await readBufferedGeminiAccounting(Response.json(raw), undefined, { expectedModel: 'fixture-gemini', clientToolsOriginal: original() });
    expect(value.message).toEqual(before); expect(value.usage).toMatchObject({ exact: true, input: 100, output: 20, cacheRead: 40, reasoning: 10, reasoningIncludedInOutput: false });
    expect(() => inspectRawGeminiAccounting(raw, 'fixture-gemini')).toThrow(); expect(raw).toEqual(before);
  });
  it('SSE emits accepted call/signature frames unchanged but genuine finish/usage is only authority at clean EOF', () => {
    const values = [frame(), frame(true)], result = parse(values); expect(result.usage.exact).toBe(true);
    expect(new TextDecoder().decode(Buffer.concat(result.events.map(value => value.bytes)))).toBe(values.map(event).join(''));
    expect(result.events.filter(value => value.terminal)).toHaveLength(1); expect(parse([frame()]).usage).toBeNull();
    const parser = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', clientToolsOriginal: original() });
    const bytes = encoder.encode(values.map(event).join('')); for (const byte of bytes) parser.push(Uint8Array.of(byte)); expect(parser.finish().exact).toBe(true);
  });
  it('raw call names honor original declarations/current mode but history names cannot override NONE/allowed subset', () => {
    expect(parse([frame(), frame(true)]).usage.exact).toBe(true);
    for (const mutate of [b => { b.toolConfig.functionCallingConfig.mode = 'NONE'; delete b.toolConfig.functionCallingConfig.allowedFunctionNames; },
      b => { b.tools[0].functionDeclarations.push({ name: 'other', description: 'Other' }); b.toolConfig.functionCallingConfig.allowedFunctionNames = ['other']; }]) {
      const body = original(); mutate(body); expect(() => parse([frame(), frame(true)], { clientToolsOriginal: body })).toThrow();
    }
    const unknown = frame(); unknown.candidates[0].content.parts[0].functionCall.name = 'Task'; expect(() => parse([unknown, frame(true)])).toThrow();
    expect(() => parse([frame(), frame(true)], { clientToolsOriginal: null })).toThrow();
  });
  it('wrong roles/union/media/client results/invalid opaque signatures/args and duplicate raw IDs cannot become exact', () => {
    expect(parse([frame(), frame(true)]).usage.exact).toBe(true);
    for (const mutate of [v => { v.candidates[0].content.role = 'user'; }, v => { v.candidates[0].content.parts[0].text = 'union'; },
      v => { v.candidates[0].content.parts[0].functionCall.args = []; }, v => { v.candidates[0].content.parts[0].thoughtSignature = 'invalid'; },
      v => { v.candidates[0].content.parts = [{ functionResponse: { name: 'lookup', response: {} } }]; },
      v => { v.candidates[0].content.parts[0].functionCall.newBillable = 1; }, v => { v.candidates[0].content.parts = [{ inlineData: {} }]; }]) {
      const value = frame(); mutate(value); expect(() => parse([value, frame(true)])).toThrow();
    }
    expect(() => parse([frame(), frame(), frame(true)])).toThrow();
    const second = frame(); second.candidates[0].content.parts[0].functionCall.id = 'other'; expect(parse([frame(), second, frame(true)]).usage.exact).toBe(true);
  });
  it('nonzero/unknown tool monetary category, missing counters, paid early metadata and postterminal bytes remain unavailable', () => {
    expect(parse([frame(), frame(true)]).usage.exact).toBe(true);
    for (const mutate of [v => { v.usageMetadata.toolUsePromptTokenCount = 1; v.usageMetadata.totalTokenCount = 131; },
      v => { delete v.usageMetadata.candidatesTokenCount; }, v => { v.usageMetadata.unknownToolCounter = 1; }, v => { v.modelVersion = 'foreign'; }]) {
      const value = frame(true); mutate(value); expect(() => parse([frame(), value])).toThrow();
    }
    const early = frame(); early.usageMetadata = { toolUsePromptTokenCount: 1 }; expect(() => parse([early, frame(true)])).toThrow();
    expect(() => parse([frame(), frame(true), frame()])).toThrow();
  });
  it('bounded plain original/raw capture rejects programmable evidence without reading getters/proxies', () => {
    const raw = frame(true); raw.candidates[0].content.parts = frame().candidates[0].content.parts;
    expect(inspectRawGeminiAccounting(raw, 'fixture-gemini', { clientToolsOriginal: original() }).usage.exact).toBe(true);
    const getter = vi.fn(), trap = vi.fn();
    expect(() => inspectRawGeminiAccounting(Object.defineProperty(raw, 'usageMetadata', { enumerable: true, get: getter }), 'fixture-gemini', { clientToolsOriginal: original() })).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(() => inspectRawGeminiAccounting(new Proxy(frame(true), { ownKeys: trap }), 'fixture-gemini', { clientToolsOriginal: original() })).toThrow(); expect(trap).not.toHaveBeenCalled();
    const huge = frame(); huge.candidates[0].content.parts[0].functionCall.args.huge = 'x'.repeat(262145); expect(() => parse([huge, frame(true)])).toThrow();
  });
  it('terminal-contained calls and mixed text/signatures remain raw while original issued IDs cannot be reused', () => {
    const last = frame(true); last.candidates[0].content.parts = [{ text: 'private summary', thought: true, thoughtSignature: 'b3BhcXVl' }, ...frame().candidates[0].content.parts];
    expect(parse([last]).usage.exact).toBe(true);
    const body = original(); body.contents.push({ role: 'model', parts: [{ functionCall: { id: 'opaque_current', name: 'lookup', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'opaque_current', name: 'lookup', response: {} } }] });
    expect(() => parse([frame(), frame(true)], { clientToolsOriginal: body })).toThrow();
    const current = frame(); delete current.candidates[0].content.parts[0].functionCall.id;
    expect(parse([current, frame(true)]).usage.exact).toBe(true);
  });
  it('stream-local retained IDs are cumulative bounded metadata, independent instances share no client authority', () => {
    const parser = createAccountingGeminiSseParser(() => {}, { expectedModel: 'fixture-gemini', clientToolsOriginal: original() });
    const first = frame(); first.candidates[0].content.parts[0].functionCall.id = 'x'.repeat(20000); parser.push(encoder.encode(event(first)));
    expect(parse([first, frame(true)]).usage.exact).toBe(true);
    let refused = false;
    for (let i = 0; i < 20; i++) {
      const next = frame(); next.candidates[0].content.parts[0].functionCall.id = `${i}_${'x'.repeat(20000)}`;
      try { parser.push(encoder.encode(event(next))); } catch { refused = true; break; }
    }
    expect(refused).toBe(true); expect(() => parser.finish()).toThrow();
  });
  it('existing sole stream terminal owner holds native finish until its own ACK; call content is not success authority', async () => {
    let upstream, enter, release; const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const response = new Response(new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(encoder.encode(event(frame()) + event(frame(true)))); } }));
    const accounting = { completeAttempt: vi.fn(async (_attempt, payload) => { expect(payload.usage.exact).toBe(true); enter(); await held; return { state: 'settled', costNanoUsd: 124000 }; }), assertSuccessfulTerminal: vi.fn() };
    const parserFactory = (onEvent, limits) => createAccountingGeminiSseParser(onEvent, { ...limits, clientToolsOriginal: original() });
    const reader = createAccountedOpenaiStream(response, { accounting, attempt: {}, parserFactory, expectedModel: 'fixture-gemini' }).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(event(frame())); expect(accounting.completeAttempt).not.toHaveBeenCalled();
    let ended = false; const next = reader.read().then(value => { ended = true; return value; }); upstream.close();
    try { await Promise.race([entered, next.then(() => { throw new Error('terminal before own ACK'); })]); expect(ended).toBe(false); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); } finally { release(); }
    expect(new TextDecoder().decode((await next).value)).toBe(event(frame(true))); expect((await reader.read()).done).toBe(true); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.assertSuccessfulTerminal).toHaveBeenCalledTimes(1);
  });
});
