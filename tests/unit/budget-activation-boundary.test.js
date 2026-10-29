import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const root=path.resolve(import.meta.dirname,'../..');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
describe('shipping accounting activation boundary',()=>{
  it('has no shipping caller of private fixture association functions',()=>{
    for(const file of files(path.join(root,'src')).filter(file=>/\.[cm]?jsx?$/.test(file))){
      const source=fs.readFileSync(file,'utf8');
      for(const name of ['associateBudgetManagementFixture','associateChatAccountingFixture']){
        if(!source.includes(name))continue;
        const owner=name==='associateBudgetManagementFixture'?'src/lib/accounting/budget-management.js':'src/sse/services/chat-accounting.js';
        expect(path.relative(root,file)).toBe(owner);expect(source.match(new RegExp(`${name}\\s*\\(`,'g'))).toHaveLength(1);
      }
    }
  });
  it('management readiness is private request identity, not env/header/body setting',()=>{
    const source=fs.readFileSync(path.join(root,'src/lib/accounting/budget-management.js'),'utf8');
    expect(source).toContain('const fixtures = new WeakMap()');expect(source).not.toContain('process.env');expect(source).not.toContain('request.headers');expect(source).not.toContain('request.json');
    expect(source).toContain("throw fail(409,'accounting_not_ready'");
  });
});
