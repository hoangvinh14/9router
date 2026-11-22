// Scoped actual Next config lint + same-path HEAD baseline, no app imports.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {ESLint} from 'eslint';
assert.equal(process.env.BUDGET_LINT_SANDBOX,'1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),process.env.BUDGET_OUTER_NET);
const base='/app/src/app/(dashboard)/dashboard/endpoint/';
const page=base+'EndpointPageClient.js';
const inputs=[base+'components/AccountingStatus.js',base+'components/accountingStatusClient.js',page];
const baseline=fs.readFileSync(0,'utf8');
assert.ok(baseline.startsWith('"use client";'));
const eslint=new ESLint({cwd:'/app',overrideConfigFile:'/app/eslint.config.mjs',cache:false});
const current=await eslint.lintFiles(inputs);
const before=await eslint.lintText(baseline,{filePath:page});
function report(label,results){
 console.log(label);
 for(const result of results){
  console.log(JSON.stringify({file:result.filePath,errors:result.errorCount,warnings:result.warningCount,fatal:result.fatalErrorCount}));
  for(const message of result.messages)console.log(JSON.stringify(message));
 }
}
report('CURRENT',current);report('HEAD_BASELINE_SAME_CONFIG_SAME_PATH',before);
const pageResult=current.find(r=>r.filePath===page);
assert.ok(pageResult);assert.equal(before.length,1);
// Compare rule/severity plus exact implicated source line; line shifts are visible
// in full diagnostics, but do not turn the new import into a new hook violation.
function signatures(result,source){return result.messages.map(m=>({rule:m.ruleId,severity:m.severity,source:source.split('\n')[m.line-1]?.trim()}));}
const existing = signatures(before[0], baseline).map(signature => JSON.stringify(signature));
for (const signature of signatures(pageResult, fs.readFileSync(page, 'utf8'))) {
 const index = existing.indexOf(JSON.stringify(signature));
 assert.ok(index >= 0, `New Endpoint lint finding: ${JSON.stringify(signature)}`);
 existing.splice(index, 1);
}
for(const result of current.filter(r=>r.filePath!==page))assert.equal(result.errorCount,0);
console.log('No new Endpoint findings compared with HEAD. The budget components have zero lint errors.');
