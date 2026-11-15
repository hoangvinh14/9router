import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Attest the actual mount/network boundary before importing any budget module.
assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.equal(process.version, 'v24.21.0');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
for (const name of ['HOME', 'DATA_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TMPDIR']) {
  assert.ok(process.env[name]?.startsWith('/sandbox/'));
  assert.deepEqual(fs.readdirSync(process.env[name]), []);
}
for (const hidden of ['/home/gmo', '/app/.env', '/app/.git', '/app/node_modules', '/app/.next', '/app/tests/vitest.config.js']) {
  assert.equal(fs.existsSync(hidden), false, `Unexpected mounted path: ${hidden}`);
}
const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => {
  const fields = line.split(' ');
  return { path: fields[4], options: fields[5].split(',') };
});
const covering = target => mounts.filter(m => target === m.path || target.startsWith(`${m.path.replace(/\/$/, '')}/`))
  .sort((a, b) => b.path.length - a.path.length)[0];
for (const target of ['/', '/app', '/app/src', '/app/src/lib/accounting/exact-money.js', '/app/package.json', '/runtime/node']) {
  assert.ok(covering(target)?.options.includes('ro'), `Read-only mount required: ${target}`);
}
assert.ok(covering('/sandbox/home')?.options.includes('rw'));
const { decimalToNanoUsd, nanoUsdToDecimal, validateRate } = await import('../../src/lib/pricing/decimalMoney.js');
const { costFromExactUsageSnapshot: cost, nanoUsd } = await import('../../src/lib/accounting/exact-money.js');
const { budgetWindows, budgetInstant } = await import('../../src/lib/accounting/budget-windows.js');
const { snapshotPayload, canonical } = await import('../../src/lib/accounting/attempt-payload.js');
const price = (rates = { input: '1', output: '2' }) => ({ currency: 'USD', unit: 'USD/1M tokens', revision: 'fake-v1', rates });
const usage = (input = 1000, output = 100) => ({ exact: true, input, output, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true });

test('decimal money is exact, bounded and never coerces missing or numeric prices', () => {
  for (const [value, expected] of [['0', '0'], ['0.000000001', '1'], ['1.123456789', '1123456789'], ['9000000', '9000000000000000']]) {
    assert.equal(decimalToNanoUsd(value), expected);
  }
  assert.equal(nanoUsdToDecimal('1123456780'), '1.12345678');
  assert.equal(validateRate('1.1000'), '1.1');
  for (const bad of [undefined, null, 0, 1.1, NaN, Infinity, '-1', '01', '1e2', ' 1', '1.', '0.0000000001', '9000000.000000001']) {
    assert.throws(() => decimalToNanoUsd(bad));
  }
  for (const bad of [null, 1, '-1', '01', '1.1', '9000000000000001']) assert.throws(() => nanoUsd(bad));
});

test('cost rounds once over the whole attempt, using original copied price', () => {
  const original = price({ input: '0.000000001', output: '0.000000001' });
  assert.equal(cost(usage(250000, 250000), original), '1');
  assert.equal(cost(usage(249999, 250000), original), '0');
  assert.equal(cost(usage(500000, 500000), original), '1');
  const saved = snapshotPayload(price());
  const current = price(); current.rates.input = '99';
  assert.equal(cost(usage(), saved), '1200000');
  assert.deepEqual(saved.rates, { input: '1', output: '2' });
});

test('explicit zero is valid; missing, estimated, unsafe or contradictory usage is not zero', () => {
  assert.equal(cost(usage(0, 0), price({ input: '0', output: '0' })), '0');
  for (const bad of [null, { ...usage(), input: undefined }, { ...usage(), input: null }, { ...usage(), exact: false },
    { ...usage(), input: -1 }, { ...usage(), input: NaN }, { ...usage(), input: Infinity },
    { ...usage(), input: Number.MAX_SAFE_INTEGER + 1 }, { ...usage(), cacheRead: 1001 },
    { ...usage(), cacheWrite: 600, cacheRead: 600 }, { ...usage(), reasoning: 101 },
    { ...usage(), reasoningIncludedInOutput: undefined }, { ...usage(), toolUses: 1 }]) {
    assert.throws(() => cost(bad, price()));
  }
  assert.throws(() => cost(usage(), price({ input: '1' })));
  assert.throws(() => cost(usage(), price({ input: '1', output: null })));
  assert.throws(() => cost(usage(Number.MAX_SAFE_INTEGER, 0), price({ input: '9000000', output: '0' })));
});

