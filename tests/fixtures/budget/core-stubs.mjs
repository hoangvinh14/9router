// Explicit unrelated-dependency stub for actual chatCore control-flow lane.
// Actual core, native JSON/error owner, ledger and SQLite remain unmocked.
import assert from 'node:assert/strict';
const blocked=()=>assert.fail('unsupported fixture helper reached');
const noop=()=>{};
const failAt=stage=>{if(globalThis.__budgetCore?.settled && globalThis.__budgetCore?.failure===stage)throw new Error('private '+stage);};
const mark=()=>{globalThis.__budgetCore.helpers++;};
export const detectFormat=()=> 'claude', getTargetFormat=()=> 'claude', resolveTransport=()=>null;
export const translateRequest=blocked, needsTranslation=()=>{failAt('translation');return false;}, applyThinking=blocked, extractThinking=()=>null, stripThinkingSuffix=x=>x;
export const normalizeClaudePassthrough=noop, anchorClaudeCache=noop;
export const createStreamController=()=>({signal:new AbortController().signal,handleComplete:()=>{globalThis.__budgetCore.completions=(globalThis.__budgetCore.completions||0)+1;failAt('completion');},handleError:noop});
export const refreshWithRetry=()=>{globalThis.__budgetCore.refresh++;assert.fail('accounted refresh');};
export const createRequestLogger=async()=>({logClientRawRequest:noop,logRawRequest:noop,logTargetRequest:noop,logError:noop,logProviderResponse:()=>failAt('logger'),logConvertedResponse:noop});
export const getModelTargetFormat=provider=>provider === 'codex' ? 'openai-responses' : 'claude', getModelSupportedFormats=()=>null, getModelStrip=()=>[], getModelUpstreamId=(_a,m)=>m, getModelType=()=>null;
export const PROVIDER_ID_TO_ALIAS={}, PROVIDERS={};
export const trackPendingRequest=noop, appendRequestLog=async()=>{}, saveRequestDetail=async()=>{};
export const getExecutor=()=>{globalThis.__budgetCore.executors++;return globalThis.__budgetCore.executor;};
export const supportsGrokCliReasoningEffort=()=>false;
export const buildRequestDetail=x=>x, extractRequestConfig=()=>({}), extractUsageFromResponse=x=>x.usage, saveUsageStats=noop, formatDoneLine=()=>'';
export const handleForcedSSEToJson=blocked, parseSSEToOpenAIResponse=blocked, handleStreamingResponse=blocked, buildOnStreamComplete=blocked;
export const createSSETransformStreamWithLogger=blocked, createPassthroughStreamWithLogger=blocked;
export const detectClientTool=()=> 'fixture', isNativePassthrough=()=>true;
export const handleBypassRequest=()=>{mark();return null;}, dedupeTools=blocked, takeRenamedToolNames=()=>null;
export const injectCaveman=blocked, injectPonytail=blocked, injectCustomPrompt=blocked, compressWithPxpipe=blocked;
export const compressMessages=(_body,enabled)=>{assert.ok(!enabled);return null;}, formatRtkLog=()=>null;
export const compressWithHeadroom=async(_body,options)=>{assert.ok(!options.enabled);return null;}, formatHeadroomLog=()=>null, formatHeadroomSizeLog=()=>null, isHeadroomPhantomSavings=()=>false;
export const getCapabilitiesForModel=blocked, stripUnsupportedModalities=blocked, prefetchRemoteImages=blocked;
export const defaultClaudeToolType=blocked, shouldDefaultClaudeToolType=()=>false, resolveSessionId=()=>null;
export const openAICompletionToClaudeMessage=x=>x, ollamaBodyToOpenAI=x=>x, addBufferToUsage=x=>x, filterUsageForFormat=x=>x;
export const unwrapClineEnvelope=x=>x, decloakToolNames=x=>{failAt('decloak');return x;}, restoreToolNames=x=>{if(globalThis.__budgetCore?.settled && globalThis.__budgetCore?.failure==='serialization'){const cycle={};cycle.self=cycle;return cycle;}return x;};
// Combo's unrelated dependency fixture: no router/storage/real timer/network.
export const parseModel=x=>({provider:x.split('/')[0],model:x.split('/')[1]});
export const checkFallbackError=()=>({shouldFallback:true,cooldownMs:0,requestScoped:false}),formatRetryAfter=x=>x;
export const extractTextContent=x=>typeof x==='string'?x:'';
export const peekStreamForContent=()=>{globalThis.__budgetCore.peeks++;return {outcome:'empty',finishReason:'stop',head:[],reader:null};};
export const reconstructStream=()=>new ReadableStream({start(c){c.close();}}),isNoRetryFinish=()=>false;
export const getStickyComboModel=()=>null,setStickyComboModel=noop,clearStickyComboSession=noop,orderModelsByChoice=x=>x;
export const ROLE={SYSTEM:'system',ASSISTANT:'assistant',USER:'user'}, RESPONSES_ITEM={};
