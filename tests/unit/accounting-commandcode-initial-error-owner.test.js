import { beforeAll, describe, expect, it, vi } from 'vitest';
let observe;
beforeAll(async () => {
  ({ observeCommandCodeInitialFailure: observe } = await import('open-sse/utils/accountedCommandCodeInitialFailure.js'));
});
const response = () => new Response(`${JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture unavailable' } })}\n`);
const attempt = Object.freeze({ fixture: 'owned-attempt' });
const setup = () => ({ completeAttempt: vi.fn(async () => ({ state: 'unresolved' })), gate: vi.fn() });
// Mock sinks only. Actual ledger/native POST/adapters remain separate obligations.
describe('CommandCode posted initial failure own completion delivery (not retry executor)', () => {
  it('waits for own unresolved completion ACK before fresh gate or failure status', async () => {
    const accounting = setup(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    accounting.completeAttempt.mockImplementation(async () => { enter(); await held; return { state: 'unresolved' }; });
    let returned = false;
    const work = observe(response(), { accounting, attempt }).then(result => { returned = true; return result; });
    try {
      await entered; expect(returned).toBe(false); expect(accounting.gate).not.toHaveBeenCalled();
      expect(accounting.completeAttempt).toHaveBeenCalledWith(attempt, { usage: null, outcome: 'failed' });
    } finally { release(); }
    expect(await work).toEqual({ statusCode: 503, usage: null }); expect(accounting.gate).toHaveBeenCalledTimes(1);
  });
  it('does not recover status or fresh gate when own completion handle delivery is lost', async () => {
    const accounting = setup(), lost = new Error('fixture lost failure completion ACK');
    accounting.completeAttempt.mockRejectedValue(lost);
    await expect(observe(response(), { accounting, attempt })).rejects.toBe(lost);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.gate).not.toHaveBeenCalled();
  });
  it('fresh unresolved budget gate rejects instead of giving retry a status', async () => {
    const accounting = setup(), blocked = Object.assign(new Error('fixture unresolved gate'), { code: 'api_key_accounting_unresolved' });
    accounting.gate.mockImplementation(() => { throw blocked; });
    await expect(observe(response(), { accounting, attempt })).rejects.toBe(blocked);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(accounting.gate).toHaveBeenCalledTimes(1);
  });
  it('malformed posted response gets one unknown completion ACK, never not_dispatched/free', async () => {
    const accounting = setup();
    await expect(observe(new Response('{"type":"error"'), { accounting, attempt })).rejects.toThrow();
    expect(accounting.completeAttempt).toHaveBeenCalledWith(attempt, { usage: null, outcome: 'network_unknown' });
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
  });
  it('abort while completion ACK held preserves failed winner and exact false caller reason', async () => {
    const ctrl = new AbortController(), accounting = setup(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    accounting.completeAttempt.mockImplementation(async () => { enter(); await held; return { state: 'unresolved' }; });
    const work = observe(response(), { accounting, attempt, signal: ctrl.signal }).then(value => ({ value }), error => ({ error }));
    try { await entered; ctrl.abort(false); expect(accounting.gate).not.toHaveBeenCalled(); } finally { release(); }
    expect((await work).error).toBe(false); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(accounting.completeAttempt).toHaveBeenCalledWith(attempt, { usage: null, outcome: 'failed' }); expect(accounting.gate).not.toHaveBeenCalled();
  });
});
