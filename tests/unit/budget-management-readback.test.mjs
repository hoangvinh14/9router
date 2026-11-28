// The route, installed services, policy, ledger and SQLite adapter are real.
// This isolated process supplies the qualified key and disposable adapter.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { initializeNodeKeyPolicy } from '../../src/lib/accounting/node-key-policy.js';
import { createNodeAttemptLedger, initializeNodeAttemptLedger } from '../../src/lib/accounting/node-attempt-ledger.js';

test('qualified GET reads the saved policy and recorded cost after reopening the database', async t => {
  assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
  assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
  const fixtureDriver = 'data:text/javascript,export let db;export const setDb=v=>db=v;export const getAccountingAdapter=()=>db;';
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '../db/driver.js' && context.parentURL?.endsWith('/installed-service.js')) {
      return { url: fixtureDriver, shortCircuit: true };
    }
    return next(specifier, context);
  } });
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 16, 10) });
  const path = '/tmp/readback.sqlite';
  let db = await createNodeSqliteAdapter(path);
  try {
    const { setDb } = await import(fixtureDriver);
    setDb(db);
    const { GET, PUT } = await import('../../src/app/api/keys/[id]/budget/route.js');
    const params = {params:Promise.resolve({id:'qualified'})};
    const url = 'https://dashboard.invalid/api/keys/qualified/budget';
    function signed(request) {
      Object.defineProperty(request,'cookies',{value:{get:()=>({value:'fixture-admin'})}});
      return request;
    }
    const get = () => GET(signed(new Request(url)),params);
    db.exec('CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, isActive INTEGER NOT NULL)');
    initializeNodeKeyPolicy(db);
    initializeNodeAttemptLedger(db);
    db.run('INSERT INTO apiKeys VALUES (?,?,1)', ['qualified','disposable-client']);
    assert.equal((await GET(new Request(url),params)).status,401);
    db.run('UPDATE apiKeys SET isActive = 0 WHERE id = ?', ['qualified']);
    const inactive = await get();
    assert.equal(inactive.status, 409);
    assert.equal((await inactive.json()).error.code, 'budget_key_inactive');
    const inactiveSave = await PUT(signed(new Request(url, {method:'PUT',headers:{origin:new URL(url).origin,'content-type':'application/json'},
      body: JSON.stringify({expectedVersion:0,limits:{weekly:'0',monthly:null}})})), params);
    assert.equal(inactiveSave.status, 409);
    assert.equal((await inactiveSave.json()).error.code, 'budget_key_inactive');
    db.run('UPDATE apiKeys SET isActive = 1 WHERE id = ?', ['qualified']);
    const unconfigured = await get();
    assert.equal(unconfigured.status,503);
    assert.deepEqual(await unconfigured.json(),{keyId:'qualified',error:{code:'budget_not_configured'}});
    const put = signed(new Request(url,{method:'PUT',headers:{origin:new URL(url).origin,'content-type':'application/json'},
      body:JSON.stringify({expectedVersion:0,limits:{weekly:'1000',monthly:null}})}));
    const stale = put.clone();
    assert.equal((await PUT(put,params)).status,200);
    assert.equal((await PUT(signed(stale),params)).status,409);
    const writer = createNodeAttemptLedger(db);
    writer.prepare({attemptId:'first',keyId:'qualified',bindingGeneration:'1',provider:'test',model:'test',
      startedAt:new Date().toISOString(),price:{currency:'USD',unit:'USD/1M tokens',revision:'test',rates:{input:'1',output:'1'}}})
      .settle({semantics:'exclusive-category-counts-v1',components:[{category:'input',count:1,unit:'USD/1M tokens'}]});
    db.close();
    db = await createNodeSqliteAdapter(path);
    setDb(db);
    const response = await get();
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const result = await response.json();
    assert.deepEqual(result.policy,{keyId:'qualified',version:1,bindingGeneration:'1',lifecycle:'active',limits:{weekly:'1000',monthly:null}});
    assert.equal(result.usage.weekly.spent,'1000');
    assert.equal(result.usage.weekly.remaining,'0');
    assert.equal(result.usage.monthly.remaining,null);
    assert.equal(result.usage.unknownDefaulted,1);
    db.exec('DROP TABLE accounting_terminals_v1');
    const failure = await get();
    assert.equal(failure.status,503);
    assert.deepEqual(await failure.json(),{error:{message:'Budget storage unavailable',code:'api_key_accounting_unavailable'}});
  } finally {
    db.close();
    hooks.deregister();
  }
});
