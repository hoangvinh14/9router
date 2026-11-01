import {openChatFixture, fixtureProvider, gate, observe, reach} from './chat-loopback.js';
import {associateEmbeddingsAccountingFixture} from '../../../src/sse/services/embeddings-accounting.js';
import {handleEmbeddings} from '../../../src/sse/handlers/embeddings.js';
export {fixtureProvider,gate,observe,reach};
export const embeddingsReply = (tokens = 1000) => ({object:'list',model:'fixture',data:[{object:'embedding',index:0,embedding:[0.1,0.2]}],usage:{prompt_tokens:tokens,total_tokens:tokens}});
export async function openEmbeddingsFixture(engine,options = {}) {
  // Reuse the isolated DB/socket/proxy lifecycle, not the Chat accounting policy.
  const fixture = await openChatFixture(engine,{rates:{input:'1',output:'0'},respond:(_request,response) => {
    response.setHeader('content-type','application/json'); response.end(JSON.stringify(embeddingsReply()));
  },...options});
  return {...fixture,get posts(){return fixture.posts;},get connects(){return fixture.connects;},
    request({model='fixture-node/fixture',key='fixture-secret',hooks={},clock,signal,accounting=true,body={}} = {}) {
      const request = new Request('http://localhost/v1/embeddings',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({model,input:'hello',...body}),signal});
      if (accounting) associateEmbeddingsAccountingFixture(request,fixture.db,hooks,{clock});
      return handleEmbeddings(request);
    },
  };
}
