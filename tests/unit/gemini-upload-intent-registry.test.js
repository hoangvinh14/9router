import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createSqlJsAdapter } from '@/lib/db/adapters/sqljsAdapter.js';
import { acquireWriterOwnership } from '@/lib/db/writerOwnership.js';
import { openAccountingCoverage } from '@/lib/db/accountingCoverage.js';
import { runMigrationOnce } from '@/lib/db/migrate.js';
import { retainKeyBindings } from '@/lib/db/helpers/apiKeyBindings.js';
import { seedGeminiAccountingFixture } from './fixtures/accounting-gemini-db.js';
import { openGeminiResourceLifecycleSync } from '@/lib/apiKeyBudget/geminiResourceLifecycle.js';
function attachLifecycle() { openGeminiResourceLifecycleSync(db, owner); }
let db, owner, dir, file;
const now = '2026-10-03T00:00:00.000Z';
const binding = () => ({ credential: 'dummy-key-a', apiKeyId: 'a', provider: 'gemini', model: 'fixture-gemini', connectionId: 'c' });
const metadata = () => ({ name: 'files/upload-1', uri: 'https://generativelanguage.googleapis.com/v1beta/files/upload-1', mimeType: 'video/mp4', sizeBytes: '17', sha256Hash: Buffer.alloc(32, 1).toString('base64'), createTime: now, updateTime: now, expirationTime: '2026-10-05T00:00:00.000Z', state: 'ACTIVE', source: 'UPLOADED' });
const api = () => import('@/lib/apiKeyBudget/geminiUploadRegistry.js');
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-gemini-upload-registry-')); file = path.join(dir, 'data.sqlite'); owner = acquireWriterOwnership(dir);
  db = await createSqlJsAdapter(file, owner); await runMigrationOnce(db); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId; expect(db.driver).toBe('sql.js'); seedGeminiAccountingFixture(db); attachLifecycle();
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); owner?.release(); fs.rmSync(dir, { recursive: true, force: true }); });
describe('internal owned upload intent registry storage prerequisite, not authenticated upload or admission', () => {
  it('durably retains own pending intent before completion, finalizes once and reopens binding without secrets or accounting corpus', async () => {
    const r = await api(), intent = r.beginGeminiUploadIntentSync(db, binding(), now);
    const pending = JSON.parse(db.get('SELECT value FROM kv WHERE scope=? AND key=?', ['gemini-upload-registry-v1', intent.id]).value); expect(pending.payload.state).toBe('pending');
    const resource = r.completeGeminiUploadIntentSync(db, intent, metadata(), now); expect(resource.id).toBe(intent.id); expect(resource.state).toBe('active'); expect(resource.file).toEqual(metadata());
    expect(r.completeGeminiUploadIntentSync(db, intent, metadata(), now)).toEqual(resource);
    const stored = db.all('SELECT value FROM kv WHERE scope=?', ['gemini-upload-registry-v1']).map(x => x.value).join(''); for (const secret of ['dummy-key-a','dummy-provider']) expect(stored).not.toContain(secret);
    expect(db.all('SELECT * FROM apiKeyAccounting')).toEqual([]); expect(db.all('SELECT * FROM apiKeyAccountingAudit')).toEqual([]);
    db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId; expect(db.driver).toBe('sql.js'); attachLifecycle();
    expect(r.captureGeminiUploadedResourceSync(db, binding(), intent.id, now)).toEqual(resource);
    expect(() => r.completeGeminiUploadIntentSync(db, intent, metadata(), now)).toThrow();
  });
  it('cannot adopt arbitrary file/project metadata without exact module-owned intent, or resume orphan pending metadata after reopen', async () => {
    const r = await api(), intent = r.beginGeminiUploadIntentSync(db, binding(), now);
    expect(() => r.completeGeminiUploadIntentSync(db, { ...intent }, metadata(), now)).toThrow(); expect(() => r.captureGeminiUploadedResourceSync(db, binding(), intent.id, now)).toThrow();
    db.close(); db = await createSqlJsAdapter(file, owner); db.coverage = openAccountingCoverage(db, owner); db.ownerInstanceId = owner.instanceId; attachLifecycle();
    expect(() => r.completeGeminiUploadIntentSync(db, intent, metadata(), now)).toThrow(); expect(JSON.parse(db.get('SELECT value FROM kv WHERE scope=? AND key=?',['gemini-upload-registry-v1',intent.id]).value).payload.state).toBe('pending');
  });
  it('rechecks gateway key binding, connection credentials and coverage generation on completion and every capture', async () => {
    const r = await api(), intent = r.beginGeminiUploadIntentSync(db, binding(), now); r.completeGeminiUploadIntentSync(db, intent, metadata(), now);
    db.durableTransaction(() => { db.run('INSERT INTO apiKeys(id,key,isActive,createdAt) VALUES(?,?,1,?)',['b','dummy-key-b',now]); retainKeyBindings(db,db.coverage,[{id:'b',key:'dummy-key-b'}]); });
    expect(() => r.captureGeminiUploadedResourceSync(db, {...binding(),apiKeyId:'b',credential:'dummy-key-b'},intent.id,now)).toThrow();
    const second = r.beginGeminiUploadIntentSync(db,binding(),now);
    db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?',[JSON.stringify({apiKey:'changed-dummy-provider'}),'c']));
    expect(() => r.completeGeminiUploadIntentSync(db,second,metadata(),now)).toThrow(); expect(() => r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow();
    db.durableTransaction(() => db.run('UPDATE providerConnections SET data=? WHERE id=?',[JSON.stringify({apiKey:'dummy-provider'}),'c']));
    db.coverage.latchGap('a','fixture managed restore generation'); expect(() => r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow();
  });
  it('preserves durable revocation across reopen and rejects exact expiry or stale before-completion metadata', async () => {
    const r = await api(), intent = r.beginGeminiUploadIntentSync(db,binding(),now); r.completeGeminiUploadIntentSync(db,intent,metadata(),now);
    expect(() => r.captureGeminiUploadedResourceSync(db,binding(),intent.id,metadata().expirationTime)).toThrow();
    expect(r.revokeGeminiUploadedResourceSync(db,binding(),intent.id,now).state).toBe('revoked'); expect(() => r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow(); expect(() => r.completeGeminiUploadIntentSync(db,intent,metadata(),now)).toThrow();
    db.close(); db = await createSqlJsAdapter(file,owner); db.coverage = openAccountingCoverage(db,owner); db.ownerInstanceId = owner.instanceId; attachLifecycle(); expect(() => r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow();
    const expiredIntent = r.beginGeminiUploadIntentSync(db,binding(),now); expect(() => r.completeGeminiUploadIntentSync(db,expiredIntent,metadata(),metadata().expirationTime)).toThrow();
  });
  it('refuses malformed/getter/proxy bindings and invalid metadata before resource writes, with unchanged pending row', async () => {
    const r = await api(); for (const change of [x=>{x.apiKeyId='b';},x=>{x.connectionId=null;},x=>{x.provider='vertex';},x=>{x.claimedOwner='a';}]) {const b=binding();change(b);expect(()=>r.beginGeminiUploadIntentSync(db,b,now)).toThrow();}
    const getter = vi.fn(), b=binding(); Object.defineProperty(b,'credential',{enumerable:true,get:getter}); expect(()=>r.beginGeminiUploadIntentSync(db,b,now)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const trap=vi.fn(); expect(()=>r.beginGeminiUploadIntentSync(db,new Proxy(binding(),{ownKeys:trap,get:trap}),now)).toThrow();expect(trap).not.toHaveBeenCalled();
    const intent=r.beginGeminiUploadIntentSync(db,binding(),now), before=db.get('SELECT value FROM kv WHERE scope=? AND key=?',['gemini-upload-registry-v1',intent.id]).value;
    expect(()=>r.completeGeminiUploadIntentSync(db,intent,{...metadata(),source:'GENERATED'},now)).toThrow(); expect(db.get('SELECT value FROM kv WHERE scope=? AND key=?',['gemini-upload-registry-v1',intent.id]).value).toBe(before);
  });
  it('rejects altered stored binding/metadata and duplicate resource identity, preserving original active record', async () => {
    const r=await api(), first=r.beginGeminiUploadIntentSync(db,binding(),now); r.completeGeminiUploadIntentSync(db,first,metadata(),now);
    const second=r.beginGeminiUploadIntentSync(db,binding(),now); expect(()=>r.completeGeminiUploadIntentSync(db,second,metadata(),now)).toThrow();
    expect(()=>r.completeGeminiUploadIntentSync(db,first,{...metadata(),sizeBytes:'18'},now)).toThrow();
    const before=db.get('SELECT value FROM kv WHERE scope=? AND key=?',['gemini-upload-registry-v1',first.id]).value, damaged=JSON.parse(before); damaged.payload.file.mimeType='application/pdf';
    db.durableTransaction(()=>db.run('UPDATE kv SET value=? WHERE scope=? AND key=?',[JSON.stringify(damaged),'gemini-upload-registry-v1',first.id])); expect(()=>r.captureGeminiUploadedResourceSync(db,binding(),first.id,now)).toThrow();
    db.durableTransaction(()=>db.run('UPDATE kv SET value=? WHERE scope=? AND key=?',[before,'gemini-upload-registry-v1',first.id])); expect(r.captureGeminiUploadedResourceSync(db,binding(),first.id,now).file).toEqual(metadata());
  });
  it('withholds resource return on uncertain completion persistence and leaves only pending intent on disk before rename', async () => {
    const r=await api(), intent=r.beginGeminiUploadIntentSync(db,binding(),now), real=fs.renameSync;
    vi.spyOn(fs,'renameSync').mockImplementation((from,to)=>{if(to===file)throw new Error('fixture completion persist failed');return real(from,to);});
    expect(()=>r.completeGeminiUploadIntentSync(db,intent,metadata(),now)).toThrow(); expect(db.health().healthy).toBe(false); expect(()=>r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow();
    vi.restoreAllMocks(); db.close(); db=await createSqlJsAdapter(file,owner); db.coverage=openAccountingCoverage(db,owner); db.ownerInstanceId=owner.instanceId; attachLifecycle();
    expect(JSON.parse(db.get('SELECT value FROM kv WHERE scope=? AND key=?',['gemini-upload-registry-v1',intent.id]).value).payload.state).toBe('pending'); expect(()=>r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow();
  });
  it('rejects restored valid signed active row after revocation, including reopened adapter', async () => {
    const r=await api(), intent=r.beginGeminiUploadIntentSync(db,binding(),now); r.completeGeminiUploadIntentSync(db,intent,metadata(),now);
    const old=db.get('SELECT value FROM kv WHERE scope=? AND key=?',['gemini-upload-registry-v1',intent.id]).value;
    r.revokeGeminiUploadedResourceSync(db,binding(),intent.id,now);
    db.durableTransaction(()=>db.run('UPDATE kv SET value=? WHERE scope=? AND key=?',[old,'gemini-upload-registry-v1',intent.id]));
    expect(()=>r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow();
    db.close(); db=await createSqlJsAdapter(file,owner); db.coverage=openAccountingCoverage(db,owner); db.ownerInstanceId=owner.instanceId; attachLifecycle();
    expect(()=>r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow();
  });
  it('fails closed if external lifecycle receipts are deleted or corrupted, never initializes over existing resources', async () => {
    const r=await api(), intent=r.beginGeminiUploadIntentSync(db,binding(),now); r.completeGeminiUploadIntentSync(db,intent,metadata(),now);
    const sidecar=path.join(dir,'.gemini-resource-lifecycle.json'); expect(fs.existsSync(sidecar)).toBe(true); const saved=fs.readFileSync(sidecar);
    fs.unlinkSync(sidecar); expect(()=>r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow(); expect(()=>r.beginGeminiUploadIntentSync(db,binding(),now)).toThrow();
    fs.writeFileSync(sidecar,saved); const bad=JSON.parse(saved); bad.signature='0'.repeat(64); fs.writeFileSync(sidecar,JSON.stringify(bad)); expect(()=>r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow();
  });
  it('withholds upload handle when external receipt persistence fails before DB intent write', async () => {
    const r=await api(), real=fs.renameSync, sidecar=path.join(dir,'.gemini-resource-lifecycle.json');
    vi.spyOn(fs,'renameSync').mockImplementation((from,to)=>{if(to===sidecar)throw new Error('fixture lifecycle receipt failed');return real(from,to);});
    expect(()=>r.beginGeminiUploadIntentSync(db,binding(),now)).toThrow(); expect(db.all('SELECT * FROM kv WHERE scope=?',['gemini-upload-registry-v1'])).toEqual([]);
    vi.restoreAllMocks(); expect(()=>r.beginGeminiUploadIntentSync(db,binding(),now)).toThrow();
  });
  it('external completion receipt precedes uncertain DB write and refuses old pending row after reopen', async () => {
    const r=await api(), intent=r.beginGeminiUploadIntentSync(db,binding(),now), real=fs.renameSync;
    vi.spyOn(fs,'renameSync').mockImplementation((from,to)=>{if(to===file)throw new Error('fixture db failed after receipt');return real(from,to);});
    expect(()=>r.completeGeminiUploadIntentSync(db,intent,metadata(),now)).toThrow(); vi.restoreAllMocks(); db.close();
    db=await createSqlJsAdapter(file,owner); db.coverage=openAccountingCoverage(db,owner); db.ownerInstanceId=owner.instanceId; attachLifecycle();
    expect(JSON.parse(db.get('SELECT value FROM kv WHERE scope=? AND key=?',['gemini-upload-registry-v1',intent.id]).value).payload.state).toBe('pending');
    expect(()=>r.revokeGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow();
  });
  it('rejects signed sidecar rollback within a live owner and refuses fabricated ownership initialization', async () => {
    const r=await api(), intent=r.beginGeminiUploadIntentSync(db,binding(),now); r.completeGeminiUploadIntentSync(db,intent,metadata(),now);
    const sidecar=path.join(dir,'.gemini-resource-lifecycle.json'), old=fs.readFileSync(sidecar); r.revokeGeminiUploadedResourceSync(db,binding(),intent.id,now);
    fs.writeFileSync(sidecar,old); expect(()=>r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow(); expect(()=>r.beginGeminiUploadIntentSync(db,binding(),now)).toThrow();
    expect(()=>openGeminiResourceLifecycleSync(db,{...owner})).toThrow();
  });
  it('refuses symlinked lifecycle receipt and missing receipt after adapter reopen rather than adopting project resources', async () => {
    const r=await api(), intent=r.beginGeminiUploadIntentSync(db,binding(),now); r.completeGeminiUploadIntentSync(db,intent,metadata(),now);
    const sidecar=path.join(dir,'.gemini-resource-lifecycle.json'), target=path.join(dir,'fixture-sidecar-copy'); fs.copyFileSync(sidecar,target); fs.unlinkSync(sidecar); fs.symlinkSync(target,sidecar);
    expect(()=>r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow(); fs.unlinkSync(sidecar);
    db.close(); db=await createSqlJsAdapter(file,owner); db.coverage=openAccountingCoverage(db,owner); db.ownerInstanceId=owner.instanceId; attachLifecycle();
    expect(()=>r.captureGeminiUploadedResourceSync(db,binding(),intent.id,now)).toThrow(); expect(()=>r.beginGeminiUploadIntentSync(db,binding(),now)).toThrow();
  });
  it('failed durable intent persistence never returns an upload handle and cannot recover authority from poisoned RAM', async () => {
    const r = await api(), real=fs.renameSync; vi.spyOn(fs,'renameSync').mockImplementation((from,to)=>{if(to===file)throw new Error('fixture registry persist failed');return real(from,to);});
    expect(()=>r.beginGeminiUploadIntentSync(db,binding(),now)).toThrow(); expect(db.health().healthy).toBe(false);
    expect(()=>r.beginGeminiUploadIntentSync(db,binding(),now)).toThrow();
  });
});
