import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);

// The real CommonJS client uses the same guarded HTTP routes and real login.
// This is separate from mock transport tests and never substitutes a CLI token.
export async function runBudgetCliChecks({base,check,expect,password}) {
  const session=require('../../cli/src/cli/api/managementSession.js');
  const url=new URL(base);
  session.configure({host:url.hostname,port:Number(url.port),protocol:url.protocol});
  try {
    await check('actual CLI management requires dashboard session and round-trips key CRUD',async()=>{
      session.clear();expect((await session.request('GET','/api/keys')).statusCode).toBe(401);
      expect((await session.login(password)).success).toBe(true);
      const created=await session.request('POST','/api/keys',{name:'Disposable CLI management key'});
      expect(created.success).toBe(true);expect(created.statusCode).toBe(201);expect(created.data.id).toBeTruthy();
      const id=encodeURIComponent(created.data.id);
      const listed=await session.request('GET','/api/keys');expect(listed.success).toBe(true);expect(listed.data.keys.some(key=>key.id===created.data.id)).toBe(true);
      const paused=await session.request('PUT',`/api/keys/${id}`,{isActive:false});expect(paused.success).toBe(true);expect(paused.data.key.isActive).toBe(false);
      const resumed=await session.request('PUT',`/api/keys/${id}`,{isActive:true});expect(resumed.success).toBe(true);expect(resumed.data.key.isActive).toBe(true);
      expect((await session.request('DELETE',`/api/keys/${id}`)).success).toBe(true);
      const retained=await session.request('GET',`/api/keys/${id}/budget`);expect(retained.success).toBe(true);expect(retained.data).toMatchObject({active:false,retired:true});
      expect((await session.request('GET',`/api/keys/${id}`)).statusCode).toBe(404);
    });
  } finally {session.clear();}
}
