import { describe, expect, it } from 'vitest';
import { openaiToCommandCodeRequest } from 'open-sse/translator/request/openai-to-commandcode.js';
import { captureCommandCodeChatConversion } from 'open-sse/config/accountedCommandCodeChatCapture.js';
const model = 'deepseek/deepseek-v4-pro';
const body = () => ({ model, stream: true, max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] });
const runtime = () => ({ workingDir: '/fixture/retained-workspace', date: '2001-02-03', environment: 'linux' });

describe('real CommandCode translator explicit retained runtime (not executor/runtime provenance approval)', () => {
  it('legacy omitted runtime keeps ambient cwd/platform/date behavior', () => {
    const before = new Date().toISOString().slice(0, 10);
    const actual = openaiToCommandCodeRequest(model, body(), true);
    const after = new Date().toISOString().slice(0, 10);
    expect(actual.config.workingDir).toBe(process.cwd()); expect(actual.config.environment).toBe(process.platform);
    expect([before, after]).toContain(actual.config.date);
    expect(actual.threadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
  it('explicit retained runtime drives actual conversion without ambient cwd/date replacement', () => {
    const retained = Object.freeze(runtime()), input = body();
    const actual = openaiToCommandCodeRequest(model, input, true, null, retained);
    expect({ workingDir: actual.config.workingDir, date: actual.config.date, environment: actual.config.environment }).toEqual(retained);
    expect(actual.params.messages[0].content).toEqual([{ type: 'text', text: 'fixture prompt' }]); expect(input).toEqual(body());
  });
  it.each(['getter', 'proxy', 'invalid-date', 'unknown', 'null'])('explicit %s runtime refuses before any body conversion read', kind => {
    expect(openaiToCommandCodeRequest(model, body(), true, null, runtime()).config.date).toBe(runtime().date);
    let reads = 0; const touch = () => { reads++; throw new Error('fixture programmable runtime/body read'); };
    const input = {}; Object.defineProperty(input, 'messages', { enumerable: true, get: touch });
    let held = runtime();
    if (kind === 'getter') Object.defineProperty(held, 'workingDir', { enumerable: true, get: touch });
    if (kind === 'proxy') held = new Proxy(held, { get: touch, ownKeys: touch, getPrototypeOf: touch });
    if (kind === 'invalid-date') held.date = '2001-02-29';
    if (kind === 'unknown') held.extra = true;
    if (kind === 'null') held = null;
    expect(() => openaiToCommandCodeRequest(model, input, true, null, held)).toThrow(); expect(reads).toBe(0);
  });
  it('guarded full capture calls real translator once with held runtime and preserves its generated thread identity', () => {
    const original = { body: body(), model, stream: true, credentials: { apiKey: 'dummy-api-key', connectionId: 'c' }, config: {},
      providerOverrides: null, proxyOptions: null, runtime: runtime() };
    const retained = Object.freeze({ ...original.runtime });
    let calls = 0, generated;
    const captured = captureCommandCodeChatConversion(original, (selected, held, stream, credentials) => {
      calls++; generated = openaiToCommandCodeRequest(selected, held, stream, credentials, retained); return generated;
    });
    expect(calls).toBe(1); expect(captured.identity).toEqual({ threadId: generated.threadId, ...runtime() });
    expect(captured.actual).toEqual(generated); expect(Object.isFrozen(captured.actual.config)).toBe(true);
    original.runtime.workingDir = '/changed'; expect(captured.actual.config.workingDir).toBe(runtime().workingDir);
  });
});
