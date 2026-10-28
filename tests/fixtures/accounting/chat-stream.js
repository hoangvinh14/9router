import { rawUsage } from './chat-loopback.js';
export const event = value => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
export const streamDelta = {id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'hello'},finish_reason:null}]};
export const streamFinish = {id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]};
export const streamReply = (usage = rawUsage()) => event(streamDelta)+event(streamFinish)+event({choices:[],usage})+event('[DONE]');
export const respondStream = text => (_request,response) => {response.setHeader('content-type','text/event-stream');response.end(text);};
