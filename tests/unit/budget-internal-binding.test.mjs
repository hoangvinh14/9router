import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {test} from 'node:test';

assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const {getAccountingAdapter}=await import('../../src/lib/db/driver.js');
const {verifyInternalAnthropicBinding}=await import('../../src/lib/accounting/internal-binding.js');
const providerKey='binding-fixture-provider-only';
const binding={clientKeyId:'client',workspaceBinding:{scope:'single-workspace',workspaceId:'wrkspc_Fixture',connectionId:'provider',keyDigest:createHash('sha256').update(providerKey).digest('hex')}};

test('offline binding check uses current local identity and account without modifying rows',async()=>{
 const db=await getAccountingAdapter();
 try {
  const now='2026-11-16T10:00:00.000Z';
  db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',['client','binding-fixture-client-only',now]);
  db.run("INSERT INTO providerConnections(id,provider,authType,isActive,data,createdAt,updatedAt) VALUES(?,'anthropic','apikey',1,?,?,?)",['provider',JSON.stringify({apiKey:providerKey}),now,now]);
  db.run("INSERT INTO settings(id,data) VALUES(1,'{}') ON CONFLICT(id) DO UPDATE SET data=excluded.data");
  const before=db.get('SELECT total_changes() AS n').n;
  assert.equal(verifyInternalAnthropicBinding(db,binding),true);
  const refuse=input=>assert.throws(()=>verifyInternalAnthropicBinding(db,input),e=>e.code==='api_key_accounting_unavailable'&&!e.message.includes(providerKey)&&!e.message.includes(binding.workspaceBinding.keyDigest));
  for(const patch of [{connectionId:'missing'},{keyDigest:'0'.repeat(64)},{scope:'organization'},{workspaceId:'wrkspc_Fixture\n'},{ready:true}])
   refuse({...binding,workspaceBinding:{...binding.workspaceBinding,...patch}});
  refuse({...binding,clientKeyId:'missing'});refuse({...binding,enabled:true});
  assert.equal(db.get('SELECT total_changes() AS n').n,before);
  db.run("UPDATE settings SET data=? WHERE id=1",[JSON.stringify({outboundProxyEnabled:true})]);
  refuse(binding);
  db.run("UPDATE settings SET data='{}' WHERE id=1");
  db.run("UPDATE providerConnections SET data=? WHERE id='provider'",[JSON.stringify({apiKey:'binding-fixture-rotated-only'})]);
  refuse(binding);
  assert.equal(db.get('SELECT total_changes() AS n').n,before+3);
 } finally {db.close();}
});
