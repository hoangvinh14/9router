import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.post(...args) }));
vi.mock('open-sse/services/qoderModels.js', () => ({ getQoderModelConfig: vi.fn(async () => ({ key: 'auto', max_output_tokens: 32 })), resolveQoderModels: vi.fn(), isQoderPat: () => false, resolveQoderCredentials: vi.fn() }));
import { QoderExecutor, __test__ } from 'open-sse/executors/qoder.js';
import { canonicalizeQoderUsage } from 'open-sse/shared/qoder/sse.js';
const frame = body => `data: ${JSON.stringify({ statusCodeValue: 200, body: JSON.stringify(body) })}\n\n`;
const request = accounting => ({ model: 'auto', body: { messages: [{ role: 'user', content: 'fixture prompt' }], max_tokens: 32 }, stream: true, accounting,
  credentials: { accessToken: 'dt-fixture-token', providerSpecificData: { userId: 'fixture-user', machineId: 'fixture-machine' } } });
beforeEach(() => fixture.post.mockReset());
describe('Qoder legacy raw evidence-loss characterization (not accounting ownership/exactness)', () => {
  it('actual signed executor bypasses accounting admission and settlement despite successful stream', async () => {
    fixture.post.mockResolvedValue(new Response('data: {"statusCodeValue":200,"body":"[DONE]"}\n\n'));
    const before = vi.fn(), complete = vi.fn(), result = await new QoderExecutor().execute(request({ beforeAttempt: before, completeAttempt: complete }));
    expect(await result.response.text()).toBe('data: [DONE]\n\n'); expect(fixture.post).toHaveBeenCalledTimes(1);
    const [url, options, proxy] = fixture.post.mock.calls[0]; expect(url).toContain('/agent_chat_generation?'); expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(Buffer); expect(options.headers.Authorization).toBeTruthy(); expect(proxy.strictProxy).toBe(true);
    expect(before).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  });
  it('counter normalization coerces strings and manufactures missing output/total zero semantics', () => {
    expect(canonicalizeQoderUsage({ input_tokens: '100' })).toEqual({ prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 });
    expect(canonicalizeQoderUsage({ input_tokens: 0 })).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    expect(canonicalizeQoderUsage({ input_tokens: -3, output_tokens: 1 })).toEqual({ prompt_tokens: -3, completion_tokens: 1, total_tokens: -2 });
  });
  it('empty EOF synthesizes DONE without raw terminal or usage', async () => {
    const wrapped = await __test__.wrapQoderSSE(new Response(''), 'qoder/auto');
    expect(await wrapped.text()).toBe('data: [DONE]\n\n');
  });
  it('finish plus later usage cancels upstream before genuine DONE/EOF and erases trailing fault', async () => {
    const cancel = vi.fn(); let upstream;
    const input = new Response(new ReadableStream({ start(controller) { upstream = controller;
      controller.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { finish_reason: 'stop' } }] })));
    }, cancel }));
    const wrapped = await __test__.wrapQoderSSE(input, 'qoder/auto');
    // No upstream DONE/EOF: usage triggers the coalescer's synthetic terminal and reader cancellation.
    upstream.enqueue(new TextEncoder().encode(frame({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }) + 'data: {"statusCodeValue":503,"body":"fixture trailing fault"}\n\n'));
    const output = await wrapped.text(); expect(output).toContain('"prompt_tokens":100'); expect(output).toContain('"finish_reason":"stop"');
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1); expect(output).not.toContain('fixture trailing fault'); expect(cancel).toHaveBeenCalledTimes(1);
  });
});
