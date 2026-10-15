import { describe, it, expect, vi } from 'vitest';
import { handleFusionChat } from '../../open-sse/services/combo.js';
const reply = text => Response.json({ choices: [{ message: { content: text } }] });
const log = { info() {}, warn() {} };
const setup = extra => ({ body: { messages: [{ role: 'user', content: 'fixture' }] }, models: ['a', 'b'], judgeModel: 'judge', log, tuning: { minPanel: 2, stragglerGraceMs: 5, panelHardTimeoutMs: 30 }, accounting: { gate() {}, isLocalError() { return false; } }, ...extra });
describe('fusion injected accounting authority', () => {
  it('private panel failure escapes instead of generic all-failed or judge dispatch', async () => {
    const local = new Error('private accounting failure'); const signals = [];
    const single = vi.fn((_body, model, _panel, signal) => { signals.push(signal); if (model === 'a') return Promise.reject(local); return new Promise(() => {}); });
    await expect(handleFusionChat(setup({ handleSingleModel: single, accounting: { gate() {}, isLocalError: error => error === local } }))).rejects.toBe(local);
    expect(single).toHaveBeenCalledTimes(2); expect(signals.every(signal => signal.aborted)).toBe(true);
  });
  it('deeply isolates panel inputs and acknowledges panels before judge call', async () => {
    const inputs = [];
    const single = vi.fn(async (body, model, panel) => { inputs.push(body); if (panel) { body.messages[0].content = model; return reply(model); } return reply('judge'); });
    const body = { messages: [{ role: 'user', content: 'original' }] };
    expect((await handleFusionChat(setup({ body, handleSingleModel: single }))).ok).toBe(true);
    expect(single).toHaveBeenCalledTimes(3); expect(inputs[0]).not.toBe(inputs[1]); expect(inputs[0].messages).not.toBe(inputs[1].messages); expect(body.messages[0].content).toBe('original'); expect(inputs[2].messages[0].content).toBe('original');
  });
  it('one-answer path preserves actual regeneration, not response reuse', async () => {
    const single = vi.fn(async (_body, model, panel) => panel && model === 'b' ? Response.json({}, { status: 400 }) : reply(panel ? 'panel' : 'regenerated'));
    const response = await handleFusionChat(setup({ handleSingleModel: single }));
    expect((await response.json()).choices[0].message.content).toBe('regenerated'); expect(single).toHaveBeenCalledTimes(3); expect(single.mock.calls[2][1]).toBe('a'); expect(single.mock.calls[2][2]).toBe(false);
  });
  it('late local failure after quorum stops active judge with original authority', async () => {
    vi.useFakeTimers();
    try {
      let lateReject; const local = new Error('late accounting failure'); let judgeSignal;
      const single = vi.fn((_body, model, panel, signal) => {
        if (model === 'c') return new Promise((_resolve, reject) => { lateReject = reject; });
        if (panel) return Promise.resolve(reply(model));
        judgeSignal = signal; return new Promise(() => {});
      });
      const pending = expect(handleFusionChat(setup({ models: ['a', 'b', 'c'], handleSingleModel: single, accounting: { gate() {}, isLocalError: error => error === local } }))).rejects.toBe(local);
      await vi.advanceTimersByTimeAsync(6); expect(single).toHaveBeenCalledTimes(4); expect(judgeSignal.aborted).toBe(false);
      lateReject(local); await pending; expect(judgeSignal.aborted).toBe(true); expect(single).toHaveBeenCalledTimes(4); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('nested held inner ACK may miss outer collector; later lost delivery stops the already-admitted single-answer regeneration', async () => {
    vi.useFakeTimers();
    try {
      let rejectInner, innerSignal, regenerationSignal;
      const local = new Error('late inner own ACK unavailable');
      const accounting = { gate() {}, isLocalError: error => error === local };
      const posts = [];
      const dispatch = (_body, model, panel, signal) => {
        if (model === 'nested') return handleFusionChat(setup({ models: ['inner-a', 'inner-b'], judgeModel: 'inner-judge',
          handleSingleModel: dispatch, accounting, signal }));
        posts.push({ panel, signal });
        if (model === 'inner-judge') {
          innerSignal = signal;
          // Represent an installed terminal whose delivery is still held.
          return new Promise((_resolve, reject) => { rejectInner = reject; });
        }
        if (!panel) { regenerationSignal = signal; return new Promise(() => {}); }
        return Promise.resolve(reply(model));
      };
      const run = handleFusionChat(setup({ models: ['nested', 'peer'], handleSingleModel: dispatch, accounting }));
      const observed = run.then(response => ({ response }), error => ({ error }));
      await vi.advanceTimersByTimeAsync(0);
      expect(posts).toHaveLength(4); expect(rejectInner).toBeTypeOf('function');
      expect(innerSignal.aborted).toBe(false); expect(regenerationSignal).toBeUndefined();
      await vi.advanceTimersByTimeAsync(31);
      expect(posts).toHaveLength(5); expect(posts.at(-1).panel).toBe(false);
      expect(regenerationSignal.aborted).toBe(false); expect(innerSignal.aborted).toBe(false);
      rejectInner(local); expect((await observed).error).toBe(local);
      expect(regenerationSignal.aborted).toBe(true); expect(innerSignal.aborted).toBe(true);
      expect(posts).toHaveLength(5); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('normal grace never cancels live straggler when judge succeeds', async () => {
    vi.useFakeTimers();
    try {
      let lateResolve, lateSignal;
      const single = vi.fn((_body, model, panel, signal) => { if (model === 'c') { lateSignal = signal; return new Promise(resolve => { lateResolve = resolve; }); } return Promise.resolve(reply(panel ? model : 'judged')); });
      const pending = handleFusionChat(setup({ models: ['a', 'b', 'c'], handleSingleModel: single }));
      await vi.advanceTimersByTimeAsync(6); expect((await pending).ok).toBe(true); expect(lateSignal.aborted).toBe(false);
      lateResolve(reply('late')); await vi.advanceTimersByTimeAsync(1); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it.each(['malformed', 'empty'])('%s HTTP-200 panel does not supply judge prose or erase a valid peer', async kind => {
    const single = vi.fn((_body, model, panel) => {
      if (panel && model === 'b') return Promise.resolve(kind === 'malformed' ? new Response('{', { headers: { 'content-type': 'application/json' } }) : reply('   '));
      return Promise.resolve(reply(panel ? 'answer' : 'regenerated'));
    });
    const response = await handleFusionChat(setup({ handleSingleModel: single }));
    expect((await response.json()).choices[0].message.content).toBe('regenerated');
    expect(single).toHaveBeenCalledTimes(3); expect(single.mock.calls[2][1]).toBe('a');
  });
  it('already-aborted caller never starts a panel or collector timer', async () => {
    const ctrl = new AbortController(); ctrl.abort(0); const single = vi.fn();
    await expect(handleFusionChat(setup({ handleSingleModel: single, signal: ctrl.signal }))).rejects.toBe(0);
    expect(single).not.toHaveBeenCalled();
  });
  it('synchronous private failure wins over secondary cancellation errors', async () => {
    const local = new Error('first accounting authority'); const secondary = new Error('secondary cleanup');
    const single = vi.fn((_body, model, _panel, signal) => {
      if (model === 'a') throw local;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(secondary), { once: true }));
    });
    await expect(handleFusionChat(setup({ handleSingleModel: single, accounting: { gate() {}, isLocalError: error => error === local || error === secondary } }))).rejects.toBe(local);
    expect(single).toHaveBeenCalledTimes(2);
  });
  it('caller primitive abort cleans collector timers without waiting foreign panels', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = new AbortController(); const single = vi.fn(() => new Promise(() => {}));
      const pending = expect(handleFusionChat(setup({ handleSingleModel: single, signal: ctrl.signal }))).rejects.toBe(7);
      await vi.advanceTimersByTimeAsync(1); ctrl.abort(7); await pending; expect(vi.getTimerCount()).toBe(0); expect(single).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
