import {afterEach,describe,it,expect,vi} from 'vitest';
import {openEmbeddingsFixture,fixtureProvider} from '../fixtures/accounting/embeddings-loopback.js';
import {associateEmbeddingsAccountingFixture,captureEmbeddingsAccounting} from '../../src/sse/services/embeddings-accounting.js';
import {normalizeEmbeddingsUsage} from '../../open-sse/utils/accounting-embeddings-usage.js';
import {projectBudget} from '../../src/lib/accounting/budget-projection.js';
let fixture;
afterEach(async()=>{vi.unstubAllEnvs();if(fixture){await fixture.close();fixture=null;}});
for(const engine of ['node','sqljs'])describe(`${engine} retained E1 terminal capability`,()=>{
  it('late exact sink survives disposal/revoke/rate change, idempotent original-window charge and conflict safety',async()=>{
    for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])vi.stubEnv(name,'');
    fixture=await openEmbeddingsFixture(engine);let now='2026-10-25T16:59:00.000Z';
    const request=new Request('http://localhost/v1/embeddings',{headers:{authorization:'Bearer fixture-secret'}});
    associateEmbeddingsAccountingFixture(request,fixture.db,{}, {clock:()=>now});const session=captureEmbeddingsAccounting(request);
    session.authorizeTarget('fixture-node/fixture',{model:'fixture-node/fixture',input:'hello'});const credentials=session.credentials(fixtureProvider,'fixture');
    const bound=session.bind({provider:fixtureProvider,model:'fixture',endpoint:'embeddings',connectionId:credentials.connectionId},credentials);
    const targetUrl=`${credentials.providerSpecificData.baseUrl}/embeddings`;
    const wire={targetUrl,url:targetUrl,route:{kind:'direct',proxyUrl:null,insecure:false},method:'POST',body:JSON.stringify({model:'fixture',input:'hello',encoding_format:'float'}),headers:JSON.stringify([['authorization','Bearer provider-secret']])};
    const ticket=await bound.prepare(wire);ticket.assertDispatch(wire);await ticket.finish(null,'network_unknown',{kind:'absent',interrupted:true});session.dispose();
    now='2026-10-25T17:01:00.000Z';fixture.db.durableTransaction(()=>{
      fixture.db.run("UPDATE apiKeys SET isActive=0 WHERE id='key-one'");fixture.db.run("UPDATE kv SET value=? WHERE scope='pricing'",[JSON.stringify({fixture:{input:'9',output:'0'}})]);
    });
    const usage=normalizeEmbeddingsUsage({prompt_tokens:1000,total_tokens:1000});await ticket.finish(usage,'late',{kind:'valid',interrupted:true});await ticket.finish(usage,'late',{kind:'valid',interrupted:true});
    expect(fixture.db.get('SELECT costNanoUsd,state,resolutionVersion FROM apiKeyAccounting')).toEqual({costNanoUsd:1000000,state:'settled',resolutionVersion:2});
    const policy={weeklyLimitNanoUsd:2000000,monthlyLimitNanoUsd:2000000};const projection=projectBudget(fixture.db,'key-one',policy,now);
    expect(projection.weekly.spentUsd).toBe('0');expect(projection.previousWindows.weekly.spentUsd).toBe('0.001');expect(projection.monthly.spentUsd).toBe('0.001');
    now='2026-10-31T17:01:00.000Z';expect(projectBudget(fixture.db,'key-one',policy,now).previousWindows.monthly.spentUsd).toBe('0.001');
    await expect(ticket.finish(normalizeEmbeddingsUsage({prompt_tokens:1001,total_tokens:1001}),'conflict',{kind:'valid',interrupted:true})).rejects.toThrow();
    expect(fixture.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(1000000);
    expect(()=>ticket.assertDispatch(wire)).toThrow();expect(fixture.posts).toBe(0); // capability-only, not a socket coverage claim
  });
});
