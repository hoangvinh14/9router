// Test-only cancellation boundary. A Vitest timeout rejects its wrapper but
// does not stop ignored async work; never let that work enter a successor's
// shared fixture spies/counters. This does not change production deadlines.
export function createAccountingFixtureLifetime(testSignal) {
  const controller = new AbortController();
  const signal = AbortSignal.any([testSignal, controller.signal]);
  return Object.freeze({
    signal,
    check() { signal.throwIfAborted(); },
    close() { controller.abort(new Error('Accounting fixture closed')); },
    async complete(invoke, after) {
      signal.throwIfAborted();
      const result = await invoke();
      signal.throwIfAborted();
      await after(result);
      signal.throwIfAborted();
      return result;
    },
  });
}
