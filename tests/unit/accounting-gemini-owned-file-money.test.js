import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { costFromExactUsageSnapshot } from '@/lib/pricing/money.js';
import { attemptRecoveryDraft } from '@/shared/utils/budgetManagementDraft.js';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { insertAttemptSync, finalizeAttemptSync, resolveAttemptSync, getAttemptSync } from '@/lib/db/repos/apiKeyAccountingRepo.js';
import { recoveryReceiptSync } from '@/lib/apiKeyBudget/recoveryReceipt.js';
const marker='observed_gemini_owned_file_input_modalities';
const usage=()=>({exact:true,input:100,cacheRead:40,cacheWrite:0,output:20,reasoning:10,reasoningIncludedInOutput:false,inputModalities:{TEXT:{input:20,cacheRead:10},IMAGE:{input:50,cacheRead:20},AUDIO:{input:30,cacheRead:10}},provenance:{schema:'gemini',endpoint:'chat',inputIncludesCache:true,inputModalities:marker}});
const snapshot=()=>({rates:{input:'1',cached:'0.1',output:'2',input_image:'3',cached_image:'0.2',input_audio:'7',cached_audio:'0.4',input_video:'11',cached_video:'0.5'},rateUnits:Object.fromEntries(['input','cached','input_image','cached_image','input_audio','cached_audio','input_video','cached_video'].map(k=>[k,'USD/1M tokens'])),usageSemantics:{inputModalities:marker,allowedInputModalities:['TEXT','VIDEO','IMAGE','AUDIO']}});
const operation=(value=usage())=>({action:'exact_usage',operationId:'owned-file-recovery',actor:'fixture-admin',reason:'observed counters',evidence:'bounded terminal observation',expectedVersion:1,usage:value});
describe('owned-file immutable reference money/recovery, seeded monetary evidence not POST admission',()=>{
  it('prices observed categories plus separate thoughts once, without resource metadata or initial-input double charge',()=>{
    //10*1+10*.1 +30*3+20*.2 +20*7+10*.4 +30*2 =309000 nanoUSD.
    expect(costFromExactUsageSnapshot(usage(),snapshot())).toBe('309000');
    const u=usage();Object.assign(u,{input:2,cacheRead:0,output:1,reasoning:0});u.inputModalities={TEXT:{input:1,cacheRead:0},IMAGE:{input:1,cacheRead:0}};const s=snapshot();for(const k of Object.keys(s.rates))s.rates[k]=k.startsWith('cached')?'0':'0.0002';expect(costFromExactUsageSnapshot(u,s)).toBe('1');
  });
  it('requires original marker and all allowed rate/unit categories even zero/unobserved, without inline provenance laundering',()=>{
    expect(costFromExactUsageSnapshot(usage(),snapshot())).toBe('309000');
    for(const change of [s=>{delete s.rates.input_video;},s=>{delete s.rates.cached_audio;},s=>{s.rateUnits.input_image='USD/1000 uses';},s=>{delete s.usageSemantics;},s=>{s.usageSemantics.inputModalities='observed_gemini_inline_input_modalities';},s=>{s.usageSemantics.allowedInputModalities=['TEXT','VIDEO','IMAGE'];}]){const s=snapshot();change(s);expect(()=>costFromExactUsageSnapshot(usage(),s)).toThrow();}
    const zero=usage();Object.assign(zero,{input:0,cacheRead:0,output:0,reasoning:0});zero.inputModalities={};expect(costFromExactUsageSnapshot(zero,snapshot())).toBe('0');const missing=snapshot();delete missing.rates.cached_video;expect(()=>costFromExactUsageSnapshot(zero,missing)).toThrow();
  });
  it('retains owned provenance in parsed recovery drafts and refuses count/category erasure, corpus, cross-marker and processing contamination',()=>{
    const draft=v=>attemptRecoveryDraft({resolutionVersion:1},{action:'exact_usage',reason:'owned',evidence:'observed',usageJson:JSON.stringify(v)},'owned-file-recovery');expect(draft(usage()).usage).toEqual(usage());
    for(const change of [v=>{delete v.inputModalities;},v=>{v.inputModalities.IMAGE.input--;},v=>{v.provenance.inputModalities='foreign';},v=>{v.inputModalities.IMAGE.fileUri='private source';},v=>{v.processingToolPromptTokens=0;v.provenance.videoProcessingToolPrompt='observed_gemini_video_processing_tool_prompt_zero';}]){const v=usage();change(v);expect(()=>draft(v)).toThrow();}
  });
  it('prices DOCUMENT and VIDEO only with independent typed rates and keeps inline zero grammar unchanged',()=>{
    const s=snapshot(),u=usage();u.inputModalities.DOCUMENT=u.inputModalities.IMAGE;delete u.inputModalities.IMAGE;s.usageSemantics.allowedInputModalities=['TEXT','VIDEO','DOCUMENT','AUDIO'];s.rates.input_document='4';s.rates.cached_document='0.3';s.rateUnits.input_document=s.rateUnits.cached_document='USD/1M tokens';expect(costFromExactUsageSnapshot(u,s)).toBe('341000');
    const v=usage();v.inputModalities.VIDEO=v.inputModalities.IMAGE;delete v.inputModalities.IMAGE;expect(costFromExactUsageSnapshot(v,snapshot())).toBe('555000');
    const zero=usage();Object.assign(zero,{input:0,cacheRead:0,output:0,reasoning:0});zero.inputModalities={};const inline=snapshot();inline.usageSemantics.inputModalities='observed_gemini_inline_input_modalities';zero.provenance.inputModalities=inline.usageSemantics.inputModalities;expect(()=>costFromExactUsageSnapshot(zero,inline)).toThrow();
    const missing=usage();missing.inputModalities={};expect(()=>costFromExactUsageSnapshot(missing,snapshot())).toThrow();
  });
  it('actual SQL.js recovery owns original309000 despite current100x prices; erased evidence stays unresolved, audit/receipt retry and reopen exact',async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'9router-owned-file-money-')),owner=acquireWriterOwnership(dir),file=path.join(dir,'db.sqlite');let db;
    try{
      db=await createSqlJsAdapter(file,owner);expect(db.driver).toBe('sql.js');await runMigrationOnce(db);db.coverage=openAccountingCoverage(db,owner);db.ownerInstanceId=owner.instanceId;
      insertAttemptSync(db,{attemptId:'owned-file-attempt',requestId:'owned-file-request',apiKeyId:'fixture-key',ownerInstanceId:owner.instanceId,provider:'gemini',model:'fixture-model',endpoint:'chat',startedAt:'2026-10-03T00:00:00.000Z',priceSnapshot:snapshot()});finalizeAttemptSync(db,'owned-file-attempt',{state:'unresolved',outcome:'failed',finishedAt:'2026-10-03T00:01:00.000Z'});
      const erased=usage();delete erased.inputModalities;delete erased.provenance.inputModalities;expect(()=>resolveAttemptSync(db,'owned-file-attempt',operation(erased))).toThrow();expect(getAttemptSync(db,'owned-file-attempt')).toMatchObject({state:'unresolved',costNanoUsd:null});expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toEqual([]);
      const current=snapshot().rates;for(const k of Object.keys(current))current[k]=String(Number(current[k])*100);db.durableTransaction(()=>db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','gemini',?)",[JSON.stringify({'fixture-model':current})]));
      const result=resolveAttemptSync(db,'owned-file-attempt',operation());expect(result).toMatchObject({state:'settled',costNanoUsd:'309000',resolutionVersion:2});expect(resolveAttemptSync(db,'owned-file-attempt',operation())).toEqual(result);const receipt=recoveryReceiptSync(db,'fixture-key',{kind:'attempt',id:'owned-file-attempt'},operation());expect(receipt.costUsd).toBe('0.000309');
      db.close();db=await createSqlJsAdapter(file,owner);db.coverage=openAccountingCoverage(db,owner);expect(db.driver).toBe('sql.js');expect(recoveryReceiptSync(db,'fixture-key',{kind:'attempt',id:'owned-file-attempt'},operation())).toEqual(receipt);expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toHaveLength(1);expect(JSON.stringify(receipt)).not.toContain('fixture-admin');
    }finally{db?.close();owner.release();fs.rmSync(dir,{recursive:true,force:true});}
  },20000);
});
