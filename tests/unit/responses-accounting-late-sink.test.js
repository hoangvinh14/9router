import { afterEach, describe, expect, it, vi } from 'vitest';
import { openResponsesFixture, rawResponsesUsage, fixtureProvider } from '../fixtures/accounting/responses-loopback.js';
import { associateChatAccountingFixture, captureChatAccounting } from '../../src/sse/services/chat-accounting.js';
import { normalizeResponsesUsage } from '../../open-sse/utils/accounting-responses-usage.js';
import { RESPONSES_EXPLICIT_USAGE_PROFILE } from '../../open-sse/config/accountingProfiles.js';
import { projectBudget } from '../../src/lib/accounting/budget-projection.js';
let fixture;
afterEach(async()=>{vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} native retained terminal sink`,()=>{
  it('settles late once after disposal/revoke using original price and actual original-window projection',async()=>{
    for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(name,'');
    fixture=await openResponsesFixture(engine);let now='2026-10-25T16:59:00.000Z';
    const request=new Request('http://localhost/v1/responses',{headers:{authorization:'Bearer fixture-secret'}});
    associateChatAccountingFixture(request,fixture.db,{}, {clock:()=>now});
    const session=captureChatAccounting(request);session.authorizeTarget('fixture-node/fixture');
    const credentials=session.credentials(fixtureProvider,'fixture');
    const bound=session.bind({provider:fixtureProvider,model:'fixture',endpoint:'chat',connectionId:credentials.connectionId},credentials);
    const wire={targetUrl:`${credentials.providerSpecificData.baseUrl}/responses`,method:'POST',body:JSON.stringify({model:'fixture',input:'hello'}),
      headers:JSON.stringify([['authorization','Bearer provider-secret']])};
    const ticket=await bound.prepare(wire);ticket.assertDispatch(wire);
    await ticket.finish(null,'network_unknown',{kind:'absent',interrupted:true});session.dispose();
    now='2026-10-25T17:01:00.000Z';fixture.db.durableTransaction(()=>{
      fixture.db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-one'");
      fixture.db.run("UPDATE kv SET value=? WHERE scope='pricing'",[JSON.stringify({fixture:{input:'9',output:'9',cached:'9'}})]);
    });
    const usage=normalizeResponsesUsage(rawResponsesUsage(),RESPONSES_EXPLICIT_USAGE_PROFILE);
    await ticket.finish(usage,'late',{kind:'valid',interrupted:true});await ticket.finish(usage,'late',{kind:'valid',interrupted:true});
    expect(fixture.db.get('SELECT costNanoUsd,state,resolutionVersion FROM apiKeyAccounting')).toEqual({costNanoUsd:900000,state:'settled',resolutionVersion:2});
    const projection=projectBudget(fixture.db,'key-one',{weeklyLimitNanoUsd:1000000,monthlyLimitNanoUsd:1000000},now);
    expect(projection.weekly.spentUsd).toBe('0');expect(projection.previousWindows.weekly.spentUsd).toBe('0.0009');expect(projection.monthly.spentUsd).toBe('0.0009');
    await expect(ticket.finish(normalizeResponsesUsage(rawResponsesUsage(401),RESPONSES_EXPLICIT_USAGE_PROFILE),'conflict',{kind:'valid',interrupted:true})).rejects.toThrow();
    expect(fixture.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(900000);
  });
});
