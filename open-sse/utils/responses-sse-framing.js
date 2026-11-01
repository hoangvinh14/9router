import { ACCOUNTING_SSE_FRAME_MAX_BYTES } from '../config/runtimeConfig.js';
// Incremental strict framing only; protocol/usage authority lives at raw owner.
export function createResponsesSSEFramer(onFrame) {
  const decoder=new TextDecoder('utf-8',{fatal:true}),encoder=new TextEncoder();
  let line='',data=[],event='',size=0,cr=false;
  const endLine=()=>{
    if(line===''){
      const frame=data.length?{event,payload:data.join('\n')}:null;
      data=[];event='';size=0;line='';return frame;
    }else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));
    else if(line.startsWith('event:'))event=line.slice(6).trim();
    line='';return null;
  };
  function* frames(bytes){
      // Decode bounded pieces; frame state is byte-bounded independently of chunk size.
      for(let offset=0;offset<bytes.byteLength;offset+=4096){
        const text=decoder.decode(bytes.subarray(offset,offset+4096),{stream:true});
        for(const char of text){
          if(cr&&char==='\n'){cr=false;continue;}cr=false;
          size+=encoder.encode(char).byteLength;
          if(size>ACCOUNTING_SSE_FRAME_MAX_BYTES)throw new Error('Responses SSE frame limit exceeded');
          if(char==='\r'||char==='\n'){cr=char==='\r';const frame=endLine();if(frame)yield frame;}else line+=char;
        }
      }
  }
  return {
    frames,
    push(bytes){for(const frame of frames(bytes))onFrame(frame);},
    end(){decoder.decode();if(line.trim()||data.length||event)throw new Error('Partial Responses SSE frame');},
    hasPartial:()=>!!(line.trim()||data.length||event),
    clear(){line='';data=[];event='';size=0;decoder.decode();},
  };
}
export const encodeResponsesFrame = ({event,payload}) => new TextEncoder().encode(`${event?`event: ${event}\n`:''}${payload.split('\n').map(line=>`data: ${line}`).join('\n')}\n\n`);
