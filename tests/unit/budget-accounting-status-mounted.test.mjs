// Disposable offline actual React/DOM fixture; NOT Next, CSS/visual or auth E2E.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import ts from 'typescript';
import {chromium} from 'playwright-core';
assert.equal(process.env.BUDGET_UI_MOUNT_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
assert.equal(/^CapEff:\s+0+$/m.test(fs.readFileSync('/proc/self/status','utf8')),true);
const base='/app/src/app/(dashboard)/dashboard/endpoint/components/';
const moduleFiles={
 react:'react/cjs/react.production.js',
 'react/jsx-runtime':'react/cjs/react-jsx-runtime.production.js',
 'react-dom':'react-dom/cjs/react-dom.production.js',
 'react-dom/client':'react-dom/cjs/react-dom-client.production.js',
 scheduler:'scheduler/cjs/scheduler.production.js',
 'prop-types':'prop-types/factoryWithThrowingShims.js',
 './lib/ReactPropTypesSecret':'prop-types/lib/ReactPropTypesSecret.js',
};
const modules=Object.fromEntries(Object.entries(moduleFiles).map(([id,file])=>[id,fs.readFileSync('/app/node_modules/'+file,'utf8')]));
// Use actual production prop-types factory, same branch as index.js.
modules['prop-types']+='\nmodule.exports=module.exports();';
for(const [id,file] of [['./accountingStatusClient','accountingStatusClient.js'],['component','AccountingStatus.js']]){
 const result=ts.transpileModule(fs.readFileSync(base+file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 assert.deepEqual(result.diagnostics,[]);modules[id]=result.outputText;
}
const bundle=`(()=>{const sources=${JSON.stringify(modules)},cache=Object.create(null);function require(id){if(!Object.hasOwn(sources,id))throw Error('Unadmitted module '+id);if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;new Function('require','module','exports',sources[id])(require,module,module.exports);return module.exports;}window.React=require('react');window.ReactDOM=require('react-dom');window.Component=require('component').default;window.root=require('react-dom/client').createRoot(document.getElementById('root'));window.renderKey=id=>ReactDOM.flushSync(()=>root.render(React.createElement(Component,{keyId:id})));})();`;
const body=(id='key-A',version=1)=>({readiness:{ready:false,reason:'no_admitted_profile'},policy:{keyId:id,version,bindingGeneration:'1',lifecycle:'active',limits:{weekly:'0',monthly:null}},retirementEvent:null,usage:null});

test('actual mounted disclosure refresh collapse key-switch late response and errors in offline browser', {timeout:30000},async()=>{
 const browser=await chromium.launch({executablePath:'/browser/chrome-headless-shell',headless:true,chromiumSandbox:false,timeout:10000,args:['--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND'],env:{HOME:'/sandbox/home',TMPDIR:'/sandbox/tmp',LANG:'C',TZ:'UTC'}});
 const errors=[];let actualRequests=0;
 try{
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>{actualRequests++;return route.abort();});
  const page=await context.newPage();page.setDefaultTimeout(5000);
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setContent('<!doctype html><html lang="en"><title>Offline accounting fixture</title><div id="root"></div></html>');
  await page.evaluate(()=>{window.requests=[];window.fetch=(url,options)=>new Promise((resolve,reject)=>{requests.push({url,options,resolve,reject});});});
  await page.evaluate(bundle);await page.evaluate(()=>renderKey('key-A'));
  const text=()=>page.locator('#root').textContent();
  const count=()=>page.evaluate(()=>requests.length);
  const waitCount=n=>page.waitForFunction(n=>requests.length===n,n);
  const settle=(index,value,status=200)=>page.evaluate(({index,value,status})=>{requests[index].resolve({ok:status===200,status,json:async()=>value});},{index,value,status});
  const waitText=value=>page.waitForFunction(value=>document.getElementById('root').textContent.includes(value),value);
  const expanded=page.getByRole('button',{name:'Hide accounting status',exact:true});
  const open=page.getByRole('button',{name:'Accounting status',exact:true});
  const refresh=page.getByRole('button',{name:'Refresh accounting status',exact:true});
  assert.equal(await count(),0);assert.equal(await open.getAttribute('aria-expanded'),'false');
  await open.click();await waitCount(1);assert.equal(await expanded.getAttribute('aria-expanded'),'true');
  assert.equal(await refresh.isDisabled(),true);assert.match(await text(),/Loading accounting status/);
  await settle(0,body());await waitText('Policy version: 1');assert.equal(await refresh.isEnabled(),true);
  assert.match(await text(),/Weekly limit \(nano-USD\): 0/);assert.match(await text(),/Monthly limit \(nano-USD\): Unlimited/);
  assert.match(await text(),/No recorded retirement event. This does not mean this key was never retired/);
  await refresh.click();await waitCount(2);assert.match(await text(),/Loading accounting status/);assert.doesNotMatch(await text(),/Policy version/);assert.equal(await refresh.isDisabled(),true);
  // Real inner production key boundary: no harness key on Component.
  await page.evaluate(()=>renderKey('key-B'));await waitCount(3);
  await page.waitForFunction(()=>requests[1].options.signal.aborted);
  await settle(1,body('key-A',77));
  // Drain actual pending promise callbacks plus real renderer turn, no arbitrary sleep.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.match(await text(),/Loading accounting status/);assert.doesNotMatch(await text(),/77/);assert.equal(await refresh.isDisabled(),true);
  await settle(2,body('key-B',4));await waitText('Policy version: 4');
  await refresh.click();await waitCount(4);await expanded.click();
  await page.waitForFunction(()=>requests[3].options.signal.aborted);await settle(3,body('key-B',88));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.doesNotMatch(await text(),/Policy version|88/);assert.equal(await count(),4);
  await open.click();await waitCount(5);assert.match(await text(),/Loading accounting status/);assert.doesNotMatch(await text(),/Policy version/);
  await settle(4,null,401);await waitText('A signed dashboard session is required');
  await refresh.click();await waitCount(6);await page.evaluate(()=>requests[5].reject(Error('private-network-secret')));await waitText('Accounting status unavailable');assert.doesNotMatch(await text(),/private-network-secret/);
  await refresh.click();await waitCount(7);await settle(6,{private:'secret'});await waitText('Accounting status unavailable');assert.doesNotMatch(await text(),/private|secret/);
  // Every actual helper invocation receives exact stable ID + options, no body.
  const observed=await page.evaluate(()=>requests.map(({url,options})=>({url,keys:Object.keys(options).sort(),method:options.method,credentials:options.credentials,cache:options.cache,redirect:options.redirect,isSignal:options.signal instanceof AbortSignal})));
  assert.deepEqual(observed.map(x=>x.url),['key-A','key-A','key-B','key-B','key-B','key-B','key-B'].map(id=>`/api/keys/${id}/budget/retire`));
  for(const request of observed)assert.deepEqual({...request,url:undefined},{url:undefined,keys:['cache','credentials','method','redirect','signal'],method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',isSignal:true});
  await expanded.click();
  const openBudget = page.getByRole('button',{name:'View budget',exact:true});
  const refreshBudget = page.getByRole('button',{name:'Refresh budget',exact:true});
  const budget = {readiness:{ready:true,reason:null}, policy:body('key-B',4).policy,
    usage:{weekly:{spent:'9007199254740993',remaining:'0',resetAt:'2026-11-22T17:00:00.000Z'},
      monthly:{spent:'9007199254740993',remaining:null,resetAt:'2026-11-30T17:00:00.000Z'},
      timezone:'Asia/Ho_Chi_Minh',unknownDefaulted:1,unrecorded:2}};
  await openBudget.click();await waitCount(8);
  assert.equal(await page.evaluate(()=>requests[7].url),'/api/keys/key-B/budget');
  await settle(7,budget);await waitText('Recorded spend (nano-USD): 9007199254740993');
  for(const expected of ['Policy version 4 (active)','Remaining (nano-USD): 0','Remaining (nano-USD): Unlimited',
    '23 Nov 2026, 00:00','1 Dec 2026, 00:00','Asia/Ho_Chi_Minh','Unknown/defaulted usage','no recorded terminal cost']) {
    assert.ok((await text()).includes(expected),expected);
  }
  await refreshBudget.click();await waitCount(9);await settle(8,null,503);await waitText('Budget data unavailable');
  assert.doesNotMatch(await text(),/9007199254740993/);
  await page.getByRole('button',{name:'Hide budget',exact:true}).click();
  await openBudget.click();await waitCount(10);await settle(9,budget);await waitText('Policy version 4');
  await page.evaluate(()=>renderKey('key-C'));await waitCount(11);
  await settle(10,{readiness:{ready:false,reason:'no_admitted_profile'},policy:null,usage:null});
  await waitText('No budget profile');assert.doesNotMatch(await text(),/Recorded spend|Policy version 4/);
  assert.equal(await page.getByRole('button',{name:'Save budget'}).count(),0);
  await refreshBudget.click();await waitCount(12);
  await settle(11,{keyId:'key-C',error:{code:'budget_not_configured'}},503);
  const save = page.getByRole('button',{name:'Save budget',exact:true});
  await page.getByLabel('weekly limit (nano-USD)').fill('0');
  await page.getByLabel('monthly limit (nano-USD)').fill('Unlimited');
  await save.click();await waitCount(13);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(requests[12].options.body)),
    {expectedVersion:0,limits:{weekly:'0',monthly:null}});
  assert.equal(await page.evaluate(()=>requests[12].options.method),'PUT');
  const saved = {...budget,policy:{...budget.policy,keyId:'key-C',version:1}};
  await settle(12,{policy:saved.policy});await waitCount(14);await settle(13,saved);
  await waitText('Policy version 1 (active)');
  await page.getByLabel('weekly limit (nano-USD)').fill('1234567890123456');
  await save.click();await waitCount(15);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(requests[14].options.body)),
    {expectedVersion:1,limits:{weekly:'1234567890123456',monthly:null}});
  await settle(14,null,409);await waitText('The policy changed.');
  await refreshBudget.click();await waitCount(16);await settle(15,null,503);
  await waitText('Budget data unavailable');assert.equal(await save.count(),0);
  await refreshBudget.click();await waitCount(17);await settle(16,saved);
  await save.click();await waitCount(18);
  await page.evaluate(()=>requests[17].reject(Error('private fixture error')));
  await waitText('Save could not be confirmed.');
  assert.doesNotMatch(await text(),/private fixture error/);
  await refreshBudget.click();await waitCount(19);await settle(18,saved);
  await save.click();await waitCount(20);
  await page.evaluate(()=>renderKey('key-D'));await waitCount(21);
  await page.waitForFunction(()=>requests[19].options.signal.aborted);
  await settle(19,{policy:{...saved.policy,version:2}});
  await settle(20,{readiness:{ready:false,reason:'no_admitted_profile'},policy:null,usage:null});
  await waitText('No budget profile');assert.equal(await count(),21);
  assert.equal(actualRequests,0);assert.deepEqual(errors,[]);
  console.log('mounted assertions: closed0fetch; loading; refresh-clears; production inner-key stale+pending; collapse abort+late/reopen;401/network/malformed sanitized; versioned budget creation, reload and conflict;0real network/console errors');
  await context.close();
 }finally{await browser.close();}
});
