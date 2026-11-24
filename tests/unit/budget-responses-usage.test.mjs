import assert from 'node:assert/strict';
import { readlinkSync } from 'node:fs';
import { test } from 'node:test';
import { parseCodexStandardReferences } from '../../src/lib/accounting/exact-money.js';
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


test('Codex aggregate writes have their own price and are subtracted from ordinary input', () => {
  const writePrice = { ...price, rates: { ...price.rates, cache_creation: '3' } };
  const withWrites = (cached_tokens, cache_write_tokens) => ({
    ...usage, input_tokens_details: { cached_tokens, cache_write_tokens },
  });
  const priced = raw => terminalCost(responsesTokenUsage(raw, true), writePrice);
  const complete = priced(withWrites(127744, 1000));
  assert.equal(complete.amountNanoUsd, '38630000');
  assert.deepEqual(complete.unknown, []);
  assert.deepEqual(priced(usage).unknown, ['cache_creation', 'input']);
  assert.deepEqual(priced(withWrites(127744, 2723)).unknown, ['cache_creation', 'cached', 'input']);
  assert.equal(priced(withWrites(127744, 0)).amountNanoUsd, '37630000');
  const unpricedWrite = cost(withWrites(127744, 1000));
  assert.deepEqual(unpricedWrite.unknown, ['input']);
  assert.equal(unpricedWrite.amountNanoUsd, '32186000');
});

test('Codex Standard reference uses the published USD rates and includes cache writes in ordinary input', () => {
  const row = '<tr><td>GPT-6.2 Sol</td><td>$2</td><td>$0.10</td><td>$10</td></tr>';
  const other = '<tr><td>GPT-6.1 Terra</td><td>$1</td><td>$0.05</td><td>$5</td></tr>';
  const card = rows => '<h1>ChatGPT Work and Codex models</h1><table><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>' + rows + '</table>';
  const daybreak = '<tr><td>Daybreak Blue (GPT-5.6 Sol)</td><td>$2</td><td>$0.1</td><td>$10</td></tr>';
  const prices = parseCodexStandardReferences(card(row + other + daybreak), 42);
  assert.equal(prices['openai:codex/gpt-daybreak-blue-latest:standard:v1'].rates.input, '2');
  const snapshot = prices['openai:codex/gpt-6.2-sol:standard:v1'];
  assert.deepEqual({ ...snapshot.rates }, { input: '2', cached: '0.10', output: '10' });
  assert.equal(snapshot.syncedAt, 42);
  assert.equal(prices['openai:codex/gpt-6.1-terra:standard:v1'].rates.output, '5');
  assert.throws(() => parseCodexStandardReferences(row, 42), /Missing Codex USD tariff/);
  assert.throws(() => parseCodexStandardReferences(card(row + row), 42), /Invalid Codex USD tariff/);
  const usage = responsesTokenUsage({
    input_tokens: 100, output_tokens: 25, total_tokens: 125,
    input_tokens_details: { cached_tokens: 40, cache_write_tokens: 60 },
  }, 'included-in-input');
  assert.equal(terminalCost(usage, snapshot).amountNanoUsd, '374000');
});

test('OpenAI Standard keeps known output when write details are missing or contradict the requested TTL', async () => {
  const { openAIStandardUsage } = await import('../../src/lib/accounting/responses-usage.js');
  const price = { rates: { input: '2', cached: '0.1', cache_creation: '2.5', output: '10' } };
  const usage = { prompt_tokens: 100, completion_tokens: 25, prompt_tokens_details: { cached_tokens: 20 } };
  const expected = [['cached', 20], ['output', 25]];
  const counts = u => openAIStandardUsage(u, price, false).components.map(c => [c.category, c.count]);
  assert.deepEqual(counts(usage), expected);
  assert.deepEqual(counts({ ...usage, prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 40,
    cache_write_tokens_details: { ttl_30m_tokens: 20, ttl_12h_tokens: 20 } } }), expected);
  assert.deepEqual(counts({ completion_tokens: 7 }), [['output', 7]]);
  assert.deepEqual(counts({ ...usage, total_tokens: 124 }), []);
});
