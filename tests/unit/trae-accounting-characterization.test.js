import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.fetch(...args) }));
import TraeExecutor from 'open-sse/executors/trae.js';
import { PROVIDERS } from 'open-sse/config/providers.js';
import traeRegistry from 'open-sse/providers/registry/trae.js';
// Explicit fixture-only transport: production registry intentionally excludes Trae.
// Actual executor methods stay intact; this is NOT activation/support permission.
function fixtureExecutor() {
  const executor = new TraeExecutor();
  expect(PROVIDERS.trae).toBeUndefined(); expect(executor.config).toBeUndefined();
  executor.config = traeRegistry.transport;
  return executor;
}
const base = 'https://core-normal.trae.ai/api/remote/v1';
const eventsURL = `${base}/chat_sessions/fixture-session/events?reply_to_message_id=fixture-message`;
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const request = (extra = {}) => ({ model: 'gpt-5.4', stream: true, body: { messages: [{ role: 'user', content: 'fixture prompt' }] },
  credentials: { accessToken: 'fixture-jwt', providerSpecificData: { userRegion: 'US', webId: 'fixture-web' } }, ...extra });
function transport(response) {
  fixture.fetch.mockImplementation(async (url, options) => {
    if (url === `${base}/chat_sessions` && options.method === 'POST') return new Response(JSON.stringify({ code: 0, data: { chat_session_id: 'fixture-session', message_id: 'fixture-message' } }));
    if (url === eventsURL && options.method === 'GET') return response;
    throw new Error('Unexpected fixture Trae transport'); // Never falls through to native fetch.
  });
}
beforeEach(() => { fixture.fetch.mockReset(); });
describe('Trae actual legacy generation/evidence-loss characterization, NOT accounting support', () => {
  it('ordinary constructor has no transport config because registry intentionally hides Trae', async () => {
    expect(PROVIDERS.trae).toBeUndefined();
    const executor = new TraeExecutor(); expect(executor.config).toBeUndefined();
    await expect(executor.execute(request())).rejects.toThrow(/baseUrl/);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it('initial-message POST launches turn, GET subscribes; accounting and selected proxy are bypassed', async () => {
    transport(new Response(event('token_usage', { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }) + event('done', {})));
    const before = vi.fn(), complete = vi.fn();
    const result = await fixtureExecutor().execute(request({ accounting: { beforeAttempt: before, completeAttempt: complete }, proxyOptions: { proxyUrl: 'http://fixture.invalid:8080' } }));
    const output = await result.response.text(); expect(output).toContain('"prompt_tokens":100'); expect(output).toContain('data: [DONE]');
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    const [url, options, proxy] = fixture.fetch.mock.calls[0]; expect(url).toBe(`${base}/chat_sessions`); expect(options.method).toBe('POST'); expect(proxy).toBeNull();
    expect(options.headers.Authorization).toBe('Cloud-IDE-JWT fixture-jwt');
    const sent = JSON.parse(options.body); expect(sent.initial_message.model_name).toBe('gpt-5.4'); expect(sent.initial_message.model_selection_strategy).toBe('manual');
    expect(JSON.parse(sent.initial_message.query)).toEqual([{ type: 'text', data: { content: 'fixture prompt' } }]);
    expect(fixture.fetch.mock.calls[1][0]).toBe(eventsURL); expect(fixture.fetch.mock.calls[1][1].method).toBe('GET'); expect(fixture.fetch.mock.calls[1][2]).toBeNull();
    expect(before).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  });
  it('empty EOF synthesizes success stop/DONE without token_usage or raw done', async () => {
    transport(new Response('')); const result = await fixtureExecutor().execute(request()); const output = await result.response.text();
    expect(output).toContain('"finish_reason":"stop"'); expect(output).toContain('data: [DONE]'); expect(output).not.toContain('"usage"');
  });
  it('missing output/total default to zero while string prompt count remains a string', async () => {
    transport(new Response(event('token_usage', { prompt_tokens: '100' }) + event('done', {})));
    const result = await fixtureExecutor().execute(request({ stream: false })); const output = await result.response.json();
    expect(output.usage).toEqual({ prompt_tokens: '100', completion_tokens: 0, total_tokens: 0 });
  });
  it('nonstreaming partial text EOF without done still becomes successful completion', async () => {
    transport(new Response(event('plan_item', { id: 'p', thought: 'fixture partial' })));
    const result = await fixtureExecutor().execute(request({ stream: false })); const output = await result.response.json();
    expect(result.response.status).toBe(200); expect(output.choices[0].message.content).toBe('fixture partial'); expect(output.choices[0].finish_reason).toBe('stop'); expect(output.usage).toBeUndefined();
  });
  it('raw done cancels before EOF and discards trailing token_usage/error', async () => {
    const cancel = vi.fn(); transport(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(event('done', {}) + event('token_usage', { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }) + event('error', { code: 503, message: 'fixture late fault' }))); }, cancel })));
    const result = await fixtureExecutor().execute(request()); const output = await result.response.text();
    expect(cancel).toHaveBeenCalledTimes(1); expect(output).toContain('data: [DONE]'); expect(output).not.toContain('"usage"'); expect(output).not.toContain('fixture late fault');
  });
  it('usage preceding error is discarded; streaming error still emits synthetic DONE', async () => {
    transport(new Response(event('token_usage', { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }) + event('error', { code: 503, message: 'fixture fault' })));
    const result = await fixtureExecutor().execute(request()); const output = await result.response.text();
    expect(output).toContain('fixture fault'); expect(output).not.toContain('"usage"'); expect(output).toContain('data: [DONE]');
  });
  it('consumer receives prefix before late error; no settlement or second generation follows', async () => {
    let upstream; const cancel = vi.fn();
    transport(new Response(new ReadableStream({ start(c) { upstream = c; }, cancel })));
    const before = vi.fn(), complete = vi.fn();
    const result = await fixtureExecutor().execute(request({ accounting: { beforeAttempt: before, completeAttempt: complete } }));
    const reader = result.response.body.getReader(); const decoder = new TextDecoder();
    let output = decoder.decode((await reader.read()).value); expect(output).toContain('"role":"assistant"');
    upstream.enqueue(new TextEncoder().encode(event('plan_item', { id: 'p', thought: 'fixture delivered prefix' })));
    output += decoder.decode((await reader.read()).value);
    expect(output).toContain('fixture delivered prefix'); // Actual downstream read BEFORE fault injection.
    upstream.enqueue(new TextEncoder().encode(event('token_usage', { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }) + event('error', { code: 503, message: 'fixture late error' })));
    for (;;) { const next = await reader.read(); if (next.done) break; output += decoder.decode(next.value); }
    reader.releaseLock();
    expect(output).toContain('fixture late error'); expect(output).toContain('data: [DONE]'); expect(output).not.toContain('"usage"');
    expect(cancel).toHaveBeenCalledTimes(1); expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expect(fixture.fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    expect(before).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  });
  it('later usage replaces accepted positive usage and truthy negative counts survive', async () => {
    const positive = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
    const negative = { prompt_tokens: -3, completion_tokens: 1, total_tokens: -2 };
    transport(new Response(event('token_usage', positive) + event('token_usage', negative) + event('done', {})));
    const result = await fixtureExecutor().execute(request({ stream: false })); const output = await result.response.json();
    expect(output.usage).toEqual(negative); expect(output.usage).not.toEqual(positive);
  });
  it('malformed token_usage JSON becomes _raw then manufactured zero counters', async () => {
    transport(new Response('event: token_usage\ndata: not-json\n\n' + event('done', {})));
    const result = await fixtureExecutor().execute(request({ stream: false })); const output = await result.response.json();
    expect(output.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });
});
