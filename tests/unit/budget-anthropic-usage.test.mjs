import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { anthropicJsonUsage, createAnthropicUsageAccumulator } from '../../src/lib/accounting/anthropic-usage.js';
import { terminalCost } from '../../src/lib/accounting/terminal-cost.js';
assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
const price = {currency:'USD',unit:'USD/1M tokens',revision:'source-fixture',rates:{input:'3',output:'15',cached:'0.30',cache_creation:'3.75',cache_creation_1h:'6'}};
const cost = raw => terminalCost(anthropicJsonUsage(raw),price);

test('Anthropic input/cache counters are disjoint and output includes thinking without extra charge', () => {
  const value=cost({input_tokens:1000,output_tokens:1000,cache_read_input_tokens:1000,
    cache_creation_input_tokens:2000,cache_creation:{ephemeral_5m_input_tokens:1000,ephemeral_1h_input_tokens:1000},
    output_tokens_details:{thinking_tokens:500}});
  assert.equal(value.amountNanoUsd,'28050000');
  assert.deepEqual(value.unknown,[]);assert.equal(value.provenance,'provider-reported');
});

test('missing TTL never becomes five-minute zero and aggregate mismatch preserves other known categories', () => {
  const raw={input_tokens:1000,output_tokens:2,cache_read_input_tokens:0,cache_creation_input_tokens:1000};
  const missing=cost(raw);
  assert.deepEqual(missing.unknown,['cache_creation','cache_creation_1h']);assert.equal(missing.amountNanoUsd,'3030000');
  const conflict=cost({...raw,cache_creation:{ephemeral_5m_input_tokens:900,ephemeral_1h_input_tokens:900}});
  assert.deepEqual(conflict,missing);
  const partial=cost({...raw,cache_creation:{ephemeral_5m_input_tokens:500}});
  assert.equal(partial.amountNanoUsd,'4905000');assert.deepEqual(partial.unknown,['cache_creation_1h']);
});

test('malformed output defaults only output, null does not masquerade as reported zero', () => {
  const invalid=cost({input_tokens:1000,output_tokens:null,cache_read_input_tokens:0,
    cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}});
  assert.equal(invalid.amountNanoUsd,'3000000');assert.deepEqual(invalid.unknown,['output']);
  const zero=cost({input_tokens:0,output_tokens:0,cache_read_input_tokens:0,
    cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}});
  assert.equal(zero.amountNanoUsd,'0');assert.equal(zero.provenance,'provider-reported');
});

test('native stream snapshots overwrite not sum or max; partial output retains start input', () => {
  const acc=createAnthropicUsageAccumulator();
  acc.observe({type:'message_start',message:{usage:{input_tokens:1000,output_tokens:1,
    cache_read_input_tokens:0,cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}}}});
  acc.observe({type:'message_delta',usage:{output_tokens:10}});
  acc.observe({type:'message_delta',usage:{output_tokens:5}});
  acc.observe({type:'message_stop'});
  acc.observe({type:'message_delta',usage:{output_tokens:9999}});
  const result=acc.result();assert.equal(result.observedStop,true);assert.equal(result.observedStart,true);
  assert.equal(result.completed,true);
  assert.equal(terminalCost(result.usage,price).amountNanoUsd,'3075000');
  const changed=result.usage.components;changed[0].count=999;
  assert.equal(terminalCost(acc.result().usage,price).amountNanoUsd,'3075000');
});

test('stream completion requires an ordered start, delta and stop without an error', () => {
  const start = {type:'message_start',message:{usage:{input_tokens:1000}}};
  const delta = {type:'message_delta',usage:{output_tokens:2}};
  const stop = {type:'message_stop'};
  const error = {type:'error',error:{type:'overloaded_error'}};
  for (const events of [[stop], [start, stop], [start, delta], [delta, start, delta, stop],
    [start, start, delta, stop], [start, delta, error, stop]]) {
    const accumulator = createAnthropicUsageAccumulator();
    for (const event of events) accumulator.observe(event);
    assert.equal(accumulator.result().completed,false);
  }
  const accumulator = createAnthropicUsageAccumulator();
  for (const event of [start, {type:'ping'}, {type:'message_delta'}, stop]) accumulator.observe(event);
  const result = accumulator.result();
  assert.equal(result.completed,true);
  assert.equal(terminalCost(result.usage,price).amountNanoUsd,'3000000');
  assert.equal(terminalCost(result.usage,price).provenance,'unknown/defaulted');
});

test('explicit null delta invalidates only that counter; partial/error observations stay explicit not success', () => {
  const acc=createAnthropicUsageAccumulator();
  acc.observe({type:'message_start',message:{usage:{input_tokens:1000,output_tokens:10}}});
  acc.observe({type:'message_delta',usage:{output_tokens:null}});
  acc.observe({type:'error',error:{type:'overloaded_error'}});
  const result=acc.result();assert.equal(result.observedError,true);assert.equal(result.observedStop,false);
  const value=terminalCost(result.usage,price);assert.equal(value.amountNanoUsd,'3000000');
  assert.ok(value.unknown.includes('output'));
});
