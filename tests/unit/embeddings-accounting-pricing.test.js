import fs from 'node:fs';
import {afterEach,describe,expect,it} from 'vitest';
import {openFixture,addKey} from '../fixtures/accounting/test-database.js';
import {resolveReferencePriceSync} from '../../src/lib/pricing/referenceResolver.js';
import {costFromExactUsageSnapshot} from '../../src/lib/accounting/exact-money.js';
import {insertAttemptSync,finalizeAttemptSync,getAttemptSync} from '../../src/lib/db/repos/api-key-accounting-repo.js';
import {projectBudget} from '../../src/lib/accounting/budget-projection.js';
import {assertEmbeddingsPrice,normalizeEmbeddingsUsage} from '../../open-sse/utils/accounting-embeddings-usage.js';
let fixture;
afterEach(()=>{if(fixture){fixture.db.close();fs.rmSync(fixture.root,{recursive:true,force:true});fixture=null;}});
for(const engine of ['node','sqljs']) describe(`${engine} E1 independent price oracle`,()=>{
  it('resolver input1/output0 -> 1000 tokens -> 1000000 nanoUSD -> ledger/reopen/original week and month',async()=>{
    fixture=await openFixture(engine);let {db}=fixture;addKey(db);const provider='openai-compatible-embeddings-price-fixture';
    db.durableTransaction(()=>db.run("INSERT INTO kv(scope,key,value) VALUES('pricing',?,?)",[provider,JSON.stringify({fixture:{input:'1'}})]));
    const price=resolveReferencePriceSync(db,provider,'fixture','embeddings');assertEmbeddingsPrice(price);
    expect(price.snapshot.endpoint).toBe('embeddings');expect(price.snapshot.rates).toEqual({input:'1',output:'0'});
    const usage=normalizeEmbeddingsUsage({prompt_tokens:1000,total_tokens:1000});
    expect(costFromExactUsageSnapshot(usage,price.snapshot)).toBe('1000000');
    expect(costFromExactUsageSnapshot(normalizeEmbeddingsUsage({prompt_tokens:2000,total_tokens:2000}),price.snapshot)).toBe('2000000');
    insertAttemptSync(db,{attemptId:'e1-price',requestId:'request',apiKeyId:'key-one',ownerInstanceId:db.ownerInstanceId,provider,model:'fixture',endpoint:'embeddings',connectionId:'fixture-connection',startedAt:'2026-10-25T16:59:00.000Z',priceSnapshot:price.snapshot});
    db.durableTransaction(()=>db.run("UPDATE kv SET value='{}' WHERE scope='pricing' AND key=?",[provider]));
    finalizeAttemptSync(db,'e1-price',{state:'settled',outcome:'http_503',finishedAt:'2026-11-01T17:01:00.000Z',usage});
    db.close();fixture=await openFixture(engine,fixture.file);db=fixture.db;
    const row=getAttemptSync(db,'e1-price');expect(row.costNanoUsd).toBe('1000000');expect(row.priceSnapshot).toEqual(price.snapshot);expect(row.endpoint).toBe('embeddings');
    const policy={weeklyLimitNanoUsd:2000000,monthlyLimitNanoUsd:2000000};
    const week=projectBudget(db,'key-one',policy,'2026-10-25T17:02:00.000Z');expect(week.weekly.spentUsd).toBe('0');expect(week.previousWindows.weekly.spentUsd).toBe('0.001');expect(week.monthly.spentUsd).toBe('0.001');
    const month=projectBudget(db,'key-one',policy,'2026-10-31T17:02:00.000Z');expect(month.monthly.spentUsd).toBe('0');expect(month.previousWindows.monthly.spentUsd).toBe('0.001');
  });
});
