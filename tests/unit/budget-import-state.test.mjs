import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.BUDGET_DRIVER_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const aclModes=['acl-object','acl-columns','acl-both','acl-unrestricted','acl-deny-all','acl-invalid-object','acl-invalid-columns','acl-conflict'];
const identityModes=['custom-distinct','details-duplicate','details-missing-id','custom-duplicate','custom-collision','custom-missing-id'];
const commitModes=['bootstrap-release','import-release','empty-release'];
const entityModes=['providerConnections','providerNodes','proxyPools','apiKeys','combos'].flatMap(table=>['missing','duplicate'].map(kind=>'entity-'+table+'-'+kind));
const connectionModes=['connection-absent','connection-null','connection-falsey'];
const nodeModes=['node-absent','node-null','node-falsey'];
const poolModes=['pool-absent','pool-null','pool-empty','pool-known'];
const keyModes=['key-absent','key-null','key-empty'];
const mapModes=['map-valid','map-pricing-null','map-price-null','map-mitm-null','map-disabled-null','map-disabled-item'];
const usageModes=['usage-values-valid','usage-tokens-null','usage-tokens-array','usage-day-null','usage-day-array'];
const unsupportedModes=['unknown-main','unknown-usage','unknown-disabled','unknown-details','unknown-apiKey','unknown-combo','unknown-usageEntry','unknown-apiKey-provider','unknown-combo-provider','unknown-combo-key'];
const modes=[...unsupportedModes,...usageModes,...mapModes,...connectionModes,...nodeModes,...poolModes,...keyModes,...entityModes,...commitModes,...identityModes,...aclModes,'empty','import','all-entities','assert-retry','marker','marker-empty','old-untracked','empty-meta-data','bad-state','bootstrap-fault','completion-fault','changed-input',...['main','usage','disabled','details'].flatMap(name=>['json','shape','read'].map(kind=>name+'-'+kind))];
for(const mode of modes)test('existing migration import state '+mode,()=>{
 const dir='/tmp/import-state-'+mode;fs.mkdirSync(dir);
 const source=`
 import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
 import {createNodeSqliteAdapter} from '/app/src/lib/db/adapters/nodeSqliteAdapter.js';
 import {runMigrationOnce} from '/app/src/lib/db/migrate.js';
 import {DATA_FILE,ensureDirs,LEGACY_FILES,DB_DIR} from '/app/src/lib/db/paths.js';
 const mode=${JSON.stringify(mode)};const identityMode=${JSON.stringify(identityModes)}.includes(mode);const commitMode=${JSON.stringify(commitModes)}.includes(mode);const entityMode=/^entity-(.+)-(missing|duplicate)$/.exec(mode);const keyMode=mode.startsWith('key-');const poolMode=mode.startsWith('pool-');const nodeMode=mode.startsWith('node-');const connectionMode=mode.startsWith('connection-');const mapMode=mode.startsWith('map-');const usageMode=${JSON.stringify(usageModes)}.includes(mode);const unsupportedMode=${JSON.stringify(unsupportedModes)}.includes(mode);ensureDirs();let db=await createNodeSqliteAdapter(DATA_FILE);
 const state=()=>db.get('SELECT value FROM _meta WHERE key=?',['legacyImportState'])?.value??null;
 const write=(name,value)=>fs.writeFileSync(LEGACY_FILES[name],JSON.stringify(value));
 const sample=()=>write('main',{apiKeys:[{id:'original',key:'private-original',name:'retained'}]});
 const reopen=async()=>{db.close();db=await createNodeSqliteAdapter(DATA_FILE);};
 try{
 if(['import','assert-retry','marker','completion-fault','changed-input','import-release'].includes(mode))sample();
 if(mode==='all-entities'){
  write('main',{settings:{retained:true},providerConnections:[{id:'pc',provider:'fixture'}],providerNodes:[{id:'pn'}],proxyPools:[{id:'pp'}],apiKeys:[{id:'ak',key:'private-all'}],combos:[{id:'combo',name:'fixture',models:[]}],customModels:[{id:'model',providerAlias:'fixture'}],modelAliases:{alias:'fixture/model'},mitmAlias:{tool:{name:'model'}},pricing:{fixture:{model:{input:1}}}});
  write('usage',{history:[{timestamp:'2026-11-16',tokens:{input_tokens:1}}],dailySummary:{'2026-11-16':{count:1}},totalRequestsLifetime:1});
  write('disabled',{disabled:{fixture:['model']}});write('details',{records:[{id:'detail',timestamp:'2026-11-16'}]});
 }
 let unsupportedFile,unsupportedBytes;
 if(unsupportedMode){
  const [section,explicitField]=mode.slice('unknown-'.length).split('-');const privateField=explicitField??'private-field-do-not-log';
  const value={privateValue:'retained-original'};
  let data;
  if(['main','usage','disabled','details'].includes(section)){unsupportedFile=section;data={[privateField]:value};}
  else if(section==='apiKey'){unsupportedFile='main';data={apiKeys:[{id:'retained',key:'private-original',[privateField]:value}]};}
  else if(section==='combo'){unsupportedFile='main';data={combos:[{id:'retained',name:'retained',models:[],[privateField]:value}]};}
  else{unsupportedFile='usage';data={history:[{timestamp:'2026-11-16',tokens:{},[privateField]:value}]};}
  write(unsupportedFile,data);unsupportedBytes=fs.readFileSync(LEGACY_FILES[unsupportedFile],'utf8');
 }
 const usageInput=()=>write('usage',{history:[{timestamp:'2026-11-16T00:00:00.000Z',provider:'fixture',model:'model',cost:0,status:'ok',
  tokens:{input_tokens:0,output_tokens:2,extension:{flag:false,nil:null,list:[0,'',{}]}}}],
  dailySummary:{'2026-11-16':{requests:1,cost:0,byModel:{model:{requests:1,cost:0}},extension:{flag:false,list:[]}}},totalRequestsLifetime:1});
 if(usageMode){
  usageInput();
  if(mode==='usage-tokens-null')write('usage',{history:[{tokens:null}]});
  if(mode==='usage-tokens-array')write('usage',{history:[{tokens:[]}]});
  if(mode==='usage-day-null')write('usage',{dailySummary:{'2026-11-16':null}});
  if(mode==='usage-day-array')write('usage',{dailySummary:{'2026-11-16':[]}});
 }
 const mapInput=()=>{
  write('main',{pricing:{fixture:{model:{input:0,output:2,cached:0,extension:{flag:false,items:[0,null,'']}}}},mitmAlias:{tool:{model:'fixture/model',nested:{flag:false,list:[]}}}});
  write('disabled',{disabled:{fixture:['model','other']}});
 };
 if(mapMode){
  mapInput();
  if(mode==='map-pricing-null')write('main',{pricing:{fixture:null}});
  if(mode==='map-price-null')write('main',{pricing:{fixture:{model:null}}});
  if(mode==='map-mitm-null')write('main',{mitmAlias:{tool:null}});
  if(mode==='map-disabled-null')write('disabled',{disabled:{fixture:null}});
  if(mode==='map-disabled-item')write('disabled',{disabled:{fixture:['model',false]}});
 }
 if(connectionMode){
  const fields=mode==='connection-absent'?{}:mode==='connection-null'?{name:null,email:null,priority:null}:{name:'',email:'',priority:0};
  write('main',{providerConnections:[{id:'retained-connection',provider:'fixture',authType:'apikey',isActive:false,...fields,
   providerSpecificData:{zero:0,no:false,empty:'',nil:null,array:[0,false,'',null,{deep:[]}]},customFuture:{children:[{},[]]},
   createdAt:'2026-11-16T00:00:00.000Z',updatedAt:'2026-11-16T00:00:00.000Z'}]});
 }
 if(nodeMode){
  const fields=mode==='node-absent'?{}:mode==='node-null'?{type:null,name:null}:{type:'',name:''};
  write('main',{providerNodes:[{id:'retained-node',...fields,baseUrl:'https://fixture.invalid',extension:{zero:0,flag:false,nil:null,list:[0,'',{}]},createdAt:'2026-11-16T00:00:00.000Z',updatedAt:'2026-11-16T00:00:00.000Z'}]});
 }
 if(poolMode){
  const fields=mode==='pool-absent'?{}:{testStatus:mode==='pool-null'?null:mode==='pool-empty'?'':'ok'};
  write('main',{proxyPools:[{id:'retained-pool',isActive:false,...fields,proxyUrl:'http://fixture.invalid:1234',strictProxy:true,noProxy:'',extension:{zero:0,flag:false,nil:null,list:[0,'',{}]},createdAt:'2026-11-16T00:00:00.000Z',updatedAt:'2026-11-16T00:00:00.000Z'}]});
 }
 if(keyMode){
  const fields=mode==='key-absent'?{}:mode==='key-null'?{name:null,machineId:null}:{name:'',machineId:''};
  write('main',{apiKeys:[{id:'retained-key',key:'private-key-roundtrip',...fields,isActive:false,access:{restricted:true,allow:['fixture/model']},createdAt:'2026-11-16T00:00:00.000Z'}]});
 }
 const entityRow=i=>{
  const base={id:'entity-'+i,name:'name-'+i};
  if(entityMode[1]==='apiKeys')return {...base,key:'private-'+i};
  if(entityMode[1]==='combos')return {...base,models:['fixture/model-'+i]};
  return {...base,provider:'fixture',key:'private-'+i};
 };
 if(entityMode){
  const row=entityRow;
  const rows=entityMode[2]==='duplicate'?[row(1),{...row(2),id:'entity-1'}]:[row(1)];
  if(entityMode[2]==='missing')delete rows[0].id;
  write('main',{[entityMode[1]]:rows});
 }
 if(mode.startsWith('acl-')){
  const access={restricted:true,allow:[' combo/team ','P/Model','p/model']};
  const columns={accessRestricted:1,accessAllow:JSON.stringify(['combo/team','P/Model'])};
  const acl=mode==='acl-object'?{access}:mode==='acl-columns'?columns:mode==='acl-both'?{access,...columns}:
   mode==='acl-unrestricted'?{access:{restricted:false,allow:[]}}:mode==='acl-deny-all'?{access:{restricted:true,allow:[]}}:
   mode==='acl-invalid-object'?{access:{restricted:'yes',allow:['P/Model']}}:
   mode==='acl-invalid-columns'?{accessRestricted:1,accessAllow:'not JSON'}:{access,...columns,accessRestricted:0};
  write('main',{apiKeys:[{id:'acl',key:'private-acl',...acl}]});
 }
 if(mode.startsWith('details-')&&identityMode){
  write('details',{records:mode==='details-duplicate'?[{id:'same',data:'first'},{id:'same',data:'second'}]:[{timestamp:'missing'}]});
 }
 if(mode.startsWith('custom-')){
  const models=mode==='custom-distinct'?[{providerAlias:'p',id:'one',type:null},{providerAlias:'p',id:'two',type:''}]:mode==='custom-duplicate'?[{providerAlias:'p',id:'same'},{providerAlias:'p',id:'same',type:'llm'}]:
   mode==='custom-collision'?[{providerAlias:'p|q',id:'r'},{providerAlias:'p',id:'q|r'}]:[{providerAlias:'p'}];
  write('main',{customModels:models});
 }
 if(mode==='assert-retry')write('main',{apiKeys:[{id:'original',key:'private-original'},{id:'duplicate',key:'private-original'}]});
 if(mode==='marker'||mode==='marker-empty')fs.writeFileSync(path.join(DB_DIR,'.migrated-from-json'),'existing');
 if(['old-untracked','empty-meta-data','bad-state'].includes(mode)){
  await runMigrationOnce(db);db.run('DELETE FROM _meta WHERE key=?',['legacyImportState']);
  if(mode==='empty-meta-data')db.run('DELETE FROM _meta');
  if(mode==='bad-state')db.run('INSERT INTO _meta VALUES(?,?)',['legacyImportState','unknown-v99']);
  db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',['keep','private-keep','2026-11-16']);
  if(mode!=='bad-state')fs.writeFileSync(LEGACY_FILES.main,'not JSON ignored old file');
  await reopen();
 }
 const faultMode=/^(main|usage|disabled|details)-(json|shape|read)$/.exec(mode);
 if(faultMode){
  if(faultMode[2]==='json')fs.writeFileSync(LEGACY_FILES[faultMode[1]],'{');
  if(faultMode[2]==='shape')write(faultMode[1],null);
  if(faultMode[2]==='read')fs.mkdirSync(LEGACY_FILES[faultMode[1]]);
 }
 const actualRun=db.run;let injected=false;
 const actualRawExec=db.raw.exec;
 if(commitMode)db.raw.exec=function(sql){
  const result=actualRawExec.call(this,sql);
  // Actual native RELEASE has executed. Throw only after the selected state is
  // visible outside the outermost transaction, never on a nested savepoint.
  if(!injected&&sql.startsWith('RELEASE ')&&!db.raw.isTransaction){
   const target=mode==='bootstrap-release'?'pending-v1':mode==='import-release'?'imported-v1':'no-input-v1';
   if(state()===target){injected=true;throw new Error('fixture lost RELEASE result');}
  }
  return result;
 };
 if(mode==='bootstrap-fault'||mode==='completion-fault')db.run=(sql,params)=>{
  if(!injected&&sql.startsWith('INSERT INTO _meta')&&params?.[0]==='legacyImportState'&&params[1]===(mode==='bootstrap-fault'?'pending-v1':'imported-v1')){injected=true;throw new Error('fixture completion unavailable');}
  return actualRun(sql,params);
 };
 const originalRun=db.run;
 if(mode==='changed-input')db.run=(sql,params)=>{
  const result=originalRun(sql,params);
  if(sql.startsWith('INSERT OR REPLACE INTO apiKeys'))write('main',{apiKeys:[{id:'changed',key:'private-changed'}]});
  return result;
 };
 const badAcl=['acl-invalid-object','acl-invalid-columns','acl-conflict'].includes(mode);
 const fail=unsupportedMode||(usageMode&&mode!=='usage-values-valid')||(mapMode&&mode!=='map-valid')||Boolean(entityMode)||commitMode||(identityMode&&mode!=='custom-distinct')||badAcl||Boolean(faultMode)||['assert-retry','marker','bad-state','bootstrap-fault','completion-fault','changed-input'].includes(mode);
 if(unsupportedMode)await assert.rejects(runMigrationOnce(db),error=>{
  assert.equal(error.code,'legacy_import_unavailable');assert.equal(error.legacySection,mode.slice('unknown-'.length).split('-')[0]);
  assert.equal(JSON.stringify({message:error.message,...error}).includes('private-field'),false);
  assert.equal(JSON.stringify({message:error.message,...error}).includes('private-original'),false);
  assert.equal(JSON.stringify({message:error.message,...error}).includes('retained-original'),false);
  return true;
 });else if(fail)await assert.rejects(runMigrationOnce(db));else await runMigrationOnce(db);
 db.run=actualRun;db.raw.exec=actualRawExec;
 if(commitMode){
  assert.equal(injected,true);assert.equal(db.raw.isTransaction,false);
  assert.equal(state(),mode==='bootstrap-release'?'pending-v1':mode==='import-release'?'imported-v1':'no-input-v1');
  if(mode==='import-release'){
   assert.equal(db.get('SELECT key FROM apiKeys WHERE id=?',['original']).key,'private-original');
   assert.equal(fs.existsSync(path.join(DB_DIR,'.migrated-from-json')),false);
  }
  // Re-entry is ordinary startup recovery, NOT a durable accounting ACK or
  // producer right. Detect any destructive replay of the known committed rows.
  db.run=(sql,params)=>{if(mode!=='bootstrap-release'&&sql.startsWith('INSERT OR REPLACE'))assert.fail('committed import replay');return actualRun(sql,params);};
  await runMigrationOnce(db);db.run=actualRun;
  assert.equal(state(),mode==='bootstrap-release'?'no-input-v1':mode==='import-release'?'imported-v1':'no-input-v1');
  if(mode==='import-release')assert.equal(db.get('SELECT COUNT(*) AS n FROM apiKeys').n,1);
 }else if(mode==='bootstrap-fault'){
  assert.equal(injected,true);assert.equal(db.get("SELECT name FROM sqlite_schema WHERE name='_meta'"),undefined);
  await runMigrationOnce(db);assert.equal(state(),'no-input-v1');
 }else if(mode==='bad-state'){
  assert.equal(state(),'unknown-v99');assert.equal(db.get('SELECT COUNT(*) AS n FROM apiKeys').n,1);
 }else if(fail){
  assert.equal(state(),'pending-v1');assert.equal(db.get('SELECT COUNT(*) AS n FROM apiKeys').n,0);
  if(mode==='completion-fault')assert.equal(injected,true);
  if(faultMode?.[2]==='read')fs.rmdirSync(LEGACY_FILES[faultMode[1]]);
  if(faultMode)write(faultMode[1],{});
  if(unsupportedMode){
   assert.equal(fs.readFileSync(LEGACY_FILES[unsupportedFile],'utf8'),unsupportedBytes);
   assert.equal(fs.existsSync(path.join(DB_DIR,'.migrated-from-json')),false);
   for(const table of ['providerConnections','combos','usageHistory','usageDaily','requestDetails','kv'])assert.equal(db.get('SELECT COUNT(*) AS n FROM '+table).n,0);
   write(unsupportedFile,{});sample();
  }
  if(usageMode){
   assert.equal(db.get('SELECT COUNT(*) AS n FROM usageHistory').n,0);
   assert.equal(db.get('SELECT COUNT(*) AS n FROM usageDaily').n,0);usageInput();
  }
  if(mapMode){assert.equal(db.get('SELECT COUNT(*) AS n FROM kv').n,0);mapInput();}
  if(entityMode){
   assert.equal(db.get('SELECT COUNT(*) AS n FROM '+entityMode[1]).n,0);
   write('main',{[entityMode[1]]:[1,2].map(entityRow)});
  }
  if(identityMode){
   assert.equal(db.get('SELECT COUNT(*) AS n FROM requestDetails').n,0);
   assert.equal(db.get('SELECT COUNT(*) AS n FROM kv').n,0);
   if(mode.startsWith('details-'))write('details',{records:[{id:'one',tag:'first'},{id:'two',tag:'second'}]});
   else write('main',{customModels:[{providerAlias:'p',id:'one'},{providerAlias:'p',id:'two'}]});
  }
  if(badAcl)write('main',{apiKeys:[{id:'acl',key:'private-acl',access:{restricted:true,allow:['P/Model']}}]});
  if(mode==='marker')fs.unlinkSync(path.join(DB_DIR,'.migrated-from-json'));
  if(['assert-retry','changed-input'].includes(mode))sample();
  await reopen();await runMigrationOnce(db);assert.equal(state(),'imported-v1');
  if(unsupportedMode)assert.equal(db.get('SELECT key FROM apiKeys WHERE id=?',['original']).key,'private-original');
  if(entityMode){
   assert.deepEqual(db.all('SELECT id FROM '+entityMode[1]+' ORDER BY id').map(row=>row.id),['entity-1','entity-2']);
   if(entityMode[1]==='apiKeys')assert.deepEqual(db.all('SELECT key FROM apiKeys ORDER BY id').map(row=>row.key),['private-1','private-2']);
   if(entityMode[1]==='combos')assert.deepEqual(db.all('SELECT models FROM combos ORDER BY id').map(row=>JSON.parse(row.models)),[['fixture/model-1'],['fixture/model-2']]);
  }
  if(identityMode){
   if(mode.startsWith('details-'))assert.deepEqual(db.all('SELECT id,data FROM requestDetails ORDER BY id').map(row=>JSON.parse(row.data)),[{id:'one',tag:'first'},{id:'two',tag:'second'}]);
   else assert.deepEqual(db.all("SELECT key FROM kv WHERE scope='customModels' ORDER BY key").map(row=>row.key),['p|one|llm','p|two|llm']);
  }
  if(badAcl){const row=db.get('SELECT accessRestricted,accessAllow FROM apiKeys WHERE id=?',['acl']);assert.equal(row.accessRestricted,1);assert.deepEqual(JSON.parse(row.accessAllow),['P/Model']);}
 }else if(['old-untracked','empty-meta-data'].includes(mode)){
  assert.equal(state(),null);assert.equal(db.get('SELECT key FROM apiKeys WHERE id=?',['keep']).key,'private-keep');
 }else{
  assert.equal(state(),['import','all-entities','custom-distinct'].includes(mode)||connectionMode||nodeMode||poolMode||keyMode||mapMode||usageMode||mode.startsWith('acl-')?'imported-v1':'no-input-v1');
  if(connectionMode){
   globalThis.__connectionImportDb=db;
   const {getProviderConnectionById,updateProviderConnection}=await import('/app/src/lib/db/repos/connectionsRepo.js');
   const expected={id:'retained-connection',provider:'fixture',authType:'apikey',isActive:false,
    name:mode==='connection-falsey'?'':null,email:mode==='connection-falsey'?'':null,priority:mode==='connection-falsey'?0:null,
    providerSpecificData:{zero:0,no:false,empty:'',nil:null,array:[0,false,'',null,{deep:[]}]},customFuture:{children:[{},[]]},
    createdAt:'2026-11-16T00:00:00.000Z',updatedAt:'2026-11-16T00:00:00.000Z'};
   assert.deepEqual(await getProviderConnectionById('retained-connection'),expected);
   await updateProviderConnection('retained-connection',{lastError:'fixture retained error'});
   await reopen();globalThis.__connectionImportDb=db;
   const observed=await getProviderConnectionById('retained-connection');
   assert.equal(typeof observed.updatedAt,'string');
   assert.deepEqual({...observed,updatedAt:expected.updatedAt},{...expected,lastError:'fixture retained error'});
   delete globalThis.__connectionImportDb;
  }
  if(mode==='custom-distinct')assert.deepEqual(db.all("SELECT key FROM kv WHERE scope='customModels' ORDER BY key").map(row=>row.key),['p|one|llm','p|two|llm']);
  if(mode.startsWith('acl-')){
   const row=db.get('SELECT accessRestricted,accessAllow FROM apiKeys WHERE id=?',['acl']);
   assert.equal(row.accessRestricted,mode==='acl-unrestricted'?0:1);
   assert.deepEqual(JSON.parse(row.accessAllow),['acl-unrestricted','acl-deny-all'].includes(mode)?[]:['combo/team','P/Model']);
  }
  if(mode==='all-entities'){
   for(const table of ['settings','providerConnections','providerNodes','proxyPools','apiKeys','combos','usageHistory','usageDaily','requestDetails'])assert.equal(db.get('SELECT COUNT(*) AS n FROM '+table).n,1);
   for(const scope of ['modelAliases','customModels','mitmAlias','pricing','disabledModels'])assert.equal(db.get('SELECT COUNT(*) AS n FROM kv WHERE scope=?',[scope]).n,1);
   assert.equal(db.get('SELECT value FROM _meta WHERE key=?',['totalRequestsLifetime']).value,'1');
  }
 }
 if(keyMode){
  globalThis.__keyImportDb=db;
  const {getApiKeyById,getApiKeyByKey,updateApiKey}=await import('/app/src/lib/db/repos/apiKeysRepo.js');
  const expected={id:'retained-key',key:'private-key-roundtrip',name:mode==='key-empty'?'':null,machineId:mode==='key-empty'?'':null,isActive:false,access:{restricted:true,allow:['fixture/model']},createdAt:'2026-11-16T00:00:00.000Z'};
  assert.deepEqual(await getApiKeyById('retained-key'),expected);
  assert.deepEqual(await getApiKeyByKey('private-key-roundtrip'),expected);
  assert.deepEqual(await updateApiKey('retained-key',{isActive:true}),{...expected,isActive:true});
  await reopen();globalThis.__keyImportDb=db;
  assert.deepEqual(await getApiKeyById('retained-key'),{...expected,isActive:true});
  assert.deepEqual(await getApiKeyByKey('private-key-roundtrip'),{...expected,isActive:true});
  delete globalThis.__keyImportDb;
 }
 if(poolMode){
  globalThis.__poolImportDb=db;
  const {getProxyPoolById,updateProxyPool}=await import('/app/src/lib/db/repos/proxyPoolsRepo.js');
  const expected={id:'retained-pool',isActive:false,testStatus:mode==='pool-absent'?'unknown':mode==='pool-null'?null:mode==='pool-empty'?'':'ok',proxyUrl:'http://fixture.invalid:1234',strictProxy:true,noProxy:'',extension:{zero:0,flag:false,nil:null,list:[0,'',{}]},createdAt:'2026-11-16T00:00:00.000Z',updatedAt:'2026-11-16T00:00:00.000Z'};
  assert.deepEqual(await getProxyPoolById('retained-pool'),expected);
  await updateProxyPool('retained-pool',{lastError:'retained-fixture-error'});
  await reopen();globalThis.__poolImportDb=db;
  const observed=await getProxyPoolById('retained-pool');assert.equal(typeof observed.updatedAt,'string');
  assert.deepEqual({...observed,updatedAt:expected.updatedAt},{...expected,lastError:'retained-fixture-error'});
  delete globalThis.__poolImportDb;
 }
 if(nodeMode){
  globalThis.__nodeImportDb=db;
  const {getProviderNodeById,updateProviderNode}=await import('/app/src/lib/db/repos/nodesRepo.js');
  const expected={id:'retained-node',type:mode==='node-falsey'?'':null,name:mode==='node-falsey'?'':null,baseUrl:'https://fixture.invalid',extension:{zero:0,flag:false,nil:null,list:[0,'',{}]},createdAt:'2026-11-16T00:00:00.000Z',updatedAt:'2026-11-16T00:00:00.000Z'};
  assert.deepEqual(await getProviderNodeById('retained-node'),expected);
  await updateProviderNode('retained-node',{baseUrl:'https://changed.invalid'});
  await reopen();globalThis.__nodeImportDb=db;
  const observed=await getProviderNodeById('retained-node');assert.equal(typeof observed.updatedAt,'string');
  assert.deepEqual({...observed,updatedAt:expected.updatedAt},{...expected,baseUrl:'https://changed.invalid'});
  delete globalThis.__nodeImportDb;
 }
 if(usageMode){
  globalThis.__mapImportDb=db;
  const {getUsageHistory}=await import('/app/src/lib/db/repos/usageRepo.js');
  const expected=[{timestamp:'2026-11-16T00:00:00.000Z',provider:'fixture',model:'model',connectionId:null,apiKeyMasked:null,endpoint:null,
   cost:0,status:'ok',tokens:{input_tokens:0,output_tokens:2,extension:{flag:false,nil:null,list:[0,'',{}]}}}];
  assert.deepEqual(await getUsageHistory(),expected);
  await reopen();globalThis.__mapImportDb=db;assert.deepEqual(await getUsageHistory(),expected);
  assert.deepEqual(JSON.parse(db.get('SELECT data FROM usageDaily').data),{requests:1,cost:0,byModel:{model:{requests:1,cost:0}},extension:{flag:false,list:[]}});
  assert.equal(db.get('SELECT value FROM _meta WHERE key=?',['totalRequestsLifetime']).value,'1');
  delete globalThis.__mapImportDb;
 }
 if(mapMode){
  globalThis.__mapImportDb=db;
  const {getMitmAlias,setMitmAliasAll}=await import('/app/src/lib/db/repos/aliasRepo.js');
  const {getPricingForModel,updatePricing}=await import('/app/src/lib/db/repos/pricingRepo.js');
  const {getDisabledByProvider,disableModels}=await import('/app/src/lib/db/repos/disabledModelsRepo.js');
  const price={input:0,output:2,cached:0,extension:{flag:false,items:[0,null,'']}};
  const mappings={model:'fixture/model',nested:{flag:false,list:[]}};
  assert.deepEqual(await getPricingForModel('fixture','model'),price);
  assert.deepEqual(await getMitmAlias('tool'),mappings);
  assert.deepEqual(await getDisabledByProvider('fixture'),['model','other']);
  await updatePricing({fixture:{second:{input:0,output:0}}});
  await setMitmAliasAll('tool',mappings);await disableModels('fixture',['third']);
  await reopen();globalThis.__mapImportDb=db;
  assert.deepEqual(await getPricingForModel('fixture','model'),price);
  assert.deepEqual(await getPricingForModel('fixture','second'),{input:0,output:0});
  assert.deepEqual(await getMitmAlias('tool'),mappings);
  assert.deepEqual(await getDisabledByProvider('fixture'),['model','other','third']);
  delete globalThis.__mapImportDb;
 }
 if(!['bad-state','old-untracked','empty-meta-data'].includes(mode)){
  const before=db.get('SELECT COUNT(*) AS n FROM apiKeys').n;
  write('main',{apiKeys:[{id:'later',key:'must-not-reimport'}]});
  await reopen();await runMigrationOnce(db);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM apiKeys').n,before);
  assert.equal(db.get('SELECT id FROM apiKeys WHERE id=?',['later']),undefined);
 }
 assert.equal(db.raw.isTransaction,false);
 }finally{db.close();}
 `;
 const result=spawnSync('/runtime/node',['--unhandled-rejections=strict','--experimental-loader',(mode.startsWith('map-')||usageModes.includes(mode))?'/app/tests/fixtures/budget/map-import-loader.mjs':keyModes.includes(mode)?'/app/tests/fixtures/budget/key-import-loader.mjs':mode.startsWith('pool-')?'/app/tests/fixtures/budget/pool-import-loader.mjs':mode.startsWith('node-')?'/app/tests/fixtures/budget/node-import-loader.mjs':mode.startsWith('connection-')?'/app/tests/fixtures/budget/connection-import-loader.mjs':'/app/tests/fixtures/budget/alias-loader.mjs','--input-type=module','--eval',source],{env:{...process.env,DATA_DIR:dir},encoding:'utf8',timeout:10000});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stdout+result.stderr);
});
