import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

const artifact=path.resolve(process.env.BUDGET_STANDALONE||'.next-budget-acceptance/standalone');
const output=process.argv[2];if(!output)throw new Error('Receipt path required');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'9router-budget-standalone-'));
const pkg=path.join(root,'package'),data=path.join(root,'data');
const receipt={complete:false,artifact,checks:[]};let child,exited,browser,log='';
try{
  fs.cpSync(artifact,pkg,{recursive:true});
  const dist=fs.readdirSync(pkg).find(name=>name.startsWith('.next'));assert(dist);
  receipt.buildId=fs.readFileSync(path.join(pkg,dist,'BUILD_ID'),'utf8').trim();
  receipt.endpointHtmlSha256=createHash('sha256').update(fs.readFileSync(path.join(pkg,dist,'server/app/dashboard/endpoint.html'))).digest('hex');
  const load=createRequire(path.join(pkg,'server.js')),wasm=load.resolve('sql.js/dist/sql-wasm.wasm');assert(wasm.startsWith(pkg+path.sep));
  const SQL=await load('sql.js')({locateFile:name=>path.join(path.dirname(wasm),name)});let sql=new SQL.Database();sql.run('CREATE TABLE fixture(value TEXT)');sql.run('INSERT INTO fixture VALUES (?)',['persisted']);const image=sql.export();sql.close();sql=new SQL.Database(image);assert.equal(sql.exec('SELECT value FROM fixture')[0].values[0][0],'persisted');sql.close();receipt.checks.push('detached packaged SQL.js/WASM reopen');
  const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));const base=`http://127.0.0.1:${port}`;
  const env={...process.env,NODE_ENV:'production',PORT:String(port),HOSTNAME:'127.0.0.1',DATA_DIR:data,HOME:path.join(root,'home'),APPDATA:path.join(root,'appdata'),INITIAL_PASSWORD:'disposable-budget-standalone-password',JWT_SECRET:'disposable-budget-standalone-session',AUTH_COOKIE_SECURE:'false',MODEL_CATALOG_SYNC:'off',DISABLE_BACKGROUND_TOKEN_REFRESH:'true'};
  for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])delete env[name];
  const preload=path.join(root,'home.cjs');fs.writeFileSync(preload,`const os=require('node:os');os.homedir=()=>${JSON.stringify(env.HOME)};require('node:module').syncBuiltinESMExports();`);
  child=spawn(process.execPath,['--require',preload,'custom-server.js'],{cwd:pkg,env,stdio:['ignore','pipe','pipe']});exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));child.stdout.on('data',chunk=>{log+=chunk;});child.stderr.on('data',chunk=>{log+=chunk;});
  let ready=false;const deadline=Date.now()+30000;
  while(Date.now()<deadline&&!ready){try{ready=(await fetch(base+'/api/auth/status',{signal:AbortSignal.timeout(1000)})).status===200;}catch{}if(!ready)await new Promise(resolve=>setTimeout(resolve,200));}
  assert(ready,'Standalone readiness failed');receipt.checks.push('detached package starts');
  const req=(target,options={})=>fetch(base+target,{...options,signal:AbortSignal.timeout(10000),redirect:'manual'});
  for(const target of ['/api/keys','/api/keys/unknown/budget']){const anonymous=await req(target);assert.equal(anonymous.status,401);assert.equal(anonymous.headers.get('cache-control'),'no-store');}
  receipt.checks.push('anonymous key management denied with no-store');
  const login=await req('/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({password:env.INITIAL_PASSWORD})});assert.equal(login.status,200);const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert(cookie);
  const headers={cookie,origin:base,'content-type':'application/json'};
  const created=await req('/api/keys',{method:'POST',headers,body:JSON.stringify({name:'Disposable smoke key'})});assert.equal(created.status,201);const key=await created.json();assert(key.id);
  const target=`/api/keys/${encodeURIComponent(key.id)}/budget`;
  const snapshot=await req(target,{headers});assert.equal(snapshot.status,200);const before=await snapshot.json();assert.equal(before.enforcementActive,false);assert.equal(before.ledgerStartedAt,null);assert.equal(before.weekly.limitUsd,null);
  for(const amount of ['0','1']){
    const denied=await req(target,{method:'PUT',headers:{...headers,'x-budget-ready':'true','x-9r-fixture':'true'},body:JSON.stringify({weeklyLimitUsd:amount,monthlyLimitUsd:null,expectedVersion:1})});assert.equal(denied.status,409);assert.equal((await denied.json()).code,'accounting_not_ready');assert.equal(denied.headers.get('cache-control'),'no-store');
  }
  const disable=await req(target,{method:'PUT',headers,body:JSON.stringify({weeklyLimitUsd:null,monthlyLimitUsd:null,expectedVersion:1})});assert.equal(disable.status,200);assert.equal((await disable.json()).version,1);receipt.checks.push('production inactive; finite PUT409 even forged activation headers; unlimited no-op');
  const csrf=await req(target,{method:'PUT',headers:{...headers,origin:'https://hostile.invalid'},body:'malformed'});assert.equal(csrf.status,403);receipt.checks.push('actual server Origin guard');
  const page=await req('/dashboard/endpoint',{headers:{cookie}});assert.equal(page.status,200);const markup=await page.text();assert.match(markup,/Endpoint &amp; Key/);
  const styles=[...markup.matchAll(/<link\b[^>]*>/g)].filter(([tag])=>/rel="stylesheet"/.test(tag)).map(([tag])=>tag.match(/href="([^"]+)"/)?.[1]).filter(Boolean);assert(styles.length>0);let css='';
  for(const href of styles){assert.equal(new URL(href,base).origin,base);const asset=await req(href);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/text\/css/);css+=await asset.text();}
  for(const selector of [/\.flex[,{]/,/\.grid[,{]/,/\.rounded-xl[,{]/,/\.text-sm[,{]/])assert.match(css,selector);
  receipt.checks.push('actual standalone Endpoint shell and linked CSS serve');
  const {chromium,expect}=await import('@playwright/test');
  browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:20000});
  const context=await browser.newContext();
  receipt.browser={errors:[],assetFailures:[],blockedExternal:[]};
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===base)return route.continue();receipt.browser.blockedExternal.push(new URL(route.request().url()).pathname);return route.abort();});
  await context.addCookies(cookie.split('; ').map(value=>{const split=value.indexOf('=');return {name:value.slice(0,split),value:value.slice(split+1),url:base,httpOnly:true,sameSite:'Lax'};}));
  const tab=await context.newPage();tab.setDefaultTimeout(10000);
  tab.on('pageerror',error=>receipt.browser.errors.push(error.message));
  tab.on('response',response=>{if(response.url().startsWith(base+'/_next/static/')&&response.status()!==200)receipt.browser.assetFailures.push({path:new URL(response.url()).pathname,status:response.status()});});
  tab.on('requestfailed',request=>{if(request.url().startsWith(base+'/_next/static/'))receipt.browser.assetFailures.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText});});
  const keysLoaded=tab.waitForResponse(response=>response.url()===base+'/api/keys'&&response.request().method()==='GET');
  await tab.goto(base+'/dashboard/endpoint');assert.equal((await keysLoaded).status(),200);
  const panel=tab.getByTestId(`budget-${key.id}`);await expect(panel).toBeVisible();
  await panel.getByRole('button',{name:'Manage budget for Disposable smoke key',exact:true}).click();
  await expect(panel.getByText(/Not activated — production budget enforcement is OFF/)).toBeVisible();
  await expect(panel.getByLabel(/^weekly unlimited$/i)).toBeChecked();
  await expect(panel.getByLabel(/^weekly limit USD$/i)).toBeDisabled();
  await panel.getByLabel(/^weekly unlimited$/i).uncheck();await panel.getByLabel(/^weekly limit USD$/i).fill('1');
  await expect(panel.getByRole('button',{name:'Save budget',exact:true})).toBeDisabled();
  await expect(panel.getByText(/Finite budget saves are unavailable/)).toBeVisible();
  assert.deepEqual(receipt.browser.errors,[]);assert.deepEqual(receipt.browser.assetFailures,[]);
  await context.close();await browser.close();browser=null;receipt.checks.push('actual detached browser hydrates expected key and truthfully disables finite save');
  child.kill('SIGTERM');const bound=setTimeout(()=>child.kill('SIGKILL'),10000);receipt.exit=await exited;clearTimeout(bound);
  const db=new DatabaseSync(path.join(data,'db/data.sqlite'),{readOnly:true});try{assert.equal(db.prepare("SELECT value FROM _meta WHERE key='ledgerStartedAt'").get(),undefined);assert.equal(db.prepare('SELECT count(*) AS n FROM apiKeyAccounting').get().n,0);assert.equal(db.prepare('SELECT version FROM apiKeyBudgetPolicies WHERE apiKeyId=?').get(key.id).version,1);}finally{db.close();}
  assert.match(log,/Driver: node:sqlite/);receipt.checks.push('native database reopens without activation or ledger rows');receipt.complete=true;
}catch(error){receipt.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
  await browser?.close();
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');const bound=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(bound);}
  fs.writeFileSync(output+'.server.log',log);
  if(receipt.complete)fs.rmSync(root,{recursive:true,force:true});else receipt.retainedData=root;
  fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}
