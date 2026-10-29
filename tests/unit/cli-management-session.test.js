import http from 'node:http';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require=createRequire(import.meta.url),session=require('../../cli/src/cli/api/managementSession.js');
const servers=[],sockets=new Set();
afterEach(async()=>{session.clear();for(const socket of sockets)socket.destroy();await Promise.all(servers.splice(0).map(server=>new Promise(resolve=>server.close(resolve))));});
async function listen(handler){const server=http.createServer(handler);servers.push(server);server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {host:'127.0.0.1',port:server.address().port,protocol:'http:'};}
describe('CLI origin-bound management sessions',()=>{
  it('explicit login only, cookie and mutation Origin, no CLI token or persisted default',async()=>{
    const requests=[];const config=await listen(async(req,res)=>{let text='';for await(const part of req)text+=part;requests.push({path:req.url,cookie:req.headers.cookie,origin:req.headers.origin,cli:req.headers['x-9r-cli-token'],body:text});res.setHeader('content-type','application/json');if(req.url==='/api/auth/login'){res.setHeader('set-cookie','auth_token=test-session; HttpOnly; Path=/; SameSite=Lax');res.end('{"success":true}');}else if(req.headers.cookie!=='auth_token=test-session'){res.statusCode=401;res.end('{"error":"Management authentication required"}');}else res.end('{"keys":[]}');});
    session.configure(config);expect((await session.request('GET','/api/keys')).statusCode).toBe(401);expect(requests).toHaveLength(1);expect((await session.login('')).success).toBe(false);expect(requests).toHaveLength(1);
    expect((await session.login('explicit-password')).success).toBe(true);expect((await session.request('POST','/api/keys',{name:'fixture'})).success).toBe(true);expect(requests.at(-1)).toMatchObject({cookie:'auth_token=test-session',origin:`http://127.0.0.1:${config.port}`,cli:undefined});
  });
  it('origin change clears session and cross-origin redirects are never followed',async()=>{
    let destinationCalls=0;const destination=await listen((_req,res)=>{destinationCalls++;res.end('{}');});
    const config=await listen((req,res)=>{if(req.url==='/api/auth/login'){res.setHeader('set-cookie','auth_token=test-session; Path=/');res.end('{"success":true}');}else{res.statusCode=302;res.setHeader('location',`http://127.0.0.1:${destination.port}/steal`);res.end();}});
    session.configure(config);expect((await session.login('explicit')).success).toBe(true);expect((await session.request('GET','/api/keys')).error).toContain('redirect');expect(destinationCalls).toBe(0);
    expect((await session.request('GET',`http://127.0.0.1:${destination.port}/steal`)).success).toBe(false);expect(destinationCalls).toBe(0);
    let leaked;const next=await listen((req,res)=>{leaked=req.headers.cookie;res.statusCode=401;res.end('{"error":"auth"}');});session.configure(next);await session.request('GET','/api/keys');expect(leaked).toBeUndefined();
  });
  it('invalid reconfiguration clears previous authenticated origin',async()=>{
    let calls=0;const config=await listen((_req,res)=>{calls++;res.setHeader('set-cookie','auth_token=fixture; Path=/');res.end('{"success":true}');});
    session.configure(config);expect((await session.login('explicit')).success).toBe(true);
    expect(()=>session.configure({...config,protocol:'ftp:'})).toThrow();expect((await session.request('GET','/api/keys')).error).toContain('not configured');expect(calls).toBe(1);
  });
  it('truncated response settles safely and split UTF8 remains exact',async()=>{
    const config=await listen((req,res)=>{
      if(req.url==='/truncated'){res.writeHead(200,{'content-type':'application/json','content-length':'100'});res.write('{');setImmediate(()=>res.destroy());return;}
      const bytes=Buffer.from(JSON.stringify({name:'Việt'}));const split=bytes.indexOf(0xe1)+1;res.write(bytes.subarray(0,split));setImmediate(()=>res.end(bytes.subarray(split)));
    });
    session.configure(config);expect((await session.request('GET','/utf8')).data.name).toBe('Việt');expect((await session.request('GET','/truncated')).success).toBe(false);
  });
  it('expired session clears cookie without implicit re-login',async()=>{
    let calls=0,cookies=[];const config=await listen((req,res)=>{calls++;cookies.push(req.headers.cookie);if(req.url==='/api/auth/login'){res.setHeader('set-cookie','auth_token=expired; Path=/');res.end('{"success":true}');}else{res.statusCode=401;res.end('{"error":"expired"}');}});
    session.configure(config);await session.login('explicit');await session.request('GET','/api/keys');await session.request('GET','/api/keys');expect(cookies).toEqual([undefined,'auth_token=expired',undefined]);expect(calls).toBe(3);
  });
});
