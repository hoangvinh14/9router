import { describe, it, expect, vi } from 'vitest';
import { snapshotAccountingGroup } from '@/lib/db/accountingGroupPayload.js';

// Internal function accepts plain data, not programmable object authority.
// Run before a transaction; no raw SQL, credentials or live network involved.
describe('accounting group plain-data security boundary', () => {
  it('detaches and freezes nested payload without altering input', () => {
    const commands = [{ type: 'insert', input: { attemptId: 'fixture', priceSnapshot: { rates: { input: '0', output: '1.000000001' } } } }];
    const snapshot = snapshotAccountingGroup(commands);
    commands[0].input.priceSnapshot.rates.input = '9';
    expect(snapshot[0].input.priceSnapshot.rates.input).toBe('0');
    expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot[0].input.priceSnapshot.rates)).toBe(true);
  });
  it.each(['root', 'command', 'nested'])('refuses %s Proxy before invoking any trap', location => {
    const trap = vi.fn(() => { throw new Error('Proxy must not run'); });
    const target = location === 'root' ? [{ type: 'insert', input: {} }] : {};
    const proxy = new Proxy(target, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    const commands = location === 'root' ? proxy : location === 'command' ? [proxy] : [{ type: 'insert', input: { priceSnapshot: proxy } }];
    expect(() => snapshotAccountingGroup(commands)).toThrow('Accounting group payload unavailable');
    expect(trap).not.toHaveBeenCalled();
  });
  it('refuses revoked Proxies and array subclasses without callback authority', () => {
    const root = Proxy.revocable([], {}), nested = Proxy.revocable({}, {}); root.revoke(); nested.revoke();
    expect(() => snapshotAccountingGroup(root.proxy)).toThrow('Accounting group payload unavailable');
    expect(() => snapshotAccountingGroup([{ type: 'insert', input: nested.proxy }])).toThrow('Accounting group payload unavailable');
    class Commands extends Array {}
    expect(() => snapshotAccountingGroup(new Commands({ type: 'insert', input: {} }))).toThrow();
  });
  it('never invokes getters/toJSON/functions and rejects cyclic/forbidden object material', () => {
    const callback = vi.fn(() => 'not data');
    const accessor = {}; Object.defineProperty(accessor, 'input', { enumerable: true, get: callback });
    expect(() => snapshotAccountingGroup([accessor])).toThrow(); expect(callback).not.toHaveBeenCalled();
    expect(snapshotAccountingGroup([{ type: 'insert', input: { toJSON: callback } }])).toEqual([{ type: 'invalid' }]);
    expect(callback).not.toHaveBeenCalled();
    const cycle = {}; cycle.self = cycle;
    for (const value of [cycle, JSON.parse('{"__proto__":{}}'), new Date(), new Map(), { [Symbol('key')]: 'value' }]) {
      expect(() => snapshotAccountingGroup([{ type: 'insert', input: value }])).toThrow();
    }
  });
});
