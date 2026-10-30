// Real compiled UI/routes; transport reply faults are labelled, never seeded money.
export async function runBudgetPanelChecks({page,context,base,fixture,check,expect,root,upstreamControl,setNow}) {
  await page.goto(`${base}/dashboard/endpoint`);
  const panel=page.getByTestId('budget-key-one'),other=page.getByTestId('budget-key-two');
  await check('actual Endpoint renders independent per-key budget panels',async()=>{
    await expect(panel).toBeVisible();await expect(other).toBeVisible();
    await panel.getByRole('button',{name:/Manage budget/}).click();
    await expect(panel.getByLabel(/^weekly unlimited$/i)).toBeChecked();
    await expect(panel.getByText('Virtual reference cost, not an invoice.',{exact:false})).toBeVisible();
  });
  const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/keys/key-one/budget')&&r.request().method()==='PUT');await panel.getByRole('button',{name:'Save budget',exact:true}).click();expect((await response).status()).toBe(200);};
  await check('browser saves finite string policy through guarded durable API',async()=>{
    await panel.getByLabel(/^weekly unlimited$/i).uncheck();await panel.getByLabel(/^weekly limit USD$/i).fill('0.0012');await save();
    await expect(panel.getByText(/Draft base version: 2/)).toBeVisible();expect(fixture.db.get("SELECT weeklyLimitNanoUsd FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'").weeklyLimitNanoUsd).toBe(1200000);
  });
  const infer=key=>context.request.post(`${base}/v1/chat/completions`,{headers:{authorization:`Bearer ${key}`},data:{model:'fixture-node/fixture',stream:false,messages:[{role:'user',content:'hello'}]}});
  await check('actual inference debit shown by panel and next request refused before POST',async()=>{
    const response=await infer('fixture-secret');expect(response.status()).toBe(200);await response.json();expect(fixture.posts).toBe(1);
    await panel.getByRole('button',{name:'Refresh budget',exact:true}).click();await expect(panel.locator('[aria-label="weekly budget summary"]')).toContainText('Known spent: $0.0012');
    const denied=await infer('fixture-secret');expect(denied.status()).toBe(429);const error=(await denied.json()).error;expect(error.code).toBe('api_key_budget_exceeded');expect(denied.headers()['x-request-id']).toBe(error.requestId);expect(denied.headers()['cache-control']).toBe('no-store');expect(fixture.posts).toBe(1);
    const otherResponse=await infer('fixture-secret-two');expect(otherResponse.status()).toBe(200);await otherResponse.json();expect(fixture.posts).toBe(2);
  });
  await check('dirty budget survives ACL save and refresh, then higher policy preserves spend',async()=>{
    await panel.getByLabel(/^weekly limit USD$/i).fill('0.003');
    const updated=await context.request.put(`${base}/api/keys/key-one`,{headers:{Origin:base},data:{access:{restricted:false,allow:[]}}});expect(updated.status()).toBe(200);
    await panel.getByRole('button',{name:'Refresh budget',exact:true}).click();await expect(panel.getByLabel(/^weekly limit USD$/i)).toHaveValue('0.003');
    await save();expect(fixture.db.get("SELECT costNanoUsd FROM apiKeyAccounting WHERE apiKeyId='key-one'").costNanoUsd).toBe(1200000);
  });
  await check('stale policy409 preserves draft/base until explicit reconciliation',async()=>{
    await panel.getByLabel(/^weekly limit USD$/i).fill('0.004');
    const saved=await context.request.put(`${base}/api/keys/key-one/budget`,{headers:{Origin:base},data:{weeklyLimitUsd:'0.005',monthlyLimitUsd:null,expectedVersion:3}});expect(saved.status()).toBe(200);
    const conflict=page.waitForResponse(r=>r.url().endsWith('/api/keys/key-one/budget')&&r.request().method()==='PUT');await panel.getByRole('button',{name:'Save budget',exact:true}).click();expect((await conflict).status()).toBe(409);
    await expect(panel.getByLabel(/^weekly limit USD$/i)).toHaveValue('0.004');await expect(panel.getByText(/Draft base version: 3/)).toBeVisible();
    await panel.getByRole('button',{name:'Refresh budget',exact:true}).click();await expect(panel.getByText(/displayed policy version: 4/)).toBeVisible();await expect(panel.getByLabel(/^weekly limit USD$/i)).toHaveValue('0.004');
    await panel.getByRole('button',{name:'Discard draft and load displayed policy',exact:true}).click();await expect(panel.getByLabel(/^weekly limit USD$/i)).toHaveValue('0.005');
  });
  await check('zero blocks across reset and UI warns policy change required',async()=>{
    await panel.getByLabel(/^weekly limit USD$/i).fill('0');await save();await expect(panel.getByText(/0 blocks until policy changes/)).toBeVisible();
    setNow('2026-10-25T17:00:00.000Z');const denied=await infer('fixture-secret');expect(denied.status()).toBe(429);expect((await denied.json()).error.requiresPolicyChange).toBe(true);expect(fixture.posts).toBe(2);
  });
  await check('mobile keyboard editor is labelled and exact state survives reload',async()=>{
    await page.setViewportSize({width:390,height:844});await panel.getByLabel(/^weekly limit USD$/i).focus();await expect(panel.getByLabel(/^weekly limit USD$/i)).toBeFocused();
    expect((await panel.boundingBox()).width).toBeGreaterThan(250);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:`${root}/budget-mobile.png`});
    await page.reload();await panel.getByRole('button',{name:/Manage budget/}).click();await expect(panel.getByLabel(/^weekly limit USD$/i)).toHaveValue('0');await expect(panel.getByText(/0 blocks until policy changes/)).toBeVisible();
  });
  await check('monthly-only and both-window SSE flow consumes own durable terminal then refuses without POST',async()=>{
    await page.setViewportSize({width:1280,height:900});
    const monthly=panel.getByLabel(/^monthly limit USD$/i),weekly=panel.getByLabel(/^weekly limit USD$/i);
    await panel.getByLabel(/^weekly unlimited$/i).check();await panel.getByLabel(/^monthly unlimited$/i).uncheck();await monthly.fill('0.0024');await save();
    const sse=()=>context.request.post(`${base}/v1/chat/completions`,{headers:{authorization:'Bearer fixture-secret'},data:{model:'fixture-node/fixture',stream:true,messages:[{role:'user',content:'hello'}]}});
    const response=await sse();expect(response.status()).toBe(200);const text=await response.text();expect(text).toContain('[DONE]');expect(text).toContain('"finish_reason":"stop"');expect(text).not.toContain('"error"');expect(fixture.posts).toBe(3);
    await panel.getByRole('button',{name:'Refresh budget',exact:true}).click();await expect(panel.locator('[aria-label="monthly budget summary"]')).toContainText('Known spent: $0.0024');
    const denied=await sse();expect(denied.status()).toBe(429);expect((await denied.json()).error.code).toBe('api_key_budget_exceeded');expect(fixture.posts).toBe(3);
    await panel.getByLabel(/^weekly unlimited$/i).uncheck();await weekly.fill('0.0012');await save();
    const both=await sse();expect(both.status()).toBe(429);expect(fixture.posts).toBe(3);
    fixture.db.withPersistedAccountingAuthority(reader=>{
      const rows=reader.all("SELECT apiKeyId,state,costNanoUsd,startedAt FROM apiKeyAccounting ORDER BY startedAt");expect(rows).toHaveLength(3);expect(rows.every(row=>row.state==='settled'&&String(row.costNanoUsd)==='1200000')).toBe(true);expect(rows.filter(row=>row.apiKeyId==='key-one')).toHaveLength(2);expect(rows.filter(row=>row.apiKeyId==='key-two')).toHaveLength(1);
    });
    // Unlimited changes policy, never erases existing spend/history.
    await panel.getByLabel(/^weekly unlimited$/i).check();await panel.getByLabel(/^monthly unlimited$/i).check();await save();
    await expect(panel.locator('[aria-label="monthly budget summary"]')).toContainText('Known spent: $0.0024');
  });
  await check('committed PUT with lost reply requires explicit reconciliation without silent draft rebase',async()=>{
    await panel.getByLabel(/^weekly unlimited$/i).uncheck();await panel.getByLabel(/^weekly limit USD$/i).fill('0.01');
    const target=`${base}/api/keys/key-one/budget`;
    // Execute the real guarded PUT and lose only its browser delivery, never mock API state.
    const loseReply=async route=>{if(route.request().method()!=='PUT')return route.continue();const actual=await route.fetch();expect(actual.status()).toBe(200);await actual.dispose();await route.abort('connectionreset');};
    await page.route(target,loseReply);
    await panel.getByRole('button',{name:'Save budget',exact:true}).click();await expect(panel.getByText(/Save may have committed/)).toBeVisible();
    await page.unroute(target,loseReply);await expect(panel.getByRole('button',{name:'Save budget',exact:true})).toBeDisabled();
    const committed=fixture.db.get("SELECT version,weeklyLimitNanoUsd FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'");expect(committed.weeklyLimitNanoUsd).toBe(10000000);
    await panel.getByRole('button',{name:'Refresh budget',exact:true}).click();await expect(panel.getByText(new RegExp(`displayed policy version: ${committed.version}`))).toBeVisible();
    await expect(panel.getByText(/Save may have committed/)).toBeVisible();await expect(panel.getByRole('button',{name:'Save budget',exact:true})).toBeDisabled();
    await panel.getByRole('button',{name:'Discard draft and load displayed policy',exact:true}).click();await expect(panel.getByLabel(/^weekly limit USD$/i)).toHaveValue('0.01');await expect(panel.getByText(/Save may have committed/)).toHaveCount(0);
  });
  await check('automatic reopen refresh cannot supersede an acknowledged pending policy save',async()=>{
    const target=`${base}/api/keys/key-one/budget`;
    await panel.getByLabel(/^weekly limit USD$/i).fill('0.02');
    let release,arrived,finished,handlerError,entered=false;
    const held=new Promise(resolve=>{release=resolve;}),committed=new Promise(resolve=>{arrived=resolve;}),completed=new Promise(resolve=>{finished=resolve;});let reads=0;
    const count=request=>{if(request.url()===target&&request.method()==='GET')reads++;};page.on('request',count);
    const hold=async route=>{
      if(route.request().method()!=='PUT')return route.continue();entered=true;let actual;
      try{actual=await route.fetch();expect(actual.status()).toBe(200);arrived();await held;await route.fulfill({response:actual});}
      catch(error){handlerError=error;arrived();}
      finally{await actual?.dispose();finished();}
    };
    await page.route(target,hold);
    try{
      await panel.getByRole('button',{name:'Save budget',exact:true}).click();await committed;if(handlerError)throw handlerError;
      await panel.getByRole('button',{name:/Hide budget/}).click();await panel.getByRole('button',{name:/Manage budget/}).click();
      await expect(panel.getByLabel(/^weekly limit USD$/i)).toBeVisible();
      await expect(panel.getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();expect(reads).toBe(0);
      release();await expect(panel.getByLabel(/^weekly limit USD$/i)).toHaveValue('0.02');
      const version=fixture.db.get("SELECT version FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'").version;
      await expect(panel.getByText(new RegExp(`Draft base version: ${version}; displayed policy version: ${version}`))).toBeVisible();
      await expect.poll(()=>reads).toBe(1);
    }finally{
      release();let bound;
      try{if(entered)await Promise.race([completed,new Promise((_,reject)=>{bound=setTimeout(()=>reject(new Error('Held PUT handler cleanup exceeded 10s')),10000);})]);}
      finally{clearTimeout(bound);await page.unroute(target,hold);page.off('request',count);}
      if(handlerError)throw handlerError;
    }
  });
  await check('actual ACL UI denies inference while retaining dirty budget and durable history',async()=>{
    const card=panel.locator('..'),acl=card.getByTestId('key-access');
    await panel.getByLabel(/^weekly limit USD$/i).fill('0.03');
    const update=page.waitForResponse(r=>r.url().endsWith('/api/keys/key-one')&&r.request().method()==='PUT');
    await acl.getByRole('switch').click();await page.getByRole('button',{name:'Confirm',exact:true}).click();expect((await update).status()).toBe(200);
    await expect(acl.getByText(/No combos or models allowed/)).toBeVisible();await expect(panel.getByLabel(/^weekly limit USD$/i)).toHaveValue('0.03');
    const posts=fixture.posts,response=await infer('fixture-secret');expect(response.status()).toBe(503);expect((await response.json()).error.code).toBe('api_key_accounting_unavailable');expect(fixture.posts).toBe(posts);
    await save();expect(fixture.db.get("SELECT accessRestricted FROM apiKeys WHERE id='key-one'").accessRestricted).toBe(1);
    const unrestricted=page.waitForResponse(r=>r.url().endsWith('/api/keys/key-one')&&r.request().method()==='PUT');await acl.getByRole('switch').click();expect((await unrestricted).status()).toBe(200);
    expect(fixture.db.get("SELECT count(*) AS n FROM apiKeyAccounting WHERE apiKeyId='key-one'").n).toBe(2);
  });
  await check('actual key pause and resume preserves policy, exact spend and budget editor identity',async()=>{
    const keyCard=panel.locator('..').locator('..'),active=keyCard.getByRole('switch').last();
    const before={...fixture.db.get("SELECT version,weeklyLimitNanoUsd FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'")},posts=fixture.posts;
    const paused=page.waitForResponse(r=>r.url().endsWith('/api/keys/key-one')&&r.request().method()==='PUT');
    await active.click();await page.getByRole('button',{name:'Confirm',exact:true}).click();expect((await paused).status()).toBe(200);
    await expect(keyCard.getByText('Paused',{exact:true})).toBeVisible();await expect(panel.getByLabel(/^weekly limit USD$/i)).toBeDisabled();
    const denied=await infer('fixture-secret');expect(denied.status()).toBe(503);expect(fixture.posts).toBe(posts);
    const resumed=page.waitForResponse(r=>r.url().endsWith('/api/keys/key-one')&&r.request().method()==='PUT');await active.click();expect((await resumed).status()).toBe(200);
    await expect(panel.getByLabel(/^weekly limit USD$/i)).toBeEnabled();await expect(panel.getByLabel(/^weekly limit USD$/i)).toHaveValue('0.03');
    expect({...fixture.db.get("SELECT version,weeklyLimitNanoUsd FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'")}).toEqual(before);expect(fixture.db.get("SELECT count(*) AS n FROM apiKeyAccounting WHERE apiKeyId='key-one'").n).toBe(2);
  });
  await check('loading and injected GET503 keep dirty draft and unknown allowance until real retry; keyboard order remains usable',async()=>{
    const target=`${base}/api/keys/key-one/budget`,input=panel.getByLabel(/^weekly limit USD$/i);
    await input.fill('0.04');const baseVersion=fixture.db.get("SELECT version FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'").version;
    let release,finished,entered=false,handlerError;const held=new Promise(resolve=>{release=resolve;}),done=new Promise(resolve=>{finished=resolve;});
    // Deliberate display-only HTTP fault injection; not a real backend outage or money acceptance.
    const fault=async route=>{if(route.request().method()!=='GET')return route.continue();entered=true;try{await held;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Injected budget read unavailable'})});}catch(error){handlerError=error;}finally{finished();}};
    await page.route(target,fault);
    try{
      await panel.getByRole('button',{name:'Refresh budget',exact:true}).click();await expect(panel.getByText('Refreshing budget…',{exact:true})).toBeVisible();await expect(input).toHaveValue('0.04');await expect(panel.locator('[aria-label="weekly budget summary"]')).toContainText('Remaining: Unknown');
      release();await expect(panel.getByRole('alert')).toContainText('Injected budget read unavailable');await expect(panel.locator('[aria-label="weekly budget summary"]')).toContainText('Remaining: Unknown');await expect(input).toHaveValue('0.04');
      await input.fill('0.041');await expect(panel.locator('[aria-label="weekly budget summary"]')).toContainText('Remaining: Unknown');await expect(panel.getByText(/Health: unknown/)).toBeVisible();await expect(panel.getByRole('button',{name:'Save budget',exact:true})).toBeDisabled();
    }finally{release();let bound;try{if(entered)await Promise.race([done,new Promise((_,reject)=>{bound=setTimeout(()=>reject(new Error('GET503 cleanup exceeded 10s')),10000);})]);}finally{clearTimeout(bound);await page.unroute(target,fault);}if(handlerError)throw handlerError;}
    await panel.getByRole('button',{name:'Refresh budget',exact:true}).click();await expect(panel.getByText(/Remaining: Unknown/)).toHaveCount(0);await expect(input).toHaveValue('0.041');await expect(panel.getByText(new RegExp(`Draft base version: ${baseVersion};`))).toBeVisible();
    await input.focus();await page.keyboard.press('Tab');await expect(panel.getByLabel(/^monthly unlimited$/i)).toBeFocused();await page.keyboard.press('Tab');await expect(panel.getByRole('button',{name:'Save budget',exact:true})).toBeFocused();
    await panel.getByRole('button',{name:/Hide budget/}).focus();await page.keyboard.press('Enter');await expect(input).toHaveCount(0);await expect(panel.getByRole('button',{name:/Manage budget/})).toBeFocused();await page.keyboard.press('Enter');await expect(input).toHaveValue('0.041');
  });
  await check('trusted HTTP management guard rejects forged identity and cross-site mutation before policy writes',async()=>{
    const target=`${base}/api/keys/key-one/budget`,version=fixture.db.get("SELECT version FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'").version;
    const anonymous=await context.browser().newContext();
    try{
      for(const probe of [
        {name:'invalid-session',headers:{cookie:'auth_token=invalid'},status:401,code:'management_unauthorized'},
        {name:'inference-token',headers:{authorization:'Bearer fixture-secret','x-9r-cli-token':'inference-token'},status:401,code:'management_unauthorized'},
        {name:'forwarded-authority',headers:{'x-9r-real-ip':'127.0.0.1','x-9r-peer-token':'forged','x-forwarded-host':'localhost'},status:403,code:'management_authority_invalid'},
      ]){
        const response=await anonymous.request.put(target,{headers:probe.headers,data:'bad-json'}),body=await response.json();
        expect({case:probe.name,status:response.status(),code:body.code}).toEqual({case:probe.name,status:probe.status,code:probe.code});
        expect(response.headers()['cache-control']).toBe('no-store');
      }
    }finally{await anonymous.close();}
    const denied=await context.request.put(target,{headers:{Origin:'https://hostile.invalid'},data:'bad-json'});expect(denied.status()).toBe(403);expect(denied.headers()['cache-control']).toBe('no-store');
    expect(fixture.db.get("SELECT version FROM apiKeyBudgetPolicies WHERE apiKeyId='key-one'").version).toBe(version);
  });
  await check('actual concurrent POST overshoot and completed missing usage retain independent accounting safety',async()=>{
    const target=`${base}/api/keys/key-one/budget`;
    const policy=async weekly=>{const current=await context.request.get(target),snapshot=await current.json();const response=await context.request.put(target,{headers:{Origin:base},data:{weeklyLimitUsd:weekly,monthlyLimitUsd:null,expectedVersion:snapshot.version}});expect(response.status()).toBe(200);};
    // Current-week spend is 0.0012; two admitted POSTs each add 0.0012.
    await policy('0.0024');const pair=upstreamControl.holdPair();const pending=Promise.all([infer('fixture-secret'),infer('fixture-secret')]);
    try{await pair.ready;expect(fixture.db.get("SELECT count(*) AS n FROM apiKeyAccounting WHERE apiKeyId='key-one' AND state='pending'").n).toBe(2);pair.release();const replies=await pending;for(const response of replies){expect(response.status()).toBe(200);await response.json();}}finally{pair.release();await pending;}
    await panel.getByRole('button',{name:'Refresh budget',exact:true}).click();await expect(panel.locator('[aria-label="weekly budget summary"]')).toContainText('Overshoot: $0.0012');
    const posts=fixture.posts,denied=await infer('fixture-secret');expect(denied.status()).toBe(429);expect(fixture.posts).toBe(posts);await page.screenshot({path:`${root}/budget-overshoot.png`});
    await policy('1');upstreamControl.unknown(true);
    try{const unknown=await infer('fixture-secret');expect(unknown.status()).toBe(200);await unknown.json();}finally{upstreamControl.unknown(false);}
    await panel.getByRole('button',{name:'Refresh budget',exact:true}).click();await expect(panel.getByText(/Accounting safety errors: 1/)).toBeVisible();await expect(panel.getByText(/api_key_accounting_unresolved/)).toBeVisible();
    expect(fixture.db.get("SELECT costNanoUsd FROM apiKeyAccounting WHERE state='unresolved'").costNanoUsd).toBeNull();await page.screenshot({path:`${root}/budget-unresolved.png`});
    const count=fixture.posts;setNow('2027-01-01T00:00:00.000Z');const blocked=await infer('fixture-secret');expect(blocked.status()).toBe(503);expect((await blocked.json()).error.code).toBe('api_key_accounting_unresolved');expect(fixture.posts).toBe(count);
    await expect(panel.getByLabel(/^weekly limit USD$/i)).toHaveValue('0.041');
  });
  await check('late key-A GET after actual unmount cannot overwrite key-B draft or save target',async()=>{
    const target=`${base}/api/keys/key-one/budget`;let release,arrived,finished,handlerError,entered=false;
    const held=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{arrived=resolve;}),done=new Promise(resolve=>{finished=resolve;});
    const hold=async route=>{if(route.request().method()!=='GET')return route.continue();entered=true;let actual;try{actual=await route.fetch();expect(actual.status()).toBe(200);arrived();await held;await route.fulfill({response:actual});}catch(error){handlerError=error;arrived();}finally{await actual?.dispose();finished();}};
    await page.route(target,hold);
    try{
      await panel.getByRole('button',{name:'Refresh budget',exact:true}).click();await ready;if(handlerError)throw handlerError;
      await other.getByRole('button',{name:/Manage budget/}).click();await expect(other.getByLabel(/^weekly unlimited$/i)).toBeChecked();await other.getByLabel(/^weekly unlimited$/i).uncheck();await other.getByLabel(/^weekly limit USD$/i).fill('0.1');
      const deleted=page.waitForResponse(r=>r.url().endsWith('/api/keys/key-one')&&r.request().method()==='DELETE');await panel.locator('..').locator('..').getByRole('button').filter({hasText:'delete'}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();expect((await deleted).status()).toBe(200);await expect(panel).toHaveCount(0);
      release();await done;if(handlerError)throw handlerError;
      await expect(other.getByLabel(/^weekly limit USD$/i)).toHaveValue('0.1');
      const saved=page.waitForResponse(r=>r.url().endsWith('/api/keys/key-two/budget')&&r.request().method()==='PUT');await other.getByRole('button',{name:'Save budget',exact:true}).click();expect((await saved).status()).toBe(200);
      expect(fixture.db.get("SELECT weeklyLimitNanoUsd FROM apiKeyBudgetPolicies WHERE apiKeyId='key-two'").weeklyLimitNanoUsd).toBe(100000000);expect(fixture.db.get("SELECT count(*) AS n FROM apiKeyAccounting WHERE apiKeyId='key-one'").n).toBe(5);
    }finally{release();let bound;try{if(entered)await Promise.race([done,new Promise((_,reject)=>{bound=setTimeout(()=>reject(new Error('Late GET cleanup exceeded 10s')),10000);})]);}finally{clearTimeout(bound);await page.unroute(target,hold);}if(handlerError)throw handlerError;}
  });
  await check('actual interrupted SSE has no unknown work while authoritative EOF usage debits once',async()=>{
    // Key A was removed by the preceding unmount control; use independent key B.
    const target=`${base}/api/keys/key-two/budget`;
    const read=async()=>{const response=await context.request.get(target);expect(response.status()).toBe(200);return response.json();};
    const before=await read();const initial=before.weekly.spentUsd;
    const request=()=>context.request.post(`${base}/v1/chat/completions`,{headers:{authorization:'Bearer fixture-secret-two'},data:{model:'fixture-node/fixture',stream:true,messages:[{role:'user',content:'hello'}]}});
    try{
      upstreamControl.interruption('absent');
      for(let i=0;i<2;i++){const response=await request();expect(response.status()).toBe(200);const text=await response.text();expect(text).not.toContain('[DONE]');expect(text).not.toContain('"finish_reason":"stop"');}
      const absent=await read();expect(absent.weekly.spentUsd).toBe(initial);expect(absent.unresolvedCount).toBe(0);expect(absent.eligibility.eligible).toBe(true);
      await other.getByRole('button',{name:'Refresh budget',exact:true}).click();
      await expect(other.getByText(/Unknown \/ unresolved attempts/)).toHaveCount(0);await expect(other.getByText(/audited recovery is required/)).toHaveCount(0);
      await expect(other.getByText(/Interrupted requests without recoverable usage/)).toBeVisible();
      upstreamControl.interruption('valid');const response=await request();const text=await response.text();expect(text).not.toContain('[DONE]');expect(text).not.toContain('"finish_reason":"stop"');
      const after=await read();const nano=value=>{const [whole,fraction='']=value.split('.');return BigInt(whole)*1000000000n+BigInt(fraction.padEnd(9,'0'));};
      expect(nano(after.weekly.spentUsd)-nano(initial)).toBe(1200000n);expect(after.unresolvedCount).toBe(0);
      expect(fixture.db.get("SELECT count(*) AS n FROM apiKeyAccounting WHERE apiKeyId='key-two' AND state='unrecorded'").n).toBe(2);
    }finally{upstreamControl.interruption(null);}
  });
}
