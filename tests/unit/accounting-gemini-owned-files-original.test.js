import { describe, it, expect, vi } from 'vitest';
import { supportsGeminiRequest } from 'open-sse/config/accountedGeminiCandidate.js';
const file = (id='upload-1',mimeType='video/mp4') => ({name:'files/'+id,uri:'https://generativelanguage.googleapis.com/v1beta/files/'+id,mimeType,sizeBytes:'17',sha256Hash:Buffer.alloc(32,1).toString('base64'),createTime:'2026-10-03T00:00:00Z',updateTime:'2026-10-03T00:00:00Z',expirationTime:'2026-10-05T00:00:00Z',state:'ACTIVE',source:'UPLOADED'});
const binding = (id='resource-1',f=file()) => ({id,file:f});
const body = () => ({contents:[{role:'user',parts:[{text:'before'},{fileData:{fileUri:file().uri,mimeType:'video/mp4',displayName:'original source display'}},{text:'after'}]}]});
const validate = v => supportsGeminiRequest(v);
const check = async (value,resources=[binding()],validator=validate,allowVideoMetadata=false) => (await import('open-sse/config/accountingGeminiOwnedFilesOriginal.js')).supportsGeminiOwnedFilesOriginal(value,resources,validator,allowVideoMetadata);
describe('bound full original fileData grammar prerequisite only, metadata inventory is not tenant admission authority',()=>{
  it('preserves complete original and ordered parts while locally validating exact bound fileData, without inline substitution or default grants',async()=>{
    const original=body(),before=structuredClone(original),resources=[binding()];expect(await check(original,resources)).toBe(true);expect(original).toEqual(before);expect(resources).toEqual([binding()]);expect(supportsGeminiRequest(original,false,true,true,true,true,true,true,true,true,true)).toBe(false);
    const callback=vi.fn(v=>{expect(v.contents[0].parts).toEqual([{text:'before'},{text:'[validated original owned file]'},{text:'after'}]);expect(JSON.stringify(v)).not.toContain('inlineData');return true;});expect(await check(original,resources,callback)).toBe(true);expect(callback).toHaveBeenCalledOnce();expect(original).toEqual(before);
  });
  it('accepts optional MIME/display absence without manufacturing fields and requires observed MIME equality whenever provided',async()=>{
    for(const mimeType of ['image/png','application/pdf','audio/wav','video/mp4']){const f=file('upload-1',mimeType),v=body();v.contents[0].parts[1]={fileData:{fileUri:f.uri}};expect(await check(v,[binding('resource-1',f)])).toBe(true);expect(v.contents[0].parts[1].fileData).not.toHaveProperty('mimeType');v.contents[0].parts[1].fileData.mimeType=mimeType;expect(await check(v,[binding('resource-1',f)])).toBe(true);v.contents[0].parts[1].fileData.mimeType='image/jpeg';expect(await check(v,[binding('resource-1',f)])).toBe(false);}
  });
  it('requires complete unique used inventory; repeated exact resource parts valid, no foreign, extra, empty or forged active metadata grant',async()=>{
    const v=body();v.contents[0].parts.push(structuredClone(v.contents[0].parts[1]));expect(await check(v)).toBe(true);
    for(const resources of [[],[binding(),binding()],[binding(),binding('resource-2',file('unused'))],[{...binding(),apiKeyId:'claimed'}],[binding('resource-1',{...file(),state:'PROCESSING'})],[binding('resource-1',{...file(),source:'GENERATED'})]])expect(await check(v,resources)).toBe(false);
    const foreign=body();foreign.contents[0].parts[1].fileData.fileUri='https://evil.invalid/private';expect(await check(foreign)).toBe(false);expect(await check({contents:[{parts:[{text:'no resource'}]}]})).toBe(false);
  });
  it('composes existing client and inline-media grants only through original validator, retaining source inventory and whole other material',async()=>{
    const v=body();v.contents[0].parts.push({inlineData:{mimeType:'image/png',data:'YQ=='}});expect(await check(v)).toBe(false);expect(await check(v,[binding()],x=>supportsGeminiRequest(x,false,true))).toBe(true);
    v.tools=[{functionDeclarations:[{name:'lookup',description:'original'}]}];expect(await check(v,[binding()],x=>supportsGeminiRequest(x,false,true))).toBe(false);expect(await check(v,[binding()],x=>supportsGeminiRequest(x,true,true))).toBe(true);
    const before=structuredClone(v);await check(v,[binding()],x=>supportsGeminiRequest(x,true,true));expect(v).toEqual(before);
  });
  it('never erases resource controls/unknown unions/output/system/cached references to manufacture accepted source support',async()=>{
    expect(await check(body())).toBe(true);
    for(const change of [v=>{v.contents[0].role='model';},v=>{v.contents[0].parts[1].text='other union';},v=>{v.contents[0].parts[1].mediaProcessing='AGENTIC';},v=>{v.contents[0].parts[1].videoMetadata={fps:1};},v=>{v.contents[0].parts[1].mediaResolution={level:'MEDIA_RESOLUTION_LOW'};},v=>{v.contents[0].parts[1].fileData.unknown='x';},v=>{v.cachedContent='cachedContents/project';},v=>{v.systemInstruction={parts:[{fileData:{fileUri:file().uri}}]};}]){const v=body();change(v);expect(await check(v)).toBe(false);}
  });
  it('binds raw observed categories independently from inline grants, without fake data or metadata-based counts',async()=>{
    const a=await import('open-sse/config/accountingGeminiOwnedFileRaw.js'),raw=await import('open-sse/utils/accountingGeminiUsage.js');
    for(const [mimeType,categories] of [['image/png',['TEXT','IMAGE']],['application/pdf',['TEXT','IMAGE','DOCUMENT']],['audio/wav',['TEXT','AUDIO']],['video/mp4',['TEXT','VIDEO','IMAGE','AUDIO']]]){
      const f=file('upload-1',mimeType),v={contents:[{parts:[{fileData:{fileUri:f.uri}}]}]},owner=a.createGeminiOwnedFileRawAuthority(v,[binding('resource-1',f)]);expect(a.assertGeminiOwnedFileRawAuthority(owner).allowedInputModalities).toEqual(categories);
      const modality=categories.at(-1),message={modelVersion:'exact-model',candidates:[{index:0,finishReason:'STOP',content:{role:'model',parts:[{text:'answer'}]}}],usageMetadata:{promptTokenCount:7,cachedContentTokenCount:2,candidatesTokenCount:1,totalTokenCount:8,promptTokensDetails:[{modality,tokenCount:7}],cacheTokensDetails:[{modality,tokenCount:2}]}};
      expect(raw.inspectRawGeminiAccounting(message,'exact-model',{ownedFileRawAuthority:owner}).usage.inputModalities).toEqual({[modality]:{input:7,cacheRead:2}});expect(()=>raw.inspectRawGeminiAccounting(message,'exact-model')).toThrow();expect(()=>raw.inspectRawGeminiAccounting(message,'exact-model',{ownedFileRawAuthority:{...owner}})).toThrow();expect(()=>raw.inspectRawGeminiAccounting(message,'exact-model',{ownedFileRawAuthority:owner,inlineVideoOriginal:v})).toThrow();expect(v.contents[0].parts[0]).toEqual({fileData:{fileUri:f.uri}});
    }
    const v=body();v.contents[0].parts.push({inlineData:{mimeType:'image/png',data:'YQ=='}});expect(()=>a.createGeminiOwnedFileRawAuthority(v,[binding()])).toThrow();
  });
  it('refuses programmable validator returns without reading then getters or proxy traps, while observing genuine rejected promises',async()=>{
    expect(await check(body(),[binding()],()=>true)).toBe(true);
    const getter=vi.fn(()=>{throw new Error('must not invoke foreign then getter');});
    const returned={};Object.defineProperty(returned,'then',{get:getter});
    expect(await check(body(),[binding()],()=>returned)).toBe(false);expect(getter).not.toHaveBeenCalled();
    const trap=vi.fn(()=>{throw new Error('must not invoke foreign proxy');});
    const proxy=new Proxy({},{get:trap,getPrototypeOf:trap,ownKeys:trap});
    expect(await check(body(),[binding()],()=>proxy)).toBe(false);expect(trap).not.toHaveBeenCalled();
    const revoked=Proxy.revocable({},{});revoked.revoke();expect(await check(body(),[binding()],()=>revoked.proxy)).toBe(false);
    const promise=Promise.reject(new Error('expected rejected validator return'));
    Object.defineProperty(promise,'then',{get:getter});
    expect(await check(body(),[binding()],()=>promise)).toBe(false);expect(getter).not.toHaveBeenCalled();
    expect(await check(body(),[binding()],()=>Promise.resolve(true))).toBe(false);
  });
  it('requires complete multi-resource inventory and rejects non-Boolean/async validation without mutating originals',async()=>{
    const v=body(),other=file('upload-2','application/pdf');v.contents[0].parts.push({fileData:{fileUri:other.uri}});const resources=[binding(),binding('resource-2',other)];expect(await check(v,resources)).toBe(true);expect(await check(v)).toBe(false);expect(await check(v,[binding(),binding('resource-1',other)])).toBe(false);
    const before=structuredClone(v);expect(await check(v,resources,()=>1)).toBe(false);expect(await check(v,resources,async()=>true)).toBe(false);expect(await check(v,resources,()=>Promise.reject(new Error('fixture invalid async validator')))).toBe(false);expect(v).toEqual(before);
    delete v.contents[0].role;expect(await check(v,resources)).toBe(true);const empty=body();empty.contents[0].parts[1].fileData.displayName='';expect(await check(empty)).toBe(true);
  });
  it('owned video metadata grant preserves whole source controls with separate default-closed local grammar validation',async()=>{
    for(const metadata of [{},{fps:1},{startOffset:'0.000000001s',endOffset:'315576000000s',fps:24}]){
      const v=body();v.contents[0].parts[1].videoMetadata=metadata;const before=structuredClone(v);
      expect(await check(v)).toBe(false);
      const validator=vi.fn(view=>{expect(view.contents[0].parts[1]).toEqual({text:'[validated original owned file]'});expect(JSON.stringify(view)).not.toContain('inlineData');return supportsGeminiRequest(view);});
      expect(await check(v,[binding()],validator,true)).toBe(true);expect(validator).toHaveBeenCalledOnce();expect(v).toEqual(before);
      expect(supportsGeminiRequest(v,false,true,true,true,true,true,true,true,true,true)).toBe(false);
    }
  });
  it('owned video metadata grant validates exact observed video resource and entire controls before callback, not client MIME claims',async()=>{
    for(const mimeType of ['image/png','application/pdf','audio/wav']){const f=file('upload-1',mimeType),v=body();v.contents[0].parts[1]={fileData:{fileUri:f.uri},videoMetadata:{fps:1}};const callback=vi.fn(()=>true);expect(await check(v,[binding('resource-1',f)],callback,true)).toBe(false);expect(callback).not.toHaveBeenCalled();}
    for(const metadata of [{fps:0},{fps:25},{fps:'1'},{startOffset:'1s',endOffset:'1s'},{startOffset:'2s',endOffset:'1s'},{startOffset:'315576000000.000000001s'},{endOffset:'0.0000000001s'},{unknown:1},null]){const v=body();v.contents[0].parts[1].videoMetadata=metadata;const callback=vi.fn(()=>true);expect(await check(v,[binding()],callback,true)).toBe(false);expect(callback).not.toHaveBeenCalled();}
    const v=body();v.contents[0].parts[1].videoMetadata={fps:1};v.contents[0].parts[1].text='unknown union';expect(await check(v,[binding()],()=>true,true)).toBe(false);
    delete v.contents[0].parts[1].text;v.contents[0].parts[1].mediaProcessing='AGENTIC';expect(await check(v,[binding()],()=>true,true)).toBe(false);
  });
  it('owned video metadata grant rejects forged raw/default promotion and getter controls before programmable validation',async()=>{
    const v=body();v.contents[0].parts[1].videoMetadata={fps:1};const raw=await import('open-sse/config/accountingGeminiOwnedFileRaw.js');expect(()=>raw.createGeminiOwnedFileRawAuthority(v,[binding()])).toThrow();
    const callback=vi.fn(()=>true),getter=vi.fn();Object.defineProperty(v.contents[0].parts[1].videoMetadata,'fps',{enumerable:true,get:getter});expect(await check(v,[binding()],callback,true)).toBe(false);expect(getter).not.toHaveBeenCalled();expect(callback).not.toHaveBeenCalled();
  });
  it('captures body and inventory before introspection, rejecting getters/proxies/own undefined/oversize without callbacks or lookups',async()=>{
    expect(await check(body())).toBe(true);const getter=vi.fn(),v=body();Object.defineProperty(v.contents[0].parts[1].fileData,'fileUri',{enumerable:true,get:getter});const callback=vi.fn(()=>true);expect(await check(v,[binding()],callback)).toBe(false);expect(getter).not.toHaveBeenCalled();expect(callback).not.toHaveBeenCalled();const trap=vi.fn();expect(await check(body(),new Proxy([binding()],{get:trap,ownKeys:trap}),callback)).toBe(false);expect(trap).not.toHaveBeenCalled();
    const undef=body();undef.contents[0].parts[1].fileData.mimeType=undefined;expect(await check(undef)).toBe(false);const big=body();big.contents[0].parts[0].text='x'.repeat(262145);expect(await check(big)).toBe(false);expect(await check(body(),[binding()],null)).toBe(false);
  });
});
