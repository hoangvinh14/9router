import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fixtureKiroEvent, concatFixtureBytes } from '../helpers/accountingKiroFrames.js';
let observe;
beforeAll(async () => { ({ observeAccountingKiroRepairGeneration: observe } = await import('open-sse/utils/accountedKiroRepairGeneration.js')); });
const usage = () => ({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 });
// Raw total is validated by the parser; the accounting sink receives the full
// normalized exact-usage contract, not the upstream metrics payload.
const exact = { exact: true, input: 100, output: 20, cacheRead: 0, cacheWrite: 0,
  reasoning: 0, reasoningIncludedInOutput: true,
  provenance: { schema: 'kiro', endpoint: 'chat', inputIncludesCache: true } };
const bytes = (text, stop = true) => concatFixtureBytes([fixtureKiroEvent('assistantResponseEvent', { content: text }),
  fixtureKiroEvent('metricsEvent', usage()), ...(stop ? [fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' })] : [])]);
const sink = () => ({ completeAttempt: vi.fn(async () => ({ state: 'settled', costNanoUsd: 140000 })),
  assertSuccessfulTerminal: vi.fn(), gate: vi.fn() });
describe('raw buffered Kiro repair generation observer (mock sink, not ledger/socket/loop approval)', () => {
  it.each([['Fixture complete answer.', null], ['...', 'ellipsis'], ['…', 'ellipsis']])('raw text %s retains exact bytes and explicit EOF usage before own ACK disposition', async (text, repairKind) => {
    const accounting = sink(), attempt = Object.freeze({ id: 'fixture attempt' }), original = bytes(text);
    const result = await observe(new Response(original), { accounting, attempt });
    expect(result.bytes).toEqual(original); expect(result.repairKind).toBe(repairKind); expect(result.usage).toEqual(exact);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(accounting.completeAttempt.mock.calls[0][0]).toBe(attempt);
    expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: exact, outcome: 'success' });
    expect(accounting.assertSuccessfulTerminal).toHaveBeenCalledTimes(1); expect(accounting.gate).toHaveBeenCalledTimes(repairKind ? 1 : 0);
  });
  it.each(['deliver', 'lost'])('ellipsis disposition waits own completion ACK delivery: %s', async mode => {
    const accounting = sink(), lost = new Error('fixture lost Kiro repair generation handle'); let enter, release;
    const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    accounting.completeAttempt.mockImplementation(async () => { enter(); await held; if (mode === 'lost') throw lost; return { state: 'settled', costNanoUsd: 140000 }; });
    let returned = false;
    const work = observe(new Response(bytes('...')), { accounting, attempt: {} }).then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try { await installed; expect(returned).toBe(false); expect(accounting.gate).not.toHaveBeenCalled(); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); }
    finally { release(); }
    const result = await work;
    if (mode === 'deliver') { expect(result.value.repairKind).toBe('ellipsis'); expect(accounting.gate).toHaveBeenCalledTimes(1); }
    else { expect(result.error).toBe(lost); expect(accounting.gate).not.toHaveBeenCalled(); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); }
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
  });
  it('missing genuine stop never grants exact usage or repair permission; owns one unresolved ACK then throws', async () => {
    const accounting = sink();
    await expect(observe(new Response(bytes('...', false)), { accounting, attempt: {} })).rejects.toThrow();
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: null, outcome: 'network_unknown' });
    expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); expect(accounting.gate).toHaveBeenCalledTimes(1);
  });
  it('abort false during pending raw read cancels reader, completes once and preserves exact reason without repair', async () => {
    const accounting = sink(), controller = new AbortController(); let reading;
    const entered = new Promise(resolve => { reading = resolve; }), cancel = vi.fn();
    const response = new Response(new ReadableStream({ pull() { reading(); return new Promise(() => {}); }, cancel }));
    const work = observe(response, { accounting, attempt: {}, signal: controller.signal }).then(value => ({ value }), error => ({ error }));
    await entered; controller.abort(false); expect(await work).toEqual({ error: false });
    expect(cancel).toHaveBeenCalledTimes(1); expect(cancel.mock.calls[0][0]).toBe(false);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.completeAttempt.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
    expect(accounting.gate).not.toHaveBeenCalled(); expect(accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); expect(response.body.locked).toBe(false);
  });
});
