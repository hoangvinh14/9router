import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {test} from 'node:test';

assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const {getAccountingAdapter}=await import('../../src/lib/db/driver.js');
const {verifyInternalAnthropicBinding, resolveInternalBudgetBinding}=await import('../../src/lib/accounting/internal-binding.js');
const providerKey='binding-fixture-provider-only';
const binding={clientKeyId:'client',workspaceBinding:{scope:'single-workspace',workspaceId:'wrkspc_Fixture',connectionId:'provider',keyDigest:createHash('sha256').update(providerKey).digest('hex')}};

test('offline binding checker validates the saved account and tariff',async()=>{
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

  db.run("UPDATE settings SET data='{}' WHERE id=1");
    db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)', ['codex-client', 'fixture-client-only', now]);
    db.run("INSERT INTO providerConnections(id,provider,authType,isActive,data,createdAt,updatedAt) VALUES(?,'codex','oauth',1,?,?,?)",
      ['codex-connection', JSON.stringify({ accessToken: 'fixture-oauth-only', providerSpecificData: { chatgptAccountId: 'fixture-account' } }), now, now]);
    const codex = { clientKeyId: 'codex-client', codexBinding: {
      connectionId: 'codex-connection', accountId: 'fixture-account', serviceTier: 'standard',
    } };
    assert.throws(() => resolveInternalBudgetBinding(db, codex), { code: 'api_key_accounting_unavailable' });

    const revision = 'openai:codex/gpt-6.2-sol:standard:v1';
    db.run('INSERT INTO kv VALUES(?,?,?)', ['budgetReferencePricing', revision, JSON.stringify({
      currency: 'USD', unit: 'USD/1M tokens', revision, syncedAt: 1, rates: { input: '2', cached: '0.1', output: '10' },
    })]);
    assert.deepEqual(resolveInternalBudgetBinding(db, codex), {
      enabled: true, producerAdmitted: true, provider: 'codex', auth: 'oauth',
      connectionId: 'codex-connection', accountId: 'fixture-account', referencePrices: [{
        currency: 'USD', unit: 'USD/1M tokens', revision, syncedAt: 1, rates: { input: '2', cached: '0.1', output: '10' },
      }],
    });
    assert.throws(() => resolveInternalBudgetBinding(db, { ...codex, clientKeyId: 'other-client' }), { code: 'api_key_accounting_unavailable' });
    for (const invalid of [{ accountId: 'other-account' }, { connectionId: 'other-connection' }, { serviceTier: 'priority' }]) {
      assert.throws(() => resolveInternalBudgetBinding(db, { ...codex, codexBinding: { ...codex.codexBinding, ...invalid } }),
        { code: 'api_key_accounting_unavailable' });
    }

 } finally {db.close();}
});


test('workspace evidence follows the upstream connection and stops matching after credential rotation', async () => {
 const db = await createTestAdapter();
 try {
  const { inspectAnthropicWorkspace, saveAnthropicWorkspace } = await import('../../src/lib/accounting/anthropic-workspace.js');
  const { connectionId, workspaceId, keyDigest } = binding.workspaceBinding;
  assert.deepEqual(inspectAnthropicWorkspace(db, connectionId), { workspaceId: null });
  assert.throws(() => saveAnthropicWorkspace(db, connectionId, workspaceId, '0'.repeat(64)), { status: 409 });
  assert.deepEqual(saveAnthropicWorkspace(db, connectionId, workspaceId, keyDigest), { workspaceId });
  const changes = db.get('SELECT total_changes() AS n').n;
  assert.deepEqual(saveAnthropicWorkspace(db, connectionId, workspaceId, keyDigest), { workspaceId });
  assert.equal(db.get('SELECT total_changes() AS n').n, changes);
  db.run('UPDATE providerConnections SET data = ? WHERE id = ?', [JSON.stringify({ apiKey: 'different-fixture-key' }), connectionId]);
  assert.deepEqual(inspectAnthropicWorkspace(db, connectionId), { workspaceId: null });
  assert.throws(() => saveAnthropicWorkspace(db, connectionId, workspaceId, keyDigest), { status: 409 });
 } finally { db.close(); }
});

async function createTestAdapter() {
 const { createNodeSqliteAdapter } = await import('../../src/lib/db/adapters/nodeSqliteAdapter.js');
 const db = await createNodeSqliteAdapter('/tmp/workspace-proof.sqlite');
 db.exec('CREATE TABLE kv (scope TEXT, key TEXT, value TEXT, PRIMARY KEY (scope, key)); CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT, authType TEXT, isActive INTEGER, data TEXT)');
 db.run('INSERT INTO providerConnections VALUES (?, ?, ?, ?, ?)', ['provider', 'anthropic', 'apikey', 1, JSON.stringify({ apiKey: providerKey })]);
 return db;
}
