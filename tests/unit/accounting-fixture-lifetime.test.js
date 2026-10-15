import { describe, it, expect, vi } from 'vitest';
import { createAccountingFixtureLifetime } from './fixtures/accounting-fixture-lifetime.js';

describe('test-only accounting fixture lifetime', () => {
  it('pre-cancelled late completion never enters current counters or durable work', async () => {
    const timeout = new AbortController(), old = createAccountingFixtureLifetime(timeout.signal);
    const invoke = vi.fn(), after = vi.fn(); timeout.abort(new Error('old test timeout'));
    await expect(old.complete(invoke, after)).rejects.toThrow('old test timeout');
    expect(invoke).not.toHaveBeenCalled(); expect(after).not.toHaveBeenCalled();
    const next = createAccountingFixtureLifetime(new AbortController().signal);
    await expect(next.complete(() => 'own terminal', after)).resolves.toBe('own terminal');
    expect(after).toHaveBeenCalledOnce(); expect(after).toHaveBeenCalledWith('own terminal');
  });
  it('cleanup while durable completion is held withholds late delivery after successor starts', async () => {
    const old = createAccountingFixtureLifetime(new AbortController().signal);
    let release; const held = new Promise(resolve => { release = resolve; }), after = vi.fn();
    const work = old.complete(() => held, after); old.close();
    const next = createAccountingFixtureLifetime(new AbortController().signal);
    next.check(); release('already durable old row');
    await expect(work).rejects.toThrow('Accounting fixture closed'); expect(after).not.toHaveBeenCalled();
  });
  it('cancellation during held delivery cannot become a successful completion', async () => {
    const timeout = new AbortController(), owner = createAccountingFixtureLifetime(timeout.signal);
    let release, entered; const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const work = owner.complete(() => 'own row', async () => { entered(); await held; });
    await started; timeout.abort(new Error('test ended')); release();
    await expect(work).rejects.toThrow('test ended');
  });
});
