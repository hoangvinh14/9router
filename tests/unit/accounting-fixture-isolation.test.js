import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { assertAccountingIsolation } from '../fixtures/accounting/isolation-attestation.mjs';
import { openResponsesFixture } from '../fixtures/accounting/responses-loopback.js';
import { saveRequestUsage, saveRequestDetail, appendRequestLog } from '@/lib/usageDb.js';
import { getAdapter } from '../../src/lib/db/driver.js';

describe('OS-enforced accounting fixture containment',()=>{
  it('attests before imports and contains inherited subprocess writes and SQLite opens',()=>{
    const root=assertAccountingIsolation();
    const child=spawnSync(process.execPath,['--input-type=module','-e',`
      import fs from 'node:fs'; import {DatabaseSync} from 'node:sqlite';
      let denied=0;
      for(const f of [()=>fs.writeFileSync('/isolation-canary','escape'),()=>new DatabaseSync('/escape.sqlite'),
        ()=>fs.readFileSync(process.env.R1_HIDDEN_CANARY)]){try{f()}catch{denied++}}
      const db=new DatabaseSync(process.env.DATA_DIR+'/probe.sqlite');db.exec('CREATE TABLE probe(n)');db.close();
      console.log(JSON.stringify({denied,net:fs.readlinkSync('/proc/self/ns/net')}));
    `],{encoding:'utf8'});
    expect(child.status).toBe(0);const proof=JSON.parse(child.stdout);
    expect(proof.denied).toBe(3);expect(proof.net).not.toBe(process.env.R1_OUTER_NET);
    expect(fs.existsSync(path.join(root,'data','probe.sqlite'))).toBe(true);
  });
  it('contains invalid DATA_DIR fallback inside private HOME and refuses forged attestation',()=>{
    const moduleUrl=new URL('../../src/lib/dataDir.js',import.meta.url).href;
    const child=spawnSync(process.execPath,['--input-type=module','-e',`
      try { await import(${JSON.stringify(moduleUrl)}); process.exitCode=2; }
      catch(error) { console.log(JSON.stringify({code:error.code,syscall:error.syscall,path:error.path})); process.exitCode=1; }
    `],{env:{...process.env,DATA_DIR:'/read-only-fixture/denied-data-root'},encoding:'utf8'});
    const diagnostic=spawnSync(process.execPath,['--input-type=module','-e',`
      import fs from 'node:fs';
      const capture=fn=>{try{fn();return {allowed:true}}catch(error){return {code:error.code,syscall:error.syscall,path:error.path}}};
      const parent='/read-only-fixture';
      console.log(JSON.stringify({directory:fs.statSync(parent).isDirectory(),
        mount:fs.readFileSync('/proc/self/mountinfo','utf8').split('\\n').find(line=>line.split(' ')[4]===parent),
        mkdir:capture(()=>fs.mkdirSync(parent+'/probe')),
        recursive:capture(()=>fs.mkdirSync(parent+'/probe',{recursive:true})),
        write:capture(()=>fs.writeFileSync(parent+'/probe-file','probe'))}));
    `],{encoding:'utf8'});
    expect(diagnostic.status).toBe(0);const proof=JSON.parse(diagnostic.stdout);
    console.log('read-only-mkdir-diagnostic',proof);
    expect(proof.directory).toBe(true);expect(proof.mount.split(' ')[5].split(',')).toContain('ro');
    expect(proof.mkdir.code).toBe('EROFS');expect(proof.write.code).toBe('EROFS');
    expect(child.status).toBe(1);expect(JSON.parse(child.stdout)).toEqual({...proof.recursive,path:'/read-only-fixture/denied-data-root'});
    expect(fs.existsSync('/read-only-fixture/denied-data-root')).toBe(false);
    expect(fs.existsSync(`${process.env.HOME}/.9router`)).toBe(false);
    // Exercise the application's EACCES fallback separately. The OS namespace
    // still constrains it: default HOME is private, never the operator profile.
    const fallback=spawnSync(process.execPath,['--input-type=module','-e',`
      import fs from 'node:fs';
      const mkdir=fs.mkdirSync;fs.mkdirSync=(target,...args)=>{
        if(target==='/denied-data-root')throw Object.assign(new Error('sacrificial EACCES'),{code:'EACCES'});
        return mkdir(target,...args);
      };
      const {getDataDir}=await import(${JSON.stringify(moduleUrl)});
      console.log(JSON.stringify({dir:getDataDir()}));
    `],{env:{...process.env,DATA_DIR:'/denied-data-root'},encoding:'utf8'});
    expect(fallback.status).toBe(0);expect(JSON.parse(fallback.stdout).dir).toBe(`${process.env.HOME}/.9router`);
    const config=new URL('../vitest.accounting-isolated.config.js',import.meta.url).href;
    const forged=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(config)})`],
      {env:{...process.env,R1_OUTER_NET:fs.readlinkSync('/proc/self/ns/net')},encoding:'utf8'});
    expect(forged.status).not.toBe(0);expect(forged.stderr).toContain('Private network namespace required');
  });
  it('uses the same legacy-only boundary in spawned actual-process fixtures',()=>{
    const loader=new URL('../fixtures/accounting/chat-module-loader.mjs',import.meta.url).pathname;
    const child=spawnSync(process.execPath,['--import',loader,'--input-type=module','-e',`
      import fs from 'node:fs';import {saveRequestUsage,saveRequestDetail,appendRequestLog} from '@/lib/usageDb.js';
      await Promise.all([saveRequestUsage({}),saveRequestDetail({}),appendRequestLog({})]);
      if(fs.existsSync(process.env.DATA_DIR+'/db'))throw new Error('Legacy child persistence initialized DB');
      console.log('legacy-boundary-contained');
    `],{encoding:'utf8'});
    expect(child.status).toBe(0);expect(child.stdout).toContain('legacy-boundary-contained');
  });
  it('contains late presentation calls overlapping the next fixture without default adapter initialization',async()=>{
    const first=await openResponsesFixture('node');
    const response=await first.request();expect(response.status).toBe(200);await response.text();
    expect(first.db.get('SELECT state FROM apiKeyAccounting').state).toBe('settled');
    await first.close();
    await expect(getAdapter()).rejects.toThrow();
    const second=await openResponsesFixture('sqljs');
    try{
      await Promise.all([saveRequestUsage({provider:'late',model:'late',tokens:{prompt_tokens:1}}),saveRequestDetail({model:'late'}),appendRequestLog({status:'late'})]);
      expect(second.db.all('SELECT * FROM apiKeyAccounting')).toEqual([]);
      expect(second.db.all('SELECT * FROM usageHistory')).toEqual([]);
      expect(fs.existsSync(path.join(process.env.DATA_DIR,'db'))).toBe(false);
    }finally{await second.close();}
    await expect(getAdapter()).rejects.toThrow();
  });
});
