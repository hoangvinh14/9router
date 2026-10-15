import { describe, it, expect, vi } from 'vitest';
import { createGeminiOwnedFileRawAuthority } from 'open-sse/config/accountingGeminiOwnedFileRaw.js';
import { inspectRawGeminiAccounting, readBufferedGeminiAccounting } from 'open-sse/utils/accountingGeminiUsage.js';
import { createAccountingGeminiSseParser } from 'open-sse/utils/accountingGeminiSseParser.js';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
const file = () => ({ name:'files/upload-1', uri:'https://generativelanguage.googleapis.com/v1beta/files/upload-1', mimeType:'video/mp4', sizeBytes:'17', sha256Hash:Buffer.alloc(32,1).toString('base64'), createTime:'2026-10-03T00:00:00Z', updateTime:'2026-10-03T00:00:00Z', expirationTime:'2026-10-05T00:00:00Z', state:'ACTIVE', source:'UPLOADED' });
const inventory = () => [{id:'resource-1',file:file()}];
const original = (metadata={fps:1,startOffset:'0.000000001s',endOffset:'1.000000001s'}) => ({contents:[{role:'user',parts:[{text:'private original'},{fileData:{fileUri:file().uri,displayName:'private display'},videoMetadata:metadata}]}]});
const message = () => ({modelVersion:'fixture-gemini',candidates:[{index:0,finishReason:'STOP',content:{role:'model',parts:[{text:'private answer'}]}}],usageMetadata:{promptTokenCount:100,cachedContentTokenCount:40,candidatesTokenCount:20,thoughtsTokenCount:10,totalTokenCount:130,promptTokensDetails:[{modality:'TEXT',tokenCount:20},{modality:'IMAGE',tokenCount:50},{modality:'AUDIO',tokenCount:30}],cacheTokensDetails:[{modality:'TEXT',tokenCount:10},{modality:'IMAGE',tokenCount:20},{modality:'AUDIO',tokenCount:10}]}});
const inspect = (raw, owner) => inspectRawGeminiAccounting(raw,'fixture-gemini',{ownedFileRawAuthority:owner});
const parse = (frames,owner) => {
  const events=[], parser=createAccountingGeminiSseParser(event=>{events.push(event);},{expectedModel:'fixture-gemini',ownedFileRawAuthority:owner});
  const text=frames.map(frame=>`data: ${JSON.stringify(frame)}\n\n`).join('');
  for(const byte of new TextEncoder().encode(text)) parser.push(Uint8Array.of(byte));
  expect(parser.evidence()).toBeNull();
  return {usage:parser.finish(),events,text};
};
const rates={input:'1',output:'2',cached:'0.1',input_image:'3',cached_image:'0.2',input_audio:'7',cached_audio:'0.4',input_video:'11',cached_video:'0.5'};
const snapshot={rates,rateUnits:Object.fromEntries(Object.keys(rates).filter(key=>!['output'].includes(key)).map(key=>[key,'USD/1M tokens'])),usageSemantics:{inputModalities:'observed_gemini_owned_file_input_modalities',allowedInputModalities:['TEXT','VIDEO','IMAGE','AUDIO']}};
describe('owned video metadata raw independent original grant, not gateway ownership or decoded quantities',()=>{
  it('JSON buffered and byte-framed native SSE use full captured owned original with explicit grant, default remains closed',async()=>{
    const body=original(),before=structuredClone(body),owner=createGeminiOwnedFileRawAuthority(body,inventory(),true),raw=message();
    const result=inspect(raw,owner);expect(result.message).toEqual(raw);expect(result.usage).toMatchObject({exact:true,input:100,cacheRead:40,output:20,reasoning:10,inputModalities:{TEXT:{input:20,cacheRead:10},IMAGE:{input:50,cacheRead:20},AUDIO:{input:30,cacheRead:10}}});
    expect((await readBufferedGeminiAccounting(Response.json(raw),null,{expectedModel:'fixture-gemini',ownedFileRawAuthority:owner})).usage).toEqual(result.usage);
    const streamed=parse([raw],owner);expect(streamed.usage).toEqual(result.usage);expect(new TextDecoder().decode(Buffer.concat(streamed.events.map(event=>Buffer.from(event.bytes))))).toBe(streamed.text);expect(body).toEqual(before);
    expect(()=>createGeminiOwnedFileRawAuthority(body,inventory())).toThrow();expect(()=>inspect(raw,{...owner})).toThrow();expect(()=>inspectRawGeminiAccounting(raw,'fixture-gemini',{ownedFileRawAuthority:owner,videoMetadataOriginal:body})).toThrow();
  });
  it('offsets FPS display and observed byte size never change observed cost; all original allowed rates mandatory even unobserved VIDEO',()=>{
    for(const metadata of [{},{fps:24,startOffset:'315575999999.999999999s',endOffset:'315576000000s'},{fps:0.000001,endOffset:'1s'}]){
      const resources=inventory();resources[0].file.sizeBytes='1000';const owner=createGeminiOwnedFileRawAuthority(original(metadata),resources,true);expect(costFromExactUsageSnapshot(inspect(message(),owner).usage,snapshot)).toBe('309000');
      const missing=structuredClone(snapshot);delete missing.rates.cached_video;expect(()=>costFromExactUsageSnapshot(inspect(message(),owner).usage,missing)).toThrow();
    }
  });
  it('early counters cannot fill omitted terminal lists; foreign categories processing/output controls and wrong model stay refused',()=>{
    const owner=createGeminiOwnedFileRawAuthority(original(),inventory(),true),raw=message(),early=structuredClone(raw);delete early.candidates[0].finishReason;
    expect(parse([early],owner).usage).toBeNull();expect(parse([early,raw],owner).usage).toEqual(inspect(raw,owner).usage);
    for(const change of [v=>{delete v.usageMetadata.promptTokensDetails;},v=>{delete v.usageMetadata.cacheTokensDetails;},v=>{v.usageMetadata.promptTokensDetails[1].modality='DOCUMENT';},v=>{v.usageMetadata.toolUsePromptTokenCount=0;},v=>{v.usageMetadata.toolUsePromptTokensDetails=[];},v=>{v.usageMetadata.durationSeconds=1;},v=>{v.modelVersion='foreign';},v=>{v.candidates[0].content.parts[0].videoMetadata={fps:1};}]){
      const bad=message();change(bad);expect(()=>inspect(bad,owner)).toThrow();expect(()=>parse([early,bad],owner)).toThrow();
    }
  });
  it('captures source before callbacks/traps and refuses unsupported controls and false type grants; retained owner cannot be changed by caller source',()=>{
    const body=original(),owner=createGeminiOwnedFileRawAuthority(body,inventory(),true);body.contents[0].parts[1].videoMetadata.fps=0;expect(inspect(message(),owner).usage.input).toBe(100);
    for(const grant of ['true',1,{},null])expect(()=>createGeminiOwnedFileRawAuthority(original(),inventory(),grant)).toThrow();
    const getter=vi.fn(),v=original();Object.defineProperty(v.contents[0].parts[1].videoMetadata,'fps',{enumerable:true,get:getter});expect(()=>createGeminiOwnedFileRawAuthority(v,inventory(),true)).toThrow();expect(getter).not.toHaveBeenCalled();
    for(const change of [v=>{v.contents[0].parts[1].videoMetadata.fps=25;},v=>{v.contents[0].parts[1].mediaProcessing='AGENTIC';},v=>{v.contents[0].parts[1].mediaResolution={level:'MEDIA_RESOLUTION_LOW'};},v=>{v.contents[0].parts.push({inlineData:{mimeType:'image/png',data:'YQ=='}});},v=>{v.tools=[{functionDeclarations:[{name:'lookup',description:'private'}]}];}]){const bad=original();change(bad);expect(()=>createGeminiOwnedFileRawAuthority(bad,inventory(),true)).toThrow();}
  });
});
