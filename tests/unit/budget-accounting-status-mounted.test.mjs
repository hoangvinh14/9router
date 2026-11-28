// Disposable offline actual React/DOM fixture; NOT Next, CSS/visual or auth E2E.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import ts from 'typescript';
import {chromium} from 'playwright-core';
assert.equal(process.env.BUDGET_UI_MOUNT_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
assert.equal(/^CapEff:\s+0+$/m.test(fs.readFileSync('/proc/self/status','utf8')),true);
const base='/app/src/app/(dashboard)/dashboard/';
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
for (const [id, file] of [['@/lib/pricing/decimalMoney.js', 'decimalMoney.js'], ['./constants.js', 'constants.js']]) {
 const source = fs.readFileSync('/app/src/lib/pricing/' + file, 'utf8');
 modules[id] = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}
modules['@/shared/components/Card']='module.exports=({children})=>children;';
modules['@/shared/components/Loading']='exports.CardSkeleton=()=>null;';
for(const [id,file] of [
 ['./accountingStatusClient','endpoint/components/accountingStatusClient.js'],
 ['../../endpoint/components/accountingStatusClient','endpoint/components/accountingStatusClient.js'],
 ['../../useAccountingSnapshot','useAccountingSnapshot.js'],
 ['component','endpoint/components/AccountingStatus.js'],
 ['budget','usage/components/BudgetTab.js'],
 ['./BudgetDetails','usage/components/BudgetDetails.js'],
]){
 const result=ts.transpileModule(fs.readFileSync(base+file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 assert.deepEqual(result.diagnostics,[]);modules[id]=result.outputText;
}
const bundle=`(()=>{const sources=${JSON.stringify(modules)},cache=Object.create(null);function require(id){if(!Object.hasOwn(sources,id))throw Error('Unadmitted module '+id);if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;new Function('require','module','exports',sources[id])(require,module,module.exports);return module.exports;}window.React=require('react');window.ReactDOM=require('react-dom');window.Component=require('component').default;window.root=require('react-dom/client').createRoot(document.getElementById('root'));window.renderKey=id=>ReactDOM.flushSync(()=>root.render(React.createElement(Component,{keyId:id})));window.renderBudget=id=>ReactDOM.flushSync(()=>root.render(React.createElement(require('budget').default,{key:id,keyId:id})));})();`;
const body=(id='key-A',version=1)=>({readiness:{ready:false,reason:'no_admitted_profile'},policy:{keyId:id,version,bindingGeneration:'1',lifecycle:'active',limits:{weekly:'0',monthly:null}},retirementEvent:null,usage:null});

test('actual mounted disclosure refresh collapse key-switch late response and errors in offline browser', {timeout:30000},async()=>{
 const browser=await chromium.launch({executablePath:'/browser/chrome-headless-shell',headless:true,chromiumSandbox:false,timeout:10000,args:['--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND'],env:{HOME:'/sandbox/home',TMPDIR:'/sandbox/tmp',LANG:'C',TZ:'UTC'}});
 const errors=[];let actualRequests=0;
 try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  await context.route('**/*',route=>{actualRequests++;return route.abort();});
  const page=await context.newPage();page.setDefaultTimeout(5000);
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setContent('<!doctype html><html lang="en"><title>Offline accounting fixture</title><div id="root"></div></html>');
  await page.evaluate(()=>{window.requests=[];window.budgets=[];window.fetch=(url,options)=>new Promise((resolve,reject)=>{if(url === '/api/keys?view=budget') return resolve(Response.json({keys:[
    {id:'key-B',name:'Production',isActive:true}, {id:'key-C',name:'Sandbox',isActive:true}, {id:'key-D',name:'Legacy',isActive:false},
   ]})); (url.endsWith('/retire')?requests:budgets).push({url,options,resolve,reject});});});
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
  await page.keyboard.press('Tab');
  assert.equal(await open.evaluate(button=>button===document.activeElement),true);
  await page.keyboard.press('Enter');await waitCount(1);assert.equal(await expanded.getAttribute('aria-expanded'),'true');
  assert.equal(await refresh.isDisabled(),true);assert.match(await text(),/Loading accounting status/);
  await settle(0,body());await waitText('Policy version: 1');assert.equal(await refresh.isEnabled(),true);
  assert.match(await text(),/Weekly limit \(USD\): 0/);assert.match(await text(),/Monthly limit \(USD\): Unlimited/);
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
  assert.equal(await page.evaluate(() => budgets.length), 0);
  await page.evaluate(()=>renderBudget('key-B'));
  const production = page.locator('details').filter({hasText:'Production'});
  const sandbox = page.locator('details').filter({hasText:'Sandbox'});
  const refreshBudget = production.getByRole('button',{name:'Refresh budget',exact:true});
  assert.equal(await production.getAttribute('open'),'');
  assert.equal(await page.locator('summary').count(),3);
  const budget = {readiness:{ready:true,reason:null}, policy:body('key-B',4).policy,
    usage:{weekly:{spent:'9007199254740993',remaining:'0',resetAt:'2026-11-22T17:00:00.000Z'},
      monthly:{spent:'9007199254740993',remaining:null,resetAt:'2026-11-30T17:00:00.000Z'},
      timezone:'Asia/Ho_Chi_Minh',unknownDefaulted:1,unrecorded:2}};
  const budgetCount = n => page.waitForFunction(n => budgets.length === n, n);
  const settleBudget = (index, value, status=200) => page.evaluate(({index,value,status}) => {
    budgets[index].resolve({ok:status===200,status,json:async()=>value});
  }, {index,value,status});
  await budgetCount(2);
  assert.deepEqual(await page.evaluate(() => budgets.map(item => item.url)), ['/api/keys/key-B/budget','/api/keys/key-C/budget']);
  await settleBudget(0,budget);await waitText('Recorded spend (USD): 9007199.254740993');
  for (const expected of ['Policy version 4 (active)','Remaining (USD): 0','Remaining (USD): Unlimited',
    '23 Nov 2026, 00:00','1 Dec 2026, 00:00','Asia/Ho_Chi_Minh','Unknown/defaulted usage','no recorded terminal cost']) {
    assert.ok((await text()).includes(expected),expected);
  }
  await refreshBudget.click();await budgetCount(3);await settleBudget(2,null,503);await waitText('Budget storage unavailable');
  assert.doesNotMatch(await text(),/Recorded spend/);
  assert.equal(await page.getByRole('button',{name:'Save budget'}).count(),0);
  await settleBudget(1,{keyId:'key-C',error:{code:'budget_not_configured'}},503);
  await sandbox.locator('summary').press('Space');
  assert.equal(await production.getAttribute('open'),'');
  assert.equal(await sandbox.getAttribute('open'),'');
  await sandbox.getByRole('button',{name:'Set budget',exact:true}).click();
  await waitText('Saving a budget can block requests');
  const save = page.getByRole('button',{name:'Save budget',exact:true});
  await page.getByLabel('weekly limit (USD)').fill('0');
  await save.click();await budgetCount(4);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(budgets[3].options.body)),
    {expectedVersion:0,limits:{weekly:'0',monthly:null}});
  assert.equal(await page.evaluate(()=>budgets[3].options.method),'PUT');
  const saved = {...budget,policy:{...budget.policy,keyId:'key-C',version:1}};
  await settleBudget(3,{policy:saved.policy});await budgetCount(5);await settleBudget(4,saved);
  await waitText('Policy version 1 (active)');
  await page.getByLabel('weekly limit (USD)').fill('  ');
  await page.getByLabel('monthly limit (USD)').fill('1234567.890123456');
  await save.click();await budgetCount(6);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(budgets[5].options.body)),
    {expectedVersion:1,limits:{weekly:null,monthly:'1234567890123456'}});
  await settleBudget(5,null,409);await waitText('The policy changed.');
  await sandbox.getByRole('button',{name:'Refresh budget',exact:true}).click();await budgetCount(7);await settleBudget(6,saved);
  await save.click();await budgetCount(8);
  await page.evaluate(()=>budgets[7].reject(Error('private fixture error')));
  await waitText('Save could not be confirmed.');
  assert.doesNotMatch(await text(),/private fixture error/);
  await save.click();await budgetCount(9);
  await settleBudget(8,{error:{message:'Invalid request origin'}},403);
  await waitText('Set BASE_URL to the dashboard URL');
  await save.click();await budgetCount(10);
  await page.evaluate(()=>renderKey('key-D'));
  await page.waitForFunction(()=>budgets[9].options.signal.aborted);
  await settleBudget(9,{policy:{...saved.policy,version:2}});
  await waitText('Accounting status');
  assert.equal(actualRequests,0);assert.deepEqual(errors,[]);
  console.log('mounted assertions: retirement disclosure; loading; refresh-clears; production inner-key stale+pending; collapse abort+late/reopen;401/network/malformed sanitized; versioned budget creation, reload and conflict;0real network/console errors');
  await context.close();
 }finally{await browser.close();}
});