test('cache and reasoning subsets are not billed twice; exact cache tiers are required', () => {
  const original = price({ input: '1', output: '2', cached: '0', cache_creation: '3', cache_creation_1h: '6', reasoning: '4' });
  const observed = { ...usage(), cacheRead: 100, cacheWrite: 100, cacheWrite5m: 50, cacheWrite1h: 50, reasoning: 20 };
  // 800 ordinary input + 450 cache creation + 160 output + 80 reasoning, in nanoUSD.
  assert.equal(cost(observed, original), '1490000');
  assert.equal(cost({ ...observed, reasoningIncludedInOutput: false }, original), '1530000');
  assert.throws(() => cost({ ...observed, cacheWrite1h: 51 }, original));
  assert.throws(() => cost(usage(), original));
  const missing = structuredClone(original); delete missing.rates.cache_creation_1h;
  assert.throws(() => cost(observed, missing));
});

test('component counts require complete original categories and matching units', () => {
  const original = { ...price({ input: '1', output: '2', web_search_per_1000: '3' }), rateUnits: { web_search_per_1000: 'USD/1000 uses' } };
  const observed = { exact: true, provenance: 'fake-disjoint-v1', components: [
    { category: 'input', count: 1000, unit: 'USD/1M tokens' },
    { category: 'output', count: 100, unit: 'USD/1M tokens' },
    { category: 'web_search_per_1000', count: 2, unit: 'USD/1000 uses' },
  ] };
  assert.equal(cost(observed, original), '7200000');
  assert.throws(() => cost(usage(), original));
  assert.throws(() => cost({ ...observed, components: observed.components.slice(0, 2) }, original));
  assert.throws(() => cost({ ...observed, components: [observed.components[0], observed.components[0]] }, original));
  const wrong = structuredClone(observed); wrong.components[2].unit = 'USD/1M tokens';
  assert.throws(() => cost(wrong, original));
});

test('bounded snapshots reject accessors, executable values and oversized payloads', () => {
  let invoked = false;
  const accessor = Object.defineProperty({}, 'input', { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => snapshotPayload(accessor)); assert.equal(invoked, false);
  for (const bad of [new Date(), () => 1, { x: undefined }, { x: Infinity }, new Array(2), JSON.parse('{"__proto__":1}')]) {
    assert.throws(() => snapshotPayload(bad));
  }
  assert.equal(canonical({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.throws(() => snapshotPayload({ text: 'x'.repeat(32768) }));
});

test('HCM week/month reset boundaries are half-open and independent of host timezone', () => {
  const boundaries = [
    ['2026-10-25T17:00:00.000Z', 'weekly', '2026-10-18T17:00:00.000Z', '2026-11-01T17:00:00.000Z'],
    ['2026-10-31T17:00:00.000Z', 'monthly', '2026-09-30T17:00:00.000Z', '2026-11-30T17:00:00.000Z'],
    ['2024-02-29T17:00:00.000Z', 'monthly', '2024-01-31T17:00:00.000Z', '2024-03-31T17:00:00.000Z'],
    ['2026-12-31T17:00:00.000Z', 'monthly', '2026-11-30T17:00:00.000Z', '2027-01-31T17:00:00.000Z'],
  ];
  for (const [at, dimension, previousStart, nextEnd] of boundaries) {
    const before = budgetWindows(new Date(Date.parse(at) - 1).toISOString())[dimension];
    assert.deepEqual(before, { startAt: previousStart, resetAt: at });
    for (const delta of [0, 1]) {
      const windows = budgetWindows(new Date(Date.parse(at) + delta).toISOString());
      assert.deepEqual(windows[dimension], { startAt: at, resetAt: nextEnd });
      assert.equal(windows.previousWindows[dimension].resetAt, windows[dimension].startAt);
      assert.ok(Object.isFrozen(windows[dimension]));
    }
  }
  const expected = budgetWindows('2026-10-25T17:00:00.000Z');
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = zone; assert.deepEqual(budgetWindows('2026-10-25T17:00:00.000Z'), expected);
    }
  } finally { process.env.TZ = previous; }
});

test('clock must be synchronous and canonical; unsupported timezone is refused', () => {
  const at = '2026-10-28T00:00:00.000Z';
  assert.equal(budgetInstant(() => at), at);
  assert.throws(() => budgetInstant(async () => at));
  assert.throws(() => budgetWindows(at, 'UTC'));
  for (const bad of [null, undefined, NaN, 0, 'bad', '2026-02-30T00:00:00.000Z', '2026-10-28T00:00:00Z']) {
    assert.throws(() => budgetWindows(bad));
  }
});
