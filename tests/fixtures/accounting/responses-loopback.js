import './isolated-bootstrap.mjs';
import { openChatFixture } from './chat-loopback.js';
export { fixtureProvider, gate, observe, reach } from './chat-loopback.js';
export const rawResponsesUsage = (cached = 400, reasoning = 20) => ({ input_tokens:1000, output_tokens:100, total_tokens:1100,
  input_tokens_details:{ cached_tokens:cached }, output_tokens_details:{ reasoning_tokens:reasoning } });
export const responsesReply = (usage = rawResponsesUsage()) => ({ id:'resp_fixture', object:'response', created_at:1700000000,
  model:'fixture', status:'completed', output:[{type:'message',id:'msg_fixture',role:'assistant',status:'completed',
    content:[{type:'output_text',text:'hello',annotations:[]}]}], usage });
export function openResponsesFixture(engine, options = {}) {
  return openChatFixture(engine, { respond:(_req,res) => { res.setHeader('content-type','application/json; charset=utf-8'); res.end(JSON.stringify(responsesReply())); },
    ...options, apiType:'responses' });
}
