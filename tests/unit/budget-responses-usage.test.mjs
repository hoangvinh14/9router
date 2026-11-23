import assert from 'node:assert/strict';
import { readlinkSync } from 'node:fs';
import { test } from 'node:test';
import { responsesTokenUsage } from '../../src/lib/accounting/responses-usage.js';
import { terminalCost } from '../../src/lib/accounting/terminal-cost.js';

assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.notEqual(readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);

const price = { currency: 'USD', unit: 'USD/1M tokens', revision: 'fixture',
  rates: { input: '2', cached: '0.25', output: '10' } };
const cost = usage => terminalCost(responsesTokenUsage(usage), price);
const usage = {
  input_tokens: 130466,
  input_tokens_details: { cached_tokens: 127744 },
  output_tokens: 25,
  output_tokens_details: { reasoning_tokens: 20 },
  total_tokens: 130491,
};

test('Responses usage charges cached input separately and includes reasoning only once', () => {
  const result = cost(usage);
  assert.equal(result.amountNanoUsd, '37630000');
  assert.equal(result.provenance, 'provider-reported');
});

test('missing or invalid cache detail preserves known output without estimating uncached input', () => {
  assert.equal(cost({ ...usage, input_tokens_details: {} }).amountNanoUsd, '250000');
  for (const cached of [null, -1, 130467, '127744']) {
    const result = cost({ ...usage, input_tokens_details: { cached_tokens: cached } });
    assert.deepEqual(result.unknown, ['cached', 'input']);
    assert.equal(result.amountNanoUsd, '250000');
  }
});

test('missing output preserves the input split and inconsistent totals default all categories', () => {
  const partial = cost({ ...usage, output_tokens: null });
  assert.deepEqual(partial.unknown, ['output']);
  assert.equal(partial.amountNanoUsd, '37380000');
  assert.deepEqual(cost({ ...usage, total_tokens: 130490 }).unknown, ['cached', 'input', 'output']);
});

test('explicit zero remains reported and absent usage defaults all categories', () => {
  assert.equal(cost({ input_tokens: 0, input_tokens_details: { cached_tokens: 0 },
    output_tokens: 0, total_tokens: 0 }).provenance, 'provider-reported');
  assert.deepEqual(cost(undefined).unknown, ['cached', 'input', 'output']);
});
