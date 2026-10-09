import { describe, it, expect, vi } from 'vitest';
import { getAccountingWriteCoordinator } from '@/lib/apiKeyBudget/accountingWriteCoordinator.js';

// Coordinator foundation only: mock the already-tested typed storage primitive.
// No inference admission/config proof, fsync or adapter certification implied.
const command = id => ({ type: 'insert', input: { attemptId: id } });
function fixture() {
  const db = { health: vi.fn(() => ({ healthy: true, poisoned: false, closed: false })) };
  const apply = vi.fn((_, commands) => commands.map(c => ({ ok: true, value: { attemptId: c.input.attemptId } })));
  const coordinator = getAccountingWriteCoordinator(db, { apply });
  return { db, apply, coordinator };
}
describe('writer-adapter typed queue foundation (not inference authority)', () => {
  it('same adapter owns one HMR-safe queue; different writers stay isolated', () => {
    const a = fixture(), b = fixture();
    expect(getAccountingWriteCoordinator(a.db)).toBe(a.coordinator); expect(b.coordinator).not.toBe(a.coordinator);
  });
  it('same-turn burst coalesces FIFO with no early ACK, low load flushes without full batch', async () => {
    const { coordinator, apply } = fixture(); let ack = false;
    const a = coordinator.enqueue(command('a')).then(v => { ack = true; return v; });
    const b = coordinator.enqueue(command('b'));
    expect(apply).not.toHaveBeenCalled(); expect(ack).toBe(false);
    expect(await Promise.all([a, b])).toEqual([{ attemptId: 'a' }, { attemptId: 'b' }]);
    expect(apply).toHaveBeenCalledTimes(1); expect(apply.mock.calls[0][1].map(c => c.input.attemptId)).toEqual(['a', 'b']);
    expect(await coordinator.enqueue(command('c'))).toEqual({ attemptId: 'c' }); expect(apply).toHaveBeenCalledTimes(2);
  });
  it('detaches queued data, rejects Proxy without traps and refuses enqueue after stop', async () => {
    const { coordinator, apply } = fixture(), original = command('a');
    const a = coordinator.enqueue(original); original.input.attemptId = 'tampered'; expect(await a).toEqual({ attemptId: 'a' });
    const trap = vi.fn(() => { throw new Error('must not run'); });
    await expect(coordinator.enqueue(new Proxy({}, { get: trap, ownKeys: trap }))).rejects.toThrow(); expect(trap).not.toHaveBeenCalled();
    await coordinator.stop(); await expect(coordinator.enqueue(command('late'))).rejects.toThrow(); expect(apply).toHaveBeenCalledTimes(1);
  });
  it('aborted queued intent removes provably unexecuted work, keeps exact primitive reason', async () => {
    const { coordinator, apply } = fixture(), ctrl = new AbortController();
    const a = coordinator.enqueue(command('a'), { signal: ctrl.signal }); ctrl.abort(false);
    const b = coordinator.enqueue(command('b'));
    await expect(a).rejects.toBe(false); await expect(b).resolves.toEqual({ attemptId: 'b' });
    expect(apply.mock.calls[0][1]).toEqual([command('b')]);
  });
  it('abort during synchronous committed write cannot erase a recorded result', async () => {
    const { coordinator, apply } = fixture(), ctrl = new AbortController();
    apply.mockImplementation((_, commands) => { ctrl.abort(false); return commands.map(c => ({ ok: true, value: { attemptId: c.input.attemptId } })); });
    await expect(coordinator.enqueue(command('a'), { signal: ctrl.signal })).resolves.toEqual({ attemptId: 'a' });
    // Owner must still check abort before POST/terminal and record not_dispatched;
    // this queue cannot invent proof that a committed intent never dispatched.
  });
  it('member conflict only rejects its promise; outer uncertainty rejects every member without retry', async () => {
    const { coordinator, apply } = fixture(), conflict = new Error('member conflict');
    apply.mockReturnValueOnce([{ ok: false, error: conflict }, { ok: true, value: 'b' }]);
    const first = await Promise.allSettled([coordinator.enqueue(command('a')), coordinator.enqueue(command('b'))]);
    expect(first).toEqual([{ status: 'rejected', reason: conflict }, { status: 'fulfilled', value: 'b' }]);
    const uncertain = new Error('group ACK uncertain'); apply.mockImplementationOnce(() => { throw uncertain; });
    const second = await Promise.allSettled([coordinator.enqueue(command('c')), coordinator.enqueue(command('d'))]);
    expect(second.every(r => r.status === 'rejected' && r.reason === uncertain)).toBe(true); expect(apply).toHaveBeenCalledTimes(2);
  });
  it('malformed or asynchronous apply never delivers any success ACK', async () => {
    const { coordinator, apply } = fixture();
    apply.mockReturnValueOnce([{ ok: true, value: 'partial' }]);
    const first = await Promise.allSettled([coordinator.enqueue(command('a')), coordinator.enqueue(command('b'))]);
    expect(first.every(result => result.status === 'rejected')).toBe(true);
    apply.mockReturnValueOnce(Promise.reject(new Error('async apply forbidden')));
    await expect(coordinator.enqueue(command('c'))).rejects.toThrow('must be synchronous');
    expect(apply).toHaveBeenCalledTimes(2);
  });
  it('payload byte limit bounds queue memory independently of entry count and splits group by bytes', async () => {
    const { coordinator, apply } = fixture();
    const large = id => ({ type: 'insert', input: { attemptId: id, model: 'x'.repeat(200000) } });
    const pending = Array.from({ length: 5 }, (_, index) => coordinator.enqueue(large(String(index))));
    await expect(coordinator.enqueue(large('overflow'))).rejects.toThrow();
    expect(await Promise.all(pending)).toHaveLength(5);
    expect(apply).toHaveBeenCalledTimes(5); expect(apply.mock.calls.every(([, commands]) => commands.length === 1)).toBe(true);
  });
  it('fresh health at flush refuses queued work without storage write', async () => {
    const { db, coordinator, apply } = fixture();
    const a = coordinator.enqueue(command('a')); db.health.mockReturnValue({ healthy: false, poisoned: true, closed: false });
    await expect(a).rejects.toThrow(); expect(apply).not.toHaveBeenCalled();
  });
  it('bounded queue refuses excess before write; stop drains accepted work without early ACK', async () => {
    const { coordinator, apply } = fixture();
    const pending = Array.from({ length: 128 }, (_, i) => coordinator.enqueue(command(String(i))));
    const excess = coordinator.enqueue(command('overflow'));
    await expect(excess).rejects.toThrow(); await coordinator.stop();
    expect(await Promise.all(pending)).toHaveLength(128);
    expect(apply).toHaveBeenCalledTimes(4); expect(apply.mock.calls.every(([, commands]) => commands.length <= 32)).toBe(true);
  });
});
