import { describe, it, expect, vi } from 'vitest';
import { refreshWithRetry } from '../../open-sse/services/tokenRefresh.js';
describe('credential refresh bounded caller cancellation', () => {
  it('already aborted primitive reason never invokes refresh', async () => {
    const ctrl = new AbortController(); ctrl.abort(7); const refresh = vi.fn();
    await expect(refreshWithRetry(refresh, 3, null, { signal: ctrl.signal })).rejects.toBe(7); expect(refresh).not.toHaveBeenCalled();
  });
  it('foreign pending refresh aborts promptly; late rejection is observed', async () => {
    let rejectLate; const refresh = vi.fn(() => new Promise((_resolve, reject) => { rejectLate = reject; })); const ctrl = new AbortController();
    const pending = expect(refreshWithRetry(refresh, 3, null, { signal: ctrl.signal })).rejects.toBe('stop');
    ctrl.abort('stop'); await pending; rejectLate(new Error('late refresh')); await Promise.resolve(); expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('abort stops refresh backoff before another credential call', async () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn().mockResolvedValue(null); const ctrl = new AbortController();
      const pending = expect(refreshWithRetry(refresh, 3, null, { signal: ctrl.signal })).rejects.toBe(17);
      await vi.advanceTimersByTimeAsync(1); expect(refresh).toHaveBeenCalledTimes(1);
      ctrl.abort(17); await pending; await vi.advanceTimersByTimeAsync(3000); expect(refresh).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('local terminal errors escape without retry while OFF defaults retain retry semantics', async () => {
    const local = new Error('fixture terminal'); const refresh = vi.fn().mockRejectedValue(local);
    await expect(refreshWithRetry(refresh, 3, null, { isTerminalError: error => error === local })).rejects.toBe(local); expect(refresh).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    try {
      const ordinary = vi.fn().mockRejectedValueOnce(new Error('credential failure')).mockResolvedValueOnce({ accessToken: 'fixture' });
      const pending = refreshWithRetry(ordinary); await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual({ accessToken: 'fixture' }); expect(ordinary).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
