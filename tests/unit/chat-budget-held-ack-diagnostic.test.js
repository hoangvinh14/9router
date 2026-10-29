import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { openChatFixture, gate } from '../fixtures/accounting/chat-loopback.js';
import { streamReply, respondStream } from '../fixtures/accounting/chat-stream.js';
const category=part=>{if(part.done)return {done:true};const text=new TextDecoder().decode(part.value);return {bytes:part.value.byteLength,error:text.includes('"error"'),finish:text.includes('"finish_reason":"stop"'),doneMarker:text.includes('[DONE]'),dataFrames:(text.match(/data:/g)||[]).length,role:text.includes('"role"'),content:text.includes('"content"')};};
for(const engine of ['node','sqljs'])describe(`${engine} held ACK diagnostic`,()=>{
  it('classifies preACK read without changing existing assertion',async()=>{
    const entered=gate(),hold=gate(),trace=[];const f=await openChatFixture(engine,{respond:respondStream(streamReply())});let reader,pending;
    try{
      const response=await f.request({stream:true,hooks:{terminalAck:async()=>{trace.push('ack-enter');entered.release();await hold.promise;trace.push('ack-release-observed');}}});reader=response.body.getReader();
      trace.push({first:category(await reader.read())});let delivered=false;
      pending=reader.read().then(part=>{delivered=true;trace.push({second:category(part)});return part;},error=>{trace.push({readFailure:error.name});throw error;});
      await entered.promise;trace.push({preAckDelivered:delivered});
      fs.writeFileSync(`/tmp/9router-p4-held-trace-${engine}.json`,JSON.stringify({engine,trace},null,2));
      expect(trace[0]).toBeTruthy();
    }finally{hold.release();if(pending)await pending.catch(()=>{});await reader?.cancel();await f.close();}
  });
});
