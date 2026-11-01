import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const root=path.resolve(import.meta.dirname,'../..');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
const owners = {
  associateBudgetManagementFixture:'src/lib/accounting/budget-management.js',
  associateChatAccountingFixture:'src/sse/services/chat-accounting.js',
  associateEmbeddingsAccountingFixture:'src/sse/services/embeddings-accounting.js',
};
function forbiddenAssociations(entries) {
  return entries.flatMap(([file,source]) => Object.entries(owners).flatMap(([name,owner]) => {
    if (!source.includes(name)) return [];
    // Owner must only declare the capability, never alias/export it through a
    // second reference. This is a lexical tripwire, not a reachability proof.
    const count = source.match(new RegExp(`\\b${name}\\b`,'g'))?.length || 0;
    return file === owner && count === 1 && source.includes(`export function ${name}(`) ? [] : [`${file}:${name}`];
  }));
}
describe('shipping accounting activation boundary',()=>{
  it('has no shipping caller of private fixture association functions in src or open-sse',()=>{
    const entries = ['src','open-sse'].flatMap(dir => files(path.join(root,dir)))
      .filter(file=>/\.[cm]?jsx?$/.test(file)).map(file => [path.relative(root,file),fs.readFileSync(file,'utf8')]);
    expect(forbiddenAssociations(entries)).toEqual([]);
  });
  it.each(['src/forbidden.js','open-sse/handlers/forbidden.js'])('same scanner rejects synthetic E1 import/call in %s',file=>{
    expect(forbiddenAssociations([[file,"import {associateEmbeddingsAccountingFixture} from './embeddings-accounting.js'; associateEmbeddingsAccountingFixture(request, db);"]]))
      .toEqual([`${file}:associateEmbeddingsAccountingFixture`]);
  });
  it('rejects owner-file aliasing as well as direct activation',()=>{
    const owner=owners.associateEmbeddingsAccountingFixture;
    expect(forbiddenAssociations([[owner,'export function associateEmbeddingsAccountingFixture() {} const activate = associateEmbeddingsAccountingFixture; activate(request, db);']]))
      .toEqual([`${owner}:associateEmbeddingsAccountingFixture`]);
  });
  it('management readiness is private request identity, not env/header/body setting',()=>{
    const source=fs.readFileSync(path.join(root,'src/lib/accounting/budget-management.js'),'utf8');
    expect(source).toContain('const fixtures = new WeakMap()');expect(source).not.toContain('process.env');expect(source).not.toContain('request.headers');expect(source).not.toContain('request.json');
    expect(source).toContain("throw fail(409,'accounting_not_ready'");
  });
});
