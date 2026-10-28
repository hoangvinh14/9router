import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { openFixture, addKey, backupFixture, intent } from './test-database.js';
import { createPersistedRequestAuthority } from '../../../src/lib/accounting/persisted-request-authority.js';
import { insertAttemptSync } from '../../../src/lib/db/repos/api-key-accounting-repo.js';

const count = 100;
for (const engine of ['node', 'sqljs']) {
  let fixture, restore = () => {};
  try {
    const started = performance.now();
    fixture = await openFixture(engine); const { db, file } = fixture;
    addKey(db); backupFixture(db, file);
    db.durableTransaction(() => db.run('INSERT INTO providerConnections(id,provider,authType,data,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      ['connection-one', 'openai', 'apikey', '{"apiKey":"measurement-only"}', '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z']));
    backupFixture(db, file);
    const authority = createPersistedRequestAuthority(db);
    const input = { credential: 'fixture-secret', provider: 'openai', model: 'fixture', connectionId: 'connection-one' };
    const projectionBytes = db.withPersistedAccountingAuthority(reader => {
      const queries = ["SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
        ...Object.entries({apiKeys:'id',apiKeyBindings:'apiKeyId',apiKeyBudgetPolicies:'apiKeyId',providerConnections:'id',providerNodes:'id',proxyPools:'id',settings:'id',combos:'id'}).map(([table,key]) => `SELECT * FROM ${table} ORDER BY ${key}`),
        "SELECT * FROM kv WHERE scope IN ('modelAliases','customModels','disabledModels','pricing','referencePricing') ORDER BY scope,key",
        "SELECT * FROM _meta WHERE key IN ('schemaVersion','backupSchemaVersion','referencePricingRevision','accountingCoverageId','accountingBindingKeyId','accountingBindingsInitialized','accountingPoliciesInitialized','ledgerStartedAt') ORDER BY key"];
      return queries.reduce((size,sql) => size + Buffer.byteLength(JSON.stringify(reader.all(sql))) + 1, 0);
    });
    const setupMs = performance.now()-started;
    function measure(state) {
      const times=[];
      for(let i=0;i<count;i++) {
        const before=performance.now();
        if (!authority.prove(input).unlimited) throw new Error('Expected explicit unlimited fixture');
        times.push(performance.now()-before);
      }
      times.sort((a,b)=>a-b);
      console.log(JSON.stringify({engine,state,count,projectionBytes,setupMs,p50Ms:times[49],p95Ms:times[94],maxMs:times[99]}));
    }
    measure('healthy');
    let injected=false;
    if(engine==='node') {
      const exec=DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec=function(sql,...args) {
        if(!injected && sql.startsWith('RELEASE sp_0_')) { injected=true; throw new Error('measurement recording failure'); }
        return exec.call(this,sql,...args);
      };
      restore=()=>{DatabaseSync.prototype.exec=exec;};
    } else {
      const rename=fs.renameSync;
      fs.renameSync=(source,target)=>{
        if(!injected && target===file) {injected=true;throw new Error('measurement recording failure');}
        return rename(source,target);
      };
      restore=()=>{fs.renameSync=rename;};
    }
    try { insertAttemptSync(db,intent(db)); throw new Error('Expected recording failure'); }
    catch(error) { if(error.message!=='measurement recording failure') throw error; }
    restore(); restore=()=>{};
    if(!injected || db.health().healthy) throw new Error('Expected poisoned fixture');
    measure('recording-failed');
  } finally {
    restore();
    if(fixture) {
      // Fixture disposal only; production lifecycle refuses the poisoned close.
      fixture.db.beforeClose=undefined; fixture.db.close();
      fs.rmSync(fixture.root,{recursive:true,force:true});
    }
  }
}
