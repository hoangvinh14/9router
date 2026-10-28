import { beforeEach, describe, expect, it, vi } from 'vitest';
const { fetchMock } = vi.hoisted(() => ({fetchMock:vi.fn()}));
vi.mock('../../open-sse/utils/proxyFetch.js',()=>({proxyAwareFetch:fetchMock}));
import { DefaultExecutor } from '../../open-sse/executors/default.js';
beforeEach(()=>fetchMock.mockReset());
describe('canonical Default executor without accounting capability',()=>{
  it('preserves OpenAI registry URL, bearer header and native body ownership',async()=>{
    const response=new Response('{"choices":[]}');fetchMock.mockResolvedValue(response);
    const result=await new DefaultExecutor('openai').execute({model:'gpt-fixture',body:{messages:[{role:'user',content:'hello'}]},stream:false,credentials:{apiKey:'fixture-provider-key'}});
    expect(result.response).toBe(response);expect(response.bodyUsed).toBe(false);
    const [url,init,,boundary]=fetchMock.mock.calls[0];expect(url).toBe('https://api.openai.com/v1/chat/completions');expect(init.headers.Authorization).toBe('Bearer fixture-provider-key');expect(boundary).toBeNull();
  });
  it('preserves no-key streaming headers and adds no usage opt-in without a capability',async()=>{
    const response=new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});fetchMock.mockResolvedValue(response);
    const result=await new DefaultExecutor('openai').execute({model:'gpt-fixture',body:{messages:[],stream:true},stream:true,credentials:{}});
    expect(result.response).toBe(response);expect(response.bodyUsed).toBe(false);
    const [url,init,,boundary]=fetchMock.mock.calls[0];expect(url).toBe('https://api.openai.com/v1/chat/completions');expect(init.headers.Authorization).toBe('Bearer undefined');expect(JSON.parse(init.body).stream_options).toBeUndefined();expect(boundary).toBeNull();
  });
});
