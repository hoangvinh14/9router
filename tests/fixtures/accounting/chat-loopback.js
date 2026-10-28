import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { openFixture, addKey, backupFixture } from './test-database.js';
import { associateChatAccountingFixture } from '../../../src/sse/services/chat-accounting.js';
import { handleChat } from '../../../src/sse/handlers/chat.js';

export const fixtureProvider = 'openai-compatible-chat-accounting-fixture';
export const rawUsage = (cached = 0) => ({ prompt_tokens:1000, completion_tokens:100, total_tokens:1100,
  prompt_tokens_details:{ cached_tokens:cached }, completion_tokens_details:{ reasoning_tokens:0 } });
export const jsonReply = (usage = rawUsage()) => ({ id:'fixture',object:'chat.completion',model:'fixture',
  choices:[{index:0,message:{role:'assistant',content:'hello'},finish_reason:'stop'}], usage });
export function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
export const observe = pending => pending.then(value => ({ok:true,value}), error => ({ok:false,error}));
export const reach = (gate, outcome) => Promise.race([gate.promise, outcome.then(result => { throw result.ok ? new Error('Request ended before expected gate') : result.error; })]);

export async function openChatFixture(engine, { rates = {input:'1',output:'2',cached:'0.25'}, respond, proxy = false, settings = {} } = {}) {
  const fixture = await openFixture(engine), { db } = fixture;
  const sockets = new Set(), servers = [];
  const previous = global._dbAdapter.instance;
  global._dbAdapter.instance = db;
  let posts = 0, connects = 0;
  const requests = [];
  async function listen(server) {
    servers.push(server);
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0,'127.0.0.1',resolve); });
    return server.address().port;
  }
  try {
    const port = await listen(http.createServer(async (request, response) => {
      let text = '';
      for await (const chunk of request) text += chunk;
      posts++; requests.push({headers:request.headers,body:JSON.parse(text),url:request.url});
      try {
        if (respond) await respond(request, response, posts, requests.at(-1));
        else { response.setHeader('content-type','application/json');response.end(JSON.stringify(jsonReply())); }
      } catch (error) { response.destroy(error); }
    }));
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    let proxyUrl = null;
    if (proxy) {
      const server = http.createServer();
      server.on('connect', (request, client, head) => {
        connects++;
        const [host, port] = request.url.split(':');
        const outgoing = net.connect(Number(port),host,() => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) outgoing.write(head);
          client.pipe(outgoing);outgoing.pipe(client);
        });
        sockets.add(outgoing);outgoing.on('close',()=>sockets.delete(outgoing));outgoing.on('error',()=>client.destroy());
      });
      proxyUrl = `http://127.0.0.1:${await listen(server)}`;
    }
    addKey(db); addKey(db,'key-two','fixture-secret-two');
    db.durableTransaction(() => {
      const now = new Date().toISOString();
      db.run('INSERT INTO settings(id,data) VALUES(1,?)',[JSON.stringify({requireApiKey:true,rtkEnabled:false,...settings})]);
      db.run('INSERT INTO providerNodes(id,type,name,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        [fixtureProvider,'openai-compatible','Fixture',JSON.stringify({prefix:'fixture-node',apiType:'chat',baseUrl}),now,now]);
      const data = {apiKey:'provider-secret',providerSpecificData:{baseUrl,apiType:'chat',...(proxy ? {proxyPoolId:'pool-one'} : {})}};
      db.run('INSERT INTO providerConnections(id,provider,authType,priority,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)',
        ['connection-one',fixtureProvider,'apikey',1,JSON.stringify(data),now,now]);
      if (proxy) db.run('INSERT INTO proxyPools(id,data,createdAt,updatedAt) VALUES(?,?,?,?)',
        ['pool-one',JSON.stringify({proxyUrl,strictProxy:true}),now,now]);
      db.run("INSERT INTO kv(scope,key,value) VALUES('pricing',?,?)",[fixtureProvider,JSON.stringify({fixture:rates})]);
    });
    backupFixture(db,fixture.file);
    return { ...fixture, requests, get posts(){return posts;},get connects(){return connects;},
      request({stream=false,model='fixture-node/fixture',key='fixture-secret',hooks={},signal,accounting=true,body={}} = {}) {
        const request = new Request('http://localhost/v1/chat/completions', {method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},
          body:JSON.stringify({model,messages:[{role:'user',content:'hello'}],stream,...body}),signal});
        if (accounting) associateChatAccountingFixture(request,db,hooks);
        return handleChat(request);
      },
      async close() {
        global._dbAdapter.instance = previous;
        for (const socket of sockets) socket.destroy();
        await Promise.all(servers.map(server => new Promise(resolve => {server.closeAllConnections?.();server.close(resolve);})));
        db.beforeClose = undefined;db.close();fs.rmSync(fixture.root,{recursive:true,force:true});
      },
    };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    global._dbAdapter.instance = previous;db.beforeClose=undefined;db.close();fs.rmSync(fixture.root,{recursive:true,force:true});throw error;
  }
}
