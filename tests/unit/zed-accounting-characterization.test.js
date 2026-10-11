import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ transport: vi.fn(), completion: vi.fn(), calls: [] }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.transport(...args) }));
import ZedExecutor from 'open-sse/executors/zed.js';
import { clearZedCaches } from 'open-sse/shared/zedAuth.js';
const model = 'fixture-grok-model';
const credentials = () => ({ accessToken: 'dummy-zed-access', providerSpecificData: { userId: 'fixture-user', organizationId: 'fixture-org', systemId: 'fixture-system' } });
const args = accounting => ({ model, body: { messages: [{ role: 'user', content: 'fixture prompt' }] }, stream: true, credentials: credentials(), accounting });
const textEvent = { id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'fixture text' }, finish_reason: null }] };
beforeEach(() => {
  clearZedCaches(); fixture.calls = []; fixture.transport.mockReset(); fixture.completion.mockReset();
  fixture.transport.mockImplementation(async (url, options, proxy) => {
    fixture.calls.push({ url, options, proxy });
    if (url === 'https://cloud.zed.dev/client/llm_tokens') {
      expect(options.method).toBe('POST'); expect(options.headers.Authorization).toBe('fixture-user dummy-zed-access');
      expect(JSON.parse(options.body)).toEqual({ organization_id: 'fixture-org' });
      return Response.json({ token: 'dummy-zed-llm-token' });
    }
    if (url === 'https://cloud.zed.dev/models') return Response.json({ models: [{ id: model, provider: 'x_ai' }] });
    if (url === 'https://cloud.zed.dev/completions') return fixture.completion(options);
    throw new Error('Unexpected fixture URL; outbound transport is fully mocked');
  });
});
describe('actual legacy Zed executor/auth helper accounting characterization (mock transport; no ownership grant)', () => {
  it('empty clean upstream EOF synthesizes DONE without raw usage, provider terminal or accounting admission', async () => {
    fixture.completion.mockResolvedValue(new Response(''));
    const before = vi.fn(), complete = vi.fn(), result = await new ZedExecutor().execute(args({ beforeAttempt: before, completeAttempt: complete }));
    expect(await result.response.text()).toBe('data: [DONE]\n\n');
    expect(before).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled(); expect(fixture.completion).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fixture.completion.mock.calls[0][0].body)).toMatchObject({ provider: 'x_ai', model, provider_request: { model, stream: true } });
  });
  it('malformed NDJSON is silently erased and EOF still synthesizes DONE', async () => {
    fixture.completion.mockResolvedValue(new Response('{invalid-json}\n'));
    const result = await new ZedExecutor().execute(args(null));
    expect(await result.response.text()).toBe('data: [DONE]\n\n'); expect(fixture.completion).toHaveBeenCalledTimes(1);
  });
  it('raw DONE causes later failure and usage frames to be ignored after delivered text', async () => {
    fixture.completion.mockResolvedValue(new Response(JSON.stringify({ event: textEvent }) + '\n[DONE]\n' + JSON.stringify({ status: { failed: { message: 'fixture late failure' } } }) + '\n' + JSON.stringify({ event: { usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } } }) + '\n'));
    const result = await new ZedExecutor().execute(args(null)), reader = result.response.body.getReader(); let delivered = '';
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += new TextDecoder().decode(chunk.value); }
    } finally { reader.releaseLock(); }
    expect(delivered).toContain('fixture text'); expect(delivered.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(delivered).not.toContain('fixture late failure'); expect(delivered).not.toContain('prompt_tokens');
  });
  it('consumer receives genuine prefix before late failed status is rendered as success-shaped stop and DONE without settlement', async () => {
    let upstream; const encoder = new TextEncoder();
    fixture.completion.mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      upstream = controller; controller.enqueue(encoder.encode(JSON.stringify({ event: textEvent }) + '\n'));
    } })));
    const complete = vi.fn(), result = await new ZedExecutor().execute(args({ completeAttempt: complete })), reader = result.response.body.getReader(); let delivered = '';
    try {
      const prefix = await reader.read(); expect(prefix.done).toBe(false); delivered += new TextDecoder().decode(prefix.value);
      expect(delivered).toContain('fixture text'); expect(delivered).not.toContain('[DONE]'); expect(complete).not.toHaveBeenCalled();
      upstream.enqueue(encoder.encode(JSON.stringify({ status: { failed: { message: 'fixture late failed status' } } }) + '\n')); upstream.close();
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; delivered += new TextDecoder().decode(chunk.value); }
      expect(delivered).toContain('[Zed error] fixture late failed status'); expect(delivered).toContain('"finish_reason":"stop"');
      expect(delivered.match(/data: \[DONE\]/g)).toHaveLength(1); expect(complete).not.toHaveBeenCalled(); expect(fixture.completion).toHaveBeenCalledTimes(1);
    } finally { try { upstream.close(); } catch { /* already closed */ } reader.releaseLock(); }
  });
  it('actual executor drops selected proxy evidence before token/model/completion helper dispatch', async () => {
    fixture.completion.mockResolvedValue(new Response(''));
    const result = await new ZedExecutor().execute({ ...args(null), proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '' } } });
    await result.response.text(); expect(fixture.calls).toHaveLength(3);
    expect(fixture.calls.map(call => call.url)).toEqual(['https://cloud.zed.dev/client/llm_tokens', 'https://cloud.zed.dev/models', 'https://cloud.zed.dev/completions']);
    expect(fixture.calls[0].proxy).toBeNull(); expect(fixture.calls[1].proxy).toBeUndefined(); expect(fixture.calls[2].proxy).toBeUndefined();
  });
  it('refresh replaces a still-unread failed generation body without cancelling it', async () => {
    const cancel = vi.fn(), first = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('fixture failed generation')); }, cancel }), { status: 401 });
    fixture.completion.mockResolvedValueOnce(first).mockResolvedValueOnce(new Response(''));
    const result = await new ZedExecutor().execute(args(null)); await result.response.text();
    expect(fixture.completion).toHaveBeenCalledTimes(2); expect(first.bodyUsed).toBe(false); expect(cancel).not.toHaveBeenCalled();
    await first.body.cancel('fixture cleanup'); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(['status401', 'expired-header'])('%s triggers actual auth helper token refresh and completion POST2 without per-generation accounting', async reason => {
    fixture.completion.mockResolvedValueOnce(reason === 'status401' ? new Response('fixture rejected', { status: 401 }) : new Response('fixture expired', { headers: { 'x-zed-expired-token': 'true' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ event: textEvent }) + '\n[DONE]\n'));
    const before = vi.fn(), complete = vi.fn(), result = await new ZedExecutor().execute(args({ beforeAttempt: before, completeAttempt: complete }));
    expect(await result.response.text()).toContain('fixture text'); expect(fixture.completion).toHaveBeenCalledTimes(2);
    expect(fixture.calls.filter(call => call.url.endsWith('/client/llm_tokens'))).toHaveLength(2);
    const posts = fixture.calls.filter(call => call.url.endsWith('/completions'));
    expect(posts).toHaveLength(2); expect(posts[0].options.body).toBe(posts[1].options.body);
    for (const post of posts) { expect(post.options.method).toBe('POST'); expect(post.options.headers.Authorization).toBe('Bearer dummy-zed-llm-token'); }
    expect(before).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  });
});
