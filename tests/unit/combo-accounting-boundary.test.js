import { describe, it, expect, vi } from 'vitest';
import { handleComboChat } from '../../open-sse/services/combo.js';
const log = { info() {}, warn() {} };
const options = extra => ({ body: {}, models: ['fixture/a', 'fixture/b'], comboStrategy: 'fallback', autoSwitch: false, log, ...extra });
describe('injected combo accounting barriers', () => {
  it('trusted local exception escapes without fallback or wire-code imitation trust', async () => {
    const local = new Error('fixture local'); const gate = vi.fn(); const single = vi.fn().mockRejectedValue(local);
    await expect(handleComboChat(options({ handleSingleModel: single, accounting: { gate, isLocalError: error => error === local } }))).rejects.toBe(local);
    expect(single).toHaveBeenCalledTimes(1);
  });
  it('fresh failed-terminal gate wins before next candidate', async () => {
    const blocked = new Error('fresh exhausted'); const gate = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw blocked; });
    const single = vi.fn().mockResolvedValue(Response.json({ error: { message: 'fixture' } }, { status: 402 }));
    await expect(handleComboChat(options({ handleSingleModel: single, accounting: { gate, isLocalError: error => error === blocked } }))).rejects.toBe(blocked);
    expect(single).toHaveBeenCalledTimes(1);
  });
  it('caller abort during cooldown never selects another model', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = new AbortController(); const single = vi.fn().mockResolvedValue(Response.json({ error: { message: 'request not allowed' } }, { status: 503 }));
      const pending = expect(handleComboChat(options({ handleSingleModel: single, accounting: { gate() {}, isLocalError() { return false; } }, signal: ctrl.signal }))).rejects.toBe(7);
      await vi.advanceTimersByTimeAsync(1); ctrl.abort(7); await pending;
      await vi.advanceTimersByTimeAsync(6000); expect(single).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('OFF exception fallback semantics are unchanged', async () => {
    const final = Response.json({ choices: [] }); const single = vi.fn().mockRejectedValueOnce(new Error('ordinary')).mockResolvedValueOnce(final);
    expect(await handleComboChat(options({ handleSingleModel: single }))).toBe(final); expect(single).toHaveBeenCalledTimes(2);
  });
});
