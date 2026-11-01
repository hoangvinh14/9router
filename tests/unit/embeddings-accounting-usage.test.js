import {describe,it,expect} from 'vitest';
import {assertEmbeddingsRequest,observeEmbeddingsJson,normalizeEmbeddingsUsage,EMBEDDINGS_USAGE_PROFILE,assertEmbeddingsPrice} from '../../open-sse/utils/accounting-embeddings-usage.js';
const bytes = text => new TextEncoder().encode(text);
describe('E1 closed embeddings request and raw usage profile',() => {
  it.each([{label:'string',input:'hello'},{label:'strings',input:['a','b']},{label:'tokens',input:[0,123]},{label:'token-batches',input:[[1,2],[3]]}])('admits synchronous shape $label',({input}) => {
    expect(assertEmbeddingsRequest({model:'fixture',input,encoding_format:'base64',dimensions:2,user:'ignored'})).toBe(true);
  });
  it.each(['',[],[''],[1,'a'],[[1],[]],[-1],[1.5],[Number.MAX_SAFE_INTEGER+1],{text:'hello'}].map((input,index)=>({input,index})))('refuses invalid input case $index',({input}) => {
    expect(() => assertEmbeddingsRequest({model:'fixture',input})).toThrow();
  });
  it.each([{stream:true},{encoding_format:'binary'},{dimensions:'2'},{dimensions:0},{tools:[]},{unknown_billing:true},{user:1}])('refuses dimensions/extra fields %j',extra => {
    expect(() => assertEmbeddingsRequest({model:'fixture',input:'hello',...extra})).toThrow();
  });
  it.each([0,1,1000])('maps only explicit exact input %s',input => {
    expect(normalizeEmbeddingsUsage({prompt_tokens:input,total_tokens:input})).toEqual({exact:true,input,output:0,cacheRead:0,cacheWrite:0,reasoning:0,reasoningIncludedInOutput:true,cacheWrite5m:0,cacheWrite1h:0});
  });
  it.each([null,[],{}, {prompt_tokens:1}, {prompt_tokens:1,total_tokens:2},{prompt_tokens:1,total_tokens:1,completion_tokens:0},
    {prompt_tokens:1,total_tokens:1,prompt_tokens_details:{}},{prompt_tokens:'1',total_tokens:1},{prompt_tokens:-1,total_tokens:-1},
    {prompt_tokens:0.1,total_tokens:0.1},{prompt_tokens:1,total_tokens:1,estimated:false}])('refuses ambiguous usage %j',usage => {
    expect(normalizeEmbeddingsUsage(usage)).toBeNull();
  });
  it('never admits another profile',() => expect(normalizeEmbeddingsUsage({prompt_tokens:1,total_tokens:1},'chat')).toBeNull());
  it.each([
    '{"usage":{"prompt_tokens":1,"total_tokens":1},"usage":{"prompt_tokens":2,"total_tokens":2}}',
    '{"usage":{"prompt_tokens":1,"prompt\\u005ftokens":1,"total_tokens":1}}',
    '{"usage":{"prompt_tokens":1,"total_tokens":1,"total_tokens":1}}',
    '{"usage":{"prompt_tokens":1,"total_tokens":1},"us\\u0061ge":{"prompt_tokens":1,"total_tokens":1}}',
    '{"usage":{"prompt_tokens":1,"total_tokens":1}} trailing',
    '{"billing":{"usd":1},"usage":{"prompt_tokens":1,"total_tokens":1}}',
  ])('rejects decoded ambiguity/invalid document %s',text => expect(observeEmbeddingsJson(bytes(text)).kind).toBe('malformed'));
  it('retains ordinary metadata and does not confuse string content with keys',() => {
    const raw = {metadata:'"usage":{"prompt_tokens":33}',data:[{embedding:'AAAB',index:0}],usage:{prompt_tokens:0,total_tokens:0}};
    expect(observeEmbeddingsJson(bytes(JSON.stringify(raw)))).toMatchObject({kind:'valid',usage:{input:0}});
    expect(observeEmbeddingsJson(bytes('{"error":{"message":"missing"}}'))).toEqual({kind:'absent'});
    expect(observeEmbeddingsJson(Uint8Array.of(0xff))).toEqual({kind:'malformed'});
  });
  it('retains normalized input-only original price; rejects extended/output/unknown price',() => {
    const price = {status:'priced',snapshot:{endpoint:'embeddings',source:'manual',rates:{input:'0',output:'0'}}};
    expect(assertEmbeddingsPrice(price)).toBe(price.snapshot);
    for (const rates of [{input:'1',output:'2'},{input:'1',output:'0',cached:'0'},{output:'0'}]) {
      expect(() => assertEmbeddingsPrice({...price,snapshot:{...price.snapshot,rates}})).toThrow();
    }
    expect(() => assertEmbeddingsPrice({status:'unavailable'})).toThrow();
    expect(EMBEDDINGS_USAGE_PROFILE).toBe('openai-embeddings-input-only-v1');
  });
});
