import { describe, expect, it } from 'vitest';
import { normalizeOpenAIUsage, createUsageObservation, OPENAI_EXPLICIT_USAGE_PROFILE as profile } from '../../open-sse/utils/accounting-openai-usage.js';
import { createAccountedBoundary } from '../../open-sse/executors/accounted-base.js';
import { costFromExactUsageSnapshot } from '../../src/lib/accounting/exact-money.js';
import { rawUsage } from '../fixtures/accounting/chat-loopback.js';

describe('strict OpenAI raw usage profile', () => {
  it.each([[0,'0.25','1200000'],[400,'0.25','900000'],[1000,'0.25','450000'],[400,'0','800000'],[400,undefined,'1200000']])('prices raw cache count %s using original cached rate %s', (cached,rate,expected) => {
    const usage = normalizeOpenAIUsage(rawUsage(cached),profile);
    const snapshot = {provider:'fixture',model:'fixture',endpoint:'chat',currency:'USD',unit:'USD/1M tokens',revision:'original',
      rates:{input:'1',output:'2',...(rate===undefined?{}:{cached:rate})}};
    expect(costFromExactUsageSnapshot(usage,snapshot)).toBe(expected);
    expect(usage).toMatchObject({cacheWrite:0,cacheWrite5m:0,cacheWrite1h:0,reasoningIncludedInOutput:true});
  });
  it.each([
    value => { delete value.prompt_tokens_details; }, value => { delete value.completion_tokens_details; },
    value => { value.total_tokens++; },value => {value.prompt_tokens_details.cached_tokens=1001;},
    value => {value.completion_tokens_details.reasoning_tokens=101;},value => {value.prompt_tokens=-1;},
    value => {value.prompt_tokens=1.5;},value => {value.completion_tokens=Number.MAX_SAFE_INTEGER+1;},
    value => {value.cache_creation_input_tokens=0;},value => {value.prompt_tokens_details.cache_write_tokens=0;},
  ])('leaves missing or contradictory evidence unknown', mutate => {
    const raw=rawUsage();mutate(raw);expect(normalizeOpenAIUsage(raw,profile)).toBeNull();
  });
  it('deduplicates complete identical observations and never sums conflicts', () => {
    const observation=createUsageObservation(profile);
    observation.observe(rawUsage(400));observation.observe(rawUsage(400));expect(observation.value()?.cacheRead).toBe(400);
    observation.observe(rawUsage(401));expect(observation.value()).toBeNull();
    observation.observe(rawUsage(400));expect(observation.value()).toBeNull();
  });
  it('cannot infer profile semantics from a compatible provider name', () => {
    expect(normalizeOpenAIUsage(rawUsage(),'openai-compatible')).toBeNull();
  });
  it.each([204,205,304])('preserves native null-body HTTP %s after unresolved ACK',async status=>{
    const observations=[];
    const boundary=createAccountedBoundary({profile,prepare:async()=>({finish:async usage=>{observations.push(usage);}})});
    const ticket=await boundary.prepare({});const response=await ticket.response(new Response(null,{status}));
    expect(response.status).toBe(status);expect(response.body).toBeNull();expect(observations).toEqual([null]);
  });

});
