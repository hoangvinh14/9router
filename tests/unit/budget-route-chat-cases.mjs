import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { handleAccountedChatCandidate } from '../../src/sse/handlers/chat.js';
import { bindAccountingIdentity } from '../../src/lib/accounting/installed-service.js';
import { createNodeAttemptLedger, initializeNodeAttemptLedger } from '../../src/lib/accounting/node-attempt-ledger.js';
import { createNodeKeyPolicy, initializeNodeKeyPolicy } from '../../src/lib/accounting/node-key-policy.js';
import { isAccountingResponse } from '../../open-sse/utils/accountingResponse.js';
import { EXCLUSIVE_USAGE } from '../../src/lib/accounting/terminal-cost.js';

const now = '2026-11-16T10:00:00.000Z';
const price = { currency:'USD', unit:'USD/1M tokens', revision:'fixture', rates:{input:'1',output:'2'} };
const command = { attemptId:'route-test', provider:'anthropic', model:'claude-sonnet-4-6', startedAt:now, price };
const manualOverride = `INSERT INTO kv VALUES('pricing','anthropic','{"claude-sonnet-4-6":{"input":99}}')`;

async function fixture(run, { beforeBegin, afterCommit, requireAccount = false } = {}) {
  const dir = fs.mkdtempSync('/tmp/route-chat-');
  const raw = new DatabaseSync(`${dir}/db`);
  const peer = new DatabaseSync(`${dir}/db`);
  let atFinal = false;
  const adapter = { driver:'node:sqlite', raw,
    exec(sql) {
      if (atFinal && sql === 'BEGIN IMMEDIATE') beforeBegin?.(peer);
      raw.exec(sql);
      if (atFinal && sql === 'COMMIT') afterCommit?.(peer);
    },
    get: (sql, params = []) => raw.prepare(sql).get(...params),
    all: (sql, params = []) => raw.prepare(sql).all(...params),
    run: (sql, params = []) => raw.prepare(sql).run(...params),
  };
  try {
    raw.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE apiKeys(id TEXT PRIMARY KEY, key TEXT UNIQUE, isActive INTEGER, accessRestricted INTEGER, accessAllow TEXT);
      CREATE TABLE combos(name TEXT PRIMARY KEY, models TEXT);
      CREATE TABLE kv(scope TEXT, key TEXT, value TEXT, PRIMARY KEY(scope,key));
      CREATE TABLE providerNodes(id TEXT PRIMARY KEY, type TEXT, data TEXT);
      CREATE TABLE providerConnections(id TEXT PRIMARY KEY, provider TEXT, authType TEXT, isActive INTEGER, data TEXT);
      CREATE TABLE proxyPools(id TEXT PRIMARY KEY, isActive INTEGER, data TEXT);
      CREATE TABLE settings(id INTEGER PRIMARY KEY, data TEXT);
      INSERT INTO settings VALUES(1,'{}');
      INSERT INTO apiKeys VALUES('key','fixture-client',1,1,'["Root"]');
      INSERT INTO combos VALUES('Root','["Nested","anthropic/unused"]'),('Nested','["fast"]');
      INSERT INTO kv VALUES('modelAliases','fast','"anthropic/${command.model}"');
      INSERT INTO providerConnections VALUES('account','anthropic','apikey',1,'{"apiKey":"fixture-upstream"}');`);
    initializeNodeKeyPolicy(adapter);
    initializeNodeAttemptLedger(adapter);
    const policy = createNodeKeyPolicy(adapter);
    policy.save('key',0,{weekly:null,monthly:null});
    const ledger = createNodeAttemptLedger(adapter,{requireRoute:true,requireAccount});
    const identity = bindAccountingIdentity({ledger,policy},'fixture-client');
    const counts = { accounts:0, contexts:0, core:0, invoked:0 };
    const state = { counts, ledger, identity, peer,
      saveSettings(settings) { peer.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify(settings)); },
      select(_provider, _exclude, _model, { accountedSettings }) {
        counts.accounts++;
        assert.equal(accountedSettings.requireApiKey,true,'uses the real defaults from the snapshot');
        return {connectionId:'account',authType:'apikey',apiKey:'fixture-upstream'};
      },
      core({accounting}) { counts.core++; return accounting.send(); },
    };
    globalThis.routeFixture = state;
    const createContext = async ({routeProof,provider,model,credentials}) => {
      counts.contexts++;
      const binding = requireAccount
        ? await identity.bindAnthropicAccount(routeProof,credentials.connectionId,credentials.apiKey,'global')
        : null;
      const attempt = identity.prepare({...command,provider,model,price:binding?.price ?? command.price},routeProof,binding?.proof);
      return {send() {
        atFinal = true;
        try {
          return identity.dispatch(attempt.ack,now,() => {
            counts.invoked++;
            return {response:Response.json({provider,model})};
          });
        } finally { atFinal = false; }
      }};
    };
    const chat = (model, extra = {}, secret = 'fixture-client') => handleAccountedChatCandidate(new Request('https://fixture.invalid/v1/messages', {
      method:'POST',headers:{authorization:`Bearer ${secret}`},body:JSON.stringify({model,...extra}),
    }),{identity,createContext});
    await run({...state,chat});
  } finally {
    delete globalThis.routeFixture;
    peer.close(); raw.close(); fs.rmSync(dir,{recursive:true,force:true});
  }
}

async function refused(response) {
  assert.equal(response.status,503);
  assert.equal(isAccountingResponse(response),true);
  assert.equal((await response.json()).error.type,'api_key_accounting_unavailable');
}

test('router-selected nested path reaches the same SQLite final gate; direct member and mismatched key cannot inherit', () => fixture(async ({chat,counts}) => {
  await refused(await chat('fast'));
  await refused(await chat('Root',{},'different-fixture-key'));
  assert.deepEqual(counts,{accounts:0,contexts:0,core:0,invoked:0});
  const response = await chat('Root');
  assert.equal(isAccountingResponse(response),true);
  assert.deepEqual(await response.json(),{provider:'anthropic',model:command.model});
  assert.deepEqual(counts,{accounts:1,contexts:1,core:1,invoked:1});
}));

test('explicitly authorized direct alias reaches the final gate once', () => fixture(async ({chat,peer,counts}) => {
  peer.exec(`UPDATE apiKeys SET accessAllow='["fast"]'`);
  assert.equal((await chat('fast')).status,200);
  assert.deepEqual(counts,{accounts:1,contexts:1,core:1,invoked:1});
}));

test('selected account still matches after unrelated bookkeeping changes', () => fixture(async ({chat,counts}) => {
  assert.equal((await chat('Root')).status,200);
  assert.deepEqual(counts,{accounts:1,contexts:1,core:1,invoked:1});
},{requireAccount:true,beforeBegin:peer=>peer.exec(`UPDATE providerConnections SET data='{"apiKey":"fixture-upstream","consecutiveUseCount":2}' WHERE id='account'`)}));

for (const [name,sql] of [
  ['key rotation',`UPDATE providerConnections SET data='{"apiKey":"fixture-new"}' WHERE id='account'`],
  ['disable',`UPDATE providerConnections SET isActive=0 WHERE id='account'`],
  ['cooldown',`UPDATE providerConnections SET data='{"apiKey":"fixture-upstream","modelLock_${command.model}":"2999-01-01T00:00:00.000Z"}' WHERE id='account'`],
  ['proxy pool',`UPDATE providerConnections SET data='{"apiKey":"fixture-upstream","providerSpecificData":{"proxyPoolId":"fixture-pool"}}' WHERE id='account'`],
  ['global proxy',`UPDATE settings SET data='{"outboundProxyEnabled":true}'`],
]) test(`peer ${name} committed before final BEGIN refuses the bound account with no successor`, () => fixture(async ({chat,counts}) => {
  await refused(await chat('Root'));
  assert.deepEqual(counts,{accounts:1,contexts:1,core:1,invoked:0});
},{requireAccount:true,beforeBegin:peer=>peer.exec(sql)}));

test('an override committed before final BEGIN refuses without invocation or successor', () => fixture(async ({chat,counts}) => {
  await refused(await chat('Root'));
  assert.deepEqual(counts,{accounts:1,contexts:1,core:1,invoked:0});
},{requireAccount:true,beforeBegin:peer=>peer.exec(manualOverride)}));

for (const [name,sql] of [
  ['exact legacy override',manualOverride],
  ['explicit null override',`INSERT INTO kv VALUES('pricing','anthropic','{"claude-sonnet-4-6":null}')`],
  ['unsupported stored catalog',`INSERT INTO kv VALUES('referencePricing','catalog','{}')`],
]) test(`${name} prevents fallback to reference pricing before intent`, () => fixture(async ({chat,counts,peer}) => {
  peer.exec(sql);
  await refused(await chat('Root'));
  assert.deepEqual(counts,{accounts:1,contexts:1,core:0,invoked:0});
  assert.equal(peer.prepare('SELECT count(*) AS n FROM accounting_attempts_v1').get().n,0);
},{requireAccount:true}));

test('geography fixes all five exact rates; another price cannot prepare or reprice the retained attempt', () => fixture(async ({identity,peer,ledger}) => {
  const view = await identity.captureRoute();
  const route = await view.select(['Root','Nested','fast'],command);
  for (const geo of [undefined,'eu','__proto__']) {
    await assert.rejects(identity.bindAnthropicAccount(route,'account','fixture-upstream',geo));
  }
  peer.exec(`INSERT INTO kv VALUES('pricing','anthropic','{"another-model":{"input":99}}')`);
  const global = await identity.bindAnthropicAccount(route,'account','fixture-upstream','global');
  const us = await identity.bindAnthropicAccount(route,'account','fixture-upstream','us');
  assert.notEqual(global.price.revision,us.price.revision);
  assert.deepEqual(global.price.rates,{input:'3',output:'15',cached:'0.30',cache_creation:'3.75',cache_creation_1h:'6'});
  assert.deepEqual(us.price.rates,{input:'3.30',output:'16.50',cached:'0.33',cache_creation:'4.125',cache_creation_1h:'6.60'});
  assert.throws(()=>identity.prepare({...command,price:global.price},route,us.proof));
  const attempt = identity.prepare({...command,price:us.price},route,us.proof);
  assert.equal(identity.dispatch(attempt.ack,now,()=>true),true);
  peer.exec('DELETE FROM kv WHERE scope = \'pricing\'');
  peer.exec(manualOverride);
  attempt.settle({semantics:EXCLUSIVE_USAGE,components:[{category:'input',count:1,unit:'USD/1M tokens'}]});
  assert.equal(ledger.totals('key',now).monthly,'3300');
},{requireAccount:true}));

test('saved proxy configuration refuses even if the selected credentials report no proxy', () => fixture(async ({chat,counts,peer}) => {
  peer.exec(`UPDATE providerConnections SET data='{"apiKey":"fixture-upstream","providerSpecificData":{"proxyPoolId":"fixture-pool"}}'`);
  await refused(await chat('Root'));
  assert.deepEqual(counts,{accounts:1,contexts:1,core:0,invoked:0});
},{requireAccount:true}));

for (const [name,sql] of [
  ['ACL',`UPDATE apiKeys SET accessAllow='[]'`],
  ['alias',`UPDATE kv SET value='"anthropic/other"' WHERE key='fast'`],
  ['member',`UPDATE combos SET models='["anthropic/other"]' WHERE name='Nested'`],
  ['new higher-precedence combo',`INSERT INTO combos VALUES('fast','["anthropic/other"]')`],
  ['nested strategy',`UPDATE settings SET data='{"comboStrategies":{"Nested":{"fallbackStrategy":"smart"}}}'`],
  ['new capacity pool',`UPDATE settings SET data='{"capacityAdapter":{"vision":{"models":["anthropic/fixture-vision"]}}}'`],
]) test(`peer ${name} change before final BEGIN prevents invocation and successor`, () => fixture(async ({chat,counts}) => {
  await refused(await chat('Root'));
  assert.deepEqual(counts,{accounts:1,contexts:1,core:1,invoked:0});
},{beforeBegin:peer=>peer.exec(sql)}));

test('peer ACL revocation after final COMMIT does not cancel the admitted invocation', () => fixture(async ({chat,counts}) => {
  assert.equal((await chat('Root')).status,200);
  assert.equal(counts.invoked,1);
},{afterCommit:peer=>peer.exec(`UPDATE apiKeys SET accessAllow='[]'`)}));

test('capacity additions and helper strategies are refused before account selection', () => fixture(async ({chat,counts,saveSettings,peer}) => {
  for (const strategy of ['smart','fusion']) {
    saveSettings({comboStrategies:{Nested:{fallbackStrategy:strategy}}});
    await refused(await chat('Root'));
  }
  saveSettings({capacityAdapter:{vision:{enabled:true,models:['anthropic/fixture-vision']}}});
  const media = {messages:[{role:'user',content:[{type:'image_url',image_url:{url:'fixture.invalid'}}]}]};
  await refused(await chat('Root',media));
  peer.exec(`UPDATE apiKeys SET accessAllow='["fast","anthropic/fixture-vision"]'`);
  await refused(await chat('fast',media));
  assert.deepEqual(counts,{accounts:0,contexts:0,core:0,invoked:0});
}));

test('candidate ledger refuses missing, fabricated and wrong-leaf route proofs before intent', () => fixture(async ({ledger,identity}) => {
  assert.throws(() => identity.prepare(command));
  assert.throws(() => identity.prepare(command,Object.freeze({stamp:'fixture'})));
  const view = await identity.captureRoute();
  const proof = await view.select(['Root','Nested','fast'],command);
  assert.throws(() => identity.prepare({...command,model:'wrong'},proof));
  const attempt = identity.prepare(command,proof);
  assert.throws(() => identity.prepare({...command,attemptId:'reuse'},proof));
  assert.throws(() => ledger.dispatch(attempt.ack,{presentedSecret:'fixture-client',now,stamp:'fixture'},()=>assert.fail('invoked')));
}));
