import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { openFixture, addKey } from '../fixtures/accounting/test-database.js';
import { resolveReferencePriceSync } from '../../src/lib/pricing/referenceResolver.js';
import { costFromExactUsageSnapshot } from '../../src/lib/accounting/exact-money.js';
import { insertAttemptSync, finalizeAttemptSync, getAttemptSync } from '../../src/lib/db/repos/api-key-accounting-repo.js';
import { projectBudget } from '../../src/lib/accounting/budget-projection.js';

let fixture;
afterEach(() => { if (fixture) { fixture.db.close(); fs.rmSync(fixture.root, { recursive:true, force:true }); fixture = null; } });
for (const engine of ['node', 'sqljs']) describe(`${engine} Responses token pricing compatibility gate`, () => {
  it('retains chat as a token-pricing identity through resolver, exact subsets, ledger, reopen and original-window reporting', async () => {
    fixture = await openFixture(engine); let { db } = fixture; addKey(db);
    const provider = 'openai-compatible-responses-pricing-fixture';
    db.durableTransaction(() => db.run("INSERT INTO kv(scope,key,value) VALUES('pricing',?,?)", [provider,
      JSON.stringify({ fixture:{ input:'1', output:'2', cached:'0.25', reasoning:'3' } })]));
    const price = resolveReferencePriceSync(db, provider, 'fixture', 'chat');
    expect(price.status).toBe('priced'); expect(price.snapshot.endpoint).toBe('chat');
    const usage = { exact:true, input:1000, output:100, cacheRead:400, cacheWrite:0,
      reasoning:20, reasoningIncludedInOutput:true, cacheWrite5m:0, cacheWrite1h:0 };
    // (600 * 1 + 400 * .25 + 80 * 2 + 20 * 3) USD/1M tokens = 920000 nanoUSD.
    expect(costFromExactUsageSnapshot(usage, price.snapshot)).toBe('920000');
    insertAttemptSync(db, { attemptId:'responses-token-price', requestId:'request', apiKeyId:'key-one',
      ownerInstanceId:db.ownerInstanceId, provider, model:'fixture', endpoint:'chat', connectionId:'fixture-connection',
      startedAt:'2026-10-25T16:59:00.000Z', priceSnapshot:price.snapshot });
    db.durableTransaction(() => db.run("UPDATE kv SET value='{}' WHERE scope='pricing' AND key=?", [provider]));
    finalizeAttemptSync(db, 'responses-token-price', { state:'settled', outcome:'http_200',
      finishedAt:'2026-10-25T17:01:00.000Z', usage });
    db.close(); fixture = await openFixture(engine, fixture.file); db = fixture.db;
    const row = getAttemptSync(db, 'responses-token-price');
    expect(row.endpoint).toBe('chat'); expect(row.priceSnapshot).toEqual(price.snapshot);
    expect(row.costNanoUsd).toBe('920000'); expect(row.usage).toEqual(usage);
    const projection = projectBudget(db, 'key-one', { weeklyLimitNanoUsd:1000000, monthlyLimitNanoUsd:1000000 }, '2026-10-25T17:02:00.000Z');
    expect(projection.weekly.spentUsd).toBe('0');
    expect(projection.previousWindows.weekly.spentUsd).toBe('0.00092');
    expect(projection.monthly.spentUsd).toBe('0.00092');
  });
});
