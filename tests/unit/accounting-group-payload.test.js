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
  it('retains shared siblings as separate frozen copies, null prototypes and invalid-member isolation', () => {
    const shared = { value: 'dummy' }, nullRecord = Object.assign(Object.create(null), { value: 'dummy-null' });
    const result = snapshotAccountingGroup([{ a: shared, b: shared, nullRecord }, { input: undefined }, { input: NaN }, { input: Infinity }, { valid: true }]);
    expect(result).toEqual([{ a: { value: 'dummy' }, b: { value: 'dummy' }, nullRecord: { value: 'dummy-null' } },
      { type: 'invalid' }, { type: 'invalid' }, { type: 'invalid' }, { valid: true }]);
    expect(result[0].a).not.toBe(result[0].b); expect(Object.isFrozen(result[0].nullRecord)).toBe(true);
  });
  it.each(['hole', 'hidden', 'symbol', 'extra-array', 'forbidden-key', 'too-many-members', 'too-many-nodes', 'too-many-bytes', 'too-deep'])('retains complete structural refusal for %s', mode => {
    let commands = [{ input: ['dummy'] }];
    if (mode === 'hole') commands[0].input = [1, , 2];
    if (mode === 'hidden') Object.defineProperty(commands[0].input, '0', { value: 'dummy', enumerable: false });
    if (mode === 'symbol') commands[0].input[Symbol('dummy')] = 1;
    if (mode === 'extra-array') commands[0].input.extra = 'dummy';
    if (mode === 'forbidden-key') commands[0].input = { constructor: 'dummy' };
    if (mode === 'too-many-members') commands = Array.from({ length: 33 }, () => ({ input: 'dummy' }));
    if (mode === 'too-many-nodes') commands[0].input = Array.from({ length: 10001 }, () => 1);
    if (mode === 'too-many-bytes') commands[0].input = 'x'.repeat(262145);
    if (mode === 'too-deep') { let value = 'dummy'; for (let i = 0; i < 17; i++) value = { nested: value }; commands[0].input = value; }
    expect(() => snapshotAccountingGroup(commands)).toThrow('Accounting group payload unavailable');
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
