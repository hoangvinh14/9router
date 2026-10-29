// Feasibility spike: actual source handlers and compiled UI, not a production server.
// All fixture capability association lives here. No HTTP input selects readiness.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

const artifact = path.resolve(process.env.BUDGET_STANDALONE || '.next-chat-final-261028/standalone');
const receiptPath = process.argv[2];
if (!receiptPath) throw new Error('Receipt path required');
const engine = process.argv.includes('--engine=sqljs') ? 'sqljs' : 'node';
const root = fs.mkdtempSync(path.join(os.tmpdir(), '9router-budget-web-'));
Object.assign(process.env, { DATA_DIR: path.join(root, 'default-data'), HOME: path.join(root, 'home'), APPDATA: path.join(root, 'appdata'),
  JWT_SECRET: 'disposable-budget-web-session-secret', INITIAL_PASSWORD: 'disposable-budget-web-password', AUTH_COOKIE_SECURE: 'false',
  MODEL_CATALOG_SYNC: 'off', DISABLE_BACKGROUND_TOKEN_REFRESH: 'true' });
for (const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy']) delete process.env[name];
for (const dir of [process.env.HOME, process.env.APPDATA, process.env.DATA_DIR]) fs.mkdirSync(dir, {recursive:true});
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const require = createRequire(import.meta.url);
// Reuse the REAL socket-header normalization rather than a test reimplementation.
require('../../../custom-server.js');
const receipt = { engine, node: process.version, artifact, complete: false, checks: [], root,
  diagnostics: {invocations: [], handlerFailures: [], browserErrors: [], assetFailures: []} };
const safeDiagnostic = value => String(value).slice(0, 2000)
  .replaceAll(process.env.INITIAL_PASSWORD, '[redacted]')
  .replaceAll(process.env.JWT_SECRET, '[redacted]')
  .replaceAll(process.env.NINEROUTER_PEER_TOKEN, '[redacted]')
  .replace(/(Bearer\s+|auth_token=)[^\s;"<>]+/gi, '$1[redacted]');
let fixture, server, browser, context;
const previous = global._dbAdapter?.instance;
const sockets = new Set();
try {
  const { NextRequest } = await import('next/server.js');
  assert.equal(require('next/package.json').version, '16.4.3', 'Review lifecycle adapter when Next version changes');
  const { AppRouteRouteModule } = require('next/dist/server/route-modules/app-route/module.js');
  const { openChatFixture, jsonReply } = await import('./chat-loopback.js');
  const { streamReply } = await import('./chat-stream.js');
  const { associateChatAccountingFixture } = await import('../../../src/sse/services/chat-accounting.js');
  const chat = await import('../../../src/app/api/v1/chat/completions/route.js');
  const login = await import('../../../src/app/api/auth/login/route.js');
  const pricing = await import('../../../src/app/api/pricing/route.js');
  const sync = await import('../../../src/app/api/pricing/sync/route.js');
  const coverage = await import('../../../src/app/api/pricing/coverage/route.js');
  const authStatus = await import('../../../src/app/api/auth/status/route.js');
  const settings = await import('../../../src/app/api/settings/route.js');
  const keyList = await import('../../../src/app/api/keys/route.js');
  const keyItem = await import('../../../src/app/api/keys/[id]/route.js');
  const budget = await import('../../../src/app/api/keys/[id]/budget/route.js');
  const { associateBudgetManagementFixture } = await import('../../../src/lib/accounting/budget-management.js');
  const tunnelStatus = await import('../../../src/app/api/tunnel/status/route.js');
  const tailscaleStatus = await import('../../../src/app/api/tunnel/tailscale-check/route.js');
  const panelMode = process.argv.includes('--panel');
  let domainNow = '2026-10-25T16:00:00.000Z';
  const clock = () => domainNow;
  const { chromium, expect } = await import('@playwright/test');
  let omitUsage=false,heldResponses=null;
  const upstreamControl={
    unknown(value){omitUsage=value;},
    holdPair(){let release,arrived,count=0;const held=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{arrived=resolve;});heldResponses=async()=>{if(++count===2)arrived();await held;};return {ready,release:()=>{heldResponses=null;release();}};},
  };
  fixture = await openChatFixture(engine, { settings: {requireLogin: true, enableObservability:false}, respond:async(_request,response,_count,wire)=>{
    if(heldResponses)await heldResponses();
    response.setHeader('content-type',wire.body.stream?'text/event-stream':'application/json');
    const body=jsonReply();if(omitUsage)delete body.usage;
    response.end(wire.body.stream?streamReply(omitUsage?null:body.usage):JSON.stringify(body));
  } });
  const distName = fs.readdirSync(artifact).find(name => name.startsWith('.next'));
  assert(distName, 'Compiled Next artifact required');
  const dist = path.join(artifact, distName);
  receipt.buildId = fs.readFileSync(path.join(dist, 'BUILD_ID'), 'utf8').trim();
  const provenanceFiles=['src/shared/components/ApiKeyBudgetPanel.js','src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js','src/dashboardGuard.js','src/lib/accounting/budget-management.js','src/app/api/keys/[id]/budget/route.js','tests/browser/budget-panel-checks.mjs','tests/browser/budget-cli-checks.mjs'];
  receipt.sourceSha256=Object.fromEntries(provenanceFiles.map(name=>[name,createHash('sha256').update(fs.readFileSync(name)).digest('hex')]));
  const app = path.join(dist, 'server/app');
  receipt.endpointHtmlSha256=createHash('sha256').update(fs.readFileSync(path.join(app,'dashboard/endpoint.html'))).digest('hex');
  const pricingHtml = path.join(app, 'dashboard/settings/pricing.html');
  receipt.pricingHtmlSha256 = createHash('sha256').update(fs.readFileSync(pricingHtml)).digest('hex');
  const invocations = receipt.diagnostics.invocations, failures = receipt.diagnostics.handlerFailures;
  // Framework owns all async stores, request proxying and cookie finalization.
  // Full middleware/server routing remains a separate standalone smoke.
  const modules = new Map();
  const runRoute = (pathname, userland, request, params) => {
    // Match Next's generated app-route template: userland is a lazy factory.
    if(!modules.has(pathname)) modules.set(pathname,new AppRouteRouteModule({userland:()=>userland,
      definition:{kind:'APP_ROUTE',page:`${pathname}/route`,pathname,filename:'route',bundlePath:`app${pathname}/route`},
      distDir:dist,relativeProjectDir:process.cwd(),resolvedPagePath:`tests-only:${pathname}`}));
    return modules.get(pathname).handle(request,{params,sharedContext:{buildId:receipt.buildId},
      renderOpts:{experimental:{},supportsDynamicResponse:true,isDraftMode:false,cacheComponents:false}});
  };
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const routes = {'/api/auth/login':login, '/api/auth/status':authStatus, '/api/pricing':pricing,
        '/api/pricing/sync':sync, '/api/pricing/coverage':coverage, '/api/settings':settings,
        '/api/keys':keyList, '/api/tunnel/status':tunnelStatus, '/api/tunnel/tailscale-check':tailscaleStatus};
      const keyMatch = /^\/api\/keys\/([^/]+)(\/budget)?$/.exec(url.pathname);
      if (keyMatch) routes[url.pathname] = keyMatch[2] ? budget : keyItem;
      const associatedChat = url.pathname === '/v1/chat/completions';
      const unassociatedChat = url.pathname === '/fixture/unassociated/chat';
      if (routes[url.pathname] || associatedChat || unassociatedChat) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const request = new NextRequest(url, {method:req.method,headers:req.headers,
          ...(!['GET','HEAD'].includes(req.method) ? {body:Buffer.concat(chunks)} : {})});
        // Associate the EXACT framework-delivered Request and invoke actual POST.
        // This route selection is test-only, never a shipping activation channel.
        const userland = associatedChat ? {...chat,POST:actual=>{
          associateChatAccountingFixture(actual,fixture.db,{}, {clock});return chat.POST(actual);
        }} : unassociatedChat ? chat : keyMatch?.[2] ? Object.fromEntries(Object.entries(budget).map(([method,handler]) =>
          typeof handler === 'function' ? [method,(actual,args)=>{
            associateBudgetManagementFixture(actual,fixture.db,{clock,coverageStartedAt:'2026-10-25T15:00:00.000Z'});return handler(actual,args);
          }] : [method,handler])) : routes[url.pathname];
        const response = await runRoute(url.pathname,userland,request,keyMatch?{id:decodeURIComponent(keyMatch[1])}:undefined);
        const denialCode=response.status>=400&&response.headers.get('content-type')?.includes('application/json')
          ? (await response.clone().json().catch(()=>null))?.code : undefined;
        invocations.push({path:url.pathname,method:req.method,status:response.status,...(typeof denialCode==='string'?{code:denialCode}:{})});
        res.statusCode = response.status;
        for (const [name,value] of response.headers) if(name !== 'set-cookie') res.setHeader(name,value);
        const cookies = response.headers.getSetCookie();
        if(cookies.length) res.setHeader('set-cookie',cookies);
        if(response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
        return;
      }
      let file;
      if(url.pathname.startsWith('/_next/static/')) file = path.join(dist, 'static', decodeURIComponent(url.pathname.slice('/_next/static/'.length)));
      else if (url.pathname === '/login') file = path.join(app,'login.html');
      else if (url.pathname === '/dashboard/settings/pricing') file = pricingHtml;
      else if (url.pathname === '/dashboard/endpoint') file = path.join(app,'dashboard/endpoint.html');
      else if (url.pathname === '/dashboard') file = path.join(app,'dashboard.html');
      else file = path.join(artifact, 'public', decodeURIComponent(url.pathname));
      if(!file.startsWith(artifact + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.statusCode=404;res.end();return;}
      res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    } catch(error) { failures.push(safeDiagnostic(error.stack));res.statusCode=500;res.end('Fixture handler failed'); }
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless:true,chromiumSandbox:true,timeout:20000});
  context = await browser.newContext({viewport:{width:1280,height:900}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base ? route.continue() : route.abort());
  const page = await context.newPage(), errors = receipt.diagnostics.browserErrors, assetsFailed = receipt.diagnostics.assetFailures;
  page.on('pageerror',error=>errors.push(safeDiagnostic(error.message)));
  page.on('response',response=>{if(response.url().includes('/_next/static/') && response.status()!==200)assetsFailed.push({path:new URL(response.url()).pathname,status:response.status()});});
  page.on('requestfailed',request=>{assetsFailed.push({path:new URL(request.url()).pathname,error:safeDiagnostic(request.failure()?.errorText)});});
  const check = async(name,action)=>{await action();receipt.checks.push(name);};
  await check('unauthenticated guarded HTTP rejected with no-store',async()=>{
    const response=await context.request.get(`${base}/api/pricing`);expect(response.status()).toBe(401);expect(response.headers()['cache-control']).toBe('no-store');
  });
  await check('real compiled login hydrates and actual source login sets verified session',async()=>{
    await page.goto(`${base}/login`);await page.locator('input[type=password]').fill(process.env.INITIAL_PASSWORD);
    const response=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');
    await page.locator('button[type=submit]').click();
    const actualLogin = await response;
    if(actualLogin.status() !== 200) {
      const body = await actualLogin.json().catch(()=>null);
      receipt.diagnostics.loginFailure = {path:'/api/auth/login',status:actualLogin.status(),
        error:typeof body?.error === 'string' ? safeDiagnostic(body.error) : 'Non-JSON or absent error'};
    }
    expect(actualLogin.status()).toBe(200);
    expect((await context.cookies()).some(c=>c.name==='auth_token'&&c.httpOnly)).toBe(true);
    expect((await context.request.get(`${base}/api/pricing`)).status()).toBe(200);
    await expect(page).toHaveURL(`${base}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
  });
  if (!process.argv.includes('--auth-only') && !panelMode) {
  await check('compiled pricing UI reads actual route and saves exact override to same adapter',async()=>{
    await page.goto(`${base}/dashboard/settings/pricing`);await expect(page.getByRole('button',{name:'Edit Pricing',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Edit Pricing',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('searchbox').fill('fixture');
    const input=page.getByLabel('openai-compatible-chat-accounting-fixture fixture input rate',{exact:true});await expect(input).toBeVisible();await input.fill('1.000000001');
    const saved=page.waitForResponse(r=>r.url().endsWith('/api/pricing')&&r.request().method()==='PATCH');
    await page.getByRole('button',{name:'Save Changes',exact:true}).click();expect((await saved).status()).toBe(200);
    const stored=fixture.db.get("SELECT value FROM kv WHERE scope='pricing' AND key=?",['openai-compatible-chat-accounting-fixture']);
    assert.equal(JSON.parse(stored.value).fixture.input,'1.000000001');
  });
  await check('actual HTTP private association reaches source app/core/transport and durable ledger',async()=>{
    // chatCore defaults to streaming unless explicitly false (or Accept JSON).
    const response=await context.request.post(`${base}/v1/chat/completions`,{headers:{authorization:'Bearer fixture-secret'},data:{model:'fixture-node/fixture',stream:false,messages:[{role:'user',content:'hello'}]}});
    const text=await response.text();
    receipt.diagnostics.chatResponse={status:response.status(),contentType:response.headers()['content-type'],bytes:Buffer.byteLength(text),sseFraming:text.startsWith('data:'),doneMarker:text.includes('[DONE]')};
    expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('application/json');
    expect(JSON.parse(text).choices[0].message.content).toBe('hello');assert.equal(fixture.posts,1);
    const row=fixture.db.get('SELECT state,apiKeyId,costNanoUsd FROM apiKeyAccounting');assert.equal(row.state,'settled');assert.equal(row.apiKeyId,'key-one');assert.equal(String(row.costNanoUsd),'1200000');
  });
  await check('concurrent associated/unassociated HTTP requests preserve private request and key identity',async()=>{
    const data={model:'fixture-node/fixture',stream:false,messages:[{role:'user',content:'hello'}]};
    const responses=await Promise.all([
      context.request.post(`${base}/v1/chat/completions`,{headers:{authorization:'Bearer fixture-secret-two'},data}),
      context.request.post(`${base}/fixture/unassociated/chat`,{headers:{authorization:'Bearer fixture-secret'},data}),
    ]);
    for(const response of responses){expect(response.status()).toBe(200);expect((await response.json()).choices[0].message.content).toBe('hello');}
    assert.equal(fixture.posts,3);
    // node:sqlite rows have null prototypes; compare the selected scalar fields.
    assert.deepEqual(fixture.db.all('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting ORDER BY apiKeyId').map(row=>({...row})),[
      {apiKeyId:'key-one',state:'settled',costNanoUsd:1200000},
      {apiKeyId:'key-two',state:'settled',costNanoUsd:1200000},
    ]);
  });
  await check('independent persisted image contains UI price and exact key-attributed terminal rows',async()=>{
    fixture.db.durableTransaction(()=>{});
    fixture.db.withPersistedAccountingAuthority(reader=>{
      const price=JSON.parse(reader.get("SELECT value FROM kv WHERE scope='pricing' AND key=?",['openai-compatible-chat-accounting-fixture']).value);
      assert.equal(price.fixture.input,'1.000000001');
      const rows=reader.all('SELECT apiKeyId,state,costNanoUsd,priceSnapshotJson FROM apiKeyAccounting ORDER BY apiKeyId');
      assert.equal(rows.length,2);
      for(const row of rows){assert.equal(row.state,'settled');assert.equal(String(row.costNanoUsd),'1200000');assert.equal(JSON.parse(row.priceSnapshotJson).rates.input,'1.000000001');}
      receipt.persisted={adapter:fixture.db.driver,rows:rows.length,keyIds:rows.map(row=>row.apiKeyId),costNanoUsd:rows.map(row=>String(row.costNanoUsd))};
    });
  });
  await check('actual production socket wrapper rejects hostile mutation and forged authority',async()=>{
    const response=await context.request.patch(`${base}/api/pricing`,{headers:{origin:'https://hostile.invalid'},data:{}});expect(response.status()).toBe(403);
    const anonymous=await browser.newContext();try {
      expect((await anonymous.request.get(`${base}/api/pricing`,{headers:{'x-9r-real-ip':'127.0.0.1','x-9r-peer-token':'forged'}})).status()).toBe(401);
    }finally{await anonymous.close();}
  });
  }
  if(panelMode){
    const {runBudgetPanelChecks}=await import('../../browser/budget-panel-checks.mjs');
    await runBudgetPanelChecks({page,context,base,fixture,check,expect,root,upstreamControl,setNow:value=>{domainNow=value;}});
    const {runBudgetCliChecks}=await import('../../browser/budget-cli-checks.mjs');
    await runBudgetCliChecks({base,check,expect,password:process.env.INITIAL_PASSWORD});
  }
  assert.equal(fixture.db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'"),undefined);
  assert.deepEqual(failures,[]);assert.deepEqual(errors,[]);
  // External analytics are deliberately blocked, never fulfilled with mock data.
  assert.deepEqual(assetsFailed.filter(item=>item.path.startsWith('/_next/static/')),[]);
  receipt.invocations=invocations;receipt.complete=true;
} catch(error) {receipt.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally {
  await context?.close();await browser?.close();for(const socket of sockets)socket.destroy();
  if(server)await new Promise(resolve=>server.close(resolve));
  await fixture?.close();global._dbAdapter?.instance?.close();if(global._dbAdapter)global._dbAdapter.instance=previous;
  for(const timer of Object.values(global._statsEmitTimers||{}))if(timer)clearTimeout(timer);
  for(const timer of Object.values(global._pendingTimers||{}))if(timer)clearTimeout(timer);
  fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');
  process.stdout.write(JSON.stringify({complete:receipt.complete,checks:receipt.checks,failure:receipt.failure?.message,receiptPath})+'\n');
}
