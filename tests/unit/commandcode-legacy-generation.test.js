import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseExecutor } from 'open-sse/executors/base.js';
import { CommandCodeExecutor } from 'open-sse/executors/commandcode.js';

// Exercise the real subclass execute loop, unlike an instance.execute replacement.
// Base delegation is mocked: invocation counts are NOT socket/ledger proof.
const rawError = status => new Response(`${JSON.stringify({ type: 'error', error: { statusCode: status, message: 'fixture failure' } })}\n`,
  { headers: { 'Content-Type': 'application/x-ndjson' } });
const rawSuccess = () => new Response(`${JSON.stringify({ type: 'text-delta', text: 'fixture recovered' })}\n${JSON.stringify({ type: 'finish' })}\n`,
  { headers: { 'Content-Type': 'application/x-ndjson' } });
const input = () => ({ model: 'deepseek/deepseek-v4-pro', body: { params: { messages: [] } }, stream: true,
  credentials: { apiKey: 'dummy-fixture-only' }, log: { debug: vi.fn() } });
afterEach(() => vi.restoreAllMocks());

describe('CommandCode actual legacy subclass generation seam (mock Base, no accounting support)', { timeout: 10000 }, () => {
  it('real subclass invokes Base again after initial retryable raw error, not an overridden execute', async () => {
    const options = input();
    const base = vi.spyOn(BaseExecutor.prototype, 'execute').mockResolvedValueOnce({ response: rawError(503) })
      .mockResolvedValueOnce({ response: rawSuccess() });
    const executor = new CommandCodeExecutor();
    expect(Object.hasOwn(executor, 'execute')).toBe(false);
    const result = await executor.execute(options);
    expect(base).toHaveBeenCalledTimes(2);
    expect(base.mock.calls.every(call => call[0] === options)).toBe(true);
    expect(options.log.debug).toHaveBeenCalledTimes(1);
    expect(result.response.ok).toBe(true); expect(await result.response.text()).toContain('fixture recovered');
  });
  it('real subclass exhausts two retries/three generations on initial retryable errors', async () => {
    const options = input();
    const base = vi.spyOn(BaseExecutor.prototype, 'execute').mockImplementation(async () => ({ response: rawError(503) }));
    const result = await new CommandCodeExecutor().execute(options);
    expect(base).toHaveBeenCalledTimes(3); expect(options.log.debug).toHaveBeenCalledTimes(2);
    expect(result.response.status).toBe(503); expect((await result.response.json()).error.code).toBe(503);
  });
  it('initial nonretryable raw 429 does not start a second Base generation', async () => {
    const base = vi.spyOn(BaseExecutor.prototype, 'execute').mockResolvedValue({ response: rawError(429) });
    const result = await new CommandCodeExecutor().execute(input());
    expect(base).toHaveBeenCalledTimes(1); expect(result.response.status).toBe(429);
  });
  it('does not regenerate after content even when a later raw error follows', async () => {
    let upstream; const encoder = new TextEncoder();
    const body = new ReadableStream({ start(controller) {
      upstream = controller;
      controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'text-delta', text: 'fixture prefix' })}\n`));
    } });
    const base = vi.spyOn(BaseExecutor.prototype, 'execute').mockResolvedValue({ response: new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }) });
    const result = await new CommandCodeExecutor().execute(input());
    expect(base).toHaveBeenCalledTimes(1); expect(result.response.ok).toBe(true);
    const reader = result.response.body.getReader();
    try {
      const prefix = await reader.read(); expect(prefix.done).toBe(false);
      expect(new TextDecoder().decode(prefix.value)).toContain('fixture prefix');
      // Inject the fault only AFTER the consumer has received valid text.
      const failure = expect(reader.read()).rejects.toThrow('fixture late failure');
      upstream.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture late failure' } })}\n`));
      upstream.close(); await failure;
      expect(base).toHaveBeenCalledTimes(1);
    } finally { reader.releaseLock(); }
  });
});
