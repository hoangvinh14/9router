import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {SignJWT} from 'jose';
import {createDashboardAuthToken} from '../../src/lib/auth/dashboardSession.js';
import {GET,POST} from '../../src/app/api/keys/[id]/budget/retire/route.js';
import {getAdapter,getAdapterSync} from '../../src/lib/db/driver.js';
import {initializeNodeKeyPolicy,createNodeKeyPolicy} from '../../src/lib/accounting/node-key-policy.js';
import {initializeNodeAttemptLedger} from '../../src/lib/accounting/node-attempt-ledger.js';
import {validateApiKey,updateApiKey} from '../../src/lib/db/repos/apiKeysRepo.js';
import {assertAccountingHealthy} from '../../src/lib/accounting/process-state.js';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
assert.equal(process.env.JWT_SECRET,'fixture-only-jwt-secret-012345678901234567890123456789');
const key=new TextEncoder().encode(process.env.JWT_SECRET);
const params={params:Promise.resolve({id:'target'})};
function request(token,origin='https://dashboard.invalid',version=1){
 const r=new Request('https://dashboard.invalid/api/keys/target/budget/retire',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({expectedVersion:version})});
 Object.defineProperty(r,'cookies',{value:{get:()=>token?{value:token}:undefined}});return r;
}

test('retirement actual JWT rejects tampering wrong-secret expiry unsigned before body or installed adapter',async()=>{
 assert.throws(getAdapterSync);
 const valid=await createDashboardAuthToken(),parts=valid.split('.');
 const tampered=[parts[0],Buffer.from(JSON.stringify({authenticated:true,exp:9999999999})).toString('base64url'),parts[2]].join('.');
 const wrong=await new SignJWT({authenticated:true}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode('fixture-different-secret-01234567890123456789'));
 const expired=await new SignJWT({authenticated:true}).setProtectedHeader({alg:'HS256'}).setExpirationTime(1).sign(key);
 const unsigned=Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from('{"authenticated":true}').toString('base64url')+'.';
 for(const token of [null,'not.jwt',tampered,wrong,expired,unsigned]){
  for(const handler of [GET,POST]){const r=request(token);const response=await handler(r,params);assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(r.bodyUsed,false);}
 }
 assert.throws(getAdapterSync);
});

test('retirement valid signed claims cannot bypass authenticated claim password change or Origin',async()=>{
 const missing=await new SignJWT({}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(key);
 for(const token of [missing,await createDashboardAuthToken({authenticated:false}),await createDashboardAuthToken({mustChangePassword:true})]){
  for(const handler of [GET,POST]){const r=request(token);assert.equal((await handler(r,params)).status,401);assert.equal(r.bodyUsed,false);}
 }
 const token=await createDashboardAuthToken();const r=request(token,'https://evil.invalid');assert.equal((await POST(r,params)).status,403);assert.equal(r.bodyUsed,false);
 assert.throws(getAdapterSync);
 assert.equal(fs.existsSync('/sandbox/data/jwt-secret'),false);assert.equal(fs.existsSync('/app/.env'),false);assert.equal(fs.existsSync('/home/gmo'),false);
});

test('actual signed session reaches same installed owner retirement CAS without enrollment permission or secret output',async()=>{
 const db=await getAdapter();after(()=>db.close());
 db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',['target','private-target','2026-11-16T00:00:00.000Z']);
 const token=await createDashboardAuthToken({actorClass:'client-forged',occurredAt:'client-forged'});
 assert.equal((await POST(request(token),params)).status,503);
 assert.equal((await GET(request(token),params)).status,503);
 assert.equal(db.all("SELECT name FROM sqlite_schema WHERE name LIKE 'accounting_%'").length,0);
 assert.equal(await validateApiKey('private-target'),true);assertAccountingHealthy();
 // Explicit disposable setup ONLY: does not manufacture installed provenance,
 // change profiles or bypass driver startup refusal for already marked files.
 initializeNodeKeyPolicy(db);initializeNodeAttemptLedger(db);createNodeKeyPolicy(db).save('target',0,{weekly:'123',monthly:'456'});
 const active=await GET(request(token),params);assert.equal(active.status,200);assert.equal(active.headers.get('cache-control'),'no-store');
 assert.deepEqual(await active.json(),{readiness:{ready:true,reason:null},policy:{keyId:'target',bindingGeneration:'1',version:1,limits:{weekly:'123',monthly:'456'},lifecycle:'active'},retirementEvent:null,usage:null});
 assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_admin_events_v1').n,0);
 assert.equal((await POST(request('not.jwt'),params)).status,401);
 assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_admin_events_v1').n,0);
 const before=JSON.stringify([db.all('SELECT * FROM apiKeys'),db.all('SELECT * FROM accounting_key_policy_v1'),db.all('SELECT * FROM accounting_key_generations_v1')]);
 assert.equal((await POST(request(token,'https://dashboard.invalid',2),params)).status,409);
 assert.equal(JSON.stringify([db.all('SELECT * FROM apiKeys'),db.all('SELECT * FROM accounting_key_policy_v1'),db.all('SELECT * FROM accounting_key_generations_v1')]),before);
 assert.equal(db.get('SELECT COUNT(*) AS n FROM accounting_admin_events_v1').n,0);
 const response=await POST(request(token),params);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{retired:true,credentialMaterialRetained:true});
 const events=db.all('SELECT * FROM accounting_admin_events_v1');assert.equal(events.length,1);
 const {occurred_at,...event}=events[0];assert.equal(new Date(occurred_at).toISOString(),occurred_at);
 assert.deepEqual(event,{key_id:'target',version:2,previous_version:1,generation:1,action:'retire',actor_class:'dashboard-session'});
 assert.equal(/private-target|client-forged/.test(JSON.stringify(events)),false);
 assert.equal(await validateApiKey('private-target'),false);await assert.rejects(updateApiKey('target',{isActive:true}));
 const policy=db.get('SELECT generation,version,retired,weekly,monthly FROM accounting_key_policy_v1 WHERE key_id=?',['target']);
 assert.deepEqual({...policy},{generation:1,version:2,retired:1,weekly:'123',monthly:'456'});
 assert.equal(db.get('SELECT retired FROM accounting_key_generations_v1 WHERE key_id=?',['target']).retired,1);
 assert.equal(db.get('SELECT key FROM apiKeys WHERE id=?',['target']).key,'private-target');
 const status=await GET(request(token),params);assert.equal(status.status,200);assert.equal(status.headers.get('cache-control'),'no-store');
 assert.deepEqual(await status.json(),{readiness:{ready:true,reason:null},policy:{keyId:'target',bindingGeneration:'1',version:2,limits:{weekly:'123',monthly:'456'},lifecycle:'retired'},retirementEvent:{action:'retire',actorClass:'dashboard-session',occurredAt:occurred_at,version:2,previousVersion:1,bindingGeneration:'1'},usage:null});
 assert.equal((await POST(request(token),params)).status,503);
 assert.deepEqual(db.all('SELECT * FROM accounting_admin_events_v1'),events);
 assert.equal(db.raw.isTransaction,false);assertAccountingHealthy();
});
