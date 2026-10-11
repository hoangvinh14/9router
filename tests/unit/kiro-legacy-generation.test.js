import { afterEach, describe, expect, it, vi } from 'vitest';
import { KiroExecutor } from 'open-sse/executors/kiro.js';
import { BaseExecutor } from 'open-sse/executors/base.js';
import { fixtureKiroEvent } from '../helpers/accountingKiroFrames.js';

// Actual subclass execute/integrity reader/repair loop; only Base delegation
// is mocked. Delegations are NOT socket POSTs, raw accounting or ACK proofs.
const body = () => ({ conversationState: { currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: 'fixture-model' } } } });
const options = () => ({ model: 'claude-sonnet-4.5', body: body(), stream: true,
  credentials: { accessToken: 'dummy-token', providerSpecificData: { kiroToolCallRepair: true } } });
const response = content => new Response(fixtureKiroEvent('assistantResponseEvent', { content }));
const result = content => ({ response: response(content) });
afterEach(() => vi.restoreAllMocks());
describe('actual Kiro legacy integrity generations (Base mock only, not accounting approval)', { timeout: 20000 }, () => {
  it('ellipsis opens one repair Base generation with appended instruction; original remains unchanged', async () => {
    const args = options(), original = structuredClone(args.body), calls = [];
    const base = vi.spyOn(BaseExecutor.prototype, 'execute').mockImplementation(async function(value) {
      expect(this).toBeInstanceOf(KiroExecutor); calls.push(structuredClone(value.body));
      return calls.length === 1 ? result('...') : result('Fixture recovered answer.');
    });
    const reply = await new KiroExecutor().execute(args), output = await reply.response.text();
    expect(base).toHaveBeenCalledTimes(2); expect(calls[0]).toEqual(original); expect(args.body).toEqual(original);
    expect(calls[1].conversationState.currentMessage.userInputMessage.content).toContain('fixture prompt');
    expect(calls[1].conversationState.currentMessage.userInputMessage.content).not.toBe('fixture prompt');
    expect(output).toContain('Fixture recovered answer.'); expect(output).not.toContain('"content":"..."');
  });
  it('second ellipsis terminates after two actual Base generations without third or semantic leak', async () => {
    const base = vi.spyOn(BaseExecutor.prototype, 'execute').mockImplementation(async () => result('...'));
    const reply = await new KiroExecutor().execute(options()), output = await reply.response.text();
    expect(base).toHaveBeenCalledTimes(2); expect(output).toContain('kiro_ellipsis_retry_failed'); expect(output).not.toContain('"content":"..."');
  });
  it('genuine terminal refusal does not create a repair generation', async () => {
    const raw = new Uint8Array([...fixtureKiroEvent('assistantResponseEvent', { content: 'Fixture refusal.' }),
      ...fixtureKiroEvent('messageStopEvent', { stopReason: 'content_filtered' })]);
    const base = vi.spyOn(BaseExecutor.prototype, 'execute').mockResolvedValue({ response: new Response(raw) });
    const reply = await new KiroExecutor().execute(options()), output = await reply.response.text();
    expect(base).toHaveBeenCalledTimes(1); expect(output).toContain('kiro_terminal_refusal'); expect(output).not.toContain('"content":"Fixture refusal."');
  });
});
