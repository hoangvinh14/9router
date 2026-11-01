import { ACCOUNTING_SSE_TERMINAL_MAX_BYTES } from '../config/runtimeConfig.js';
import { RESPONSES_EVENT, RESPONSES_STATUS } from '../translator/schema/index.js';
import { createResponsesUsageObservation, assertResponsesOutput } from './accounting-responses-usage.js';
import { createResponsesSSEFramer, encodeResponsesFrame } from './responses-sse-framing.js';
import { bindAccountingStreamActivity } from './accounting-stream-activity.js';
import { accountingRefusal } from './accounting-transport.js';
const terminals=new Map([[RESPONSES_EVENT.COMPLETED,RESPONSES_STATUS.COMPLETED],[RESPONSES_EVENT.FAILED,RESPONSES_STATUS.FAILED],
  [RESPONSES_EVENT.INCOMPLETE,RESPONSES_STATUS.INCOMPLETE],[RESPONSES_EVENT.DONE,null]]);

export function createAccountedResponsesStream(response,ticket,{profile,signal}) {
  const reader=response.body.getReader(),observation=createResponsesUsageObservation(profile),listeners=new Set();
  const nativeErrors=new WeakSet();
  let responseId=null,terminal=null,terminalBytes=null,terminalSignature=null,terminalType=null,protocolComplete=false,activeFrames=null;
  let stopped=false,released=false,rawComplete=false,controllerRef,terminalPromise,stopPromise,cancelStarted=false,readPending=false;
  const notify=(size,done=false)=>{rawComplete ||= done;for(const listener of listeners)listener(size,done);};
  const release=()=>{if(!released&&!readPending){released=true;reader.releaseLock();}};
  const cancelReader=reason=>{
    if(cancelStarted)return;cancelStarted=true;
    // Reader cancellation is cleanup, not an accounting barrier. Even a broken
    // cancel promise cannot hold an observed billable terminal hostage.
    try{Promise.resolve(reader.cancel(reason)).catch(()=>{}).finally(release);}catch{release();}
  };
  const cleanup=()=>{signal?.removeEventListener('abort',abort);listeners.clear();activeFrames=null;terminalBytes=null;terminal=null;terminalSignature=null;
    try{framer.clear();}catch{}release();
    // Close a suspended delta generator so it cannot retain its transport
    // chunk. Never wait on cleanup while an ACK is being delivered.
    Promise.resolve(iterator.return()).catch(()=>{});
  };
  const finish=(outcome,interrupted)=>{
    if(!terminalPromise){const usage=observation.value(),evidence={...observation.evidence(),interrupted};
      terminalPromise=Promise.resolve().then(()=>ticket.finish(usage,outcome,evidence));}
    return terminalPromise;
  };
  const stop=reason=>{
    if(stopPromise)return stopPromise;
    stopped=true;
    // A suspended delta yield may still own bytes already received. Inspect
    // that finite remainder without publishing or reading another chunk.
    if(activeFrames){
      try{for(const frame of activeFrames)inspect(frame);}
      catch(error){if(!nativeErrors.has(error))observation.observe(null);}
      activeFrames=null;
    }
    // A previous partial-only chunk may have no active frame iterator while
    // read() awaits the next chunk. It is still observed malformed evidence.
    try{framer.end();}catch{observation.observe(null);}
    notify(0,true);cancelReader(reason);
    stopPromise=finish('stream_unknown',!protocolComplete).finally(cleanup);return stopPromise;
  };
  const abort=()=>{
    const reason=signal.reason||new Error('Responses stream aborted');
    stop(reason).then(()=>{try{controllerRef.error(accountingRefusal(reason));}catch{}},error=>{try{controllerRef.error(accountingRefusal(error));}catch{}});
  };
  const framer=createResponsesSSEFramer();
  const inspect=frame=>{
    let parsed;try{parsed=JSON.parse(frame.payload);}catch(error){observation.observe(null);throw error;}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||typeof parsed.type!=='string'||frame.event&&frame.event!==parsed.type){observation.observe(null);throw new Error('Responses event identity mismatch');}
    const type=frame.event||parsed.type;
    if(parsed.response?.id!==undefined){
      if(typeof parsed.response.id!=='string'||!parsed.response.id||responseId&&parsed.response.id!==responseId){observation.observe(null);throw new Error('Responses response identity changed');}
      responseId=parsed.response.id;
    }
    if(type===RESPONSES_EVENT.ERROR){
      if(terminal){observation.conflict();throw new Error('Conflicting terminal error');}
      protocolComplete=true;const error=new Error('Native Responses upstream error');nativeErrors.add(error);throw error;
    }
    if(terminals.has(type)){
      const raw=parsed.response,expected=terminals.get(type);
      if(!raw||!responseId||!Object.values(RESPONSES_STATUS).includes(raw.status)||expected&&raw.status!==expected){observation.observe(null);throw new Error('Responses terminal status mismatch');}
      try{assertResponsesOutput(raw);}catch(error){observation.observe(null);throw error;}
      protocolComplete=true;
      if(Object.hasOwn(raw,'usage'))observation.observe(raw.usage);
      const signature=JSON.stringify(raw);
      if(terminalSignature&&(signature!==terminalSignature||type!==terminalType)){observation.conflict();throw new Error('Conflicting Responses terminals');}
      if(!terminal){terminal=raw;terminalSignature=signature;terminalType=type;terminalBytes=encodeResponsesFrame(frame);
        if(terminalBytes.byteLength>ACCOUNTING_SSE_TERMINAL_MAX_BYTES){observation.observe(null);throw new Error('Responses terminal limit exceeded');}}
      return null;
    }
    if(terminal){observation.observe(null);throw new Error('Evidence after Responses terminal');}
    return encodeResponsesFrame(frame);
  };
  async function* events(){
    while(true){
      let result;readPending=true;
      try{result=await reader.read();}finally{readPending=false;if(stopped)release();}
      if(stopped)return;
      const {done,value}=result;
      if(done){try{framer.end();}catch(error){observation.observe(null);throw error;}throw new Error('Responses stream ended without terminal');}
      notify(value.byteLength);
      try{
        // Yield nonterminals incrementally with backpressure. After a terminal,
        // inspect all remaining frames/partial bytes of THIS received chunk
        // before freezing evidence; never drain unseen future chunks.
        activeFrames=framer.frames(value);
        for(const frame of activeFrames){const bytes=inspect(frame);if(bytes)yield bytes;}
        activeFrames=null;
      }catch(error){if(!nativeErrors.has(error))observation.observe(null);throw error;}
      if(terminal){
        try{framer.end();}catch(error){observation.observe(null);throw error;}
        notify(0,true);cancelReader();
        if(!observation.value())throw new Error('Missing authoritative Responses terminal usage');
        await finish(`http_${response.status}`,false);if(stopped||signal?.aborted)return;
        yield terminalBytes;return;
      }
    }
  }
  const iterator=events();
  const body=new ReadableStream({
    start(controller){controllerRef=controller;signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();},
    async pull(controller){if(stopped)return;try{
      const {done,value}=await iterator.next();if(stopped)return;
      if(done){stopped=true;cleanup();controller.close();}else controller.enqueue(value);
    }catch(error){let failure=error;try{await stop(error);}catch(sinkError){failure=sinkError;}
      try{controller.error(accountingRefusal(failure));}catch{}}},
    cancel:reason=>stop(reason),
  });
  const wrapped=new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  return bindAccountingStreamActivity(wrapped,{
    subscribe(listener){listeners.add(listener);if(rawComplete)listener(0,true);return()=>listeners.delete(listener);},
    terminalError(error){try{return ticket.terminalError?.(error)??null;}catch{return ticket.fallbackTerminalBytes??null;}},
  });
}
